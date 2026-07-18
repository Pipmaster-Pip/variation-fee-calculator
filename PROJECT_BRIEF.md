# Projekt-Kontext: „Variation Toolbox" (WordPress-Plugin)

> Kompakter Startprompt / Referenz zum Projektstand. Bei größeren Änderungen aktualisieren.

## Was es ist
WordPress-Plugin für Pharma-Variations, eingebunden per Shortcode
`[variation_classification_lookup]`. Bündelt mehrere Tools in einer Oberfläche:
linke Nav (browse-col) + rechter Detail-/View-Bereich. H1 = „Variation Toolbox".

## Pfade
* Plugin-Ordner: `D:\Claude\Variation Fee Calculator\variation-fee-calculator\`
* Repo-Root: `D:\Claude\Variation Fee Calculator\` (= Git-Repo-Root)
* ZIP-Ziel: `D:\Claude\Variation Fee Calculator\variation-fee-calculator.zip` (gitignored)
* Build-Skript: `D:\Claude\Variation Fee Calculator\build_zip.py` (Repo-Root)
* Quell-Dokumente im Repo-Root (NICHT versioniert, s. .gitignore):
  - `Workload_RA_Stunden_Faktoren.xlsx` (Workload-Referenz)
  - `CMDh_132_2009_Rev66_QAs_Variations.pdf` (Q&A-Quelle)
  - `CMDh_172_2010_Rev17_Art5_Tracking_Table.xls` (Art.-5-Quelle)

## Git
* Remote `origin` = github.com/Pipmaster-Pip/variation-fee-calculator, Branch `main`.
* Solo-Repo, Historie committet direkt auf `main` (kein Branch/PR-Flow).
* Letzter Commit: `1090d7d` (Toolbox-Tools + Timetables/Nav), gepusht, Baum sauber.
* `.gitignore` schließt aus: `variation-fee-calculator.zip`, `*.xlsx/*.xls/*.pdf/*.docx`
  (Quell-Dokumente „nicht Teil des Tools"). Generierte Datendateien SIND versioniert.
* Commit-Message-Footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
* Nur committen/pushen auf ausdrücklichen Wunsch.

## Dateien (18 im ZIP, s. FILES-Liste in build_zip.py)
* `variation-fee-calculator.php` — Plugin-Header, Defines `VFC_VERSION/VFC_PLUGIN_URL/VFC_PLUGIN_DIR`
* `includes/lookup.php` — Shortcode, Asset-Registrierung (Versionierung per `filemtime()`),
  HTML-Gerüst, `VCL_CONFIG`-Localize. Data-JS sind Deps von `vcl-app` → auto-enqueued.
* `includes/admin.php` — Settings-Seite (Slug `vfc-settings`)
* `assets/js/`:
  - `vcl-app.js` — Haupt-App (alle Views außer Calculator/Workload-Logik)
  - `vcl-data.js` — HANDGEPFLEGT: Classification Guideline (`CHAPTERS`, `SECTIONS`,
    `ENTRIES`, `GROUPING_GUIDANCE`, `PRECISE_SCOPE_GUIDANCE`, `REVISION_HISTORY`)
  - `vcl-qa-data.js` — GENERIERT (extract_qa.py): `window.VCL_QA_DATA`
  - `vcl-art5-data.js` — GENERIERT (extract_art5.py): `window.VCL_ART5_DATA`
  - `vcl-workload.js` + `vcl-workload-data.js` — Workload Planning
  - `vcl-calc-app.js` + `vcl-calc-data.js` — eingebetteter Fee Calculator
    (`window.VCLCALC_DATA`), generiert per convert.py
* `assets/css/`: `vcl-style.css`, `vcl-workload-style.css`, `vcl-calc-style.css`
* Generatoren: `convert.py` (Fee-Excel → vcl-calc-data.js), `extract_qa.py`
  (Q&A-PDF → vcl-qa-data.js), `extract_art5.py` (Art.5-.xls → vcl-art5-data.js)
* `README.md`

## Harte Regeln
1. Immer erst Vorschau, außer User sagt ausdrücklich „kein Preview".
2. Verifikation: Temp-Harness `_verify-guide.html` im Plugin-Ordner (aus dem HTML-Gerüst
   in lookup.php generieren) + `python -m http.server 8791` + Browser-Tools.
   URL `http://localhost:8791/_verify-guide.html`. Harness nach Test LÖSCHEN.
   - Browser: Chrome-Tools (`mcp__claude-in-chrome__*`, via ToolSearch laden) bevorzugt;
     verlieren aber oft die Verbindung. Interne Vorschau (`mcp__Claude_Browser__*`) lädt
     meist, timeoutet aber häufig beim `screenshot`. DOM-Messungen (getBoundingClientRect,
     computed styles) sind der verlässliche Verifikationsweg; Screenshots als Bonus.
   - Cache-Falle: `?v=N` auf den Asset-`<script src>` reicht nicht — auch die Seiten-URL
     variieren (`?r=2`, `?r=3`, …). Bei „Änderung greift nicht" ZUERST hierher schauen.
3. ZIP nur per Python bauen: `python build_zip.py` (Repo-Root). Forward-Slashes Pflicht
   (PowerShell Compress-Archive bricht WP-Upload). Skript prüft: alle FILES vorhanden UND
   keine unlistete Datei im Plugin-Ordner (fängt vergessene Harness ab), Forward-Slashes,
   CRC. Vor Build: Server stoppen, Harness löschen.
4. Technik-Namen NIE ändern: Shortcode `[variation_classification_lookup]`, localStorage
   `variationLookupSelections`, Prefixe `vcl-`/`vclcalc-`, PHP-Konstanten `VFC_*`, Options-Keys.
5. Kein lokales PHP → PHP nur strukturell prüfbar (Brace-Balance). `admin.php` hat Brace-Delta
   von 1 (ein `{` in einem preg_match-Regex-String) — normal, kein Fehler. Nach Upload die
   Settings-Seite einmal aufrufen.
6. Bei Zahlen/Codes aus PDFs/Excel: Rohbytes selbst extrahieren (pypdf/xlrd/openpyxl) und
   gegenlesen — NIE WebFetch (hat für diese PDFs Inhalte erfunden). node & python vorhanden.

## Views (state.view) & Nav-Reihenfolge
Werte: `browse | summary | grouping | precisescope | qa | art5 | timetables | workload | calculator`.
Nav (renderBrowse): 1. Variation Fee Calculator (Gold-Hero) · 2. Divider · 3. Summary (nur bei
Auswahl>0) · 4. Classification of Variations (Zweig: E/Q/C/M/Art. 5 als Code-Kacheln) ·
5. Guidance on Variations (Zweig: Grouping · Precise Scope · Q&A) · 6. Timetables · 7. Workload.
Erst-Aufruf ohne Auswahl → Übersichtskarten. Live-Suche → Treffer im Detailbereich.

## Farben (Identitäten, in .vcl-app)
Calculator-Gold `#8f6e2e` (soft `#f5eedd`, deep `#5f4a1e`, Rand `#C7A653`).
`--classify #2E6E9E` · `--group #3B5BA9` · `--plum #6A4E8C` · `--slate #2C6E6E` ·
`--workload #7A3350` · `--history #9C6B2E` (= „changed"-Marker, NICHT freigeben).
Type-Badges app-weit `--ia #1F5F5B` · `--ib #A8651A` · `--ii #B23A2E` — UNVERÄNDERT lassen.

## Tools — aktueller Stand

### Classification of Variations
* Kapitel E/Q/C/M + fünftes Kapitel „Art. 5" als Code-Kacheln (`.chapter__code`, feste
  34×34, Kapitelfarbe getönt). Einzelbuchstaben 15px zentriert; „Art." gestapelt über „5"
  (10,5px / 9px), damit Titel aller Zeilen fluchten. Untertitel „Browse by chapter E·Q·C·M·Art. 5".
* Jede Ebene spiegelt sich im Detailbereich als Karten (`buildLevelNav`): Kapitel→Sections
  (Q), Section→Untergruppen (Q.I/Q.II), M→listGroups; Klick = wie Nav. Gated an `classifyOpen`.
* Breadcrumb auf ALLEN Ebenen, jedes Segment außer dem letzten ist ein Link (`wireBreadcrumb`).
* Variations variantengranular im Detailbereich (nicht in Nav), `state.activeVariant`.
* `openEntryByCode(code, variantId)` — geteilt von ?code=-Deeplink UND Q&A-Code-Chips.
* Q.V heißt „Changes from other regulatory procedures" (`SECTIONS.Q.V.title` in vcl-data.js).

### Guidance-Zweig: Grouping · Precise Scope · Q&A
* Q&A on Variations = CMDh/132/2009 Rev. 66. GENERIERT via extract_qa.py: 77 Fragen (68 aktiv,
  9 „deleted"), 194 Absätze — Wortgetreu-Sperre im Skript (jeder String muss verbatim im PDF
  stehen, sonst Abbruch). Absätze aus PDF-Textkoordinaten rekonstruiert (Quelle trennt nur per
  Zeilenabstand). 5 Kapitel-Akkordeons, Original-Nummerierung, eigenes Filterfeld, „Show 9
  deleted"-Schalter, Revisionstabelle. Code-Chips in Antworten verlinken via `openEntryByCode`
  in Classification (38/45 zitierte Codes auflösbar; nicht-auflösbare = stumpfe Chips).
  Revisionstabelle nennt KEINE Fragennummern → keine per-Frage-„changed"-Marker möglich.

### Art. 5 Recommendations (fünftes Classification-Kapitel)
* CMDh/172/2010 Rev. 17. GENERIERT via extract_art5.py aus .xls (braucht `xlrd`).
* WICHTIG: Aktuelle Liste („As of 15 Jan 2026") ist LEER — alle bisherigen Empfehlungen sind
  in die neue Guideline (C/2025/5045, gültig ab 15.01.2026) aufgegangen. View zeigt daher
  Leerstand-Callout + „historical" Archiv (52 Einträge, 2010–2023). Historische Codes im ALTEN
  A/B/C-Schema → KEINE Code-Links (nicht auf E/Q/C/M abbildbar). Typ-Badges (IA/IB/II via
  typeBadgeClass); 6 Prosa-Klassifizierungen wortgetreu ohne Badge. 14 Gruppen-Akkordeons,
  eigenes Filterfeld, 2 Fußnoten. Neue Empfehlungen füllen die aktuelle Liste künftig automatisch.

### Timetables for Variations
* Durchgehende Kalendertag-Achse Day 0 → EOP (`ttAxis(data, stop)`), Clock-stop-Slider, reine
  Prozent-Geometrie (kein getBoundingClientRect mehr). Type IA/IB/II (30/60/90).
* Type-II-Vergleich („Compare 30/60/90"): Spannen-Balken frühester↔spätester EOP auf gemeinsamer
  Achse (Assessment · Clock-stop schraffiert · Assessment 2; offener Ring = frühester EOP).
  BEWUSST kein Regler (Spannen-Überlappung ist die Aussage). EOPs: 30→d22–d50, 60→d60–d209,
  90→d90–d270 (Kalendertage; Achsenregel überspringt den Clock-stop in der Guide-Nummerierung).
* SVG-Export (`ttExportSVG(data, stop)`) zeichnet dieselbe Kalenderachse; Farben als Literale
  (`#2C6E6E/#5C7F9B/#9C6B2E`), Dateiname trägt Stop. `ttGrowFor` entfernt (war letzter Nutzer).

### Workload Planning
* RA-Stunden-Formel + Timeline. Zahlen (`F`, `TIMING`, `ASSESS`, `F_META`) HARTKODIERT in
  vcl-workload.js (~Z.39–90), aus Excel abgeschrieben — EINZIGE Quelle. `vcl-workload-data.js`
  enthält NUR `meta`, `taskDurationDays`, `annualUpdate` (nicht zurückwachsen lassen).
* `F_META.lastChecked` bei jeder Zahlenänderung hochsetzen. „How this estimate is built"-Panel
  generiert Tabellen aus F/TIMING/ASSESS (keine zweite Wahrheit).
* Basis RA-h: IA 10 · IAIN 10 · IB 12 · II 15. Prep IAIN 7 · IB 7 · IB(unf.) 14 · II 14 (IA n.a.).

### Summary + Export
* „Export to Variation Fee Calculator" — gedämpft in Calculator-Gold gefüllt (`#F5EEDD`/`#C7A653`).
  Übergibt Variations-Zahlen in-memory via `window.VCLCALC.setGlobalCounts(totalsByBucket())`;
  Calculator zeigt Prefill-Notiz auf dem Countries-Schritt. (Vorher: nur View-Wechsel, Zahlen
  gingen verloren.)

### Eingebetteter Fee Calculator
* Gescoped `.vclcalc-app`, IDs `vclcalc-`, `window.VCLCALC_DATA`. Kopf rendert Guide via
  `fillCalcHead()`. Ländertext („N countries selected") 12,5px `--ink-faint` (`.nav-row .hint`).

## Admin-Seite (Einstellungen → vfc-settings)
Gebühren-Upload (convert.py-Workflow) · Fee-/Workload-Excel-URLs · Kontakt-E-Mail ·
„Last updated" + Reference je View. Keys: `classification, grouping, precisescope, qa, art5,
timetables, workload` (in Defaults, Save-Loop UND Formular). Kontakt-Adresse geteilt ausgeliefert
(user/domain), erst im Browser zusammengesetzt.

## Offene Punkte
* **Annual Update Tool** (zurückgestellt): geplantes eigenes Tool; 3 offene Fachfragen (RA-Basis-
  Staffelung nach IA-Zahl? AU-Prozedur-Uhr/Prep? Fenster ab frühester IA oder je IA?).
* IAIN-Prep 7d & National-Validation 14d sind provisorisch (im Panel als „provisional").
* „Estimated Workload"/Department-Balken temporär raus (bis Abteilungs-Zeitmodell steht;
  DEPARTMENTS/computeSchedule liegen bereit, taskDurationDays sind Platzhalter).
* Q&A: Schaubild in Frage 1.4 nicht reproduziert (nur Text).
* Art. 5 aktuelle Liste leer (füllt sich mit künftigen CMDh-Empfehlungen).

## Stand
Alles committet & gepusht (1090d7d). ZIP aktuell baubar (18 Dateien, ~266 KB).
