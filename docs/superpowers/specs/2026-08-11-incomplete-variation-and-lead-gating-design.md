# Design: Gate incomplete additional variations and the SG/WS lead

**Date:** 2026-08-11
**Tools:** Guided Workflow (`vcl-workflow.js`), Budget Planning (`vcl-budget.js`)
**Type:** Bug fix (two live-test findings)

## Bug A — "＋ Add variation" and Next allow incomplete additional variations

In both tools the "Additional variations" builder lets the user click
"＋ Add variation" repeatedly, each click appending an empty row
(`{code:null, variantId, type:null, query:""}`). There is no guard, so empty
rows stack up. Empty rows are filtered out of the fee/IA counts
(`filter(t => !!t)`), so they are not fee-incorrect, but they are dead UI state
and let the user advance mid-entry.

**Desired behaviour (user-chosen scope: gate both Add and Next):** while any
additional-variation row has no type selected:
1. "＋ Add variation" is disabled.
2. Advancing past the Variations station is blocked.

## Bug B — SG/WS lead not required before advancing (Guided Workflow only)

In the Guided Workflow, `stationComplete("B")` is:

```js
procComplete(state.procedure) && (!allVariationsAreIA() || !!state.submission.mode)
```

It does not check the lead. When Super-Grouping or Worksharing is active
(`leadPricingActive()`), a lead authority is mandatory, but `state.worksharingLead`
may still be `null` (the "— select —" state) and `Next` stays enabled.

Budget Planning already gates this: `stationComplete("B")` includes
`leadOk = !SUB.leadPricingActive(sub) || !!sub.lead`. So Bug B is **Guided
Workflow only**; Budget needs no change.

(CP case is safe: when a CP is involved the lead auto-locks to the EMA in
`rerender()`, so `worksharingLead` is non-null.)

## Fix

### Guided Workflow — `vcl-workflow.js`

**Bug A:**
- `buildGroupingList`: disable the "＋ Add variation" button when
  `state.grouping.some(g => !g.type)`.
- `stationComplete("A")`: `hasVariation()` checks only the base variation
  (`currentType()`); extend to also require every grouping row resolved:
  `hasVariation() && state.grouping.every(g => !!g.type)`.

**Bug B:**
- `stationComplete("B")`: add `&& (!leadPricingActive() || !!state.worksharingLead)`.

### Budget Planning — `vcl-budget.js`

**Bug A:**
- `renderGroupingList`: disable the "＋ Add variation" button when any additional
  variation is incomplete: `sub.variations.slice(1).some(v => !v.type)`.
- `stationComplete("A")` already requires `sub.variations.every(v => !!v.type)`,
  so the Next part of Bug A is already covered — no change.

**Bug B:** no change (already gated by `leadOk`).

## Non-goals / out of scope

- Extra-procedure completeness in SG (an added procedure with no country) is a
  separate potential gap; not part of this fix.
- Auto-pruning empty rows on Next: not needed — Add is disabled while incomplete,
  and Next is blocked, so empty trailing rows cannot persist into a completed
  station.

## Testing (browser, real Chrome)

1. **GW, add variation:** click "＋ Add variation" → new empty row; the
   "＋ Add variation" button is now disabled and `Next` is disabled. Pick a type
   (or a code) → both re-enable.
2. **GW, remove:** removing the incomplete row (✕) re-enables Add/Next.
3. **GW, SG lead:** with SG active and lead "— select —", `Next` on Procedures is
   disabled; selecting an RMS enables it; a CP-based SG auto-locks EMA and is
   enabled.
4. **Budget, add variation:** same Add-button behaviour; Next already blocked by
   the existing all-typed gate.
5. **Regression:** a fully-typed grouping list and a chosen lead behave exactly
   as before (nothing over-blocks).

## Files touched

- `assets/js/vcl-workflow.js` — `buildGroupingList` (add-button guard),
  `stationComplete` (A: grouping-complete; B: lead)
- `assets/js/vcl-budget.js` — `renderGroupingList` (add-button guard)
