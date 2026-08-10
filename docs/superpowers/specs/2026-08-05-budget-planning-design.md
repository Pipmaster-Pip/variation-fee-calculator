# Budget Planning tool

**Date:** 2026-08-05
**Status:** Approved for planning
**Scope:** MVP only. Quarter rollup, probability-weighted totals, grouping/worksharing savings,
annual fees, and .docx summary export are explicitly deferred (see Out of scope).

## Why

RA departments plan next year's variation portfolio in Q4: total agency fees across all markets,
plus internal RA effort (hours → FTE) to justify headcount in the budget round. This is a new
top-level tool in the Variation Toolbox, sitting *above* the Guided Workflow: one plan line per
variation, each priced/timed by calling the same two engines the Guided Workflow already uses,
then rolled up across the whole portfolio.

Related memory: `budget-planung`, `ra-hours-additive-engine`, `guided-workflow`,
`working-instructions-variation-toolbox`.

## Decisions (resolved during brainstorming)

- **Granularity: precise, per variation** — not a coarse product×market×type average. Every plan
  line prices through the real fee tables and the real additive RA-hours engine, same accuracy as
  the Guided Workflow. A line can carry multiple countries at once (see Entry ergonomics).
- **Persistence: `localStorage`**, autosaved on every change, no save button. No JSON
  import/export, no URL-state — out of scope.
- **Line entry: a compact single form (modal), not a multi-step wizard.** All fields on one
  screen; live fee/hours preview at the bottom. Faster for RA managers who already know what
  they're entering than re-running 5 wizard stations per line.
- **MVP rollups: annual total (€ + hours) + FTE, by market, by product.** Quarter and probability
  are captured on the line (cheap to store) but have no rollup view yet — Phase 2.
- **Excel export: in the MVP.**
- **Language: English**, matching the rest of the toolbox (`vcl-calc-app.js`,
  `vcl-workflow.js` are English-only; the brainstorming mockup was corrected from German to
  English, and from the wrong "Lead" label to the codebase's actual **RMS** terminology, and from
  bare "MRP" to the codebase's actual combined **MRP/DCP** procedure kind).

## Data model — one plan line

```js
{
  id,
  product: "",                     // free text — the toolbox has no product entity/DB
  variationLabel: "", type: null,  // e.g. "B.II.d.1.a", "IB" — reuse Classification Lookup's
                                    // search so users don't hand-type codes
  procedure: { kind: "national" | "mrpdcp" | "cp", rms: null, cms: [] },
  countries: [{ cc, role, strengths, special }],   // → VCLCALC.computeFees()
  activeSubstance: null, piDocs: [], modules: { pi: false, cmc: false, compilation: false },
  submission: { worksharing: {...}, grouping: {...} },  // → VCL_WORKLOAD_HOURS.computeAdditiveWorkload()
  quarter: null, probability: 100, // captured now, no rollup consumer yet (Phase 2)
  _cache: { fees: null, hours: null },  // memoized per-line result, invalidated on edit
}
```

This mirrors the Guided Workflow's own `sel` shape almost exactly
(`vcl-workflow.js` builds `{ type, procedure, cmsCount, activeSubstance, piDocs, modules,
submission }` for the hours engine and `{ countries, counts }` for `computeFees` — see
`vcl-workflow.js:464-465,518-519` and `vcl-calc-app.js:482-493`). The budget tool's compact form
collects the same fields flattened onto one screen instead of across wizard stations.

## Architecture

New tool tile, no changes to existing engines or to the Guided Workflow. New files, following the
existing per-view convention (own JS file, own stylesheet, own local class prefix):

- **`assets/js/vcl-budget.js`** — the view: line list, modal editor, rollups, localStorage,
  Excel export. DOM code following the `vcl-workflow.js` pattern (IIFE, reads
  `window.VCL_BUDGET_DATA` if any static data is needed). Class prefix `.vcl-bud-*`.
- **Pure rollup math lives in the same file but as standalone functions** (`computeRollup(lines)`,
  `computeFte(hours, hoursPerHead)`), dual-exported (`window` + `module.exports`) like
  `vcl-workload-hours.js:326-327`, so they're Node-testable without a DOM.
- **`assets/css/vcl-budget-style.css`** — scoped under `.vcl-app`, loaded after `vcl-style.css`.
  Reuses shared tokens (`--paper`, `--panel`, `--ink`, `--border`, type badges `--ia/--ib/--ii`,
  `.cc-chip`-style country pills). New identity color for the tile: reuse the burgundy freed up by
  today's standalone-Workload-tool removal (`--workload: #7A3350`, now orphaned per
  `2026-08-05-remove-standalone-workload-tool-design.md`) under a new name `--budget: #7A3350` —
  no new color added to the palette, and it doesn't collide with `--plum` (already used inside
  Classification's chapter boxes).

**Engine calls, one line at a time, no engine changes:**
- Fees: `VCLCALC.computeFees({ countries: line.countries, counts: {...} })` →
  `{ countries, grandTotal }` (`vcl-calc-app.js:482`).
- Hours: `VCL_WORKLOAD_HOURS.computeAdditiveWorkload(window.VCL_WORKLOAD_HD, sel)` → parts,
  then `composeSections(parts)` for the `{min,max}` total, then `pertExpected(min,max)` for the
  headline number (`vcl-workload-hours.js:261,303,248`).

