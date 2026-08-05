# RA-Hours: Additiv/PERT-Umbau — Slim Spec + Plan

> Status: Umsetzung gestartet 2026-08-03. Design ist **final** (siehe Obsidian:
> `The Pudel Brain/Projects/Variation-Toolbox/Brainstorming RA-Stunden-Methodik (PERT).md`).
> Design wird NICHT verändert. Code ist Single Source of Truth.

## Ziel (ein Satz)
Ersetze die multiplikative RA-Stunden-Engine durch ein additives Baustein-Modell mit
min–max-Bandbreite (PERT-fähig), gespeist aus `RA-CMC-hours.xlsx`, modular nach Verantwortung
(Core RA + zuschaltbare Module PI / CMC / Compilation & Submission).

## Architektur
- **Daten:** neuer Converter `convert-workload.py` liest `RA-CMC-hours.xlsx` → generiert
  `assets/js/vcl-workload-hours-data.js` (`window.VCL_WORKLOAD_HD = {...}`). Ersetzt die
  hardcodierten Faktoren `F` in `vcl-workload.js` (für den RA-Stunden-Teil).
- **Engine:** additive Summierung je Stream (RA / CMC / Compilation&Submission), min & max
  getrennt aufsummiert; Zwischensummen je Sektion + Gesamtsumme. PERT-E = (min + 4·m + max)/6,
  m vorerst Mittelpunkt (offener Punkt, siehe unten).
- **UI Guided Workflow:** Station A „Identify" → „Variations" (Wirksubstanz raus);
  Station B „Procedure" unverändert; NEUE Station „RA tasks" gated PI/CMC/Compilation/Submission
  (gleiche Optik wie der bestehende PI-Gate). Wirksubstanz wandert in den CMC-Block.
- **Anzeige (Variante A, final):** Live-Preview = eine „RA workload"-Zahl mit min–max-Range.
  Box „How the RA hours are calculated" = drei feinliniig getrennte, benannte Sektionen
  (RA activities / CMC activities / Compilation & submission activities), je Zwischensumme
  (dashed border-top) + Gesamtsumme „RA workload total" (solid heavier border-top).
  Farben: `--workflow #41762F`, Box-bg `#EAF3DE`, Text `#27500A`, Border `#639922`, dark-mode-fähig.
  Regel: CMC-Gate an → CMC-Stunden fließen in die RA-workload-Gesamtsumme.

## Datenstruktur `RA-CMC-hours.xlsx` (Referenz für Converter)
- `RA - Variations & Roles` (70 Zeilen): Core RA. Spalten: Variation Type | Role1 | Role2 |
  RA process | RA hours (min.) | RA hours (max.).
- `CMC - Variations & Roles` (37): Variation Type | Role1 | CMC process | CMC min | max.
  Zeilen inkl. „Dossier preparation ... (API chemical)" / „(API biological)" — eine je Wirksubstanz.
- `Product Information` (73): granular je Type×Role, keine Wirksubstanz-Abhängigkeit.
- `RA - Compilation & Submission` (31): docuBridge/Veeva-Kompilierung, Internal checks, CESP, je CMS.
- `Annual Update`, `Grouping`, `Super-Grouping`, `Worksharing`: je RA- UND CMC-Spalten;
  CMC-Seite wirksubstanz-spezifisch; Active-Substance-Spalte vorhanden.
- Stream-Zuordnung: `CMC - ...` → CMC-Stream; `RA - Compilation & Submission` + `Product Information`
  + `RA - Variations & Roles` → RA-Stream.
- ⚠️ Type-II-CMC-Korrektur (chemical/biological Zahlendreher, vom User korrigiert) beim Import verifizieren.
- ⚠️ Excel NUR lesen (openpyxl read-only ok); nie speichern.

