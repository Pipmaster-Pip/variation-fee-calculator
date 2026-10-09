# Budget Planning – Excel Import (Design)

Date: 2026-10-09
Status: Approved for planning
Scope: Variation Toolbox → Budget Planning tool (`vcl-budget*.js`)

## 1. Goal

Let a user load an Excel (`.xlsx`) list of products and planned variations into the
Budget Planning tool, so the portfolio-wide fee and RA-effort plan is built from their
own list instead of typed in line by line. A preview step lets the user confirm the
interpreted budget lines (and any proposed grouping) before anything is written.

## 2. Non-negotiable constraints

- **100 % client-side.** The file is read in the browser via `FileReader` →
  `XLSX.read()` (SheetJS `0.18.5`, already loaded from cdnjs for the existing export).
  Nothing is uploaded, no server call is made, no IP is collected, no AI/LLM is
  involved. This must be stated explicitly in the import dialog ("full transparency"
  requirement).
- **No new third-party dependency.** Reuse the already-loaded `XLSX` global.
- Follow existing budget-tool conventions: ES5-style module pattern, pure engine logic
  separated from DOM, rerender + persist through existing `state`/save path.

## 3. In scope (v1)

- Submission **modes**: Single and Worksharing.
- Procedure **kinds**: national, MRP/DCP, CP.
- **Uncoded variations** entered as type counts (IA / IB / II). This is the common case
  and is already fully supported by the tool (`{ code:null, variantId:null, type:"IA|IB|II" }`,
  see `vcl-budget.js` "No classification code? Set the type directly").
- Tolerant column detection + a mapping fallback (see §6).
- Grouping proposal with user confirm/split (see §7).
- Incomplete rows imported as-is and flagged (see §8).
- Downloadable template + example table shown in the dialog (see §9).

## 4. Out of scope (v1 – user completes manually later)

- Super-Grouping and Annual Update modes.
- The "Annual maintenance fees" section (`annualLines`).
- RA-task flags (CMC / PI / Compilation) and internal/external cost columns — imported
  lines get the core workload estimate; the user refines per line in the editor.
- Concrete classification codes (e.g. `B.II.a.3`). A list that carries codes instead of
  type counts is imported by type where a type can be derived, otherwise flagged
  incomplete — never guessed.
- Free-form layouts (one row per country, variations as prose, etc.). For these the
  downloadable template is the answer.

## 5. Expected format

Reference layout (the downloadable template and `test-budget.xlsx`):

| Product | Procedure No. | Strengths | Countries | Procedure | Type IA | Type IB | Type II | Planned Submission Date | Quarter |
|---|---|---|---|---|---|---|---|---|---|

- **Product** – free text.
- **Procedure No.** – `national` / `CP` / an MRP-DCP number like `DE/H/1234/001-004`.
- **Strengths** – positive integer.
- **Countries** – comma list of ISO-ish country codes (`DE, IT, FR, …`); `EU` for CP.
- **Procedure** – `n.a.` (→ Single) or `Worksharing (RMS=DE)` (→ Worksharing, RMS = DE).
- **Type IA / Type IB / Type II** – counts (blank = 0).
- **Planned Submission Date** – year (e.g. `2027`).
- **Quarter** – `Q1`–`Q4` (blank allowed).

## 6. Column detection (Stufe 1 + Stufe 2)

**Stufe 1 – tolerant auto-detection (no UI).**
- Header matching is case-insensitive and whitespace-trimmed.
- Synonym dictionary per field, e.g.
  - Product: `product`, `produkt`, `arzneimittel`, `medicinal product`
  - Procedure No.: `procedure no`, `procedure number`, `verfahrensnummer`, `proc no`
  - Countries: `countries`, `länder`, `laender`, `markets`, `märkte`
  - Procedure: `procedure`, `verfahren`, `mode`
  - Type IA/IB/II: `type ia`/`typ ia`/`ia`, etc.
  - Strengths: `strengths`, `stärken`, `staerken`
  - Date: `planned submission date`, `year`, `jahr`, `submission year`
  - Quarter: `quarter`, `quartal`
- The header row is located even if it is not row 1 (scan the first N rows for the row
  that matches the most known headers).
- Unknown/extra columns are ignored but listed in the preview ("ignored columns: …").

**Stufe 2 – mapping fallback (small UI, only when needed).**
- If a *required* field (Product, Procedure, Countries, at least one Type column) is not
  detected confidently, the preview shows a short mapping block **before** the line list:
  one row per unmatched required field: `Your column [dropdown of sheet headers] → <field>`.
- Optional fields left unmapped fall back to defaults (Strengths = 1, Year = next plan
  year, Quarter = none).
- Mapping is the only pre-list step; once resolved the flow continues to the normal
  grouping preview (no inline field editing — see §8).

