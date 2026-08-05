# Budget Planning — submission-based redesign

**Status:** design approved (brainstorming, 2026-08-05). Supersedes the per-variation line model in
`2026-08-05-budget-planning-design.md` (that MVP shipped on branch `worktree-budget-planning`; this
redesign builds on it).

## 1. Problem & motivation

The Budget Planning MVP models each plan line as **one standalone variation** (one classification,
one procedure, RMS + CMS). Real RA annual planning is done in **submissions**, and a submission is
usually a *bundle*: grouped variations, a Worksharing across several procedures, a Super-Grouping of
Type-IA over several marketing authorisations, or an Annual Update. These bundling mechanisms change
exactly the two numbers the budget tool exists to produce:

- **Fees:** grouping caps and Worksharing/Super-Grouping lead pricing reduce the official fees
  substantially. Pricing five variations as five standalone filings overstates the budget.
- **RA hours → FTE:** WS/SG/AU carry their own workload factors (already in the additive engine). The
  headline FTE number is wrong without them.

**Concrete driver (the user's 2027 example):** Product X = Annual Update (bundled Type-IA) on one
MRP/DCP in Q2; Product Y = Worksharing + grouping of 10 mixed-type variations across 3 national + 2
MRP/DCP in Q1; a Super-Grouping of 5 Type-IA involving 3 CPs in Q4; a single national Type II in Q2.
Each of these is **one plan line = one submission**.

**Goal:** each budget plan line captures a full submission using the same queries as the Guided
Workflow's Stations A–C (Variations, Procedures + submission mode, RA tasks), priced and timed through
the *same* engine the Guided Workflow uses — so the two tools can never disagree about the same
submission.

## 2. The canonical `Submission` model (the shared source of truth)

A pure data structure describing one submission — today this data is scattered across the Guided
Workflow's DOM `state`:

```
Submission = {
  mode: null | 'worksharing' | 'superGrouping' | 'annualUpdate',   // the multi-authorisation STRATEGY; null = plain single-authorisation submission
  variations: [ { code, variantId, type } , … ],      // 1…n  (Station A)
  procedures: [ { kind:'national'|'mrpdcp'|'cp', nat?, rms?, cms?:[], ema? } , … ], // 1…n (Station B)
  lead: cc | null,                                     // WS/SG lead authority (RMS / EMA)
  raTasks: { cmc:bool, compilation:bool, pi:bool, piDocs:{smpc,leaflet,labelling,mockups}, activeSubstance:null|'chemical'|'biologic' }, // Station C
  // fee-detail fields — the Guided Workflow fills these (Stations D/E); the Budget tool leaves them
  // at defaults ("planning-grade" fees), see §7:
  strengths: { default: 1, overrides: {} },
  specials: {}                                         // per-line fee sub-category picks; {} = engine default
}
```

**Grouping is derived, not a mode.** "Grouping" (several variations bundled into one submission) is
orthogonal to the strategy and can co-exist with it — the driver's Product Y is *Worksharing **and**
grouped* (10 variations across 5 procedures). So grouping is **not** a `mode` value; it follows from
`variations.length > 1`. A derived `displayMode(sub)` gives the friendly label used in the table and
editor summary: the strategy (`worksharing`/`superGrouping`/`annualUpdate`) if set, else `grouping`
when `variations.length > 1`, else `single`. (The workload engine already treats the grouping factor
and the AU/SG factors as non-stacking — that logic moves verbatim into the shared module, §3.)

**Key property — superset contract.** The Guided Workflow populates the *whole* object (A–E). The
Budget editor populates A–C and leaves `strengths`/`specials` at defaults. Both call the same
functions; the only difference is completeness. This is what guarantees no drift.

A budget **plan line** wraps a Submission with budget-only fields:

```
PlanLine = { id, product, quarter, probability, submission: Submission }
```

## 3. Shared module: `assets/js/vcl-submission.js`

New pure, DOM-free, dual-export module (`window.VCL_SUBMISSION` + `module.exports`), mirroring the
split already used by `vcl-workload-hours.js` / `vcl-sg-logic.js`. Public API (all take a `Submission`
plus injected engines; never read `window`):

- `computeSubmissionFees(sub, engines) -> { total, byCountry:[{cc,total}] }` — the orchestration
  currently in `vcl-workflow.js` (`feeCounts` / `procPricedCountries` / `procFees` / `leadFees` /
  `grandTotalFees`), parameterised on `sub`.
- `computeSubmissionHours(sub, engines) -> { min, max, expected }` — the `raEffort` orchestration
  (`groupingBuckets` / `worksharingKinds` / `sgProcKinds` / `primaryType` → `computeAdditiveWorkload`
  → `composeSections` → `pertExpected`), parameterised on `sub`.
- Mode predicates as pure functions of `sub`: `leadPricingActive`, `multiProcedureMode`, `auActive`,
  `sgActive`, `allVariationsAreIA`, plus `allowedModes(sub)` and `computeAllowedProcedureKinds(...)`
  (the existing CP-exclusivity logic from `vcl-sg-logic.js` is reused, not reimplemented).
- Small helpers the two UIs share: `submissionCountries(sub)`, `feeCounts(sub)`, `groupingBuckets(sub)`,
  `primaryType(sub)`.

`engines = { computeFees, workload, workloadData }` — same dependency-injection pattern as
`vcl-budget-engine.js` today.

## 4. Architecture — two implementation phases

The work splits into two phases so the risky part (touching the large, reviewed Guided Workflow) is a
behaviour-preserving refactor with a safety net, done *before* any budget UI changes.

### Phase 1 — extract the shared module + refactor the Guided Workflow (no behaviour change)

- Create `vcl-submission.js` with the API in §3.
- Refactor `vcl-workflow.js` so its calc functions build a `Submission` from `state` and delegate to
  the shared module, instead of reading `state` directly. The Guided Workflow's stations, DOM, and
  behaviour are unchanged.
- **Safety net:** the existing workflow/engine tests must still pass, plus a numeric before/after
  equality harness — for a set of representative submissions (single, grouping, WS, SG, AU, CP cases),
  assert the fees and hours are identical before and after the refactor. No user-visible change ships
  in this phase.
- Enqueue `vcl-submission.js` ahead of `vcl-workflow` in `lookup.php`; add it to `build_zip.py`.

### Phase 2 — Budget line = Submission + compact A–C editor + table/rollup

- `vcl-budget-engine.js`'s `computeLineResult` delegates to `VCL_SUBMISSION` instead of its own
  simplified single-variation mapping.
- Replace the single-variation modal with the stations editor (§5).
- Update the table + rollup (§6).
- Migrate stored data v1 → v2 (§8).

## 5. Editor UX — GW-style stations, pop-up modal

The line editor is a **pop-up modal** over the budget table (same trigger as today's "New line /
Edit"). Inside, it uses the Guided Workflow's **station** metaphor for recognition, but is *not* a
sequential wizard — every station is reachable in any order and the Fee / RA-hours preview updates
live. Layout (approved mockup `budget-editor-mockup-stations.html`):

- **Header:** "Edit plan line — <product>" + close.
- **Meta row:** Product (text) · Quarter (select) · Probability (select).
- **Horizontal station stepper** directly under the meta row — the exact GW shape (30 px dots + label
  below, connecting line, `is-active` / `is-done` states) but in the Budget colour (`--budget`):
  **A Variations · B Procedures · C RA tasks**.
- **Body card** below the stepper (the GW `.vcl-wf-body` bordered card with title + subtitle) showing
  the active station's content:
  - **A Variations:** searchable variation rows (code + title + type badge, remove); "+ Add variation";
    ≥2 variations ⇒ grouped. Type badges bucket to `--ia/--ib/--ii` (reuse the `typeBucketClass`
    helper) so `IAIN` / `IB (unforeseen)` render correctly.
  - **B Procedures:** **strategy chips** for the opt-in multi-authorisation modes — Worksharing /
    Super-Grouping / Annual Update — greyed out when not applicable per the shared logic (WS disabled
    when all-IA; SG/AU only when all-IA). The `Single` / `Grouping` chips shown in the mockup are the
    **derived** state (from `displayMode`) when no strategy is selected, not independent choices.
    Procedure rows (kind select + country chips, RMS/CMS/lead marked); "+ Add procedure"; lead shown
    for WS/SG. CP-exclusivity enforced via the shared `computeAllowedProcedureKinds`.
  - **C RA tasks:** toggles — CMC dossier in RA (+ active substance), dossier compilation & CESP
    submission in RA, product information touched (+ which docs).
- **Bottom (below the body):** an emphasised **Fee / RA-hours preview strip** ("grouping cap & WS lead
  applied" note), then a de-emphasised one-line **summary** (mode · N variations · M procedures · lead
  · quarter), then the Cancel / Apply footer.

Focus-safety: reuse the targeted-update pattern already added for the search field (no full
`rerender()` on each keystroke).

## 6. Table & rollup

Columns change from per-variation to per-submission:

| Product | Mode | Variations | Procedures | Quarter | Fee | Hours (PERT) | actions |

- **Mode** — pill showing `displayMode(sub)` (WS/SG/AU if a strategy is set, else Grouping when >1
  variation, else Single).
- **Variations** — count + type mix (e.g. "10 · 4 IA·3 IB·3 II"); Single mode shows the code.
- **Procedures** — compact summary ("3 nat · 2 MRP/DCP", "1 MRP/DCP (5 CMS)", "3 CP"). The old
  per-country chip column is removed (details live in the editor).
- **Fee / Hours** — from `VCL_SUBMISSION`; grouping caps and WS/SG lead already applied.
- Actions (duplicate / edit / delete) and the footer totals row are unchanged.

Rollup tiles (Annual fees · Annual RA hours · FTE) and the by-market / by-product breakdowns are
unchanged in shape — they now aggregate over submissions. `computeSubmissionFees`'s `byCountry`
breakdown feeds by-market exactly as `feeByCountry` does today; `product` feeds by-product.

## 7. Scope — in / out

**In (Stations A–C):** variations list + types + grouping · procedures + exact countries + mode
(grouping / WS / SG / AU, incl. CP-exclusivity, grouping cap, WS/SG lead) · RA tasks · product /
quarter / probability.

**Out (deliberate):**
- **Station D** (exact submission/implementation dates, timeline, clock-stop, AU/SG date corridors) —
  the budget granularity is **Quarter** only.
- **Planning-grade fees:** strengths are fixed at 1 (no per-country strengths UI) and fee sub-category
  "special" picks use the engine default (no Station-E picks). Fees are budget-accurate (±), which is
  appropriate for an annual forecast, not a final fee calculation. (The Submission model still carries
  `strengths`/`specials` so the Guided Workflow — which does expose them — shares the same calc.)
- **Probability weighting:** probability is captured per line but the rollup shows **unweighted**
  totals. Risk-adjusted expected values are Phase-2+ (see §11).

## 8. Migration (localStorage `v1` → `v2`)

Bump the persisted payload version to 2. On load, `normalizeLine` (extended) converts an old
single-variation line into a Single-mode Submission:

- `variations = [{ code: old.variationCode, variantId: null, type: old.type }]` (or empty if none).
- `procedures = [ old.procedure ]`.
- `mode = null` (plain single-authorisation submission; `displayMode` renders it "Single"); `raTasks`
  = defaults; `strengths` = {default:1, overrides:{}}; `specials = {}`.
- `product` / `quarter` / `probability` carry over.

Unrecognised / malformed lines fall back to a safe empty Single submission (never throw), consistent
with the existing recovery behaviour. A `v2` payload loads unchanged.

## 9. Edge cases

- **Incomplete submission** (no variations, or a procedure with no country) — priced as €0 / 0 h,
  flagged "incomplete" in the table (as today), skipped in the rollup.
- **Mode-invalid combinations** (e.g. CP mixed with national in an SG) — prevented in the editor by
  the shared `computeAllowedProcedureKinds` / `allowedModes`; a mode that becomes invalid after an
  edit falls back to a valid one (the Guided Workflow's existing `rerender()` guard behaviour,
  now living in the shared logic).
- **Empty plan** — tiles/footer read €0 / 0 h without crashing (already handled).

## 10. Testing

- **Phase 1:** existing workflow + engine tests stay green; new `vcl-submission` unit tests
  (fees + hours + mode predicates for single / grouping / WS / SG / AU / CP fixtures); the
  before/after numeric-equality harness proving the GW refactor changed no numbers.
- **Phase 2:** `vcl-budget-engine` tests updated for the Submission-based `computeLineResult`;
  migration tests (v1 line → v2 Single submission; malformed → safe fallback); browser acceptance in
  the dev harness for the stations editor, the mode chips, the table/rollup, and an Excel export of a
  multi-mode plan.

Tests live at the repo root (`test/`), framework-less, per the project convention; `vcl-submission.js`
and any new asset go into `build_zip.py`'s FILES allowlist.

## 11. Deferred (Phase-2+, explicitly not now)

Probability-weighted rollup (expected fee/hours), grouping/WS-savings visibility ("you save €X vs.
filing separately"), per-country strengths / fee-category picks at budget stage, annual maintenance
fees as standing budget items, `.docx` management summary. None of these have a task in this design.
