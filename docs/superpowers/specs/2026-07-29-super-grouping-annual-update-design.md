# Design-Spec: Super-Grouping & Annual Update im Guided Workflow

- **Datum:** 2026-07-29
- **Status:** Design freigegeben (Implementierung noch nicht begonnen)
- **Betroffene Datei (Kern):** `assets/js/vcl-workflow.js`
- **Weitere Dateien:** `assets/css/vcl-workflow-style.css` (neuer Warn-Banner), ggf. `assets/js/vcl-data.js` (nur lesend: `entry.chapter`)
- **Ansatz:** A — Mode-Enum + geteilte Verfahrensliste (WS-Maschinerie wiederverwenden)

> Schreibweise: Der Begriff wird durchgängig **„Super-Grouping"** (mit Bindestrich) verwendet.

---

## 1. Kontext & Ziel

Der Guided Workflow kennt heute zwei Submission-Konzepte:

- **Grouping** — mehrere Variations in *einem* Verfahren; im Code **automatisch abgeleitet** (`state.submission.grouping = state.grouping.some(g => g.type)`, vcl-workflow.js:1665), kein UI-Schalter.
- **Worksharing (WS)** — dieselbe Änderung über mehrere Verfahren, ein **Lead** wird einmalig bepreist; Chip in Station B (vcl-workflow.js:584).

Neu zu integrieren sind zwei **Type-IA-only**-Modi:

- **Annual Update (AU)** — mehrere Type-IA-Variations für *das eine* bereits gewählte Verfahren, gebündelt, mit 12-Monats-Frist.
- **Super-Grouping (SG)** — dieselben Type-IA-Änderung(en) über einen **Mix aus nationalen Zulassungen und mehreren MRP/DCP-Verfahren (auch mit unterschiedlichen RMS)**, mit **Super-Grouping RMS (lead)** und **Letter of Intent** analog WS, plus Kapitel-C-Multi-RMS-Prüfung, plus 12-Monats-Frist.

AU und SG sind **geschichtet**: SG = AU + Mehrfach-Verfahren (WS-artig) + Kapitel-C-Prüfung. Beide teilen IA-only-Gating, `earliestImplDate` + 12-Monats-Frist und den Export-Fristenblock.

**Regulatorische Grundlage (Beispiel als Referenz):** Ibu 500, 4 Stärken; nationale Zulassungen DE/PT/LT; MRP/DCP mit RMS FR (5 CMS) und RMS PL (2 CMS); 5× Type IA (keine IAIN). Frühestes Implementation Date 15.03.2026 → späteste Einreichung 15.03.2027 (Umsetzung + 12 Monate). Kapitel E (administrativ) und Q (Qualität) dürfen frei über die gemischte Palette gebündelt werden; Kapitel C (Klinik/Sicherheit) nur, wenn **alle** betroffenen MRP/DCP **denselben RMS** haben — sonst C herausnehmen oder pro RMS getrennt einreichen.

## 2. Scope & Non-Goals

