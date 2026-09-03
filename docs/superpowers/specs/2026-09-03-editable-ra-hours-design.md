# Editable RA hours — user adjustments on top of the benchmark

Date: 2026-09-03
Status: approved (design), ready for planning
Affects: Guided Workflow (Station C "RA tasks"), Budget Planning (line editor), v1.22.0

## Problem

RA hours are dictated by the RA/CMC benchmark workbook (`RA-CMC-hours.xlsx` →
`vcl-workload-hours-data.js`). A department whose real effort differs from the benchmark has no
way to say so: the numbers are take-it-or-leave-it, which makes both the Guided Workflow's effort
box and the Budget tool's FTE figure unusable for them.

## Solution

The benchmark stays the default and the single source of truth. On top of it, the user sets an own
**adjustment in hours per block** — positive or negative — via a stepper. Benchmark and own share
stay visibly separate everywhere they are shown (station, breakdown, exports).

Approved mockup: <https://claude.ai/code/artifact/f0bb70ab-3795-4917-83ee-0720578f37da>
("Variante 2": the stepper is collapsed behind an "Adjust these hours" link until used).

## Station C after the change

Four blocks, in this order, each a white card with the hour band right-aligned in its header row:

1. **RA preparation** — not switchable, tinted in the tool colour, badge `ALWAYS INCLUDED`,
   sub-line "Based on your variations & procedures (Type IB · MRP/DCP · 3 CMS)".
2. **CMC dossier written in RA** — toggle, active-substance chips.
3. **Product information** — toggle, document chips.
4. **Compilation & submission** — toggle.

Rules:

- A block that is **on** shows its effective band (`min – max h`); a block that is **off** shows a
  muted "not in RA" and no adjustment control.
- The adjustment control is collapsed to an **"Adjust these hours"** link while the block's
  adjustment is 0. Once non-zero it stays expanded permanently — a stored number the user cannot
  see would be worse than one extra row.
- Expanded, it reads: `Own adjustment  [ − ] ± 0 h [ + ]` and, when non-zero, the benchmark beside
  it in ochre (`--history`): `Benchmark 20 – 34 h`.
- **Step size: 1 h.** Both directions. `−` is disabled once the block's min would go below 0.
- The adjustment shifts **min and max together**, so the band keeps its width. Clamping at 0
  applies to the block's min; the max is shifted by the same amount that the min was clamped by,
  so the band never inverts.
- Changing the variation type or procedures in Station A/B recomputes the benchmark; the
  adjustment stays put.
- The adjustment of a switched-off block is **kept, not zeroed** — toggling a module off and on
  again must not silently lose a number the user typed.

## Budget Planning

The same component, in the line editor overlay, in the Budget tool colour (`--plum` instead of
`--workflow`) and set slightly more compact. Same logic, same code path, no second implementation.

The adjustment does **not** travel through "Take over from your summary" — corrected 2026-09-03,
after the final review checked it. That handoff carries the variations only and never carried
`raTasks` (not the gates, not the PI documents, not the active substance), so hours were always
re-entered on the Budget side. Extending the handoff is a separate change, deliberately not made
here.

## Architecture

### Data

`Submission.raTasks` gains one field:

```js
raTasks: {
  cmc, compilation, pi, piDocs, activeSubstance,
  hourAdjust: { core: 0, cmc: 0, pi: 0, compilation: 0 },  // integer hours, may be negative
}
```

- Guided Workflow: `state.hourAdjust`, mapped in `submissionFromState()`
  ([vcl-workflow.js:158](../../../variation-fee-calculator/assets/js/vcl-workflow.js)); reset with
  the other RA-task fields in the station's reset path.
- Budget: `emptySubmission()` and `normalizeSubmission()` in `vcl-budget-engine.js` gain the field.
  Normalisation coerces to integers and drops unknown keys; a stored plan without the field loads
  with all-zero adjustments, so **the plan storage version stays 3** (purely additive).

### Hours engine (`vcl-workload-hours.js`)

`computeAdditiveWorkload(HD, sel)` accepts `sel.hourAdjust` and returns, in addition to today's
parts, an `adjust` object with the four applied deltas (after clamping). `composeSections(parts)`
adds them into the visible sections:

| Block | Engine parts it covers | Section it lands in |
|---|---|---|
| `core` | `raCore` + `submissionRa` (grouping / worksharing / super-grouping add-ons) | RA |
| `pi` | `pi` | RA |
| `cmc` | `cmcCore` + `submissionCmc` | CMC |
| `compilation` | `compilation` | Compilation & submission |

Grouping, worksharing and super-grouping get **no stepper of their own**: they are RA preparation
work and are covered by that block's adjustment. This keeps the station at four controls.

An adjustment for a block whose gate is off contributes nothing (its parts are already zero).

Each non-zero adjustment also appends one itemised line — `{ label: "Own adjustment", min: d,
max: d, own: true }` — to its section's `items`, so every existing consumer of `items` shows it
without change.

### UI

The station is rendered today twice: `buildStationRA()` in `vcl-workflow.js` and its counterpart in
`vcl-budget.js`. Both are replaced by one shared renderer, `assets/js/vcl-ra-tasks-ui.js`
(`window.VCL_RA_TASKS`), taking the host element, the `raTasks` object, the live per-block bands
from the engine, an `onChange` callback and a `compact` flag. Enqueued before both tools, in the
same style as `vcl-submission.js`.

This is the part of the change that guarantees "GW and Budget look and behave identically" — a
promise a second copy of the markup cannot keep.

### Where the adjustment shows up

- Station C blocks (above).
- The Guided Workflow method/transparency box and the Budget per-line breakdown: as the ochre
  "Own adjustment" row inside its section, above the subtotal.
- `.docx` summary export (GW) and CSV export (Budget): as its own row, never merged into the
  benchmark figure.

## Out of scope

- **Editing the benchmark workbook values themselves.** That would be an hours editor in wp-admin,
  analogous to the fee editor — a separate, larger feature.
- **Persisting adjustments as a department default** across sessions/lines.
- **The scroll-target fix** (`VCL_APP.scrollToTop` jumps to the masthead instead of the tool
  heading; `jumpToContentTop()` exists in [vcl-app.js:439](../../../variation-fee-calculator/assets/js/vcl-app.js)
  but is not exported). Noted during this brainstorming, tracked separately.

## Version

`Version:` header and `VFC_VERSION` → **1.22.0** (per the project rule to bump on every change).
