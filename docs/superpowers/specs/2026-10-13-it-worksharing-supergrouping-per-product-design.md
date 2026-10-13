# IT Worksharing & Super-Grouping — Pro-Produkt-Gebühren

**Datum:** 2026-10-13
**Status:** Design (zur Umsetzung freigegeben, Modell bestätigt)
**Quelle:** AIFA, *Elenco Tariffe aggiornato ad aprile 2026* (gültig für ab 01.04.2026 eingereichte Anträge).

## 1. Kontext & Problem

Italien (IT) bepreist Variations in Worksharing/Grouping **je Arzneimittel** — grundlegend anders als die bisher gepflegten Länder (DE/DK/LT/FI), deren WS/SG-Gebühr **eine** Gebühr je Behörde ist.

Der gemeinsame WS/SG-Preispfad (`computeSubmissionFees` → `leadFees` + `procFees`) rechnet **pro Land** ab: der Lead einmal, jedes *unterschiedliche* Member-Land einmal, dedupliziert über `x.cc !== sub.lead`. Mehrere Verfahren **desselben Landes** (= mehrere Produkte bei IT) kollabieren dadurch auf eine Gebühr.

**Verifiziert** (echte Engine, `scratchpad/run_sg_it.js`): IT-Super-Grouping mit 1/2/3 Verfahren → konstant 1.055 € statt 1.055 / 2.110 / 3.165 €.

Folge: Die Produkt-Dimension fehlt für IT. Gewählter Ansatz (mit Nutzer abgestimmt): **IT-spezifischer Submission-Layer** — kleiner Blast-Radius, DE/DK/LT/FI unberührt.

## 2. Bestätigtes Fee-Modell

AIFA-Regel:
- **Worksharing:** jede Variation wird **einmal** berechnet (unabhängig von der Produktzahl); **zusätzlich** eine Verwaltungsgebühr **je weiterem Arzneimittel**.
- **Grouping / Super-Grouping (mehrere Produkte):** **alle** enthaltenen Variations werden **je Arzneimittel** berechnet (voll × P).

Vereinheitlicht, mit P = Zahl der IT-Verfahren im Vorgang:

| Toolbox-Modus | IT-Gesamtgebühr (eine Behörde/Rolle) |
|---|---|
| `worksharing` | `Basis(1 Produkt)` + `(P−1) × Verwaltungssatz(höchster Typ, Rolle)` |
| `superGrouping` | `Basis(1 Produkt) × P` |
| `null` (klassisches Grouping, 1 Produkt) | unverändert — schon korrekt |

**Basis(1 Produkt)** = heutige Grouping-Berechnung der Variations für IT (IA 1.055/879, IB 2.446/2.038, II 29.357/24.465 bzw. reduziert 14.678/12.232), **mit** 3.+-Typ-II-Rabatt (s. §5).

**Verwaltungssatz je weiterem Arzneimittel** (nur `worksharing`):

| Höchster Variationstyp | RMS (B.2.2.x) | CMS (B.2.2.x) |
|---|---|---|
| ≥ 1 Typ II | 1.350 (B.2.2.26) | 1.125 (B.2.2.25) |
| höchstens IB | 391 (B.2.2.30) | 326 (B.2.2.29) |
| nur IA | — (dann `superGrouping`, kein Verwaltungssatz) | — |

**3.+ Typ-II-Rabatt** (B.2.2.22 RMS = 8.478 / B.2.2.21 CMS = 7.065): die **dritte und jede weitere** Typ-II-Variation in der Basis statt voll nur zum reduzierten Satz.

### Kontrollbeispiele (IT als RMS)

| Szenario | Rechnung | Erwartet |
|---|---|---|
| WS, 1× Typ II std, 3 Produkte | 29.357 + 2×1.350 | 32.057 € |
| WS, 3× Typ II std, 1 Produkt | 29.357 + 29.357 + 8.478 | 67.192 € |
| WS, 1× Typ IB, 2 Produkte | 2.446 + 1×391 | 2.837 € |
| SG, 1× Typ IA, 3 Produkte | 1.055 × 3 | 3.165 € |

> **Default-Hinweis (Umsetzung):** Für IT Typ II ist der **reduzierte** Satz der Normalfall (Q-Variations kommen fast immer ohne neue klinische Daten; Texte werden selten mit klinischen Studien ergänzt) — er ist daher die Vorauswahl. Die obigen Beispiele mit 29.357 € illustrieren den **Standard**-Fall; realistisch rechnet der Default mit 14.678 € (RMS). Der 3.+-II-Rabatt (8.478) wird gegen die *tatsächlich* genutzte Basis-Rate (reduziert oder standard) gebildet. Erläuterung zu den Reduktionskriterien: AIFA-Dekret 06.12.2016, Anlage 2 — als Note-only-Hint unter der „reduced"-Auswahl im Rechner hinterlegt.

## 3. Architektur

**Einziger Hook:** `computeSubmissionFees` in `vcl-submission.js`. Es ist die alleinige Fee-Quelle für Guided Workflow (`vcl-workflow.js:377 grandTotalFees`) **und** Budget-Tool (`vcl-budget-engine.js:59`). Ein Hook dort deckt beide ab.

