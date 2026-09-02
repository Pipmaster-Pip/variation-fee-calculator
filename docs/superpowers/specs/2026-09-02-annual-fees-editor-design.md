# Jahresgebühren im Gebühren-Editor

**Datum:** 2026-09-02
**Status:** Design, freigegeben — Implementierungsplan folgt

## Problem

Bei der Ablösung der Excel-Tabelle durch den Gebühren-Editor in wp-admin
(Option `vcl_fee_overrides`, ausgeliefert mit v1.18.0) wurden die
Jahresgebühren übersehen. Sie sind der einzige Datenbestand des Plugins, der
weiterhin nur über die Excel-Datei und den Konverter gepflegt werden kann.

Konkret:

- Die Daten kommen ausschließlich aus `assets/js/vcl-annual-data.js`, erzeugt
  von `convert-annual-fees.py` aus dem Blatt „Annual Fees" von
  `Variation-Fee-Calculator-EU.xlsx`.
- `assets/js/vcl-budget.js` liest `window.VCL_ANNUAL_DATA.COUNTRIES` und
  `FALLBACK_FX` direkt und ungefiltert — es gibt keinerlei Override-Schicht.
- `vcl_fee_editable_fields()` in `includes/fee-editor.php` kennt nur die
  Spalten der Variation-Gebührentabelle (F, G, H, I, J, K, T, U, V).
- `applyOverrides()` in `assets/js/vcl-calc-app.js` referenziert
  `VCL_ANNUAL_DATA` nirgends.

Es fehlt also nicht bloß die Befüllung, sondern die gesamte Verdrahtung.

## Ziel

Jahresgebühren lassen sich im Gebühren-Editor pflegen — im selben Land, auf
derselben Seite, mit denselben Mechanismen (Overlay, Export/Import,
Verwerfen, Zähler) wie die Variation-Gebühren.

## Nicht-Ziele

Bewusst außen vor, um den Eingriff klein zu halten:

- **Struktur bearbeiten.** Welche Tarife ein Land hat, wie sie heißen, in
  welcher Währung sie geführt werden, welcher der Standard ist, ob ein Land
  überhaupt eine Jahresgebühr kennt — das bleibt Sache der Datendatei.
- **`FALLBACK_FX`.** Diese Kurse greifen nur, wenn weder ein Live-Kurs noch
  die statischen Kurse des Calculators die Währung abdecken. Ein Notnagel,
  kein Pflegefall.
- **Öffentliche Fee-data-Seite.** Die Jahresgebühren tauchen dort vorerst
  nicht auf. Bewusste Entscheidung, später separat nachziehbar.
- **Die Excel.** Sie bleibt Ursprung der ausgelieferten Baseline, genau wie
  bei den Variation-Gebühren. Der Editor legt sich darüber, er ersetzt sie
  nicht.

## Datenmodell

Neuer Zweig in der Option `vcl_fee_overrides`, sparse wie `rows` und
`points`:

```
annual: {
  "AT": {
    "rms":      { "base": 4100, "addStrength": 4100 },
    "national": { "base": 1750 }
  },
  "UK": {
    "pom_standard": { "base": 2950, "addStrength": 2950 }
  }
}
```

- Schlüssel der ersten Ebene ist der Ländercode (`cc` aus
  `VCL_ANNUAL_DATA.COUNTRIES`).
- Schlüssel der zweiten Ebene ist die Tarif-`id` derselben Datenquelle
  (`rms`, `cms`, `national`, `all`, `pom_standard`, …).
- Erlaubte Felder: ausschließlich `base` und `addStrength`, beide Zahlen.
- Ein Eintrag existiert nur, wo der Wert von dem der Datendatei abweicht. Ein
  unangetastetes Land speichert gar nichts.