**In Scope**
- Zwei neue Buttons in Station B (nur bei „alles IA"), WS-Chip dort ausgeblendet.
- `submission.mode`-Enum als einzige Wahrheit.
- SG nutzt den **kompletten WS-Pricing-Pfad** (Lead einmalig, Rest herausgerechnet).
- SG-Lead-Auswahl + „Additional procedures (super-grouping)" + Letter of Intent (analog WS).
- Ein Datumsfeld `earliestImplDate` (Station C) + berechnete späteste Einreichungsfrist.
- Kapitel-C-Multi-RMS: nicht blockierender Warn-Banner mit Benennung der C-Variation(en) und konfligierender RMS.
- .docx-Export: neuer Abschnitt „Annual Update / Super-Grouping".

**Non-Goals (YAGNI)**
- Kein per-Variation-Umsetzungsdatum (nur ein frühestes Datum).
- Keine harte Blockade bei Kapitel-C-Konflikt (nur Warnung).
- Keine neue Fee-Engine-Logik (bestehender WS-Pricing-Pfad wird wiederverwendet).
- **Kein** Eingriff in das visuelle Design/Layout — Chips, Panels, Labels bleiben exakt im vorhandenen Stil; nur der Warn-Banner ist neu (es existiert bisher kein Banner-Muster).
- Kein Umschreiben des bestehenden Worksharing — nur Ergänzung um Mode-Guards.

## 3. Architektur (Ansatz A)

**Mode-Enum als einzige Wahrheit.** `state.submission.worksharing` (Bool) wird durch `state.submission.mode` ersetzt:

```
submission.mode ∈ { null, 'worksharing', 'annualUpdate', 'superGrouping' }
```

Das abgeleitete `submission.grouping` (vcl-workflow.js:1665) bleibt unverändert.

**Geteilte Verfahrensliste.** SG nutzt dieselbe Liste zusätzlicher Verfahren wie WS (`state.worksharing[]`). Da immer nur **ein** Modus aktiv ist, genügt eine Liste. Der bestehende Render-Helper für die WS-Zusatzverfahren wird zu einem geteilten Helper verallgemeinert, der Label und Kontext aus dem Modus zieht (z. B. Titel „Additional procedures (super-grouping)" vs. „(worksharing)").

**Geteilter Pricing-Pfad.** Weil der SG-Lead geblührentechnisch **wie WS** wirkt (Lead einmalig, Rest herausgerechnet), teilen WS und SG denselben Pricing-Pfad (`leadFees` + `procFees` mit Lead-Ausschluss). Es wird ein Prädikat eingeführt, das „Lead-basiertes Pricing aktiv" ausdrückt und für **WS oder SG** true ist.

**Isolationsprinzip.** Alle neuen Regeln sind kleine, unabhängig testbare **reine Funktionen** (siehe §5). Bestehende WS-Funktionen werden nur so angepasst, dass ihre Gates statt „ist WS" nun „ist lead-basiert (WS oder SG)" bzw. „ist Mehrfach-Verfahren-Modus" prüfen.

## 4. State-Änderungen

In `state` (vcl-workflow.js:29–61):

| Feld | alt | neu |
|------|-----|-----|
| `submission.worksharing` (Bool) | vorhanden | **entfällt**, ersetzt durch `submission.mode` |
| `submission.mode` | — | **neu:** `null｜'worksharing'｜'annualUpdate'｜'superGrouping'` |
| `submission.grouping` (Bool, abgeleitet) | vorhanden | unverändert |
| `state.worksharing[]` (Zusatzverfahren) | vorhanden | unverändert (von WS **und** SG genutzt) |
| `state.worksharingLead` | vorhanden | unverändert (dient als Lead für WS **und** SG) |
| `state.worksharingLeadSpecial`, `state.wsSpecials` | vorhanden | unverändert (Fee-Kategorien Lead/Verfahren) |
| `state.earliestImplDate` | — | **neu:** `""` (ISO-Datumsstring, Station C) |

**Reset/Prefill.** `resetAll()` (vcl-workflow.js:406–418) setzt `submission.mode = null` und `earliestImplDate = ""`. `prefillFromVariations()` (1726–1741) bleibt unverändert (setzt keinen Modus).

> Migrationsnotiz: Alle Lesezugriffe auf `submission.worksharing` werden auf `mode === 'worksharing'` umgestellt (siehe §6). `wsActive()` wird entsprechend neu definiert.

## 5. Neue reine Funktionen (Signaturen)

Alle in `vcl-workflow.js`, klein und einzeln testbar:

| Funktion | Rückgabe | Zweck |
|----------|----------|-------|
| `allVariationsAreIA()` | `boolean` | true, wenn Basistyp IA **und** jeder `state.grouping[]`-Eintrag mit `type` IA ist. Steuert das Button-Gating in Station B. |
| `auActive()` | `boolean` | `submission.mode === 'annualUpdate'` |
| `sgActive()` | `boolean` | `submission.mode === 'superGrouping'` |
| `leadPricingActive()` | `boolean` | `mode === 'worksharing' || mode === 'superGrouping'` — ersetzt bisherige `wsActive()`-Gates im Pricing/Lead-UI. |
| `multiProcedureMode()` | `boolean` | `mode === 'worksharing' || mode === 'superGrouping'` — ob die Zusatzverfahren-Liste angezeigt/eingerechnet wird (AU = nein). |
| `annualUpdateActive()` | `boolean` | `mode === 'annualUpdate' || mode === 'superGrouping'` — ob Frist-UI/Export gilt. |
| `annualUpdateDeadline()` | `Date｜null` | `earliestImplDate` + 12 Monate; `null`, solange kein Datum. |
| `distinctRmsSet()` | `string[]` | Menge der RMS über alle MRP/DCP in `allProcedures()` (für die C-Prüfung). |
| `superGroupingConflicts()` | `Array<{code, title, chapter:'C', rmsList:string[]}>` | Nicht leer, wenn `sgActive()` **und** `distinctRmsSet().length ≥ 2` **und** mindestens eine Variation mit `findEntry(code).chapter === 'C'`. Liefert die betroffenen C-Variationen. |

`superGroupingConflicts()` liest die Kapitelzuordnung über die vorhandene Klassifikationsdatenstruktur (`entry.chapter` in vcl-data.js, Werte `E｜Q｜C｜M`). Diese wird vom Workflow bisher nicht gelesen — der Zugriff ist neu, die Daten sind vorhanden.

## 6. Station-für-Station-Änderungen

### Station A (Identify) — keine strukturelle Änderung
Variations werden wie heute erfasst. `allVariationsAreIA()` liest den bestehenden Zustand.

### Station B (Procedure) — Kern der Änderung
Im „Submission type"-Block (vcl-workflow.js:574–593):

- **`allVariationsAreIA()` == true:** WS-Chip **ausblenden**; stattdessen zwei Buttons im vorhandenen Chip-Stil — **Super-Grouping** (zuerst), **Annual Update** (danach). Auswahl setzt `submission.mode`.
- **`allVariationsAreIA()` == false:** WS-Chip wie heute; AU/SG nicht angeboten.
- **Guard:** Wird nach Modus-Wahl der Zustand so geändert, dass nicht mehr alles IA ist (bzw. bei WS umgekehrt), fällt ein nicht mehr zulässiger `mode` auf `null` zurück. Zentrale Stelle: die bestehende „grouping ableiten"-Zeile (1665) wird um eine Modus-Konsistenzprüfung ergänzt.
- **SG aktiv:** darunter „**Super-Grouping RMS (lead)**"-Label + Select (bindet an `state.worksharingLead`, analog WS) + „Additional procedures (super-grouping)"-Panel (geteilter Render-Helper). **AU aktiv:** kein Lead, keine Zusatzverfahren-Liste.
- **Warn-Banner (nur SG):** liefert `superGroupingConflicts()` Einträge, wird der Banner (neue CSS-Klasse `.vcl-wf-warn`) gerendert — benennt die C-Variation(en) und die konfligierenden RMS und nennt die zwei Auswege (C herausnehmen ODER pro RMS getrennt einreichen). Nicht blockierend.

### Station C (Date & Timeline) — Frist
- Neues Eingabefeld **„Frühestes Umsetzungsdatum (Implementation Date)"** (`state.earliestImplDate`), sichtbar wenn `annualUpdateActive()`.
- Der bestehende IA-Platzhaltertext (vcl-workflow.js:833–836, heute rein statisch) wird ersetzt/ergänzt durch die konkrete Anzeige:
  - **Frühestes Umsetzungsdatum:** `earliestImplDate`
  - **Früheste Einreichung:** „ab Umsetzung — heute bereits möglich" (Hinweis)
  - **Späteste Einreichung:** `annualUpdateDeadline()` (Datum, hervorgehoben), Zusatz „(Umsetzung + 12 Monate)".
- Individuelle Assessment-Timeline (`workflowSchedule()`) bleibt für IA `null` (kein Einzel-Clock) — unverändert.

### Station D (Fees) — Pricing-Pfad wiederverwenden
- Alle bisher an `wsActive()` gekoppelten Pricing- und Lead-Box-Gates prüfen künftig `leadPricingActive()` (WS **oder** SG). Damit gilt für SG automatisch: Lead einmalig bepreist (`leadFees`), Lead aus jedem Verfahren herausgerechnet (`procPricedCountries`), Rest über `procFees` summiert.
- Fee-Kategorie-Auswahl/Labels: SG nutzt denselben Mechanismus wie WS. **Offener Punkt (§9):** ob die Gebührenschedule SG-spezifische Kategorien kennt oder ob die vorhandenen „…- worksharing"-/Standardzeilen greifen — an den Daten zu prüfen, mit Fallback auf Standard.

## 7. Fristenlogik

- Bindende späteste Einreichung = **frühestes** Umsetzungsdatum + 12 Monate (die zuerst ablaufende Einzelfrist bindet das ganze Bündel).
- `annualUpdateDeadline()` rechnet kalendarisch (Monatsarithmetik, nicht +365 Tage), damit z. B. 15.03.2026 → 15.03.2027 exakt stimmt.
- Frühester Einreichzeitpunkt: ab dem Umsetzungsdatum (praktische Betriebsumsetzung) — als Hinweistext, keine Sperre.

## 8. Kapitel-C-Multi-RMS-Prüfung

- Auslöser (alle drei Bedingungen): `sgActive()` **und** ≥2 verschiedene RMS unter den MRP/DCP-Verfahren **und** ≥1 Variation aus Kapitel C.
- Wirkung: nicht blockierender Warn-Banner (Station B, nahe der Verfahrensliste). Text benennt konkrete C-Variation(en) (Code + Titel) und die konfligierenden RMS und nennt beide Auswege. Kapitel E und Q werden ausdrücklich als unberührt bezeichnet.
- Kein `stationComplete`-Gate (C/D bleiben ungated, vcl-workflow.js:388) — die Warnung sperrt den Fortgang nicht.

## 9. Export (.docx)

In `exportSummaryDocx()` (vcl-workflow.js:1330–1487), neuer Abschnitt **zwischen** Summary-Block (~1396) und Variations-Tabelle (~1399), gerendert wenn `annualUpdateActive()`:

- Überschrift „Annual Update / Super-Grouping" (HEADING_2).
- Key-Value-Zeilen (`kv()`-Helper wiederverwenden): Modus, frühestes Umsetzungsdatum, früheste/späteste Einreichung.
- **SG:** Liste der Zulassungen/Verfahren (inkl. RMS je MRP/DCP) und die Eligibility-Aussage; liegt ein Kapitel-C-Konflikt vor, wird dieser als Hinweis mit aufgenommen.
- **Letter of Intent:** analog WS — die bestehende Variations-/LoI-Tabelle (Number/Title/Type, 1399–1427) wird für SG so beschriftet, dass sie als Letter of Intent des Super-Groupings über alle Zulassungen dient.

Keine neue Export-Bibliothek; die vorhandenen `kv()`/`cell()`/Border-Muster werden wiederverwendet.

## 10. Neue CSS

`.vcl-wf-warn` in `assets/css/vcl-workflow-style.css` — ein zurückhaltender Warn-Banner (Titelzeile + Fließtext), passend zum bestehenden Stil der `vcl-wf-hint`-Hinweise, aber optisch als Warnung erkennbar (Warnfarbe, linker Akzentstreifen). Bisher existiert kein Banner-/Alert-Muster; dies ist die einzige neue Design-Komponente.

## 11. Edge Cases & Guards

- **Modus-Wechsel WS ↔ SG/AU:** Beim Umschalten auf einen IA-Modus bleiben `worksharing[]`/`worksharingLead` erhalten (dieselben Strukturen); beim Verlassen des Mehrfach-Verfahren-Modus (AU) wird die Zusatzliste nicht gelöscht, aber nicht eingerechnet (`multiProcedureMode()` == false).
- **Nicht-IA nachträglich ergänzt:** `mode` fällt auf `null`, Buttons verschwinden, WS-Chip erscheint (Konsistenzprüfung an Zeile 1665).
- **AU ohne Zusatzverfahren:** korrekt — AU ist per Definition ein Verfahren.
- **`earliestImplDate` leer:** `annualUpdateDeadline()` == `null`; Station C zeigt „—" für die späteste Frist; kein Fehler.
- **SG mit nur nationalen Verfahren (kein RMS) oder nur einem RMS:** `superGroupingConflicts()` == leer → kein Banner (korrekt: die C-Regel greift nur bei ≥2 RMS).
- **Doppelzählung Lead:** bleibt durch den bestehenden Lead-Ausschluss in `procPricedCountries` verhindert (jetzt auch für SG aktiv).

## 12. Erfolgskriterien

1. Bei ausschließlich Type-IA-Variations zeigt Station B **Super-Grouping** und **Annual Update** statt Worksharing; sonst unverändert Worksharing.
2. SG bietet Lead-Auswahl + Zusatzverfahren-Liste + Letter of Intent analog WS; AU nicht.
3. Gebühren bei SG entsprechen exakt dem WS-Pricing (Lead einmalig, Rest herausgerechnet), verifiziert am Referenzbeispiel.
4. `earliestImplDate` 15.03.2026 ⇒ späteste Einreichung 15.03.2027 in Station C und im Export.
5. SG mit RMS FR **und** PL **und** einer Kapitel-C-Variation ⇒ Warn-Banner mit Benennung der C-Variation und beider RMS; kein Banner bei nur E/Q oder nur einem RMS; Fortgang nie gesperrt.
6. Bestehendes Worksharing (IB/II) verhält sich unverändert (keine Regression in Pricing, Lead, Timeline, Export).
7. Kein visuelles Design außerhalb des neuen `.vcl-wf-warn`-Banners verändert.

## 13. Offene Punkte (kein Blocker, bei Umsetzung zu klären)

- **SG-Gebührenkategorien:** Prüfen, ob die Fee-Schedule SG-spezifische Zeilen kennt; falls nicht, WS-/Standardzeilen mit Fallback nutzen.
- ~~**Lead-Rolle im CP-Fall:** ob bei einem CP im Super-Grouping der Lead automatisch die EMA ist (wie WS es andeutet) — an bestehender WS-Logik ausrichten.~~ Geklärt, siehe §14 (Lead-Verhalten bei CP war bereits korrekt über `buildWorksharingLead()`/`worksharingHasCP()`; neu ist nur die Misch-Sperre der Verfahrensarten).

## 14. Addendum (2026-07-30): CP-Exklusivität in Super-Grouping

**Anlass:** Live-Review deckte auf, dass Super-Grouping heute jede Kombination aus `national`/`mrpdcp`/`cp` in `state.worksharing[]` zulässt. Regulatorisch korrekt ist: **entweder** beliebig viele `national`+`mrpdcp`-Verfahren gemischt, **oder** beliebig viele `cp`-Verfahren — niemals `cp` zusammen mit `national`/`mrpdcp`. Gilt **ausschließlich für Super-Grouping**; Worksharing bleibt unverändert (keine bestehende Regression).

**Neue reine Funktion** (Ergänzung zu §5, in `vcl-sg-logic.js`, gleiches Dual-Mode-Pattern wie `computeDistinctRms`/`computeSuperGroupingConflicts`):

```
computeAllowedProcedureKinds(allProcedures, currentProcedure) → ('national'|'mrpdcp'|'cp')[]
```

Betrachtet alle Verfahren in `allProcedures` außer `currentProcedure` (Ausschluss per Referenz). Ist unter den übrigen mindestens eines mit `kind === 'cp'` → Rückgabe `['cp']`. Ist unter den übrigen mindestens eines mit `kind === 'national'` oder `'mrpdcp'` → Rückgabe `['national','mrpdcp']`. Liste der übrigen leer (erstes Verfahren der Gruppe) → Rückgabe aller drei Kinds (freie Wahl).

**UI-Durchsetzung (harte Blockade, kein Warn-Banner):** In `procEditor()` (vcl-workflow.js:687–726) wird bei `sgActive()` der jeweils nicht erlaubte Kind-Chip `disabled` gerendert, mit Tooltip („Not allowed together with CP in Super-Grouping" bzw. „Not allowed together with national/MRP-DCP procedures in Super-Grouping"). Greift symmetrisch für das Basisverfahren (Station B) **und** jedes Zusatzverfahren in der SG-Liste — ein invalider Zustand kann so gar nicht erst entstehen. Bei Worksharing (`wsActive()`) bleibt `procEditor()` unverändert (alle drei Chips immer wählbar).

**Kein Einfluss auf bestehende Lead-/Fee-Logik:** `buildWorksharingLead()`/`worksharingHasCP()` (vcl-workflow.js:148, 837–860) erzwingen bei `cp` bereits automatisch EMA als Lead — das funktioniert für Multi-CP-Gruppen unverändert korrekt, da jedes `cp`-Verfahren `hasCP=true` auslöst. `distinctRmsSet()`/`superGroupingConflicts()` (Kapitel-C-Prüfung) bleiben unverändert, da CP ohnehin nie in die RMS-Menge einfließt (kein `p.rms`).

**Erfolgskriterien (Ergänzung zu §12):**
8. In Super-Grouping ist der `cp`-Chip deaktiviert, sobald bereits ein `national`- oder `mrpdcp`-Verfahren in der Gruppe ist — und umgekehrt sind `national`/`mrpdcp`-Chips deaktiviert, sobald bereits ein `cp`-Verfahren in der Gruppe ist. Beim ersten Verfahren der Gruppe sind alle drei Kinds wählbar.
9. Mehrere `cp`-Verfahren lassen sich problemlos zu einer Super-Grouping-Gruppe kombinieren (Lead automatisch EMA).
10. Worksharing zeigt keinerlei Änderung im Verfahrens-Picker (Regressionscheck).

---

*Erstellt im Rahmen von superpowers:brainstorming. Nächster Schritt nach Freigabe dieses Specs: superpowers:writing-plans (Implementierungsplan). Keine Implementierung vor Plan-Freigabe.*
