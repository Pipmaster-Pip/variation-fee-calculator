# VFC — Worksharing & Super-Grouping branch

**Date:** 2026-10-15
**Status:** Design (approved in brainstorming; implementation plan not yet written)
**Author:** Tom Deutschle (with Claude)

## 1. Goal

Add **Worksharing (WS)** and **Super-Grouping (SG)** as first-class procedure types to the
Variation **Fee Calculator** (the embedded "Classic Calculator", `vcl-calc-app.js`), by **reusing
the existing, battle-tested fee engine** rather than writing new pricing logic.

Two intents, both satisfied:
- **A — new procedure types:** the user can price a Worksharing or Super-Grouping procedure, not
  only a single/grouped submission.
- **B — surface existing capability:** the WS/SG pricing that already lives in `vcl-submission.js`
  (and is used by Guided Workflow + Budget) becomes reachable from the Fee Calculator.

## 1a. Decisions taken 2026-10-15 (supersede parts of §2/§5/§8)

- **Station A is the FULL Guided-Workflow Variations input** (classification search + substance +
  grouping list builder), not the slim stepper-only version from the approved mockup. Gold-themed.
- **Reuse, don't duplicate.** The toolbox already contains a decoupled, "GW-exact" Variations +
  Procedures editor inside **Budget Planning** (`vcl-budget.js`): a modal wizard whose Procedures
  station already captures **Worksharing & Super-Grouping** (mode, additional procedures, lead,
  SG-allowed kinds, the all-IA → bundling-mode rule) and prices through the shared engine.
- **Extraction path chosen:** pull Budget's Variations + Procedures stations (with their
  classification search and the draft/Submission plumbing) into a **shared module**
  (`vcl-proc-editor.js`) used by **both** Budget and the new WS/SG flow — one source of truth, no
  drift. Budget is touched **additively**; its behaviour must stay identical (guarded by its tests).
- This **relaxes** the earlier "GW untouched / own focused input (Approach A)" wording: we neither
  touch GW nor hand-duplicate it — we extract from Budget's already-decoupled copy.

## 2. Non-goals (explicit scope boundaries)

- **The classic single/grouping flow is not touched** (zero regression risk). Its 4-step wizard
  (Countries → Country details → Variations → Result) stays exactly as is.
- **No new fee engine.** The Excel-formula interpreter (`window.VCLCALC.computeFees`) and the
  orchestration layer (`VCL_SUBMISSION.computeSubmissionFees`) are reused unchanged.
- **Annual Update gets no own branch.** The fee of an Annual Update equals a grouping of Type IA
  variations, which the classic flow already produces. (See §9, design-verification item.)
- **No refactor of Guided Workflow.** `vcl-workflow.js` / `vcl-workflow-style.css` stay untouched.
- **No workload, no timeline.** RA hours and the submission timeline are out of scope for a
  fee-focused tool (see §6).

## 3. Key architectural finding (why this is low-risk)

The Fee Calculator's Excel-formula interpreter **is already the single shared fee primitive** for
the whole toolbox:

- `vcl-calc-app.js:967` defines and exports it as `window.VCLCALC.computeFees`.
- `vcl-submission.js`'s `computeSubmissionFees` does **not** compute country amounts itself — it is
  a pure orchestration layer that calls back into `engines.computeFees(...)` per procedure and
  adds the WS/SG lead, admin, process and IT-per-product adjustments on top.
- Guided Workflow (`vcl-workflow.js:178`) and Budget (`vcl-budget.js:19`) already inject
  `window.VCLCALC.computeFees` as `engines.computeFees`.

Consequence: the WS/SG branch only needs to **build a `Submission` object and call
`VCL_SUBMISSION.computeSubmissionFees(sub, engines)`** — exactly like GW/BP. There is **one** engine
with an orchestration layer, not two competing engines. A WS submission with a single procedure
therefore bottoms out in the same primitive as the classic single flow, so base fees cannot drift.

## 4. Entry point — a toggle button

In the Classic Calculator shell, next to the existing **"Fee data — country details"** button, add a
second **cream-coloured** button (same button family; set apart only by a `⇄` icon). It is a
**toggle** between the two flows:

| Current flow | Button label |
|---|---|
| Classic Calculator | **Worksharing / Super-Grouping** |
| WS/SG flow | **Classic Calculator** |

