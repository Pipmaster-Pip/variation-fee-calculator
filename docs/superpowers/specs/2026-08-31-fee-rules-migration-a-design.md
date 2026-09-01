# Design: Baustein A — Regelmodell, Migration und Abgleich der Gebührendaten

**Datum:** 2026-08-31
**Plugin:** Variation Toolbox (`variation-fee-calculator`)
**Teil von:** Ablösung der Excel als Gebührenquelle (Bausteine A–F, Reihenfolge A → B → C → D+F → E)
**Betrifft:** `assets/js/vcl-calc-data.js` (421 Zeilen), `assets/js/vcl-calc-app.js` (Rechenkern), `convert.py`

## Ziel

Beweisen oder widerlegen, dass sich die 421 Gebührenzeilen als **erklärende Regeln**
darstellen lassen — ohne dass sich ein einziges Rechenergebnis ändert.

A ist eine Vorstudie. Sie liefert Wissen, keine Funktion. Am Ende steht eine
belastbare Antwort auf: *Lässt sich die in hunderten Stunden aufgebaute
Formelarbeit verlustfrei in ein Regelmodell überführen — und wo nicht?*

## Abgrenzung

A ist **rein additiv**. Es entsteht ein neuer Ordner mit Skripten und drei
erzeugten Dateien. A ändert **keine** Plugin-Datei, erzeugt kein ZIP, deployt
nichts. Der laufende Betrieb ist zu keinem Zeitpunkt betroffen.

Nicht Teil von A: PHP-Engine (B), Umbau der Tools (C), Editor (D), Datenhaltung
(F), öffentliche Ansicht (E).

## Befunde aus der Code-Analyse (verbindliche Grundlage)

Diese fünf Punkte wurden vor dem Entwurf am Code verifiziert. Sie sind der Grund
für den gewählten Zuschnitt.

### B1 — Deckel und Gruppierung sind nicht hinterlegt, sondern werden erschlossen

Die Engine führt **drei Läufe** je Land durch (`computeCountryResult`,
`vcl-calc-app.js:1179 ff.`): kombiniert, je Typ einzeln, und mit Stärken auf 1.
Ein Deckel gilt als ausgelöst, wenn die rohe Summe P+Q+R den Wert S übersteigt
oder der kombinierte Lauf unter dem Einzellauf liegt.

Die Gruppierungspauschale wird **aus dem Formeltext** erschlossen
(`vcl-calc-app.js:1294`):

```js
const hasGroupingBranch = kVal !== null && /[MNO]\d+/.test(formulaText)
                       && />1/.test(formulaText) && /\bK\d+\b/.test(formulaText);
```

**Folge:** Entfallen die Formeln, entfällt die Grundlage dieser Erkennung. Das
Regelmodell muss Deckel und Gruppierung **ausdrücklich** führen und trotzdem
dieselben Flags liefern — die Oberfläche zeigt „cap applied" und „grouping fee" an.

### B2 — 129 Zeilen führen Landeswährung

Bei CH, CZ, DK, HU, IS, NO, PL, RS, SE, UK sind `F_lc`…`K_lc` maßgeblich; die
Euro-Werte werden zur Laufzeit aus dem Wechselkurs überschrieben
(`vcl-calc-app.js:95-99`). **Für den Abgleich sind die Kurse einzufrieren**
(`STATIC_FX_RATES`, keine Live-Abfrage), sonst vergleicht man Kursrauschen.

### B3 — Zwei tote Codezweige, mit Nebenwirkung auf die Vorauswahl

`resolveRow` sucht die Standardzeile über `candidates.find(r => !r.special)`
(`vcl-calc-app.js:319`), und `specialChoicesForType` setzt
`hasStandard: candidates.some(r => !r.special)` (`:918`). **Keine** der 421 Zeilen
hat ein leeres `special` — `convert.py:210` übernimmt Spalte D wörtlich, und dort
steht überall ein Wert, auch das Wort „standard". Beide Zweige sind damit tot.

**Nebenwirkung:** Bei den 92 Kombinationen aus (Land, Rolle, Typ) mit mehreren
Varianten entscheidet die Excel-Zeilenreihenfolge über die Vorauswahl. Für
Italien Typ II steht „reduced" vor „standard" → vorausgewählt sind 14.678 €
statt 29.357 €. Das Auswahlfeld zeigt „reduced" an, es wird also nichts
verdeckt falsch gerechnet; die Vorauswahl fällt aber zur günstigeren Seite.