Roll-up = sum of `grandTotal` across lines for €; sum of `{min,max}` and of `pertExpected` results
across lines for hours (summing the PERT point estimates, not re-deriving PERT from summed
min/max — matches how the Guided Workflow already presents a single line's headline).

## UI

**Tool tile:** added to `OVERVIEW_DESTINATIONS` in `vcl-app.js:3222` as a 6th card,
`{ dest: "budget", label: "Budget Planning", color: "var(--budget)", desc: "Plan next year's
fees and RA effort across your portfolio." }`.

**Main view** (`.vcl-bud-col`, same grid slot as the other five view columns):
1. Header: "Budget Planning — <year>" + Export to Excel + New line buttons.
2. Three rollup tiles: Annual fees (€), Annual RA hours (with min–max sub-line), FTE required
   (with an editable "hours per head per year" input, default 1500).
3. Two breakdown panels side by side: By market, By product (bar + value rows).
4. Plan-lines table: Product · Variation · Type badge · Procedure · Countries (chips) · Quarter ·
   Fee · Hours (PERT, with min–max sub-line) · row actions (duplicate / edit / delete). Footer row
   with column totals.
5. Modal editor (opened by "New line" or the row's edit icon): Product (text), Variation (reuses
   Classification Lookup's search/picker), Procedure (National / MRP/DCP / CP) + RMS (Reference
   Member State) picker when MRP/DCP, Countries (CMS) as a checkbox list with an "add" affordance
   for more countries, Quarter, Probability, live Fee/Hours preview footer, Cancel/Apply.

**Entry ergonomics:**
- **Duplicate** copies a line (same variation/procedure), leaving product/countries/quarter open
  for editing — covers "same change, different market/product" without re-entering everything.
- **Multiple countries per line** via the checkbox list — one line can carry several CMS at once
  instead of forcing one line per country.
- No Excel-paste bulk entry in the MVP — duplicate covers the common case; deferred otherwise.

Static mockup (approved, English, corrected terminology) rendered as an Artifact during
brainstorming — visual reference for implementation, not itself shipped.

## Persistence

`localStorage`, key `vcl_budget_plan_v1`, autosaved on every mutation (add/edit/delete/duplicate
line, FTE-input change). JSON payload carries a `version` field for future migrations.

**Edge case — storage unavailable** (private browsing / quota exceeded): catch the write, fall
back to an in-memory-only state for the session, and show a persistent banner: "Your plan isn't
being saved in this browser." Never let a storage failure throw and blank the view.

## Excel export

SheetJS (already a dependency via the Fee Calculator). Two sheets:
1. **Plan lines** — one row per line, all fields plus computed fee/hours.
2. **Rollup** — annual total, FTE, by-market table, by-product table.

## Edge cases

- **Incomplete line** (no countries selected, or no variation picked): fee/hours render as `0` /
  `—` in the roll-up, but the row itself shows an inline warning chip ("Countries incomplete")
  instead of crashing or being silently dropped — the mockup's row 4 shows this exact case.
- **Very large plans (50+ lines):** engines are pure/synchronous, so recompute-on-every-keystroke
  is cheap per line; still cache each line's `{fees, hours}` result in `_cache` and only
  invalidate the one line that changed, rather than recomputing the whole plan on every render.

## Testing

`test/test-budget-rollup.js` (repo root, project's framework-less Node-test pattern, root-relative
requires — same style as `test/test-additive-workload.js`): pure tests for `computeRollup` and
`computeFte` against hand-built line fixtures (empty plan; single line; multiple lines same
market/product; a line with zero countries). No DOM, no WordPress involved.

Manual acceptance pass in real Chrome after implementation (in-app browser screenshot tool is
unreliable for this project per prior sessions).

## Model-selection note (for the implementation plan / subagents)

Per the project's own model-selection strategy: UI/layout scaffolding → Haiku; roll-up math,
engine integration, localStorage/Excel wiring → Sonnet; no Opus-tier complexity expected here
(no grouping/worksharing edge cases touched — those stay inside the untouched engines).

## Wiring changes (small, mechanical)

- `includes/lookup.php`: register + enqueue `vcl-budget` (deps: `vcl-data`, `vcl-calc-app`,
  `vcl-workload-hours`, `vcl-workload-hours-data`) and `vcl-budget-style`; add the
  `vcl-budgetCol` container div alongside the other five view columns.
- `build_zip.py`: add `assets/js/vcl-budget.js` and `assets/css/vcl-budget-style.css` to `FILES`.
- `vcl-app.js`: add the `"budget"` entry to `OVERVIEW_DESTINATIONS`, the matching `state.view`
  branch/dispatch, and the column visibility logic — same shape as the existing five, no changes
  to how the other four work.

## Out of scope (Phase 2 — separate future brainstorm)

- Quarterly rollup view (Cashflow/capacity-peak breakdown) — field is captured now, view isn't.
- Probability-weighted expected value rollup — same: field captured, view deferred.
- Grouping/worksharing savings surfaced across plan lines (e.g. "these 3 lines share one CMS
  submission").
- Annual/maintenance fees (`HA_WEBSITES.annual`) as a standard line item.
- .docx one-page management summary export.
- JSON export/import or URL-state sharing.
- Bulk entry via paste.

## Done when

- New "Budget Planning" tile on the toolbox overview, opens the new view.
- Adding, editing, duplicating, deleting a line all work; fee/hours recompute live from the real
  engines (no separate/duplicated pricing or hours logic).
- Annual total, FTE (with editable hours/head), by-market, by-product all update live as lines
  change.
- Plan survives a page reload via `localStorage`; a storage failure degrades to a warning banner,
  not a crash.
- Excel export produces the two-sheet workbook described above.
- `node test/test-budget-rollup.js` green; existing tests still green;
  `python build_zip.py` builds without "unlisted files".
- Manual pass in real Chrome: create ~5 lines across 2 products/3 markets, confirm numbers match
  what the Guided Workflow would compute for the same inputs, reload the page, confirm the plan
  is still there.
