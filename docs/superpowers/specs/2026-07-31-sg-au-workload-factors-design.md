# Design: Super-Grouping & Annual Update — RA-hours factors in the Workload Planning tool

**Date:** 2026-07-31
**Scope:** Workload Planning tool only (`assets/js/vcl-workload.js`). Refine the RA-hours
factors for Super-Grouping (SG) and Annual Update (AU) so they match the maintained workbook
`Workload_RA_Stunden_Faktoren.xlsx`, and add the minimal input SG needs to consume its new
per-procedure hours. No changes to the Guided Workflow, the Fee Calculator, or the SG/AU
domain model beyond what is listed here.

## Background

The workbook is the single source of truth for the factor table. The user has updated it and
these values now disagree with the hard-coded `F` object in `vcl-workload.js`:

| # | Factor | Code (current) | Workbook (source of truth) |
|---|--------|----------------|----------------------------|
| 1 | SG factor (⑤a) | `1.3` | `1.2` (R48) |
| 2 | SG hours / further procedure (⑤b) | *does not exist* | national `1`, MRP/DCP `1`, CP `1` (R55–57) |
| 3 | AU — per Type IA (⑤b) | `perIA: 5` | `0.5` (R61) |
| 4 | Grouping — per Type IA (⑤b) | `perIA: 1` | `0.5` (R58) |

Points 1, 3, 4 are pure value corrections. Point 2 is the one structural addition: SG currently
exposes only a checkbox + factor, with no way to enter *how many* further procedures, so the new
workbook hours cannot be applied without a small input, modelled on the existing Worksharing
counters.

## Decisions (from brainstorming)

- **SG input:** three counters — national / MRP-DCP / CP — mirroring Worksharing but adding CP.
  Chosen over a single counter so the tool stays correct if the per-procedure hours diverge
  later (they are all `1` today).
- **Source of truth:** the workbook wins across the board — AU per IA → `0.5`, and Grouping per
  IA → `0.5` is corrected too, so code and workbook are deckungsgleich everywhere.
- **CP exclusivity:** enforced in the tool as in the Guided Workflow. The SG counters shown
  depend on the tool's single `state.procedure`: a CP main procedure shows only the CP counter;
  a national/MRP-DCP main procedure shows national + MRP/DCP and hides CP.

## Changes

All RA-hours factors live in the `F` object in `vcl-workload.js` (the `SCOPE` note in
`vcl-workload-data.js` forbids putting them anywhere else). The UI follows the existing
Worksharing pattern.

### 1. Data — `F.submission` (`vcl-workload.js`)

```js
annualUpdate:  { factor: 1.2, perIA: 0.5 },                              // perIA 5 → 0.5
grouping:      { factor: 1.2, perIA: 0.5, perIB: 1, perII: 2 },          // perIA 1 → 0.5
superGrouping: { factor: 1.2, perNational: 1, perMrpdcp: 1, perCp: 1 },  // factor 1.3 → 1.2; perX new
```

Bump `F_META.lastChecked` to `2026-07-31` (the in-code rule requires a bump on every `F` change,
because the "How this estimate is built" panel prints the date next to the workbook link).

### 2. State (`vcl-workload.js`, `state` object)

Add three fields alongside `worksharingNational`:

```js
superGroupingNational: 0,
superGroupingMrpdcp: 0,
superGroupingCp: 0,
```

### 3. UI — SG counters with CP exclusivity (`buildProcedureOptions`, in the `subRow` block)

Add an `if (state.procOptions.superGrouping)` branch, gated on `state.procedure`:

- `procedure === "cp"` → render **only** the CP counter; hide national/MRP-DCP **and** reset
  their state to `0` (same discipline Grouping uses when a type is not allowed).
- `procedure === "national" | "mrpdcp"` → render **national + MRP/DCP** counters; hide CP and
  reset `superGroupingCp = 0`.

Labels in the Worksharing style: "Other procedures — national / MRP-DCP / CP", each with its
`hoursPill(F.submission.superGrouping.perX)`.

### 4. Calculation

- `submissionAddHours()`: add an SG branch —
  `perNational·superGroupingNational + perMrpdcp·superGroupingMrpdcp + perCp·superGroupingCp`.
- `submissionFactorProduct()`: unchanged; it already multiplies by `superGrouping.factor`, which
  now reads `1.2`.
- `submissionPending()`: extend the SG check so it accounts for the new `perNational/perMrpdcp/
  perCp` fields (currently it only tests `superGrouping.factor == null`).

### 5. "How this estimate is built" panel

Add three SG rows (per national / MRP-DCP / CP) next to the existing Worksharing per-procedure
rows, so the provenance of every hour stays visible.

### 6. Tests (`tests/`)

Extend the existing Workload tests with SG-hours cases:

- **CP-only SG:** main procedure CP, N CP counters → `N × 1 h` added, national/MRP-DCP counters
  absent from state.