### B4 — Ein falscher Zellbezug in Zeile 422

`Of` der Zeile 422 (EU/EMA, Typ IB) lautet `=IF(ISBLANK(L422),"",O341)`.
Zeile 341 ist **PL, IB, CMS** — jede andere Zeile liest `O2`. Derzeit folgenlos,
weil (a) Zeile 422 ihr eigenes `O` nicht verwendet und (b)
`computeCountryResult` nur Zeilen des jeweiligen Landes auswertet, `O341` bei
einer EU-Rechnung also undefiniert ist und zu 0 wird. Schlafender Fehler.

### B5 — Die Regelzahl ist offen

Die Vorab-Klassifikation ergab drei Familien (Staffelung 354, Pauschale ab der
zweiten 52, pro Stärke 15) plus zwei Zusätze (Deckel 105, Fixzuschlag 12).
Diese Klassifikation ist **nachweislich unvollständig**: Zeile 423 (EU/EMA)
rechnet `IF(O<3, O*F, 2*F+(O-2)*J)` — die ersten zwei Variationen voll, ab der
dritten ermäßigt — und wurde fälschlich unter „Staffelung" geführt. Zudem
existiert eine strukturgleiche, aber über *Stärken* statt *Anzahl* laufende
Variante (IE).

**Die Zahl der Regelfamilien ist Ergebnis von A2, nicht dessen Voraussetzung.**

### B6 — Der Deckel muss eingebbar sein (Anforderung 2026-08-31)

Auftraggeber-Vorgabe: Ein Deckel — genannt wurde Deutschland — muss später im
Editor **eingegeben** werden können. Damit ist die Darstellung des Deckels nicht
frei wählbar: Jede Form muss in Formularfelder passen. Ein Deckel, der sich nur
als undurchsichtiger Ausdruck fassen lässt, erfüllt die Anforderung nicht und
ist ein Befund.

Am Bestand geprüft, es treten vier Formen auf:

| Form | Land | Formular |
|---|---|---|
| fester Betrag | DE — `19900` auf die Summe | ein Zahlenfeld |
| zwei Beträge nach Stärkenzahl | `4150` bei 1 Stärke, sonst `6425` | zwei Zahlenfelder |
| Punktzahl × Punktwert | SI — `1500*5.8`, `3500*5.8`, `250*5.8` | Punktzahl + Punktwert je Land |
| Vielfaches der Grundgebühr | PL — `2*F` | ein Faktorfeld |

Der slowenische Punktwert 5,8 stammt aus dem Blatt „Exchange rates" (`$B$9`);
`convert.py` löst diesen Sonderbezug beim Export bereits auf und dokumentiert
ihn im Kopfkommentar. Im Regelmodell gehört er als **Land-Eigenschaft**
hinterlegt, nicht in jede Zeile kopiert.

**Polen ist kein Deckel.** `IF(L=1, IF(sum>2*F, 2*F, sum), IF(count>1,
2*F+(L-1)*F*0.8, sum))` ist eine Gruppierungsregel mit einem Stärkenfaktor von
0,8, die nur wegen des `>`-Vergleichs wie ein Deckel aussieht. Der Extraktor
darf sie nicht als Deckel führen.

**Der Deckel ist offen, nicht auf bestimmte Länder beschränkt** (Auftraggeber,
2026-08-31): Es können weitere Länder hinzukommen, und die Beträge ändern sich.
Daraus folgt zweierlei:

1. Der Extraktor sucht Deckel **generisch** über alle Zeilen. Die heute acht
   betroffenen Länder sind ein Messwert, keine Liste, gegen die geprüft wird.
2. Im Regelmodell ist `cap` ein Feld, das **jede** Zeile tragen kann — auch
   solche, die heute keinen Deckel haben. Der Editor bietet den Deckel folglich
   überall an, und der Betrag ist ein ganz normal pflegbarer Wert, der wie jede
   andere Gebühr versioniert wird.

## Leitprinzip: originalgetreu, nicht besser

A bildet das **heutige Verhalten** nach, Eigenheiten eingeschlossen — auch die
Vorauswahl aus B3 und den toten Bezug aus B4. Ein „nebenbei behobener" Fehler
macht jede Abweichung im Abgleich mehrdeutig: man kann einen Migrationsfehler
dann nicht mehr von einer gewollten Verbesserung unterscheiden.