- Beträge stehen in der Währung des jeweiligen Tarifs (`ccy`), nicht in EUR.
  Das ist die Währung, in der die Behörde die Gebühr veröffentlicht — dieselbe
  Logik wie „lokale Währung führt" bei den Variation-Gebühren.

Ein Tarif mit `addStrength: null` in der Datendatei skaliert nicht mit der
Zahl der Stärken. Für ihn ist `addStrength` im Overlay **nicht** zulässig; ein
gesetzter Wert würde die Struktur ändern und wird beim Speichern verworfen.

### Validierung beim Speichern

`vcl_sanitize_fee_overrides()` (oder eine parallele Funktion daneben) prüft
den `annual`-Zweig gegen die ausgelieferte Datenstruktur:

- Unbekannter Ländercode → Eintrag verworfen.
- Unbekannte Tarif-`id` für dieses Land → Eintrag verworfen.
- Anderes Feld als `base`/`addStrength` → verworfen.
- `addStrength` bei einem Tarif mit `addStrength: null` → verworfen.
- Nicht-numerischer oder negativer Wert → verworfen.
- Wert gleich dem ausgelieferten → nicht gespeichert (hält das Overlay sparse).

Damit der PHP-Code die Struktur kennt, braucht er eine Sicht auf die
Annual-Daten, die als JS-Datei vorliegen. Gewählte Lösung:
`convert-annual-fees.py` schreibt künftig **zusätzlich** eine
`assets/data/annual-fees.json` mit demselben Inhalt. PHP liest diese Datei
(gecacht in einem Transient), JS bleibt bei der bisherigen `.js`-Datei. Kein
Parsen von JavaScript in PHP, und die beiden Dateien können nicht
auseinanderlaufen, weil derselbe Lauf beide erzeugt.

## UI

Ein zusätzlicher Abschnitt „Jahresgebühr" in `renderCountry()`
(`assets/js/vcl-fee-editor.js:578`), eingehängt **nach** den Rollen-Blöcken
(RMS → CMS → national → EMA) und **vor** der Regeln-Box `rulesSection()`.

Aufbau wie die bestehenden Gruppen (`vclfe-group` mit `vclfe-group__head`):

- Kopfzeile „Jahresgebühr" mit kurzem Untertitel, der klarstellt, dass es um
  die wiederkehrende Zulassungsgebühr geht — nicht um die einmalige
  Variation-Gebühr darüber.
- Pro Tarif eine Zeile: Label links (`label` aus der Datendatei, z. B. „RMS",
  „POM – standard", „Art. 10(1)/(3) & 10c"), rechts zwei Felder:
  **Grundbetrag** und **Je weitere Stärke**.
- Beträge werden in der Währung des Tarifs eingegeben und angezeigt. Bei
  Nicht-EUR-Tarifen steht der umgerechnete EUR-Betrag als graue Nebeninfo
  daneben, wie sonst auch.
- Tarife mit `addStrength: null`: das zweite Feld ist ausgegraut und
  nicht befüllbar, mit Hinweis „skaliert nicht mit der Zahl der Stärken".
- Ist ein Wert gegenüber der Datendatei geändert, wird die Zeile genauso
  markiert wie eine geänderte Variation-Zeile, und der Zähler
  „ungespeicherte Änderungen" im Kopf zählt sie mit.

### Länder ohne editierbare Tarife

Der Abschnitt erscheint **immer**, auch wenn es nichts einzugeben gibt. Sonst
sieht „nicht vorhanden" aus wie „vergessen" — der Fehler, der überhaupt zu
dieser Spec geführt hat.

- `hasAnnual: false` (DE, FR, PT, CY, LT, NO, SK, RS): Hinweiszeile
  „Keine Jahresgebühr."
- `turnoverBased: true` mit leeren `tariffs` (BE, CH, EL): die in der
  Datendatei hinterlegte `note` als Hinweiszeile, z. B. „Annual fee per packs
  sold" — plus ein Satz, dass sich eine umsatzabhängige Gebühr nicht als
  fester Betrag pflegen lässt.