## 7. Mapping rules (values)

- Procedure kind from *Procedure No.*: `national` → national; `CP` → cp (countries forced
  to the CP/EU pricing, country list intentionally empty); `XX/H/…` → MRP-DCP with RMS =
  `XX` (prefix), overridden by the RMS in the Worksharing label when present.
- Mode from *Procedure*: `n.a.` (or empty) → Single; `Worksharing (RMS=XX)` → Worksharing,
  RMS = `XX`.
- Countries: split on comma, trim, map to internal codes validated against
  `window.VCLCALC.countries()`. CMS = countries minus RMS. Unresolved codes are kept as
  warnings on the line (line still imports, flagged incomplete).
- Variations: each Type column count `n` expands to `n` uncoded variations
  `{ code:null, variantId:null, type:"IA|IB|II" }`.
- Strengths → `submission.strengths.default`; Year, Quarter → line fields.

## 8. Grouping (preview = group / split / confirm only)

**Heuristic:** rows sharing the same Product **and** the same `Worksharing (RMS=…)` label
are proposed as one Worksharing budget line carrying multiple procedures (one per row).
- A proposed group renders as an expandable card (Worksharing styling) listing its member
  procedures.
- `Gruppe trennen` splits a proposed group back into one line per row.
- Rows that merely share a product but have differing type counts, differing quarters, or
  no worksharing label are **not** auto-merged; a warning surfaces with a
  `Trotzdem gruppieren` action.
- The preview supports **only** grouping/splitting and the add-vs-replace target choice.
  No per-field inline editing — users refine individual lines later in the normal line
  editor.

**Incomplete rows:** any row that can be parsed at all is imported. Rows missing required
data (no resolvable country, no type set, missing RMS for an MRP/WS procedure) import as
*incomplete*. The tool already supports this state: `computeLineResult` returns
`complete:false` and the table row shows the existing "Set all countries… to see the fee
and RA-hours breakdown" hint. Incomplete lines never break the table and are editable
afterwards.

## 9. Import dialog (UX)

Trigger: a new button `data-act="import"` in `vcl-bud-header__actions`, placed between
`Export to Excel` and `+ Add variation line`. Label: `⭱ Import from Excel`.

The dialog (takeover, same pattern as the line editor / annual editor) shows, top to
bottom:
1. **Transparency notice** (prominent): everything runs locally in the browser, no file is
   uploaded, no server is contacted, no AI runs in the background.
2. **File picker** + `Vorlage herunterladen` button (generates the §5 sheet, empty with one
   example row, via `XLSX.writeFile`).
3. **Example table**: a small static rendering of the expected columns with one example
   row, always visible so the user sees the target shape before picking a file.
4. After a file is chosen: optional §6 Stufe-2 mapping block, then the §8 grouping preview
   (detected line count, grouped/single cards, warnings), the add-vs-replace target
   toggle, and `Abbrechen` / `N Zeilen importieren`.

Confirm writes the parsed lines through `normalizeLine`/`normalizeSubmission` into
`state.lines` (append or replace per the toggle), then persists and rerenders.

## 10. Architecture / files

- **New** `variation-fee-calculator/assets/js/vcl-budget-import.js` — pure logic, no DOM:
  - `detectColumns(aoa) → { map, headerRow, unmatchedRequired, ignored }`
  - `parseRows(aoa, map) → { rawLines, warnings }`
  - `groupLines(rawLines) → { lines, groupWarnings }` (Worksharing grouping proposal)
  - `buildTemplateWorkbook() → workbook` (for the download)
  - Returns plan-line shapes ready for `normalizeLine`. Reuses `VCLCALC.countries()` for
    country validation. No pricing/hours logic (delegated as today).
- **Edit** `vcl-budget.js` — import button, takeover dialog, mapping block, grouping
  preview, confirm handler. Reuses existing takeover/rerender/persist machinery.
- **New** `test/test-budget-import.js` — unit tests on the pure functions with fixtures
  mirroring `test-budget.xlsx`: Worksharing group (rows 1–3), single MRP (row 4), single
  MRP multi-country (row 5), national single (row 6), two CP rows kept separate (rows 7–8),
  plus synonym headers, header row not first, unknown country, missing required column
  (Stufe 2), empty type counts.

## 11. Risks / open points

- SheetJS `0.18.5` is loaded only on the Classification-lookup shortcode page today
  (`includes/lookup.php`). Confirm the Budget tool renders on a page where `XLSX` is
  present; if not, the import button must guard on `typeof XLSX` (same guard the export
  already uses) and the enqueue may need to cover the budget context.
- Country-code normalization must match the calculator's own code set exactly
  (composite codes like `DE - BfArM`); reuse the calculator's lookup rather than a new map.