Auffälligkeiten kommen auf eine getrennte Liste (`findings.md`) und werden nach
Abschluss von A entschieden.

## Architektur

### A1 — Golden Master

Ein Prüfstand fährt den **echten Produktionscode** über die Eingabematrix. Nicht
eine nach Node portierte Kopie: eine Kopie kann abweichen, und dann prüft man die
Kopie statt das Produkt.

- Minimale Harness-Seite lädt `vcl-calc-data.js` + `vcl-calc-app.js` und stellt
  die DOM-Knoten bereit, die das Skript beim Laden erwartet (ab `:531`).
- Angesteuert wird `window.VCLCALC.computeFees` (`:491`) — **dieselbe
  Schnittstelle**, die Calculator, Guided Workflow und Budget Planning benutzen.
- Playwright, headless, ohne Netz → `LIVE_FX` bleibt leer → `STATIC_FX_RATES`
  greifen → deterministisch (siehe B2).

**Matrix:** 92 Land-Rolle-Paare → 482 Sonderfall-Kombinationen × 63
Anzahl-Kombinationen (IA/IB/II je 0–3, nicht alle 0) × 5 Stärken (1, 2, 3, 5, 10)
= **151.830 Läufe**. Dazu eine gezielte Ausweitung auf Anzahlen bis 8 für die
Länder, die heute einen Deckel führen (BE, CH, DE, DK, ES, IE, PL, SI — Messwert
zum Stand 2026-08-31, keine feste Liste, siehe B6) und für DK wegen der Schwellen
bei M≥2.

**Erfasst wird das vollständige Ergebnisobjekt je Zeile** — nicht nur die Summe:
`total`, `singleTotal`, `rawSumSingle`, `subsumed`, `count`, `capValue`,
`groupingFee`, `groupingBase`, `groupingPerAdditional`. Andernfalls bliebe
unbemerkt, wenn das neue Modell zwar richtig rechnet, aber Deckel oder
Gruppierung anders meldet (siehe B1).

**Ergebnis:** `golden.json`.

> A1 ist **für sich allein wertvoll**. Mit dem Golden Master ist ab sofort jede
> Änderung am Rechenweg überprüfbar — unabhängig davon, ob A2/A3 je gebaut werden
> und ob das Regelmodell trägt. Er ist zugleich der Abnahmetest für B und C.

### A2 — Regel-Extraktor

Python, liest `vcl-calc-data.js`, leitet je Zeile eine Regelbeschreibung ab.

**Datenmodell je Zeile** (Entwurf; die Regelnamen sind Ergebnis, nicht Vorgabe):

```jsonc
{
  "row": 257,                        // Herkunft aus der Excel, für Rückverfolgung
  "cc": "IT", "role": "RMS", "type": "II", "special": "standard",
  "fee_code": "B.2.1.10 / B.2.2.10",
  "currency": "EUR",                 // bei B2-Ländern die Landeswährung
  "amounts": {
    "lead": 29357,                   // F — führende Variation
    "perStrength": 0,                // G — je weitere Stärke
    "rateIA": 1055,                  // H
    "rateIB": 2446,                  // I
    "rateII": 29357,                 // J
    "flat": null                     // K — Pauschale
  },
  "select": {                        // aus Mf/Nf/Of
    "subsumption": "highest-type-wins",
    "activeWhen": null               // z. B. { "type": "IA", "min": 2 } (DK)
  },
  "rule": "<Ergebnis von A2>",
  "cap": null,                       // Geltungsbereich + Wert, siehe unten
  "surcharge": null                  // fester Aufschlag auf die Summe
}
```

**Die Zeilenauswahl ist bereits vollständig analysiert:** nur 9 verschiedene
Formen. 411 Zeilen folgen einheitlich „höchster vorkommender Typ übernimmt".
Die 9 Ausnahmen sind Dänemark (je Rolle drei IA-Zeilen: „standard" nur bei genau
einer IA, „same D.Sp.No." und „several D.Sp.No." ab zwei) und der Fehlbezug aus
B4. Ein `activeWhen`-Feld mit `min`/`max` deckt das ab.

**Der Deckel ist der riskanteste Teil des Modells.** Beobachtete Formen:

