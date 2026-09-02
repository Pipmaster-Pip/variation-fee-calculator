# Design: Type-IA-only submission requires a bundling mode before advancing

**Date:** 2026-08-11
**Tools affected:** Guided Workflow (`vcl-workflow.js`), Budget Planning (`vcl-budget.js`)
**Type:** Bug fix (validation gate)

## Problem

When every listed variation is Type IA, Station B ("Procedures") offers two
submission modes — **Super-Grouping (SG)** or **Annual Update (AU)** — because a
Type IA is never submitted individually; it must be bundled into one of these
filings (the workflow itself states this in the Station D placeholder text).

The `Next` button (Guided Workflow) and the `+ Add line` / `Save line` button
(Budget Planning) are gated only on *procedure* completeness (kind + country/RMS).
Neither checks whether a submission mode has been selected. Consequences:

- In the Guided Workflow the user can advance to Stations C/D/E with
  `state.submission.mode === null`.
- In Budget Planning a line can be **saved** with `sub.mode === null`.
- The mode chip toggles back to `null` when its active chip is clicked, so the
  invalid state is reachable even after a selection.

For a Type-IA-only submission, `mode === null` is a fachlich impossible state.

## Scope of the trigger

The gate keys off `allVariationsAreIA()`, which resolves through
`computeAllVariationsAreIA()` using a **strict** `type === 'IA'` test.

This deliberately **excludes IAIN**. IAIN (immediate notification) must be
submitted within 14 days of implementation and cannot be parked in an Annual
Update. Because IAIN is not `'IA'`, `allVariationsAreIA()` is already `false`
whenever any variation is IAIN — so the SG/AU chips never appear for IAIN, and
this fix cannot affect the 14-day case. The gate applies to pure `'IA'` groups
only, which is correct.

(Out of scope: whether IAIN should have its own Super-Grouping path. Not part of
this fix.)

## Design (Approach A — extend the existing completeness predicate)

### Guided Workflow — `vcl-workflow.js`

`stationComplete("B")` currently returns `procComplete(state.procedure)`.
Extend it so that, when the submission is Type-IA-only, a mode must be set:

```js
if (key === "B") {
  return procComplete(state.procedure)
    && (!allVariationsAreIA() || !!state.submission.mode);
}
```

### Budget Planning — `vcl-budget.js`

`stationComplete("B", sub)` currently returns `procsOk && leadOk`. Add the same
mode requirement (using the local `allIA`/`sub` already available in that scope):

```js
if (key === "B") {
  // procsOk, leadOk as today ...
  var modeOk = !SUB.allVariationsAreIA(sub, engines()) || !!sub.mode;
  return procsOk && leadOk && modeOk;
}
```

This automatically fixes the `+ Add line` / `Save line` button, which already
depends on `stationComplete("A") && stationComplete("B")`.

### UX hint (both tools)

A disabled `Next` currently gives no reason. Co-locate a short hint with the
decision: render it **directly under the submission-type chips** in Station B,
shown only when the submission is Type-IA-only and no mode is selected
(`allVariationsAreIA() && !mode`):

> "Select Super-Grouping or Annual Update to continue — a Type IA is never
> submitted on its own."

Placing it under the chips (rather than next to the button) is more robust — the
Budget nav repaints via `paintNav()`, and the chips are the natural place for the
explanation. The hint disappears the moment a mode is chosen.

## Rejected alternatives

- **B — auto-select a default mode (e.g. AU):** hides a genuine RA decision
  (AU = one authorisation / 12-month window vs. SG = several authorisations) and
  would silently pick the wrong one.
- **C — allow advancing, block later in Fees:** worse UX; the invalid state
  propagates and Budget could still persist a broken line.

## Testing

Manual verification in a real Chrome (in-app browser screenshotting is
unreliable for this project):

1. **GW, three Type IA:** `Next` on Station B is disabled until SG or AU is
   picked; hint is shown; toggling the chip back off re-disables `Next`.
2. **GW, mixed types (not all IA):** Worksharing branch shown, `Next` behaves as
   today (no mode requirement).
3. **GW, one IAIN present:** SG/AU chips absent (Worksharing shown), `Next`
   unaffected by this change.
4. **Budget, three Type IA:** `Save line` / `+ Add line` disabled until a mode is
   chosen; enabled once SG or AU is selected.
5. **Budget, mixed types:** save/add behaves as today.

## Files touched

- `assets/js/vcl-workflow.js` — `stationComplete` (Station B branch) + hint render
- `assets/js/vcl-budget.js` — `stationComplete` (Station B branch) + hint render