- **National + MRP-DCP SG:** main procedure national, counts on national and MRP/DCP → correct
  sum, CP counter forced to `0`.
- **AU per-IA regression:** an AU case that pins `perIA = 0.5` (guards against the old `5`).

The counter-based sums above are the test anchors; the workbook's ⑤b values (all `1 h`) are
transcribed directly, so no separate worked example is needed.

### 7. Workbook cleanup (Excel, not code)

Remove the now-contradictory note in workbook row **R62** ("Super-Grouping hat (aktuell) keine
mengenabhängigen Zusatzstunden – nur den Faktor in ⑤a."), which the new R55–57 rows contradict.
User has approved deletion. Must be done via Word/Excel COM automation — **never** via `openpyxl`,
which would drop the workbook's drawings.

## Out of scope

- SG multi-procedure / multi-RMS / Lead+LoI / Chapter-C modelling (that lives in the Guided
  Workflow; the Workload tool only estimates hours).
- CMS-staggered SG hours: the workbook gives a flat 1 h per MRP/DCP procedure for SG, not the
  small/large split used by the base procedure factor.
- Any AU/SG timeline or window changes.

---

## Addendum (2026-07-31): Guided Workflow RA-hours coverage

**Why:** brainstorming assumed the Workload tool's own view was the only consumer of the factor
table. It is not: `vcl-workload.js` also exposes `raHoursFor(opts)` as `window.VCL_WORKLOAD.raHours`,
which the **Guided Workflow** (`vcl-workflow.js`, `raEffort()`) calls to show RA hours. That path
handled only grouping + worksharing — **no AU, no SG** — so the Guided Workflow's AU/SG modes showed
RA hours without AU/SG effort. This is the long-standing "RA-Workload für AU/SG noch offen" item.
User approved extending the spec to cover it. The approved design above is unchanged; this adds two
tasks.

### A. `raHoursFor(opts)` — add AU/SG, and become DRY

`raHoursFor` currently inlines its own copy of the per-item hours sum (grouping + worksharing).
Replace that inline sum with a call to the pure `computeSubmissionAddHours` (from the module built in
Task 1), so the module is the single source of the add-hours sum for BOTH the tool's own view and
this API. Then:

- **Factor product (`sf`):** additionally multiply by `F.submission.annualUpdate.factor` when
  `opts.annualUpdate`, and by `F.submission.superGrouping.factor` when `opts.superGrouping`.
- **New `opts` fields consumed:** `annualUpdate` (bool), `annualUpdateIaCount` (number),
  `superGrouping` (bool), `superGroupingProcs` (`{national, mrpdcp, cp}`).
- The CMS add-on (`F.cmsHoursPer × cmsCount`) stays as-is, added outside the module call.

### B. `raEffort()` — pass AU/SG context, mode-exclusively

`raEffort()` must set the four submission flags **mutually exclusive by mode**, so AU/SG never also
trigger the grouping or worksharing factor:

- `grouping: state.submission.grouping && !(auActive() || sgActive())`
- `worksharing: wsActive()` (was `multiProcedureMode()`, which is true in SG mode too — the source
  of the double-count risk)
- `annualUpdate: auActive()`, `annualUpdateIaCount: auActive() ? 1 + groupingBuckets().IA : 0`
  (all Type-IA in the AU: the primary IA plus the IA entries in the grouping list — per the user's
  "count all Type-IA" decision)
- `superGrouping: sgActive()`, `superGroupingProcs: sgProcKinds()`

New helper `sgProcKinds()` (mirrors `worksharingKinds()` but includes CP and only for SG): counts
`state.worksharing` entries by kind into `{national, mrpdcp, cp}`. The primary procedure
(`state.procedure`) is the base and is NOT counted — consistent with the standalone tool where
`state.procedure` is the base and the counters are the *further* procedures.

Count objects (`groupingCounts`, `worksharingProcs`, `superGroupingProcs`) may be passed
unconditionally: `computeSubmissionAddHours` ignores a count block whose `procOptions` flag is false,
so only the flags above need mode-gating.

### Behaviour change (intended)

In SG mode the Guided Workflow previously applied the worksharing factor (1.2) and worksharing
per-procedure hours (national 1 h, **MRP/DCP 2 h**, CP not counted at all). After this change it
applies the SG factor (1.2 — numerically equal today) and SG per-procedure hours (national 1 h,
**MRP/DCP 1 h**, **CP 1 h**). So SG effort with MRP/DCP procedures drops by 1 h each, and CP
procedures now contribute. AU mode gains its factor (1.2) and 0.5 h per Type-IA, where before it had
neither.

### Testability

The add-hours sum is covered by Task 1's module tests (extended in Task 6 with AU/SG count cases).
`raHoursFor`'s factor multiplication and `raEffort()`/`sgProcKinds()` live in browser IIFEs and are
**code-verified**, not unit-tested (no WP dev-server in this environment; same limitation as the
existing `computeRaHours`/Guided-Workflow code).
