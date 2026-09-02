# Design: Baustein E — Öffentliche Gebührenseite im Fee Calculator

**Datum:** 2026-09-01
**Plugin:** Variation Toolbox (`variation-fee-calculator`)
**Teil von:** Ablösung der Excel als Gebührenquelle (Bausteine A–F)
**Mockup:** `https://claude.ai/code/artifact/27fefe3b-a2f1-4e54-aded-b16671eb8982`
**Betrifft:** `assets/js/vcl-calc-app.js`, `assets/css/vcl-calc-style.css`, `convert.py`,
`assets/js/vcl-fee-editor.js`, `includes/admin.php`

## Ziel

Eine öffentliche Seite, auf der je Land steht, **welche Gebühren gelten, woher sie
stammen und wann sie zuletzt geprüft wurden** — und auf der man mit denselben
Sätzen eine schnelle Beispielrechnung anstellen kann.

Sie beantwortet zwei Fragen in einer Ansicht: *„So rechnen wir"* (Transparenz) und
*„Was kostet das in meinem Land?"* (Nachschlagen).

## Abgrenzung

**Nicht Teil von E:**

- **Server-Rechnung.** Ursprünglich kam der Wunsch aus dem Befund, dass
  `vcl-calc-data.js` alle Beträge und Formeln im Klartext ausliefert. Diese
  Sorge ist am 2026-09-01 ausdrücklich verworfen worden: die Beträge sollen
  offen liegen, und die Formeln bilden öffentliche Gebührenordnungen ab. Eine
  PHP-Portierung des Interpreters brächte keinen realen Schutz (Sätze lassen
  sich durch Durchprobieren rekonstruieren) und wäre ein hohes
  Regressionsrisiko für alle Module.
- **Datumsangaben in den Ergebnistabellen** von Fee Calculator, Guided Workflow
  und Budget Planning. Bewusst verworfen: die Übersichtstabelle bleibt
  unverändert.
- **Der Gebühren-Editor selbst.** Der ist mit v1.12.0 vorhanden; E erweitert ihn
  nur um vier Felder je Land (siehe E4).

**Offen, außerhalb dieses Specs:**

- Wo genau im Fee Calculator die Seite referenziert wird. Festgelegt ist nur:
  **vorerst ausschließlich im Calculator**, nicht in Guided Workflow oder Budget
  Planning.

## Befunde aus der Code-Analyse (verbindliche Grundlage)

Diese vier Punkte wurden vor dem Entwurf am Code und an der Excel verifiziert.
Sie sind der Grund dafür, dass E deutlich kleiner ausfällt als zunächst
angenommen.

### E-B1 — Die Metadaten je Land liegen bereits ausgeliefert vor

Das Excel-Blatt **„HA fee websites"** (33 Zeilen, alle Felder lückenlos gefüllt)
wird von `convert.py` bereits gelesen und als `HA_WEBSITES` nach
`vcl-calc-data.js` geschrieben:

```json
{"cc":"IT","link_text":"AIFA","link_url":"https://www.aifa.gov.it/tariffe",
 "updated_calc":"2026-05-11","checked_ha":"2026-05-11",
 "payment":"proof of payment","annual":null}
```

Damit sind `geprüft am` (`checked_ha`), `zuletzt geändert` (`updated_calc`),
Behördenlink und Zahlungsweise **ohne neue Datenarbeit** verfügbar.

Angezeigt werden sie heute nur gesammelt hinter einem Button
(`renderHaWebsitesList`, `vcl-calc-app.js:1303`) — als Liste über alle 33 Länder,
nicht je Land im Kontext.

### E-B2 — Genau ein Feld fehlt: die Quellenangabe