## Rollen-Semantik (aus Daten verifiziert 2026-08-04)
- `role1` = Verfahren: `national` | `MRP/DCP` | `CP` → mappt auf `state.procedure` (national/mrpdcp/cp).
- `role2` = Unterrolle: national→`national`, CP→`CP`, MRP/DCP→`RMS` (Basisblock EINMAL) + `CMS`
  (Zeile „for each CMS", × Anzahl CMS). Additive Summierung: Basis = role2≠'CMS' einmal;
  pro CMS = role2='CMS' × cmsCount. Type-Bucket: IAIN→IA, „IB (unforeseen)"→IB.
- **Anzeige = naive Σmin–Σmax** (bestätigt durch Mockup 31–59). PERT-E ist Budget-Tool-Zukunft.
- Verifiziert: RA-Core IA national = 7–14 h (Σ der 6 Prozesse), deckt sich mit Doku.

## Tasks (bite-sized, günstigstes Modell je Task)
- [x] **T1 — Daten-Pipeline (Sonnet). ERLEDIGT + verifiziert 2026-08-04.** `convert-workload.py`
  liest alle 8 Sheets aus `RA-CMC-hours.xlsx` → `assets/js/vcl-workload-hours-data.js`
  (`window.VCL_WORKLOAD_HD`), Spalten-Mappings gegen echte xlsx geprüft, Type-II-CMC ok
  (chem 3–6 < bio 4–8), JS lädt in Node. `n.a.`→null, Modifier-Header generisch geparst.
- [x] **T2a — Additive Engine, reine Funktionen (Opus). ERLEDIGT + getestet 2026-08-04.**
  `computeAdditiveWorkload(HD, sel)` → {raCore, pi, submissionRa, cmcCore, submissionCmc,
  compilation} je {min,max}; `composeSections(parts)` → 3 Sektionen + Gesamtsumme (CMC nur bei
  Gate an). In `vcl-workload-hours.js`. 14 Node-Tests grün (`test/test-additive-workload.js`):
  RA-Core IA national 7–14, IAIN→IA-Bucket, CMS-Skalierung, CMC chem/bio, Grouping-Modifier,
  Compilation-Gate. Alte multiplikative Helfer bleiben bis UI migriert.
- [x] **T2b — Engine verdrahtet + Anzeige Variante A (Opus). ERLEDIGT 2026-08-04.**
  `vcl-workflow.js`: `raEffort()` ruft jetzt `computeAdditiveWorkload`+`composeSections`
  (statt alter multiplikativer `VCL_WORKLOAD.raHours`); gibt {parts, sections, total} zurück.
  `raRangeText()` formatiert min–max. Konsumenten umgestellt: Live-Stat, Summary-Zeile,
  .docx-Export → min–max-Range. Methodik-Box (`buildMethodPanel`) komplett neu = additive
  3-Sektionen-Box (RA / CMC / Compilation & submission), je Zwischensumme (gestrichelt) +
  „RA workload total" (solid). CSS ergänzt (`.vcl-wf-meth-sec/__title/-subtotal`). PHP-Enqueue:
  `vcl-workload-hours-data.js` registriert + als Dep vor `vcl-workload-hours`. **T4 damit
  miterledigt** (Ausgabeform koppelt beide). Syntax-Check ok, Engine-Tests grün, E2E-Zahlen
  browserfrei geprüft. ⚠️ Nicht im echten WP-Browser verifiziert (kein Dev-Server).
  ⚠️ **OFFEN (Genauigkeit):** `state.piDocs` (SmPC/Leaflet/…) filtert die PI-Summe noch NICHT —
  Engine summiert alle PI-Zeilen des Typs. Mapping `piDocs → PI-Prozesstext` gehört in T3/T4.
  ⚠️ **OFFEN (Design):** Headline zeigt nur Range (kein Einzel-Punkt „44 h"), weil m-Regel offen.
- [x] **T3 — Station „RA tasks" (Opus). ERLEDIGT 2026-08-04.** 5 Stationen A–E (A „Variations",
  B „Procedure", C „RA tasks" NEU, D „Date & Timeline", E „Fees"); Dispatch/reached/resetAll/
  stationComplete remappt (A ohne Wirksubstanz-Pflicht; C braucht Substanz nur bei CMC-Gate).
  Station A: Wirksubstanz-Button + PI-Abfrage ENTFERNT, Titel „Variations". Neue `buildStationRA`
  mit 3 Gates (PI-Gate-Optik): CMC dossier (+Wirksubstanz-Selector im Block), Product information
  (aus A hierher), Compilation & submission (docuBridge/Veeva+CESP). State: `cmcInRA`,
  `compilationInRA` neu. **PI-Granularität ERLEDIGT:** `sumPi` filtert PI-Zeilen nach getickten
  Dokumenten (Keyword-Match im Prozesstext); `raEffort` gibt `piDocs` weiter; 3 neue Tests grün
  (kein Dokument=0, SmPC>0, SmPC+Leaflet>SmPC). ⚠️ Nicht im echten WP-Browser verifiziert.
- [ ] **T4 — Anzeige Variante A (Haiku).** Live-Preview eine RA-workload-Zahl (min–max);
  Box mit 3 benannten Sektionen + Zwischensummen + Gesamtsumme; Farben/dark-mode wie Design.
- [x] **T5 — ZIP-Deploy. ERLEDIGT 2026-08-04.** `build_zip.py` FILES um `convert-workload.py`
  + `assets/js/vcl-workload-hours-data.js` erweitert. Dev-Artefakte (dieser Plan + Engine-Test)
  aus dem Plugin-Ordner in den Projekt-Root verschoben (`docs/`, `test/`), damit der strikte
  „keine unaufgeführten Dateien"-Check besteht; Test-`require`-Pfade angepasst. Build OK:
  `variation-fee-calculator.zip`, 24 Dateien, 337,8 KB, Ordner top-level, neue Dateien im ZIP,
  Test grün von neuer Position. ⚠️ WP-Upload + visuelle Abnahme durch User offen.

## Datei-Standorte (nach T5)
- Plugin (wird gepackt): `variation-fee-calculator/` — inkl. `convert-workload.py`,
  `assets/js/vcl-workload-hours-data.js`.
- Dev-only (nicht im ZIP): `docs/ra-hours-additive-plan.md` (diese Datei),
  `test/test-additive-workload.js` (Root-relative `require`s ins Plugin), `build_zip.py`,
  `RA-CMC-hours.xlsx`.

## Verfeinerungsrunde 2026-08-04 (nach User-Review + Vorschau) — ERLEDIGT
- **Headline = rechtsschiefer PERT-Erwartungswert** (`pertExpected`): Modus bei ⅓ der Spanne,
  4× gewichtet, `E=(min+4·mode+max)/6` → liegt unter dem Mittelpunkt. Bsp. 34–65 → **46 h**.
  m-Regel damit ENTSCHIEDEN (ersetzt den offenen Punkt unten).
- **Box itemisiert:** Engine liefert `items.{ra,cmc,compilation}` — Kern-Aktivitäten einzeln
  (wortgetreue Excel-Labels), PI + „each CMS ×N" + „Grouped / shared items" je EINE Zeile;
  Zeilen summieren exakt auf die Zwischensummen. Schiefe-Erklärung als Fußnote in der Box.
- **Live preview:** große Einzelzahl (Erwartungswert) + kleine gedämpfte Spanne darunter
  (`.vcl-wf-live__range`). Summary + .docx zeigen „46 h (34–65)".
- **Station B → „Procedures"** (Plural).
- **NEU: In-Page-Referenz** („RA-hours reference", Vorschlag A): aufklappbare Box, Filter
  Type/Rolle/Strom, Tabelle live aus `VCL_WORKLOAD_HD` → immer synchron. `buildReferenceBox`/
  `buildReferencePanel` in `vcl-workflow.js`, State `refOpen/refType/refRole/refStream`, CSS `.vcl-wf-ref-*`.
- Tests: jetzt 20 grün (Itemisierung, PERT, PI-Aggregat). E2E geprüft (II national → 46 h, 34–65).
  ZIP neu: 24 Dateien, 340,3 KB. ⚠️ WP-Abnahme im echten Browser weiterhin offen.

## Verfeinerungsrunde 2 (2026-08-04) — ERLEDIGT
- **Box: Pillen → Klartext** (rechtsbündig, wie Referenz) + Spalten-Überschrift „min. – max." (Haiku).
- **Box: rohe Halbstunden** (`raBand`, fmtNum statt ceil) — Zeilen/Zwischensummen ohne „ h", Gesamt mit „ h" (Haiku).
- **Box: Modifier einzeln** (Vorschlag A): Engine liefert je aktivem Modifier eine benannte Zeile
  („Worksharing · N further procedures", „Grouping · N further variations", AU/SG analog) statt
  „Grouped / shared items"; symmetrisch RA + CMC (Sonnet-Logik/Haiku-Apply). CMS-Label „for N CMS".
- **RA-hours reference: 4. Dropdown „Grouping / shared"** (Vorschlag A): schaltet Tabelle auf
  per-Einheit-Raten (RA + CMC) des gewählten Modifiers; Stream inaktiv; Optionen typ-abhängig
  (AU/SG nur Type IA), datengetrieben. `buildActivityTable`/`buildModifierTable`, State `refModifier`.
- Tests jetzt 30 grün (inkl. Modifier-Items + „for 5 CMS"). ZIP 341,7 KB. Alle Edits per Haiku/
  Sonnet-Subagenten unter Opus-Aufsicht, jeweils selbst verifiziert. ⚠️ WP-Browser-Abnahme offen.

## Verfeinerungsrunde 3 (2026-08-04) — ERLEDIGT
- **RA-hours reference: Dropdown „Grouping / shared" verworfen** (überzeugte nicht). Stattdessen
  **Inline-Block „Grouping & shared" unter der Aktivitäten-Tabelle**: listet datengetrieben die für
  Type+Role passenden Modifier, je Modifier eine Überschrift + „each additional …"-Zeilen.
  Stream steuert Spalten: RA/CMC → eine Spanne; All → zwei Spalten RA+CMC. Zeilen ohne Wert im
  gewählten Stream werden ausgeblendet; kein Modifier → Block entfällt. `buildModifierSection`
  ersetzt `buildModifierTable`; `refModifier`-State entfernt. CSS `.vcl-wf-ref-mod*`.
  Verifiziert: IA·national·RA (AU+SG), IB·MRP/DCP·All (Grouping+WS, 2 Spalten), II·national·CMC
  (nur WS). Haiku-Subagent, selbst geprüft. ZIP 341,8 KB. ⚠️ WP-Browser-Abnahme offen.

## Offene Punkte (dokumentiert, nicht blockierend)
- ~~m-Ableitung für PERT~~ → ERLEDIGT (rechtsschief ⅓, s. o.).
- Risk-Flags: von „verbreitern das Band" → „positionieren im Band" (weiterhin offen/zukünftig).
- Type-II-CMC-Korrektur bei Import geprüft (chem 3–6 < bio 4–8, ok).