Clicking swaps the view inside the same calculator container. Entering the WS/SG flow starts a
**fresh** procedure-based input (it does not inherit the classic flow's country selection).

Naming decision: **"Worksharing / Super-Grouping" ⇄ "Classic Calculator"** (chosen over
alternatives *Standard Calculator* / *Single & Grouping* / *Per-country fees*).

## 5. The WS/SG flow — three stations

A gold-toned, GW-shaped wizard with **three** stations:

```
A  Variations   →   B  Procedures   →   C  Fees
```

Stations **A** and **B** replicate the Guided Workflow's layout/markup **exactly**, recoloured from
GW green to the VFC **gold** token set. GW's stations **C (RA tasks)** and **D (Date & Timeline)**
are **dropped**; the GW **Live-preview bar** (RA workload hours, timeline, "How the RA hours are
calculated" / "RA-hours reference" accordions) is **not shown** at all. The nav button is labelled
**"Next"** (matching GW's wording, not the classic "Continue").

### Station A — Variations
Same input as GW station A: a base variation plus "Additional variations" plus the type steppers
(Type IA / IB / II). The **mode is auto-derived** from the variation mix (see §7) and shown as a
gold **mode badge** (e.g. "→ Worksharing" / "→ Super-Grouping").

### Station B — Procedures
Same input as GW station B: the procedure list with per-procedure `kind ∈ {national, mrpdcp, cp}`
and, for MRP/DCP, RMS + CMS country selection; plus the **lead authority** (auto = EMA when a CP is
involved). The lead is **pricing-relevant** and must be retained here.

### Station C — Fees
The **result is rendered in the Classic Calculator's result style** — the dark-teal result panel
(`.vres-*` classes) with Fee total, per-country breakdown, the local-currency / EUR toggle and live
FX. Any **fee-category specials** the pricing needs (e.g. DE Type II "simple"/"complex",
"… - worksharing" variants, the lead's one-off fee category) are exposed here, as GW surfaces them
on its Fees station.

## 6. Why dropping C & D is safe (verified)

`computeSubmissionFees` depends only on `variations + procedures + mode + lead + specials + strengths`.
GW station **C (RA tasks)** feeds **only** `computeSubmissionHours` (workload); station
**D (Date & Timeline)** feeds **only** the timeline. Neither touches the fee computation. Dropping
them removes no pricing input.

## 7. Mode derivation (WS vs SG)

The engine already encodes the rule (`vcl-workflow.js:216–218`):
- **Worksharing** requires **not-all-IA** (at least one Type IB or II).
- **Super-Grouping** (and Annual Update) require an **all-Type-IA** submission.

So between the two modes this branch offers, the variation mix is **sufficient** to decide:

```
at least one IB/II  →  mode = "worksharing"
all variations IA   →  mode = "superGrouping"
```

The derived mode is written into `sub.mode` and shown in the badge. (The all-IA case is technically
also an Annual Update; since AU stays in the classic flow, this branch treats all-IA as SG.)

## 8. Data flow & components

### Submission object (built by the new flow, consumed by the engine)
Mirrors the shape GW builds (`vcl-workflow.js:166–174`):

```js
{
  mode: "worksharing" | "superGrouping",     // derived in station A
  variations: [{ code, variantId, type }, …],
  procedures: [{ kind, nat, rms, cms }, …],  // procedure[0] = primary, rest = additional
  lead: <cc or null>,                         // worksharing/super-grouping lead authority
  strengths: { default, overrides },
  specials: { line, ws, lead },               // fee-category picks
  raTasks: { … }                              // present but unused by fee path (kept null/empty)
}
```

### Engines (injected, same as GW `subEngines()`)

```js
{
  computeFees: window.VCLCALC.computeFees,
  adminFeeFor, processFeeFor, processFeeFlatFor,
  countries: window.VCLCALC.countries(),
  feeRows: window.VCLCALC_DATA.FEE_ROWS,
  itWsFees: window.VCLCALC.effectiveItWsFees(),
  sgLogic: window.VCL_SG_LOGIC,
  // workload/workloadData intentionally omitted — fees only
}
```

Result: `VCL_SUBMISSION.computeSubmissionFees(sub, engines)` → `{ total, byCountry: [{cc, total}] }`,
rendered through the classic result panel.

### Proposed files (to keep each unit focused)
- **`assets/js/vcl-ws.js`** — the WS/SG flow: state model, stations A/B/C rendering, Submission
  builder, engine call. Self-contained IIFE like the others; no changes to `vcl-calc-app.js`
  internals beyond a small hook to mount/unmount it and the toggle button.
- **`assets/css/vcl-ws-style.css`** — a **scoped** stylesheet under a wrapper class (e.g.
  `.vclws-app`) that mirrors `vcl-workflow-style.css`'s rules with the VFC gold tokens. GW's
  stylesheet is not edited, so GW's green is unaffected.
- **`includes/lookup.php`** — enqueue the two new assets; render the toggle button in the shell.

Exact wiring (how the toggle swaps the mounted view, where the button lives in the shell) is left to
the implementation plan.

## 9. Design-verification items (resolve during implementation)

1. **Annual Update pricing:** confirm no authority prices an Annual Update differently from a plain
   Type-IA grouping. If one does, AU may need a small note or a separate handling — but still not a
   button in this branch.
2. **Single-procedure parity:** assert that a WS submission with exactly one procedure produces the
   **same** per-country fee as the classic single/grouped flow for the same variations (same
   `computeFees` primitive — add a regression test).
3. **Scoped CSS:** verify the gold `.vclws-app` stylesheet does not leak into GW or the classic flow,
   and that GW stays visually green and unchanged.
4. **Retained pricing inputs:** verify the lead authority (station B) and fee-category specials
   (station C) are present and feed `specials`/`lead` correctly, since C & D were removed.

## 10. Resolved: "Continue" → "Next" in both flows

The nav button is renamed from **"Continue"** to **"Next"** in **both** the new WS/SG flow **and**
the classic flow (user decision 2026-10-15). This is the one deliberate, label-only touch to the
classic flow; it introduces no behaviour change.

## 11. Testing approach

- **Unit/parity tests** (Node, alongside `tests/vcl-sg-logic.test.js` etc.): build Submission objects
  for representative WS and SG cases and assert `computeSubmissionFees` totals; include the
  single-procedure parity test (§9.2).
- **Manual harness** (like `test/manual/*.html`): mount the WS/SG flow against the real data modules
  to click through stations A → B → C and read the result panel.
- **Visual check:** stations A/B match GW in gold; result panel matches the Classic Calculator.