Spalte C des Blattes („comments") trägt die Quellenangabe, z. B. für Italien
*„Elenco Tariffe aggiornato ad Luglio 2025"*. `convert.py:350` schließt sie
ausdrücklich aus („C = comments (intentionally excluded)"). Das ist die einzige
Datenlücke in E.

### E-B3 — Die Spaltenbedeutung steht in der Excel-Kopfzeile

Aus Zeile 2/3 des Blattes „Variation fee calculator":

| Feld | Bedeutung |
|------|-----------|
| `F` | 1. Variation, 1. Stärke |
| `G` | je weitere Stärke |
| `H` | je weitere Variation Typ IA |
| `I` | je weitere Variation Typ IB |
| `J` | je weitere Variation Typ II |
| `K` | **Gruppierung** — Festbetrag, falls vorhanden |

`K` ist **nicht** „je weitere II". Die Spaltenüberschriften der öffentlichen
Seite müssen dieser Zuordnung folgen.

### E-B4 — Landeswährung und Umschalter existieren bereits

Zehn Länder rechnen nicht in Euro (`CC_TO_CURRENCY`: CZ, DK, HU, IS, NO, PL, SE,
UK, RS, CH). Deren Zeilen tragen `currency` sowie `F_lc … K_lc` mit den amtlichen
Beträgen; die Euro-Werte sind daraus **abgeleitet**. Stichprobe Dänemark: alle
RMS-Zeilen ergeben denselben Kurs 7,47454 DKK/EUR.

Ein EUR/Landeswährung-Umschalter existiert im Ergebnis des Fee Calculators
bereits als `.vres-curtoggle`.

## Entwurf

### E1 — Seitenaufbau

Reihenfolge von oben nach unten:

1. **Länder-Chips** — Suchfeld, Zähler, ein Chip je Land mit der Zahl seiner
   Gebührenzeilen. **Ganz oben, noch über dem Breadcrumb.** Eine Länderliste in
   einer linken Spalte ist verworfen worden (zu viel Platz).
2. Breadcrumb `Variation Toolbox › Fee Calculator › Fee data`.
3. **Kopfzeile des Landes** (siehe E2).
4. **Schnellrechnung**, eingeklappt (siehe E3).
5. **Je Verfahrensrolle ein Abschnitt** — RMS, CMS, national — mit je einer
   Tabelle: Verfahrensart, Fee code, 1. Variation, je weitere IA/IB/II, je
   weitere Stärke, Gruppierung. Sonderfälle stehen in einer eigenen Spalte
   „Special case", wo das Land welche kennt (z. B. Dänemark).
6. Unter der ersten Tabelle **„In plain words"**: der Klartext-Rechenweg plus
   die geltenden Regeln als Aufzählung (Deckel, Gruppierung, Stärkenlogik).

Karten mit 12 px Radius wie die Panels des Fee Calculators, innere Boxen 8 px,
Felder 6 px; Chips und Tags rund.

### E2 — Kopfzeile je Land

Eine Metazeile, gefolgt von der Quellenzeile:

```
IT · Currency EUR · 12 fee rows · Checked 11 May 2026 · Last edited 11 May 2026
   · Authority AIFA · Payment proof of payment
Source: Elenco Tariffe aggiornato ad Luglio 2025
```

**„Checked"** ist die fachliche Aussage: wann die Beträge zuletzt gegen die
Gebührenordnung der Behörde geprüft wurden — dieselbe Bedeutung wie in den
bestehenden `vcl_last_updated`-Feldern der anderen Toolbox-Abschnitte, und
bewusst nicht zu verwechseln mit dem Datum der Quelle selbst.
**„Last edited"** fällt beim Speichern automatisch an. Beide werden gezeigt.

Bei Nicht-Euro-Ländern tritt eine zweite Zeile hinzu:

```
Published in DKK by the authority — euro amounts are converted at
1 EUR = 7,47454 DKK (ECB, 11 May 2026).
```

Ohne Kurs und Kursdatum ist die Umrechnung nicht nachvollziehbar; beides ist
Pflicht.

### E3 — Schnellrechnung

Eine Box, die über einen Button **„Quick calculation"** in der Kopfzeile
(neben *Print* und *Open in Fee Calculator*) auf- und zugeklappt wird.
Geschlossener Zustand ist der Startzustand.

Inhalt: Umschalter RMS / CMS / National, Felder für Stärken und die Zahl der
Variationen je Typ, Auswahl *Type II standard / reduced*, darunter die
Einzelzeilen und die Gesamtgebühr.

Gerechnet wird über `window.VCLCALC.computeFees` — **nicht** über eine eigene
Formel. Damit gilt automatisch alles, was die Engine kann: Deckel, Gruppierung,
Sonderfälle, Overrides aus `vcl_fee_overrides`.

Verworfene Alternativen: eine mitscrollende Box in einer rechten Spalte (kostet
320 px Tabellenbreite) und eine Box je Rolle (dreimal dasselbe auf der Seite).

### E4 — Währungsumschalter

Bei Nicht-Euro-Ländern erscheint in der Kopfzeile eine Pille **DKK | EUR** im
Muster von `.vres-curtoggle`. Voreinstellung ist die **Landeswährung**, weil das
die amtliche Angabe ist. Der Umschalter wirkt auf alle Beträge der Seite.

Bei Euro-Ländern entfällt die Pille vollständig.

Verworfen: beide Währungen als getrennte Spaltenblöcke (drei Spalten mehr, die
Tabelle scrollt seitwärts) und zweizeilige Zellen (Landeswährung groß,
Euro klein darunter).

### E5 — Quellenangabe in die Datenkette

1. `convert.py`: Spalte C des Blattes „HA fee websites" mitnehmen, als
   `comments` in die `HA_WEBSITES`-Einträge.
2. Gebühren-Editor: je Land vier überschreibbare Felder — `checked_ha`,
   `updated_calc` (automatisch beim Speichern), `comments`, und die vorhandenen
   Link-/Zahlungsangaben nur lesend.
3. Speicherort ist das bestehende Overlay `vcl_fee_overrides`, erweitert um
   einen Zweig je Land. Damit sind die Werte ohne Zusatzarbeit in Export/Import
   und im Ionos↔NAS-Abgleich enthalten.

Die Excel bleibt die Erstquelle, bis Baustein F die Datenhaltung ablöst; das
Overlay gewinnt gegenüber dem konvertierten Wert.

## Datenfluss

```
Excel "HA fee websites" ──convert.py──> HA_WEBSITES in vcl-calc-data.js
                                              │
                    vcl_fee_overrides ────────┤ (Overlay gewinnt)
                                              ▼
                                    Öffentliche Gebührenseite
                                              │
                          window.VCLCALC.computeFees (Schnellrechnung)
```

Für die Beträge selbst ändert sich nichts: `applyOverrides()` verändert die
`FEE_ROWS`-Objekte in place, bevor irgendein Modul sie liest. Die Seite liest
dieselben Objekte wie jedes andere Tool.

## Fehlerfälle

| Fall | Verhalten |
|------|-----------|
| Land ohne Gebührenzeilen | erscheint nicht als Chip (wie im Editor) |
| `checked_ha` oder `comments` leer | Feld wird weggelassen, kein „–", keine leere Beschriftung |
| Kein Behördenlink | Name ohne Verlinkung |
| Suche ohne Treffer | „No country with that name." |
| Keine Variation eingegeben | Schnellrechnung zeigt „No variation selected.", keine 0 € |

## Sprache

Englisch, wie die gesamte Toolbox-Oberfläche.

## Prüfung

1. Für drei Länder (IT als Euro-Land, DK als Nicht-Euro-Land mit Sonderfällen,
   SI als Punktwert-Land) stimmen alle angezeigten Beträge mit
   `vcl-calc-data.js` überein.
2. Die Schnellrechnung liefert für dieselbe Eingabe dasselbe Ergebnis wie der
   Fee Calculator.
3. Ein Override im Gebühren-Editor schlägt auf der öffentlichen Seite durch.
4. Der Währungsumschalter zeigt in DKK exakt die amtlichen Ganzzahlen, in EUR
   die daraus abgeleiteten Werte.
5. Seite in hellem und dunklem Thema, und auf Handybreite.

## Version

Nach der Regel „Version bei jeder Änderung hochzählen": `Version:`-Header **und**
`VFC_VERSION` bumpen, danach Memory und Obsidian nachziehen.
