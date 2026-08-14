# Annual Fees – UI Refinement Batch (Budget Tool)

**Date:** 2026-08-14
**Scope:** Budget Planning tool, "Annual maintenance fees" section and the breakdown boxes
**Files touched:** `assets/js/vcl-budget.js`, `assets/css/vcl-budget-style.css`
**Not touched:** "Plan lines — Variations" table (serves only as the visual reference)

---

## 1. Goal

Refine the recently shipped Annual-Fees section so it reads as one system with the
Variations table, tidy up the Agency-fees tile, and add a Combined / Variations / Annual
filter to the two breakdown boxes so variation spend and recurring annual spend can be
inspected separately.

## 2. Out of scope

- The "Plan lines — Variations" table and its expand behaviour stay exactly as they are.
  They are the template the Annual table is aligned to, not a target for change.
- RA-hours and FTE tiles/logic. Annual fees carry no RA hours, so no split applies there.

---

## 3. Changes

### A. Agency-fees tile (`renderRollupTiles`, `vcl-budget.js:341`+)

1. **Remove the red left stripe.** CSS rule
   `.vcl-bud-tile.vcl-bud-agency { border-left: 3px solid var(--budget); }`
   (`vcl-budget-style.css:54`) is deleted. The tile keeps the standard tile border.
2. **Drop the `/yr` suffix** on the Annual-fee value (`vcl-budget.js:353`, the trailing
   `" /yr"` string). The recurring nature is already conveyed by the row label.
3. **Right-align the value.** Follows automatically from (2): the row is already
   `justify-content: space-between`; the `/yr` suffix was what pushed the number off the
   right edge. Verify the value column lines up with the "Variations" and "Total this year"
   rows after the suffix is gone.

### B. "Annual maintenance fees" table

4. **Header rename.** Column header "Special case / tariff" → **"Special cases"**
   (`vcl-budget.js:721`; also update the plain-text export header at `:1828` for consistency).
5. **Special-cases cell — only affected markets, plain text, no pills** (`annualTariffCell`,
   `vcl-budget.js:650`). Current behaviour lists *every* market with a country pill
   (`.vcl-bud-cc`) plus an "auto" label. New behaviour: render **only** the markets that
   actually carry a special case — i.e. a real tariff `<select>` (more than one tariff
   variant), a `turnover-based` market, or an explicit tariff choice such as UK POM. Markets
   that resolve to the single default tariff ("auto") and plain no-fee markets are **omitted**.
   Each shown market is plain running text — `MT · CMS`, `EL · turnover-based`, `UK · POM –
   standard` (the `<select>` stays for markets with a genuine choice) — **without** country
   pills. When a row has no special cases at all, the cell shows `—`.
6. **Row click expands a detail row, mirroring the Variations table** (`renderExpanded`/
   `vcl-bud-detail-row`, `vcl-budget.js:416`+). Annual rows become clickable and toggle a
   `.vcl-bud-detail-row` using the same grid/typography as the Variations expansion. The
   detail shows the per-market annual fee breakdown, the proration factor, the resolved tariff
   per market, and the local-currency amounts. Only one row (variation or annual) is open at a
   time — reuse the existing `state.expandedId` single-open convention.