## Verdrahtung

**Serverseitig** (`includes/lookup.php:319`): Der `annual`-Zweig wird mit in
`window.VCLCALC_OVERRIDES` gedruckt. Die Bedingung eine Zeile darüber prüft
bisher nur `rows`/`points`/`countries`/`imprint` — sie muss `annual`
einschließen, sonst bleibt das Overlay unsichtbar, wenn ausschließlich
Jahresgebühren geändert wurden.

**Clientseitig:** Neues Mini-Modul `assets/js/vcl-annual-overrides.js`, in
`lookup.php` registriert zwischen `vcl-annual-data` und `vcl-budget-engine`
und als Abhängigkeit von letzterem geführt. Es:

1. nimmt beim ersten Lauf einen Snapshot der ausgelieferten `base`/
   `addStrength`-Werte (analog `SHIPPED_AMOUNTS` in `vcl-calc-app.js`),
2. setzt vor jedem Anwenden auf diesen Snapshot zurück,
3. legt dann `VCLCALC_OVERRIDES.annual` darüber.

Damit ist das Anwenden **idempotent** — nötig, weil die Live-Vorschau des
Editors dieselbe Kette mehrfach durchläuft.

Die generierte Datei `vcl-annual-data.js` wird dabei **nicht** angefasst; sie
trägt „DO NOT EDIT BY HAND" und wird vom Konverter neu geschrieben.

`vcl-budget.js` (Zeilen 441, 451) bleibt unverändert: es liest weiterhin
`window.VCL_ANNUAL_DATA.COUNTRIES`, nur ist das Objekt zu diesem Zeitpunkt
bereits überlagert.

## Bestandspflege

Der `annual`-Zweig muss überall dort mitlaufen, wo `vcl_fee_overrides` als
Ganzes behandelt wird — sonst exportiert der Editor stillschweigend
unvollständig:

- `vcl_count_fee_overrides()` — Jahresgebühren zählen mit.
- Export (`vclfe_export`) — `annual` wandert in die JSON-Datei.
- Import (`vclfe_import`) — `annual` wird gelesen und validiert.
- „Alle gespeicherten Änderungen löschen" (`vclfe_clear`) — löscht auch
  Jahresgebühren.
- „Stand vor dem letzten Import zurückholen" (`vclfe_undo_import`) — arbeitet
  ohnehin auf der ganzen Option, braucht aber einen Test.
- „Verwerfen" im Editor (`savedAnnual` als pristine Baseline, analog
  `savedCountries`).

## Verifikation

Ein „0 Abweichungen" beweist hier nichts, solange nicht gezeigt ist, dass die
Kette überhaupt etwas durchlässt. Deshalb als Abnahme ein **gepflanzter
Ausschlag**:

1. Im Editor die AT-RMS-Jahresgebühr von 3.965 auf einen deutlich anderen
   Wert setzen und speichern.
2. Im Budget-Tool eine Planzeile mit AT als RMS anlegen und prüfen, dass die
   Annual-Tabelle den geänderten Betrag zeigt — nicht den alten.
3. Änderung verwerfen, prüfen, dass wieder 3.965 erscheint.

Erst wenn Schritt 2 den Ausschlag zeigt, ist ein späteres „unverändert"
aussagekräftig.

Zusätzlich:

- Export → Import in eine leere Installation → derselbe Stand, inklusive
  Jahresgebühren.
- Doppeltes Anwenden des Overlays (Editor-Vorschau) verändert die Werte nicht
  (Idempotenz).
- Ein Tarif mit `addStrength: null` (z. B. EE-RMS, IT, HU) lässt sich nicht
  mit einem Stärken-Aufschlag versehen.

## Versionierung

`Version:`-Header und `VFC_VERSION` werden mit der Änderung hochgezählt
(Projektregel), danach Memory und Obsidian nachgezogen.
