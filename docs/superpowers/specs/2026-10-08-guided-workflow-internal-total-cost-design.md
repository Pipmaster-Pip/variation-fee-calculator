# Guided Workflow — Internal & Total Cost (Station E)

Date: 2026-10-08
Status: Approved for implementation

## Goal

Turn the Guided Workflow's Fees station from "what is the official fee?" into
"what does this variation cost in total?" by adding, as an opt-in, the internal
RA effort expressed in money and a combined total.

Today the summary shows the official fees (€) and the RA workload (hours) side by
side but unconnected. This feature multiplies the RA hours by a user-supplied
hourly rate and adds the result to the fees.

## Scope

In scope (Station E only):
- A gate (toggle) **Include internal cost**, OFF by default. When off, Station E
  and its summary look exactly as today.
- When on: one input **Internal RA rate** (€/h).
- Two new summary rows: **Internal cost** and **Total cost**, each as an expected
  value plus a min–max band (mirroring the existing RA-workload row).
- A short derivation footnote under the new rows.
- The new rows flow into the existing `.docx` export automatically (the export
  mirrors the summary card).

Explicitly out of scope (YAGNI / moved elsewhere):
- **External costs** (consultant / agency / local representative). These belong
  in the Budget tool, across variations — a separate later spec.
- Per-department / per-activity rates — one global rate is enough.
- Named scenarios (Lean / Typical / Complex) — the existing min–max band covers
  this.
- Sensitivity ("what changes the result").
- Persisting anything beyond the browser session.

## UI

Location: Station E ("Fees"), a **Cost inputs** card inserted after the fee grand
total and its hint, immediately above the Summary card. Shown only when there are
priced countries (i.e. fees exist).

The toggle reuses the existing `vcl-rat-toggle` component (same switch as Station
"RA tasks"). When ON, a single rate input appears below it with a `€/h` suffix and
a one-line hint: "Rate × expected RA hours. Applies to this session only; nothing
is stored permanently."

Summary additions (only when the gate is on AND a positive rate is set):

```
Internal cost   ≈ €2,160.00  (€1,890.00 – €3,510.00)
Total cost      ≈ €10,010.00 (€9,740.00 – €11,360.00)
                Total cost = €7,850.00 official fees + internal cost
                (24 expected RA h × €90/h) · band from the RA-hours range (21–39 h)
```

All UI strings in English.

## Calculation

Hours come from `raEffort()` → `{ expected, total: { min, max } }`.

- `rate` = parsed from the input (accept "," or "." decimal). Must be > 0.
- Internal cost: expected = `expected × rate`; band = `total.min × rate … total.max × rate`.
- Total cost: `grand (fees) + internal cost`.
  - expected = `grand + expected × rate`
  - band = `grand + total.min × rate … grand + total.max × rate`
  - Band width comes only from the hours; the fee total is a point value.

When the gate is off, or no positive rate is set, `internalCost()` returns null and
the summary shows only "Total fees", exactly as today.

## State & persistence

Add to the module `state`:
- `includeInternalCost: false` — the gate.
- `internalRate: ""` — the hourly rate as typed.

The rate is mirrored to `sessionStorage` (key `vclcalc_wf_internal_rate`) so it
survives a reload within the same browser session, wrapped in try/catch. Nothing
goes to `localStorage` or the server. The gate itself is not persisted (off by
default each fresh load). This keeps the feature out of TTDSG §25 consent scope:
the rate is a business figure (not personal data) held only for the session the
user explicitly initiated.

## Formatting

Use the existing `fmtEUR` for all three monetary figures (consistent with the
"Total fees" row). Round the internal/total expected and band values before
formatting. Hours in the footnote reuse `Math.round(ra.expected)` and the
ceil'd band (as the RA-workload row already shows).

## Files touched

- `assets/js/vcl-workflow.js` — state fields, a `loadInternalRate`/`saveInternalRate`
  pair, an `internalCost(ra)` helper, the Cost inputs block in `buildStationD`, and
  the two rows + footnote in `buildSummaryCard`.
- `assets/css/vcl-workflow-style.css` — styles for the Cost inputs card and the new
  summary rows/footnote.
- Version bump in `variation-fee-calculator.php`.

## Testing

Manual, in the live tool:
1. Gate off → Station E and summary unchanged from today.
2. Gate on, no rate → no internal/total rows (no fabricated number).
3. Gate on, rate 90 → Internal cost and Total cost appear with the correct band;
   Total cost = fees + internal expected.
4. `.docx` export includes the new rows.
5. Reload the page mid-session → rate is retained; open a new browser session →
   gate is off and rate is empty.