7. **Move noisy notes into the detail.** The local-currency list
   (`UK 8,724 GBP, HU 364,500 HUF, SE 120,0…`) and any `+ turnover-based` / `+ rate
   unavailable` qualifier move out of the compact "Annual fee" cell into the expanded detail
   (from #6). The compact cell shows the clean EUR figure only.
8. **Fix the two right-hand columns running into each other** (`<colgroup>`,
   `vcl-budget.js:717`). The "Annual fee" notes were overflowing into the actions column.
   With the notes moved (#7), widen the fee column, give the actions column a fixed width, and
   re-check the column-width percentages so the row fits without overflow.
9. **Remove the horizontal scrollbar.** Caused by `.vcl-bud-table-wrap { overflow-x: auto }`
   (`vcl-budget-style.css:73`) plus the overflowing `nowrap` fee-cell note. Once #7/#8 remove
   the overflow the bar disappears on its own; additionally set `overflow-x: clip` (or
   `hidden`) on the Annual table's wrapper as a guard so a stray wide cell can never
   reintroduce it.
10. **Match Variations typography/design.** The Annual table already reuses the shared
    `.vcl-bud-table*` classes; audit font sizes, cell padding, and the muted-note style so the
    two tables are visually indistinguishable apart from their columns.

### C. "+ Add product" button (`renderAnnualTable`, `vcl-budget.js:705`)

11. **Make it subtle + add a hint.** Change from `vcl-bud-btn--primary` to
    `vcl-bud-btn--ghost`. Add a quiet helper line next to/under the button:
    *"Add a product for which no variation is planned in {year}"* — `{year}` is the plan year
    (`planYearLabel()`), never a literal "XXX".

### D. "Add product" editor — escape without input (`renderAnnualEditor`, `vcl-budget.js:2244`+)

12. **Clear back/cancel path on Station A.** Today the only exit is the small `✕` top-right;
    the nav "← Back" is disabled on Station A (`idx === 0`). Add an always-enabled
    **"← Back to plan"** control in the nav bar (or make the existing cancel obviously visible)
    so the user can leave the editor without entering a product name. Cancelling discards the
    draft (existing `closeAnnualEditor` behaviour).

### E. Header "New line" button (`vcl-budget.js:804`)

13. **Rename** — the button now sits above a section that also feeds annual fees, so "New
    line" alone no longer fits. **"+ Add variation line"** (parallel to the annual table's
    "+ Add product"). Confirmed 2026-08-14.

### F. Breakdown split toggle — **Variante A** (`rerender`, `vcl-budget.js:810`+)

14. **Three-state segmented control above the two breakdown boxes:**
    `Combined | Variations | Annual`. Default **Combined** (today's behaviour). One control
    filters **both** boxes at once.
15. **Data source per mode** — all three sources already exist, no engine change:
    - `Combined` → `mergeBreakdown(rollup.byMarket, annualRollup.byMarket)` (current)
    - `Variations` → `rollup.byMarket` / `rollup.byProduct`
    - `Annual` → `annualRollup.byMarket` / `annualRollup.byProduct`
    Same for the `…Product` variants. The panel total switches to match the active source
    (`rollup.totals.fee`, `annualRollup.totalEur`, or the combined sum).
16. **Empty state.** A market/product with zero spend in the active mode drops out (existing
    `renderBreakdownPanel` already filters/sorts). If a whole box would be empty (e.g. Annual
    mode with no annual lines), show a quiet "No annual spend" / "No variation spend" note.
17. **Scope = Variante A (breakdown boxes only).** The Agency-fees tile and RA-hours/FTE tiles
    are **not** filtered — the tile stays the permanent Variations + Annual + "Total this year"
    overview so the full budget figure is always anchored on screen.
18. **State.** `state.breakdownMode` (`"combined" | "var" | "ann"`), session-only — a view
    preference, **not** persisted to localStorage; resets to `Combined` on reload. Clicking a
    segment sets the mode and re-renders the two panels (wire into the existing header/table
    click delegation).

---

## 4. Data flow / engine

No changes to `vcl-budget-engine.js`. `computeRollup` and `computeAnnualRollup` already
return separate `byMarket` / `byProduct` breakdowns; `mergeBreakdown` (`vcl-budget.js:332`)
already combines them. The toggle only selects which of the three the two panels render.

## 5. Testing / verification

- Manual pass in **real Chrome** (in-app browser screenshot tool is unreliable per project
  notes): red stripe gone, `/yr` gone and value right-aligned, no horizontal scrollbar, the
  two Annual columns no longer collide.
- Special-cases cell: a row with only "auto" markets shows `—`; a row with MT/NL/UK/EL shows
  exactly those, plain, no pills.
- Row click expands/collapses; only one row open at a time across both tables.
- "+ Add product" opens, "← Back to plan" returns to the plan with no product entered.
- Toggle: Combined = today's totals; Variations drops annual-only markets (e.g. MT stays but
  DE-only-variation stays, annual-only rows vanish); Annual drops variation-only markets
  (e.g. DE with no annual fee disappears); box totals match the active source.
- Excel export still succeeds and the "Special cases" header rename is reflected.

## 6. Decisions

- **New-line button label:** "+ Add variation line" (confirmed 2026-08-14).
- **Breakdown toggle scope:** Variante A — breakdown boxes only (confirmed 2026-08-14).