| Form | Beispiel |
|---|---|
| fester Betrag | `IF(sum>80000, 80000, sum)` |
| abhängig von der Stärkenzahl | `IF(L=1, IF(sum>4150,4150,sum), IF(sum>6425,6425,sum))` |
| Vielfaches der Grundgebühr | `IF(sum>(2*F), 2*F, sum)` |
| kleiner Ausdruck | `IF(P>1500*5.8, 1500*5.8, P)` |
| unterschiedlicher Geltungsbereich | mal `P+Q+R`, mal nur `Q`, mal `P+Q` |

Der Deckel braucht daher Geltungsbereich **und** einen Wert, der selbst von der
Stärkenzahl abhängen kann. Ob sich das erklärend fassen lässt, ist die zentrale
offene Frage von A.

**Ergebnis:** `fee-rules.json` und ein Abdeckungsbericht — je Zeile die
zugeordnete Regel, oder eine Begründung, warum keine passt.

### A3 — Referenz-Evaluator und Abgleich

Ein schlanker Evaluator in Python rechnet aus `fee-rules.json` und wird gegen
`golden.json` gestellt. **Bewusst Wegwerfcode:** er beweist das Modell; die
Produktionsfassung entsteht in B in PHP. Was bleibt, ist der Golden Master.

Verglichen werden alle Felder aus A1, Beträge auf 0,01 genau, Flags exakt.

**Ergebnis:** `report.md` — wie viele der 151.830 Läufe übereinstimmen, und für
jede Abweichung Zeile, Eingabe, erwarteter und tatsächlicher Wert.

## Abnahmekriterien

1. `golden.json` liegt vor und ist reproduzierbar (zweimaliger Lauf → gleiches Ergebnis).
2. `fee-rules.json` deckt alle 421 Zeilen ab **oder** benennt jede nicht abbildbare Zeile mit Begründung.
3. `report.md` weist für jede Abweichung Zeile, Eingabe und beide Werte aus.
4. Kein Plugin-Code verändert (`git status` zeigt nur neue Dateien im A-Ordner).

**Erfolg ist nicht „100 % Übereinstimmung".** Erfolg ist eine *belastbare Zahl*.
Ergibt der Abgleich etwa 415 von 421 sauber und 6 begründet nicht, ist das ein
gutes Ergebnis von A — die Entscheidung über den Rest trifft der Auftraggeber.

## Ablage

Neuer Ordner `tools/fee-migration/` im Repo-Wurzelverzeichnis
(`D:\Claude\Variation Fee Calculator`) — **bewusst außerhalb des Plugin-Ordners**,
anders als `convert.py` und die anderen Konverter. `build_zip.py` packt den
Ordner `variation-fee-calculator/`; alles darunter landet im WordPress-Upload.
Migrationswerkzeug gehört nicht ins ausgelieferte Plugin.

```
tools/fee-migration/
  harness.html          # Prüfstand-Seite für den echten Produktionscode
  golden.mjs            # A1 — Playwright-Lauf über die Matrix
  extract_rules.py      # A2 — Formeln → Regeln
  evaluate_rules.py     # A3 — Referenz-Evaluator
  compare.py            # A3 — Abgleich gegen den Golden Master
  out/golden.json       # erzeugt
  out/fee-rules.json    # erzeugt
  out/report.md         # erzeugt
  out/findings.md       # Auffälligkeiten (B3, B4, Neufunde)
```

**Hinweis zum Repo-Zustand:** `git status` meldet 16 geänderte Dateien auf `main`.
`git diff --stat` weist **keine geänderte Zeile** aus — die Abweichung liegt
ausschließlich in den Zeilenenden (CRLF gegen LF). Kein unfertiger Stand, nicht
anfassen.

## Risiken

| Risiko | Umgang |
|---|---|
| Der Deckel lässt sich nicht erklärend fassen (siehe A2) | Genau das ist die Frage, die A beantwortet. Ergebnis ist dann eine begründete Liste, kein Scheitern. |
| Harness-Seite lädt den Produktionscode nicht sauber (DOM-Abhängigkeiten ab `:531`) | Fehlende Knoten werden ergänzt, bis das Skript durchläuft. Notfalls Ausweichen auf gezielten Export der reinen Rechenfunktionen — dann aber ausdrücklich als Abweichung dokumentiert. |
| Laufzeit der Matrix | 151.830 Läufe im selben Browserkontext, ein Playwright-Start. Bei Bedarf nach Land gestückelt. |
| Weitere Regelfamilien tauchen auf (wie B5) | Erwartet. Der Extraktor meldet Unbekanntes, statt zu raten. |
