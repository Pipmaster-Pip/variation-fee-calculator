# Remove the standalone Workload Planning tool

**Date:** 2026-08-05
**Status:** Approved for planning
**Scope:** Step 1 only — remove the tool. Excel-driven timeline data is a separate Step 2 (not in this spec).

## Why

The standalone Workload Planning view is redundant: the Guided Workflow now covers the
use case, and it uses the newer additive PERT engine (`VCL_WORKLOAD_HOURS`), while the
standalone tool still runs the old multiplicative model (`VCL_WORKLOAD.raHours` × factors).
That old model is to be retired.

## Hard constraints

- **No visual change.** The Guided Workflow, Fee Calculator, and all other views must look
  and behave exactly as before. The only user-visible difference is that the
  "Workload Planning" nav tab and its view are gone.
- **No behaviour change to timeline output.** `computeSchedule` moves verbatim; the numbers
  it produces stay identical (locked by a characterization test).

## Coupling that must survive (do NOT delete)

The Guided Workflow depends on two things that live in the workload tool's orbit:

1. **`computeSchedule`** — the timeline engine, currently `vcl-workload.js:1288`, exported as
   `window.VCL_WORKLOAD.schedule`. Used by the GW's Date & Timeline station. It is
   self-contained: all inputs arrive via `opts`; it reads neither `state` nor
   `VCL_WORKLOAD_DATA`. Its only data are the module-local `TIMING` and `ASSESS` constants.
2. **`window.VCL_WORKLOAD_DATA`** — from `vcl-workload-data.js`. The GW reads `annualUpdate`
   / `meta` from it. This file stays.

Shared assets that stay:

- **`vcl-workload-style.css`** — styles the shared `.workload-col` class (the GW column reuses
  it) plus `.guide-overview*`, `.calculator-col`, `.detail-col`, `.result-card`. Deleting it
  would break the Guided Workflow layout. Stays enqueued as-is.
- **`vcl-workload-data.js`** — see above.
- **`workloadExcelUrl`** (admin option `vcl_workload_excel_url` + its getter + the
  `wp_localize_script` entry in `lookup.php`) — the Guided Workflow's RA-hours box uses it as the
  "Download the workbook" link (`vcl-workflow.js:2206`). The admin field STAYS. Its label still
  says "Workload Planning / Workload_RA_Stunden_Faktoren.xlsx", which is now stale copy — that
  wording fix is deferred to Step 2, not touched here.

Dead tool-only leftovers (CSS rules like `.assessment/.eop/.hatch`, data field
`taskDurationDays`) are **not** pruned here — deferred to Step 2 to keep this change low-risk.

## Changes

### New file — `assets/js/vcl-timeline.js`
Pure, DOM-free, Node-testable. Dual export: `window.VCL_TIMELINE` + `module.exports`.
Contains `computeSchedule` plus the `TIMING` and `ASSESS` constants, moved verbatim from
`vcl-workload.js`. Public surface: `VCL_TIMELINE.schedule(opts)`.

### `assets/js/vcl-workflow.js`
- Change the two call sites (`~516/517`) from `window.VCL_WORKLOAD.schedule` /
  `window.VCL_WORKLOAD` to `window.VCL_TIMELINE.schedule` / `window.VCL_TIMELINE`.
- Fix the stale comment at `~1992` that still mentions `window.VCL_WORKLOAD.factors`
  (no code reads `.factors`).

### Deleted — `assets/js/vcl-workload.js`
The whole standalone app: `render`, the old multiplicative `raHoursFor`, and everything else.
`computeSchedule` + `TIMING` + `ASSESS` have already moved to `vcl-timeline.js` first.

### `assets/js/vcl-app.js`
Remove the Workload view wiring only:
- nav button block (`~2227–2246`)
- `el.workloadCol` reference (`~138`)
- `isWorkload` visibility logic (`~197`, `~200`, `~207`)
- `"workload"` from the `state.view` enum comment (`~84`)
- the `OVERVIEW_DESTINATIONS` "workload" card entry (`~3257`)
- the overview dispatch branch `else if (dest === "workload") state.view = "workload";` (`~3227`)

### `includes/lookup.php`
- Remove `vcl-workloadCol` `<div>` (`~357`).
- Remove the `vcl-workload` script register + enqueue.
- Register + enqueue new `vcl-timeline` (no dependencies).
- Change `vcl-workflow`'s dependency array: `vcl-workload` → `vcl-timeline`
  (keep `vcl-sg-logic`, `vcl-data`, `vcl-calc-app`, and the workload-hours chain).
- Keep `vcl-workload-style` and `vcl-workload-data` enqueues untouched.

### `includes/admin.php`
- Remove the `workload` Reference/Last-updated row (`~447–455`) and the `'workload'` key from
  the `vcl_get_last_updated()` (`~66`) and `vcl_get_reference_text()` (`~90`) defaults and the
  save-handler `foreach` allowlist (`~543`). Verified: no surviving code reads `referenceText`/
  `lastUpdated` with key `"workload"` (the GW only reads `"calculator"`).
- **Keep** the Excel-URL field, `vcl_handle_save_workload_excel`, and `vcl_workload_excel_url` —
  the Guided Workflow consumes `workloadExcelUrl` (see coupling above). Stale label → Step 2.

### `build_zip.py`
FILES allowlist: remove `vcl-workload.js`, add `vcl-timeline.js`.

### Tests — `test/test-timeline.js`
Framework-less Node test (project pattern). Characterization: assert `VCL_TIMELINE.schedule`
returns the same output as the current `computeSchedule` for a representative set of `opts`
(IA → null; IB; IB unforeseen; II 30/60/90; national/cp/mrpdcp small+large; shared;
`clockStopFraction` 0/0.5/1). Written from the current numbers so a regression fails loudly.

## Out of scope (Step 2)
- Excel → `vcl-timeline-data.js` pipeline; confirming the "provisional / not yet confirmed"
  durations; pruning dead CSS and `taskDurationDays`.

## Done when
- No "Workload Planning" tab; Guided Workflow timeline unchanged; all other views visually
  identical.
- `node test/test-timeline.js` green; existing tests still green.
- `python build_zip.py` builds without "unlisted files".
