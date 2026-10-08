# Budget Planning — Internal & External Cost

Date: 2026-10-08
Status: Approved for implementation (implement directly, no separate plan)

## Goal

Extend the Budget Planning tool from "official fees (€) + FTE (headcount)" to a
true **total cost** per plan line and per plan: official fees + internal RA cost
(hours × rate) + optional external costs (consultant / agency / local rep).

This completes the cost model started in the Guided Workflow (v1.30.0,
[[workflow-internal-total-cost]]) and lands the external costs that were
deliberately deferred there.

## Decisions (from the brainstorm)

- **Internal cost: always computed** (no opt-in gate) once a plan-wide rate is set.
  No rate → internal/total shown as "—" (no fabricated number).
- **Internal RA rate: plan-wide, single value**, kept with the plan (like
  `hoursPerHead`). Lives in a new dashboard **Total cost** tile, inline input
  analogous to the FTE tile's "hours per FTE".
- **External costs: per plan line**, entered in the editor (Station "Product",
  4th field in the Year/Quarter/Probability meta row). Summed on the dashboard.
- **"Track external costs": plan-wide toggle** in the Total cost tile, **default
  OFF**. OFF hides the external field (editor), the external line (Cost summary),
  and the external contribution everywhere — the tool stays fees+internal only.
  ON reveals external input per line.
- **Table: dynamic RA-cost column.** One column, not a separate External column:
  - OFF → header **"Int. RA costs"**, value = internal cost.
  - ON  → header **"Int./ext. RA costs"**, value = internal + external.
  Plus a **"Total cost"** column = fee + that. (Variante 1: both columns in the
  row; the table already scrolls horizontally when narrow.)
- **Detail row** (expanded line, right column, under "Fee by country → Total
  fee"): a read-only **Cost summary** block — Official fees · Internal (h × rate,
  band) · External (only when tracked) · **Total cost** (band). The existing
  **Expected value** block gains **Expected total cost**.

## Calculation

Per line, hours come from the shared engine (`computeSubmissionHours` →
`{ expected, min, max }`, already used for the Hours (PERT) column and rollup).

- `rate` = plan-wide internal RA rate (parsed, > 0). Unset/invalid → internal and
  total are undefined ("—").
- Internal cost: expected = `hoursExpected × rate`; band = `hoursMin × rate …
  hoursMax × rate`.
- External cost: per-line `externalCost` (number ≥ 0), only counted when
  `trackExternal` is on.
- RA-cost column value = internal (OFF) or internal + external (ON); band =
  internal band shifted by the external point value.
- Total cost: `fee + internal (+ external when tracked)`; band = fee (point) +
  internal band (+ external point).
- Rollup totals gain `internalExpected`, `externalTotal`, `totalCostExpected`
  (and min/max for the band shown in the tile sub-line if desired). Probability
  weighting follows the **existing** rollup behaviour (the current rollup is
  unweighted/expected); the detail's "Expected value" block adds Expected total
  cost the same way it shows Expected fee/hours.

## UI

### Dashboard — new "Total cost" tile (4th tile)
- Label "Total cost · <year>", big value = plan total cost (budget colour, serif),
  sub-line "Fees … · intern … · extern …" (extern only when tracked).
- Inline **Internal RA rate** input (€/h) — same control pattern as the FTE tile.
- **Track external costs** toggle (reuse the `vcl-rat-toggle` component), default off.
- No rate set → value "—", sub-line omits the internal/extern parts.

### Editor — Station "Product"
- The Year/Quarter/Probability meta row gains a 4th field **External costs** (€),
  shown **only when `trackExternal` is on**. The row template switches from
  `--triple` (3) to the 4-column base when shown.
- Stored on the draft/line as `externalCost`. Commit on `change`, like the other
  selects, so the fee/cost recompute fires on blur.
- No live cost result on this station (consistent with Probability — variations /
  procedures aren't set yet).

### Plan table
- Rename the hours-area cost column dynamically ("Int. RA costs" / "Int./ext. RA
  costs") and add a **Total cost** column. Both render expected value + band
  below (like Hours (PERT)); "—" when no rate.

### Detail row
- Right column, below "Total fee": **Cost summary** block (Official fees →
  Internal → External [if tracked] → Total cost, with bands). The **Expected
  value** block gains **Expected total cost**.

### Two polish items (bundled in)
1. **Agency fees tile** restyled to match the FTE tile: the big total (€, serif,
   budget colour) directly under the label, with the Variations / Annual fee /
   Total breakdown below the big number.
2. **Plan-table rows top-aligned** — cell `vertical-align: top` (currently they
   read as vertically centred).

## State & persistence

Plan localStorage **v3 → v4** (`BUD.savePlan` / `BUD.loadPlan`):
- add `internalRate` (string, default "") and `trackExternal` (bool, default false)
  at plan level;
- add `externalCost` (number, default 0) per line.
Migration: a v3 plan loads with `internalRate: ""`, `trackExternal: false`, and
`externalCost: 0` on every line. This is the user's own planning data on their own
device (already persisted); no new privacy surface.

## Files touched

- `assets/js/vcl-budget-engine.js` — plan v4 (save/load + migration), rollup
  totals for internal/external/total cost, a cost helper (hours+rate+external →
  {internal, external, total} with bands).
- `assets/js/vcl-budget.js` — Total cost tile (rate input + toggle), Agency tile
  restyle, external field in the editor, dynamic cost column + Total cost column
  in the table, Cost summary block + Expected total cost in the detail row.
- `assets/css/vcl-budget-style.css` — tile/toggle/cost-block styles, top-aligned
  rows.
- `variation-fee-calculator.php` — version bump 1.30.0 → 1.31.0.

## Testing (live harness)

1. No rate → cost column + Total cost + tile show "—"; rest unchanged.
2. Rate 90, toggle OFF → "Int. RA costs" = hours×90 with band; Total cost = fee +
   internal; tile sub-line "Fees · intern"; no external anywhere.
3. Toggle ON → editor shows External costs field; enter 1,500 → column becomes
   "Int./ext. RA costs" = internal + 1,500; Total cost += 1,500; detail Cost
   summary shows an External line; tile sub-line adds "extern".
4. Reload → plan v4 round-trips rate, toggle, and per-line external.
5. Old v3 plan loads without error (migration).