**Umgesetzt als** `itPerProductAdjustment(sub, counts, engines)` (+ Helfer `itProcedureCount`, `itMarginalTypeIIRate`; für Tests exportiert). Ablauf:
1. Greift nur, wenn `leadPricingActive(sub)` (worksharing **oder** superGrouping) **und** IT im Vorgang beteiligt ist.
2. Ermittelt `P_IT` = Zahl der Verfahren, in denen IT vorkommt (als `rms`, `cms` oder `nat`) — siehe §4.
3. Ermittelt IT-Rolle & höchsten Typ; schlägt Verwaltungssatz bzw. Basisgebühr nach. IT-Rolle = `leadPricingRole` wenn IT der Lead/Referenz ist (→ RMS-Sätze), sonst die über `wsPricingRole` ermittelte Member-Rolle (→ CMS-Sätze). Basis und Verwaltungssatz nutzen dieselbe Rolle.
4. Liefert den **Zusatzbetrag**, der im `byCc['IT']`-Eintrag und im `total` ergänzt wird:
   - `worksharing`: `(P_IT − 1) × Verwaltungssatz`
   - `superGrouping`: `(P_IT − 1) × Basis(1 Produkt)` (ergibt in Summe Basis × P)

Die vorhandene Basis-Bepreisung (Lead einmal) bleibt unangetastet — der Layer **ergänzt** nur, analog zum ADMIN_FEES-/PROCESS_FEES-Block weiter unten in `computeSubmissionFees`.

**Guard:** Für alle Nicht-IT-Vorgänge und für `mode = null` ist der Zusatz 0 → DE/DK/LT/FI und klassisches Grouping bitweise unverändert (Regressionspflicht, §8).

## 4. Produktzahl P_IT

P_IT = Anzahl der Verfahren in `sub.procedures`, in denen IT als `rms`, `cms` oder `nat` auftritt. (Nutzerbestätigt: „Verfahrenszahl = Produktzahl"; im GW fügt man im WS/SG weitere Verfahren hinzu.) `strengths`/`L` bleibt für IT ohne Einfluss auf die Gebühr.

## 5. 3.+ Typ-II-Rabatt

Gilt nur im `worksharing`-Modus, nur auf die Basis(1 Produkt). Bei O Typ-II-Variationen:
`II-Anteil = vollerIISatz × min(O,2) + reduzierterIISatz × max(0, O−2)`.

**Umsetzungsort:** im IT-Layer als Korrektur auf die vom Engine gelieferte Basis (die Basis rechnet heute `voll × O`), d.h. Abzug `(fullII − 8.478/7.065) × max(0, O−2)`. Keine neue Formel in der Datenzeile nötig — hält die Logik an einem Ort (IT-Layer).

Im `superGrouping`-Modus (AIFA „Grouping", typischerweise nur IA) kein Rabatt.

## 6. Datenhaltung der neuen Beträge

Neue IT-spezifische Sätze (Verwaltungssätze 1.350/1.125/391/326; reduzierter 3.+-II-Satz 8.478/7.065) haben in den vorhandenen Fee-Rows keinen Platz. Vorschlag: neuer Block **`IT_WS_FEES`** in `vcl-calc-data.js`, Form:

```js
IT_WS_FEES: {
  perProduct: { RMS: { II: 1350, IB: 391 }, CMS: { II: 1125, IB: 326 } },
  reducedTypeII: { RMS: 8478, CMS: 7065 }
}
```

Die **Basis**-Variationssätze (1.055/2.446/29.357/…) bleiben in den vorhandenen IT-Rows (254–265) und damit über den Fee-Editor pflegbar.

**Offener Punkt:** Fee-Editor-Unterstützung für `IT_WS_FEES`. Erste Version: nicht editierbar (wie PROCESS_FEES anfänglich), als Limitation dokumentiert; Editor-Anbindung als Folgeaufgabe.

## 7. Scope & Abgrenzung

**In Scope:**
- IT WS/SG-Gebühren im **Guided Workflow** und **Budget-Tool** (beide über `computeSubmissionFees`).
- Rollen **RMS** und **CMS** (Lead = RMS/Referenz, Member = CMS/concerned).

**Nicht in Scope / offen:**
- **Klassischer VFC-Rechner:** bleibt vorerst außen vor (nutzerbestätigt) — er kennt keine Verfahrensliste/Produktzahl.
- **Rolle `national`:** Die AIFA-Quelle listet nur RMS/CMS-Codes für WS. National-Worksharing wird vorerst nicht pro Produkt skaliert; Verhalten dokumentieren und ggf. später klären.
- **3.+-II-Rabatt im SG/Grouping-Fall:** wird nicht angewandt (SG ist IA-fokussiert); falls IT-SG je Typ II enthält, als Folgefrage.
- **Fee-Editor** für `IT_WS_FEES` (s. §6).

## 8. Tests

Node-Harness über die echte Engine (Muster: `scratchpad/run_sg_it.js`, `run_submission.js`):
1. **Kontrollbeispiele §2** exakt (32.057 / 67.192 / 2.837 / 3.165 €), RMS und CMS.
2. **P-Skalierung:** WS 1/2/3 Produkte; SG 1/2/3 Produkte.
3. **3.+-II-Rabatt:** 1/2/3/4× Typ II, 1 Produkt.
4. **Regression (kritisch):** DE/DK/LT/FI WS/SG-Ergebnisse **unverändert** (Vorher/Nachher-Vergleich); `mode = null` IT-Grouping unverändert; bestehende Suites grün (`test-submission.js`, `vcl-feedata.test.mjs`, `vcl-sg-logic.test.js`).
5. **Budget-Tool:** ein IT-WS-Szenario über `vcl-budget-engine` liefert denselben Betrag wie der GW.

## 9. Nicht-Ziele

Keine Änderung am gemeinsamen WS/SG-Preispfad für andere Länder. Keine neue Produkt-Dimension in der UI (die Verfahrensliste existiert bereits). Keine Rückportierung ins klassische VFC.
