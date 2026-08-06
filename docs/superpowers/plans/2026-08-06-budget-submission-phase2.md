# Budget Submission Model — Phase 2 Implementation Plan (Budget line = Submission + stations editor + table/rollup)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Budget Planning plan line a full **Submission** (variations + procedures + mode + RA tasks), priced and timed through the shared `vcl-submission.js` engine that Phase 1 extracted — so the Budget tool and the Guided Workflow can never disagree — with a compact GW-style A–C stations editor, an updated per-submission table/rollup, and a v1→v2 data migration.

**Architecture:** Phase 1 already shipped the pure shared module `vcl-submission.js` (fees/hours/mode predicates for a `Submission`) and merged to `main`. Phase 2 makes the Budget tool a **consumer** of that module: the Budget engine (`vcl-budget-engine.js`) delegates `computeLineResult` to `VCL_SUBMISSION.computeSubmissionFees`/`computeSubmissionHours`, the plan line becomes `{id, product, quarter, probability, submission}`, and the UI (`vcl-budget.js`) grows a stations editor + per-submission table. **`vcl-submission.js` itself is NOT modified in Phase 2** — it is complete; Phase 2 only calls its public API (plus `VCL_SG_LOGIC.computeAllowedProcedureKinds` for CP-exclusivity).

**Tech Stack:** Vanilla JS (no framework, no build step). Node `require()` for tests (framework-less, matching `test/test-budget-engine.js` / `test/test-submission.js`). Reuses `window.VCL_SUBMISSION`, `VCLCALC.computeFees`, `VCLCALC.countries()`, `VCLCALC_DATA.FEE_ROWS`, `VCL_WORKLOAD_HOURS`, `VCL_WORKLOAD_HD`, `VCL_SG_LOGIC` through their existing public APIs. Excel export via the already-loaded `XLSX` global.

## Context — current state (read before starting)

- Branch/topology: Phase 1 is merged to `main` @ `028253a` (not pushed). Start Phase 2 in an isolated worktree via **superpowers:using-git-worktrees** off `main`.
- The shared engine and its exact API live in `variation-fee-calculator/assets/js/vcl-submission.js`. Its `api` object exports (verify by reading it): `computeSubmissionFees(sub, engines) -> {total, byCountry:[{cc,total}]}`, `computeSubmissionHours(sub, engines) -> {parts, items, sections, total, min, max, expected}`, `displayMode(sub)`, `feeCounts(sub)`, `groupingBuckets(sub)`, `primaryType(sub)`, `highestType(sub)`, `allVariationsAreIA(sub, engines)`, `wsActive/auActive/sgActive/leadPricingActive/multiProcedureMode/annualUpdateActive(sub)`, `procCountries(sub,p,engines)`, `emaCc(engines)`, and the fee-special helpers.
- The Budget MVP being modified: `variation-fee-calculator/assets/js/vcl-budget-engine.js` (pure engine + persistence, 215 lines) and `variation-fee-calculator/assets/js/vcl-budget.js` (the UI, ~561 lines). Read both fully before Task 1.
- The Guided Workflow (`vcl-workflow.js`) is the reference implementation for every station's UX and for how the same engine is called (`submissionFromState()` at ~line 147, `subEngines()` at ~line 159, the station rendering, the strategy chips at ~line 828, CP-exclusivity at ~line 781/998). Mirror its patterns; do NOT change it.
- No live WordPress server in this environment. Browser acceptance uses a dev harness served over HTTP (see Task 6), driven with text-based tools (read_page/get_page_text/javascript), NOT screenshots (the in-app browser pane renders fine but its screenshot tool is unreliable here).

## Global Constraints

- **Single source of truth:** the Budget engine MUST compute fees/hours ONLY by delegating to `VCL_SUBMISSION` — no reimplemented pricing/hours/mode logic in `vcl-budget-engine.js` or `vcl-budget.js`. Deleting the MVP's `lineCountries`/`lineHoursSel` single-variation mappers is expected.
- **Planning-grade fees:** the Budget tool fixes `strengths` at `{default:1, overrides:{}}` and leaves fee sub-category picks empty. The exact `specials` shape the engine reads is **`{ line:{}, ws:{}, lead:null }`** (NOT the spec's shorthand `{}`) — `computeSubmissionFees` dereferences `sub.specials.line` / `.ws` / `.lead`. Use the real shape.
- **`Submission` shape (must match what `vcl-submission.js` actually reads):**
  ```
  submission = {
    mode: null | 'worksharing' | 'superGrouping' | 'annualUpdate',
    variations: [ { code, variantId, type }, … ],
    procedures: [ { kind:'national'|'mrpdcp'|'cp', nat, rms, cms:[], ema }, … ],
    lead: cc | null,
    raTasks: { cmc:false, compilation:false, pi:false, piDocs:{}, activeSubstance:null },
    strengths: { default: 1, overrides: {} },
    specials: { line: {}, ws: {}, lead: null }
  }
  ```
  `procedures[0]` is the primary/base procedure; `procedures[1..]` are additional (WS/SG). `variations[0]` is the base; `variations[1..]` the grouped extras. Grouping is derived (`variations.length > 1`), never a `mode`.
- **`engines` object** injected into every engine call (identical to the GW's `subEngines()` plus a `SUB` handle so the pure engine never reads `window`):
  ```
  engines = {
    SUB: window.VCL_SUBMISSION,
    computeFees: window.VCLCALC.computeFees,
    countries: window.VCLCALC.countries(),        // [{cc,name,roles[]}]
    feeRows: window.VCLCALC_DATA.FEE_ROWS,
    workload: window.VCL_WORKLOAD_HOURS,
    workloadData: window.VCL_WORKLOAD_HD,
    sgLogic: window.VCL_SG_LOGIC,
  }
  ```
- **Incomplete submission** (no priceable variation/country) → `computeSubmissionFees(...).total === null`; the line reads €0 / 0 h, is flagged "incomplete" in the table, and is skipped in the rollup. Never throw.
- **Migration never throws:** a malformed persisted line falls back to a safe empty Single submission, consistent with the MVP's existing recovery behaviour.
- **Tests at repo root** `test/`, framework-less (`node test/<file>.js`). No new JS asset is introduced (vcl-submission.js is already registered/enqueued/in the allowlist from Phase 1), so `lookup.php` and `build_zip.py` need NO changes unless a new CSS file is added (Task 4 adds budget station styles into the existing `vcl-budget-style.css`, so still no allowlist change).
- **Commits:** per-task commits on the Phase-2 worktree branch; no push, no merge. Trailer `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. English code comments.
- **Focus-safety:** reuse the MVP's targeted-update pattern (`populateSearchResults`, vcl-budget.js:261) for any text input inside the modal — never a full `rerender()` on every keystroke.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `variation-fee-calculator/assets/js/vcl-budget-engine.js` | modify | `newLine` → PlanLine w/ Submission; `computeLineResult` delegates to `VCL_SUBMISSION`; `normalizeLine`/`loadPlan`/`defaultPlan`/`STORAGE_KEY` v1→v2 migration. Delete `lineCountries`/`lineHoursSel`. `computeRollup`/`computeFte`/`searchEntries`/`savePlan` unchanged. |
| `test/test-budget-engine.js` | modify | Update for Submission-based `computeLineResult` (stub `computeSubmissionFees`/`Hours` or use the real module); add v1→v2 migration + malformed-fallback tests. |
| `variation-fee-calculator/assets/js/vcl-budget.js` | modify | `engines()` expanded; per-submission `renderTable`; stations editor modal (A/B/C) replacing `renderModal`; `exportExcel` per-submission; live preview via `computeLineResult`. |
| `variation-fee-calculator/assets/css/vcl-budget-style.css` | modify | Budget-coloured station stepper + body-card classes (mirror the GW `.vcl-wf-station*` shapes in `--budget`); strategy-chip / procedure-row styles. |
| `test/manual/budget-harness.html` | modify | Already loads the budget stack; confirm `vcl-submission.js` + `vcl-sg-logic.js` are among the loaded scripts (add if missing) so the editor + engine run in the harness. |

Task order builds the non-UI foundation first (engine + migration, fully Node-tested), then the table (visible read-only surface), then the editor stations (the largest UI piece), then export + acceptance.

---

### Task 1: Submission-based engine — `newLine` + `computeLineResult` delegation

Make a plan line carry a `Submission` and price/time it through the shared module. Pure, Node-tested.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget-engine.js`
- Modify: `test/test-budget-engine.js`

**Interfaces — Produces:**
- `emptySubmission() -> Submission` — a default submission per the Global-Constraints shape: `mode:null`, `variations:[]`, `procedures:[{kind:'national', nat:null, rms:null, cms:[], ema:undefined}]`, `lead:null`, `raTasks:{cmc:false,compilation:false,pi:false,piDocs:{},activeSubstance:null}`, `strengths:{default:1,overrides:{}}`, `specials:{line:{},ws:{},lead:null}`.
- `newLine(id) -> PlanLine` — `{ id, product:"", quarter:null, probability:100, submission: emptySubmission() }`.
- `computeLineResult(line, engines) -> { fee:number, feeByCountry:[{cc,total}], hours:{min,max,expected}, complete:bool }` — delegates:
  ```js
  function computeLineResult(line, engines) {
    engines = engines || {};
    var sub = (line && line.submission) || {};
    var out = { fee: 0, feeByCountry: [], hours: { min: 0, max: 0, expected: 0 }, complete: false };
    if (!engines.SUB || !engines.computeFees) return out;
    var feeRes = engines.SUB.computeSubmissionFees(sub, engines); // {total, byCountry}
    out.complete = feeRes.total !== null;
    if (!out.complete) return out;
    out.fee = feeRes.total || 0;
    out.feeByCountry = feeRes.byCountry || [];
    var h = engines.SUB.computeSubmissionHours(sub, engines);
    if (h) out.hours = { min: h.min, max: h.max, expected: h.expected };
    return out;
  }
  ```
  (`complete` is driven by the engine's own null-when-nothing-priceable signal, so the Budget tool never re-derives "completeness". `computeRollup` — unchanged — already skips lines it can't price because it reads `r.feeByCountry`/`r.fee` and an incomplete line contributes `fee:0`, `feeByCountry:[]`; but to keep the rollup's "N plan lines" and by-product honest, incomplete lines still appear with 0 — matches the MVP.)

- [ ] **Step 1: Delete the MVP single-variation mappers**

In `vcl-budget-engine.js`, delete `lineCountries` (lines ~30-41) and `lineHoursSel` (lines ~46-57) and their entries in the `api` object. (They are replaced by the shared engine's own `procCountries`/hours assembly.)

- [ ] **Step 2: Add `emptySubmission()` and rewrite `newLine()`**

```js
function emptySubmission() {
  return {
    mode: null,
    variations: [],
    procedures: [{ kind: "national", nat: null, rms: null, cms: [] }],
    lead: null,
    raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
    strengths: { default: 1, overrides: {} },
    specials: { line: {}, ws: {}, lead: null },
  };
}
function newLine(id) {
  return { id: id, product: "", quarter: null, probability: 100, submission: emptySubmission() };
}
```
Add `emptySubmission` to `api`.

- [ ] **Step 3: Replace `computeLineResult` with the delegation above.** Keep it in `api`.

- [ ] **Step 4: Write the failing test**

In `test/test-budget-engine.js`, load the REAL submission module + a deterministic stub `computeFees` (mirror `test-submission.js`'s stub). Assert a single-national Type II submission prices via delegation, and an incomplete submission (no country) returns `complete:false`, `fee:0`:
```js
var SUB = require("../variation-fee-calculator/assets/js/vcl-submission.js");
function stubFees(input){ var per=input.countries.map(function(c){return {cc:c.cc,role:c.role,total:100};}); return {countries:per, grandTotal:per.reduce(function(s,c){return s+c.total;},0)}; }
var eng = { SUB: SUB, computeFees: stubFees, countries:[{cc:"EU",roles:["EMA"]}], feeRows:[], workload: WLH, workloadData: HD, sgLogic: SG };
var line = BUD.newLine("l1");
line.submission.variations = [{ type: "II" }];
line.submission.procedures = [{ kind: "national", nat: "FR", cms: [] }];
var r = BUD.computeLineResult(line, eng);
eq(r.complete, true, "computeLineResult: complete single national");
eq(r.fee, 100, "computeLineResult: fee delegated to computeSubmissionFees");
eq(BUD.computeLineResult(BUD.newLine("l2"), eng).complete, false, "computeLineResult: empty submission is incomplete");
```
(`WLH`/`HD`/`SG` are the real workload + sg-logic engines already required at the top of `test-budget-engine.js` for Phase 1 — reuse them; add the requires if absent.)

- [ ] **Step 5: Run `node test/test-budget-engine.js`** → all pass (fix the pre-existing MVP tests that referenced `lineCountries`/`lineHoursSel` / the old `newLine` shape — update them to the Submission shape or delete the ones that only covered the deleted mappers).

- [ ] **Step 6: Commit**
```bash
git add variation-fee-calculator/assets/js/vcl-budget-engine.js test/test-budget-engine.js
git commit -m "feat(budget): plan line = Submission; computeLineResult delegates to vcl-submission"
```

---

### Task 2: Migration v1 → v2

Old persisted lines are single-variation (`{variationCode, type, procedure, modules, piDocs, activeSubstance, …}`). Convert them to v2 PlanLines with a Single-mode Submission; malformed → safe empty Single; a v2 payload loads unchanged.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget-engine.js`
- Modify: `test/test-budget-engine.js`

**Interfaces — Produces:**
- `STORAGE_KEY = "vcl_budget_plan_v2"` (was `_v1`).
- `defaultPlan() -> { version: 2, hoursPerHead: 1500, lines: [] }`.
- `normalizeLine(raw, fallbackId) -> PlanLine` — accepts BOTH an already-v2 line (has `submission`) and a legacy v1 line (has `variationCode`/`type`/`procedure` at top level), always returns a valid v2 PlanLine.
- `loadPlan(storage)` — reads `_v2`; if the parsed payload is `version === 1`, migrates each line via `normalizeLine` and returns `version:2`; if it can't read/parse, returns `defaultPlan()`.

- [ ] **Step 1: Bump `STORAGE_KEY` + `defaultPlan` to v2.**

- [ ] **Step 2: Rewrite `normalizeLine`** to produce the v2 shape, handling both inputs:
```js
function migrateRaTasks(raw) {
  var m = (raw && raw.modules) || {};
  return {
    cmc: !!m.cmc, compilation: !!m.compilation, pi: !!m.pi,
    piDocs: (raw && raw.piDocs && typeof raw.piDocs === "object") ? raw.piDocs : {},
    activeSubstance: (raw && raw.activeSubstance) || null,
  };
}
function normalizeProcedure(p) {
  p = (p && typeof p === "object") ? p : {};
  var out = { kind: typeof p.kind === "string" ? p.kind : "national",
    nat: p.nat !== undefined ? p.nat : null, rms: p.rms !== undefined ? p.rms : null,
    cms: Array.isArray(p.cms) ? p.cms : [] };
  if (p.ema !== undefined) out.ema = p.ema;
  return out;
}
function normalizeSubmission(raw) {
  raw = (raw && typeof raw === "object") ? raw : {};
  var variations = Array.isArray(raw.variations)
    ? raw.variations.filter(function (v) { return v && typeof v === "object"; })
        .map(function (v) { return { code: v.code || null, variantId: v.variantId != null ? v.variantId : null, type: (typeof v.type === "string") ? v.type : null }; })
    : [];
  var procedures = Array.isArray(raw.procedures) && raw.procedures.length
    ? raw.procedures.map(normalizeProcedure)
    : [normalizeProcedure(null)];
  return {
    mode: (raw.mode === "worksharing" || raw.mode === "superGrouping" || raw.mode === "annualUpdate") ? raw.mode : null,
    variations: variations, procedures: procedures,
    lead: (typeof raw.lead === "string") ? raw.lead : null,
    raTasks: (raw.raTasks && typeof raw.raTasks === "object")
      ? { cmc: !!raw.raTasks.cmc, compilation: !!raw.raTasks.compilation, pi: !!raw.raTasks.pi,
          piDocs: (raw.raTasks.piDocs && typeof raw.raTasks.piDocs === "object") ? raw.raTasks.piDocs : {},
          activeSubstance: raw.raTasks.activeSubstance || null }
      : { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
    strengths: { default: 1, overrides: {} },
    specials: { line: {}, ws: {}, lead: null },
  };
}
function normalizeLine(raw, fallbackId) {
  raw = (raw && typeof raw === "object") ? raw : {};
  var id = (typeof raw.id === "string" && raw.id) || fallbackId ||
    ("line-recovered-" + Date.now() + "-" + Math.floor(Math.random() * 100000));
  var submission;
  if (raw.submission && typeof raw.submission === "object") {
    submission = normalizeSubmission(raw.submission);              // already-v2 line
  } else {
    // legacy v1 line: one variation + one procedure
    submission = normalizeSubmission({
      mode: null,
      variations: raw.variationCode || raw.type ? [{ code: raw.variationCode || null, variantId: null, type: (typeof raw.type === "string") ? raw.type : null }] : [],
      procedures: raw.procedure ? [raw.procedure] : null,
      raTasks: migrateRaTasks(raw),
    });
  }
  return {
    id: id,
    product: typeof raw.product === "string" ? raw.product : "",
    quarter: (typeof raw.quarter === "string" || raw.quarter === null) ? raw.quarter : null,
    probability: typeof raw.probability === "number" ? raw.probability : 100,
    submission: submission,
  };
}
```
Add `emptySubmission`/`normalizeSubmission`/`normalizeProcedure` to `api` only if a test or the UI needs them (the UI will want `emptySubmission`; keep `normalizeSubmission` internal unless a test asserts it directly).

- [ ] **Step 3: Update `loadPlan`** to accept v2 and migrate v1:
```js
function loadPlan(storage) {
  try {
    var raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) {
      // one-time migration: read the old v1 key if present
      var oldRaw = storage && storage.getItem("vcl_budget_plan_v1");
      if (!oldRaw) return defaultPlan();
      var oldParsed = JSON.parse(oldRaw);
      if (!oldParsed || !Array.isArray(oldParsed.lines)) return defaultPlan();
      return { version: 2, hoursPerHead: oldParsed.hoursPerHead || 1500,
        lines: oldParsed.lines.map(function (l, i) { return normalizeLine(l, "line-migrated-" + i); }) };
    }
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.lines)) return defaultPlan();
    parsed.version = 2;
    parsed.lines = parsed.lines.map(function (l, i) { return normalizeLine(l, "line-recovered-" + i); });
    return parsed;
  } catch (e) { return defaultPlan(); }
}
```

- [ ] **Step 4: Write the failing tests** (append to `test/test-budget-engine.js`):
```js
// v1 single-variation line migrates to a Single-mode Submission
var v1line = { id:"a", product:"X", type:"IB", variationCode:"C.I.2", procedure:{kind:"mrpdcp",rms:"DE - BfArM",cms:["FR"]}, modules:{cmc:true}, quarter:"Q2", probability:75 };
var m = BUD.normalizeLine(v1line, "fb");
eq(m.submission.variations, [{code:"C.I.2",variantId:null,type:"IB"}], "migrate: variation carried");
eq(m.submission.procedures[0].kind, "mrpdcp", "migrate: procedure carried");
eq(m.submission.mode, null, "migrate: single mode");
eq(m.submission.raTasks.cmc, true, "migrate: modules.cmc -> raTasks.cmc");
eq(m.product === "X" && m.quarter === "Q2" && m.probability === 75, true, "migrate: budget fields carried");
// malformed line -> safe empty Single, never throws
var bad = BUD.normalizeLine({ id:"b", procedure: 42, submission: "nope" }, "fb2");
eq(bad.submission.variations.length === 0 && bad.submission.procedures.length === 1, true, "migrate: malformed -> safe empty Single");
// v2 line passes through
var v2line = { id:"c", product:"Y", quarter:"Q1", probability:100, submission:{ mode:"worksharing", variations:[{type:"II"}], procedures:[{kind:"national",nat:"FR",cms:[]}], lead:"FR", raTasks:{}, strengths:{}, specials:{} } };
eq(BUD.normalizeLine(v2line,"fb3").submission.mode, "worksharing", "v2: mode preserved");
```

- [ ] **Step 5: Run `node test/test-budget-engine.js`** → all pass.

- [ ] **Step 6: Commit**
```bash
git add variation-fee-calculator/assets/js/vcl-budget-engine.js test/test-budget-engine.js
git commit -m "feat(budget): migrate persisted plan v1 (single variation) -> v2 (submission)"
```

---

### Task 3: Table + rollup columns (per-submission)

Rewrite the plan-lines table from per-variation columns to per-submission columns. The rollup ENGINE is unchanged (it already sums `resultsById`); only the table render and small summary helpers change.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css` (add `.vcl-bud-mode-pill` + `.vcl-bud-proc-summary` styles)

**Interfaces — Consumes:** `VCL_SUBMISSION.displayMode(sub)`, `.feeCounts(sub)`, `state.resultsById`.

- [ ] **Step 1: Expand `engines()`** in `vcl-budget.js` to the full Global-Constraints shape (add `SUB`, `countries`, `feeRows`, `sgLogic`). This one change makes `computeLineResult`, the table, and the editor all price correctly.

- [ ] **Step 2: Add per-submission summary helpers** (top of `vcl-budget.js`, pure):
```js
var SUB = window.VCL_SUBMISSION;
function variationsSummary(sub) {
  var n = sub.variations.length;
  if (n === 0) return "—";
  if (n === 1) return escapeHtml(sub.variations[0].code || sub.variations[0].type || "1 variation");
  var c = SUB.feeCounts(sub); // {IA,IB,II}
  var mix = ["IA","IB","II"].filter(function(k){return c[k]>0;}).map(function(k){return c[k]+" "+k;}).join("·");
  return n + " · " + mix;
}
function proceduresSummary(sub) {
  var nat=0,mrp=0,cp=0,cms=0;
  sub.procedures.forEach(function(p){ if(p.kind==="national")nat++; else if(p.kind==="mrpdcp"){mrp++;cms+=(p.cms||[]).length;} else if(p.kind==="cp")cp++; });
  var bits=[]; if(nat)bits.push(nat+" nat"); if(mrp)bits.push(mrp+" MRP/DCP"+(cms?" ("+cms+" CMS)":"")); if(cp)bits.push(cp+" CP");
  return bits.join(" · ") || "—";
}
var MODE_LABEL = { worksharing:"Worksharing", superGrouping:"Super-Grouping", annualUpdate:"Annual Update", grouping:"Grouping", single:"Single" };
```

- [ ] **Step 3: Rewrite `renderTable`** — new columns `Product | Mode | Variations | Procedures | Quarter | Fee | Hours (PERT) | actions`. Mode cell: `<span class="vcl-bud-mode-pill vcl-bud-mode-pill--<displayMode>">MODE_LABEL[displayMode(sub)]</span>`. Variations cell: `variationsSummary(line.submission)`. Procedures cell: `proceduresSummary(line.submission)`. Fee/Hours cells + the incomplete flag + `<tfoot>` totals row stay exactly as the MVP builds them (reuse the existing `r.complete` branch and `rollup.totals` footer). Remove the old `Variation`/`Type`/`Countries` columns and the `ccChips`/`typeBadge`/`procLabel` locals. Keep the row-actions buttons + `data-line-id` unchanged.

- [ ] **Step 4: Add pill/summary CSS** to `vcl-budget-style.css` (small): a `.vcl-bud-mode-pill` (rounded, `--budget-tint` bg, `--budget` text) with per-mode accent, and `.vcl-bud-proc-summary { font: ... mono }`.

- [ ] **Step 5: Browser smoke** (harness, Task 6 setup): seed 2–3 lines via the editor OR by injecting `state.lines`; confirm the table renders the new columns, the mode pill shows `Single`/`Grouping`/`Worksharing`, and the footer + rollup tiles still total correctly. No console errors.

- [ ] **Step 6: Commit**
```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): per-submission table columns (mode pill, variations/procedures summary)"
```

---

### Task 4: Stations editor — shell + Station A (Variations)

Replace the single-variation modal with a GW-style stations editor. This task builds the modal shell (header, meta row, horizontal station stepper A·B·C, body card, live preview strip, Cancel/Apply) and the **Station A** content; Stations B and C come in Task 5.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css`

**Interfaces:**
- Consumes: `modalState = { editingId, draft, station:'A', query, searchResults }` (add `station`, default `'A'`). `draft` is a PlanLine (from `openModalFor`). Editor mutates `draft.submission.*`.
- Produces (used by Task 5): `stationBody(host)` dispatches on `modalState.station`; `renderStationA(card)`; live-preview updater `renderPreviewStrip(host)` calling `BUD.computeLineResult(modalState.draft, engines())`.

- [ ] **Step 1: Add budget station CSS** — mirror the GW station shapes (`vcl-workflow-style.css:36-102`: `.vcl-wf-stations`, `.vcl-wf-station`, `.vcl-wf-station__dot`, `.is-active`, `.is-done`, `.vcl-wf-station__label`, `.vcl-wf-body`, `.vcl-wf-body__title/__sub`) as `.vcl-bud-stations` / `.vcl-bud-station*` / `.vcl-bud-body*` using `var(--budget)` where the GW uses `var(--workflow)`. Copy the geometry (30 px dots, connecting line, active/done states) verbatim, swapping only the colour token and class prefix.

- [ ] **Step 2: Rewrite `openModalFor`** to seed `station:'A'` and use `BUD.newLine` (already returns the Submission shape). Keep the deep-clone of an existing line.

- [ ] **Step 3: Rewrite `renderModal`** — header ("Edit/New plan line — <product>" + close), meta row (Product text input + Quarter select + Probability select — move these three out of the old body into the meta row; keep their existing change handlers writing `d.product`/`d.quarter`/`d.probability`), then the **station stepper** (three `.vcl-bud-station` buttons A/B/C; clicking sets `modalState.station` and re-renders the body only via `stationBody`), then the **body card** (`stationBody(card)`), then `renderPreviewStrip(strip)`, then the de-emphasised one-line summary (`displayMode · N variations · M procedures · lead · quarter`), then Cancel/Apply footer (unchanged handlers). Set `is-done` on a station chip when its data is non-empty (A: `variations.length>0`; B: a procedure has a country; C: any raTask on) and `is-active` on the current station.

- [ ] **Step 4: Implement `stationBody(card)` + `renderStationA(card)`** — Station A: the variation search field (reuse the MVP's `varInput` + `populateSearchResults` targeted-update pattern, but pushing onto `d.submission.variations` instead of setting a single `variationCode`), an "+ Add variation" button, and a list of variation rows (code/label + a type-badge picker using `typeBucketClass`, + a remove ✕). ≥2 variations ⇒ the summary/table show "Grouping". Picking a search result appends `{code, variantId:null, type: typesForEntry(entry)[0]}`; the type badges let the user change a row's `type`. Keep `typesForEntry`/`typeBucketClass` from the MVP.

- [ ] **Step 5: Implement `renderPreviewStrip(host)`** — emphasised Fee / RA-hours from `BUD.computeLineResult(modalState.draft, engines())`, with the note "grouping cap & WS lead applied". Reuse the MVP's `.vcl-bud-live-result` markup/style (vcl-budget.js:442-451) but as its own strip below the body card.

- [ ] **Step 6: Browser acceptance (harness)** — open the editor, Station A: search + add two variations (II, IB), change a type, remove one; confirm the preview strip fee/hours update live and the summary shows the grouping state. No console errors, no focus loss while typing in the search field.

- [ ] **Step 7: Commit**
```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): stations editor shell + Station A (variations, grouping)"
```

---

### Task 5: Editor Stations B (Procedures + strategy) & C (RA tasks)

Fill in the two remaining stations. Station B carries the multi-authorisation strategy (WS/SG/AU), procedure rows with exact countries, the lead, and CP-exclusivity — all via the shared logic. Station C carries the RA-task toggles.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css`

**Interfaces — Consumes:** `SUB.allVariationsAreIA(sub, engines)`, `SUB.wsActive/sgActive/auActive/leadPricingActive(sub)`, `VCL_SG_LOGIC.computeAllowedProcedureKinds(procedures, currentProcedure)`, `SUB.emaCc(engines)`, `countriesByRole`/`findEmaCc` (from the MVP).

- [ ] **Step 1: `renderStationB(card)` — strategy chips.** Three opt-in chips (Worksharing / Super-Grouping / Annual Update) that set `d.submission.mode` (toggle to `null` when re-clicked). Enablement mirrors the GW (`vcl-workflow.js:828`): compute `allIA = SUB.allVariationsAreIA(d.submission, engines())`; **WS** is disabled when `allIA` is true, **SG** and **AU** are disabled when `allIA` is false. A disabled chip is greyed (`.is-disabled`, `pointer-events:none`). When no strategy is set, show the DERIVED state as a non-interactive label from `SUB.displayMode(d.submission)` (`Single` / `Grouping`) — these are NOT chips (spec §5). When switching mode makes it invalid, clear it (re-run the enablement check on every render; if `d.submission.mode` is set but now disabled, set it to `null`).

- [ ] **Step 2: `renderStationB` — procedure rows.** Render `d.submission.procedures` as rows: a kind `<select>` (National / MRP/DCP / CP), then the country control for that kind (National → country select writing `p.nat`; MRP/DCP → RMS select writing `p.rms` + CMS checkboxes writing `p.cms`, excluding the RMS; CP → set `p.ema = SUB.emaCc(engines())` and show "CP · EMA"). Reuse the MVP's `countriesByRole`/procedure-select/CMS-checkbox code (vcl-budget.js:336-408), adapted to operate on `p = d.submission.procedures[i]` instead of the single `d.procedure`. "+ Add procedure" pushes a new `{kind:'national',nat:null,rms:null,cms:[]}`; a per-row remove (only for `procedures[1..]`, never the base `procedures[0]`). Additional procedures are only shown/added when `SUB.multiProcedureMode(d.submission)` (WS or SG); in single/grouping/AU there is exactly one procedure (the base).

- [ ] **Step 3: `renderStationB` — CP-exclusivity + lead.** For each procedure's kind select, disable the kinds NOT in `VCL_SG_LOGIC.computeAllowedProcedureKinds(d.submission.procedures, p)` when `SUB.sgActive(d.submission)` (matching `vcl-workflow.js:781/998`). When `SUB.leadPricingActive(d.submission)` (WS or SG), show a **lead** select (RMS-role countries + EMA) writing `d.submission.lead`.

- [ ] **Step 4: `renderStationC(card)` — RA tasks.** Toggles writing `d.submission.raTasks`: CMC dossier in RA (+ active-substance select `chemical`/`biologic` → `raTasks.activeSubstance`), dossier compilation & CESP submission in RA (`raTasks.compilation`), product information touched (`raTasks.pi`) + which docs (`raTasks.piDocs` checkboxes: smpc/leaflet/labelling/mockups). Mirror the GW's Station-C toggles; keep the exact `piDocs` keys the workload engine reads.

- [ ] **Step 5: Wire `stationBody` to dispatch** to `renderStationA`/`renderStationB`/`renderStationC` on `modalState.station`. Every mutation re-renders the body + preview strip (targeted, not the whole page) — except the variation search input, which uses the targeted `populateSearchResults` path.

- [ ] **Step 6: Browser acceptance (harness)** — reproduce a Worksharing submission end-to-end (mixed types, 2 procedures + lead) and a Super-Grouping (3× IA, CP-only, verify national/MRP-DCP kinds are disabled once a CP is added); confirm the preview fee/hours match what the SAME submission shows in the Guided Workflow (cross-check one WS + one SG case). No console errors.

- [ ] **Step 7: Commit**
```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): stations editor B (procedures/strategy/CP-exclusivity/lead) + C (RA tasks)"
```

---

### Task 6: Excel export (per-submission) + housekeeping + acceptance

Update the Excel export to the submission shape and finish the dev-harness acceptance.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `test/manual/budget-harness.html`

- [ ] **Step 1: Confirm the harness loads the full stack.** `test/manual/budget-harness.html` must load, in order: `vcl-data`, `vcl-calc-data`, `vcl-calc-app`, `vcl-workload-data`, `vcl-workload-hours-data`, `vcl-workload-hours`, `vcl-sg-logic`, `vcl-submission`, `vcl-budget-engine`, `vcl-budget` (+ the budget CSS). Add any missing `<script>` (esp. `vcl-sg-logic.js` + `vcl-submission.js`).

- [ ] **Step 2: Rewrite `exportExcel`'s "Plan lines" sheet** to per-submission columns: `Product | Mode | Variations | Procedures | Quarter | Probability | Fee (EUR) | Hours (min) | Hours (max) | Hours (expected)`, using `SUB.displayMode`, `variationsSummary`, `proceduresSummary`, and `state.resultsById`. Incomplete lines export `Fee=0`/`Hours=0` with `Mode` still shown (keep the MVP's behaviour; the blank fee already signals incompleteness). The "Rollup" sheet is unchanged.

- [ ] **Step 3: Full browser acceptance** in the harness (localhost over HTTP): build the spec's driver plan (§1) — an Annual Update (4× IA on one MRP/DCP), a Worksharing+grouping (mixed types across national + MRP/DCP with a lead), a Super-Grouping (Type-IA over CPs), and a single national Type II — across products/quarters. Confirm: table mode pills + summaries correct; rollup tiles/FTE + by-market/by-product correct; the Excel export's two sheets match the on-screen numbers (monkeypatch `XLSX.writeFile` to capture the workbook without downloading, then `XLSX.utils.sheet_to_json`). Record the numbers. No console errors.

- [ ] **Step 4: Migration acceptance** — seed an OLD `vcl_budget_plan_v1` payload in `localStorage` (a couple of single-variation lines), reload the harness, confirm they appear as Single-mode submissions with the same product/quarter/fee, and that a fresh `vcl_budget_plan_v2` key is written.

- [ ] **Step 5: Commit**
```bash
git add variation-fee-calculator/assets/js/vcl-budget.js test/manual/budget-harness.html
git commit -m "feat(budget): per-submission Excel export; harness loads submission stack"
```

---

## Self-Review Notes

- **Spec coverage:** §2 Submission/PlanLine → Task 1 (`emptySubmission`/`newLine`) + the shape in Global Constraints; §4 Phase 2 (`computeLineResult` delegates, modal→stations, table/rollup, migration) → Tasks 1/4/5, 3, 2; §5 editor stations A–C + strategy chips + CP-exclusivity + lead + focus-safety → Tasks 4/5; §6 table columns + mode pill + summaries + unchanged rollup/tiles → Task 3; §8 migration v1→v2 → Task 2; §9 edge cases (incomplete → €0/skip via `total===null`; mode-invalid fallback; empty plan) → Tasks 1/5/3; §10 tests → Tasks 1/2 (Node) + 4/5/6 (browser acceptance).
- **Out of scope (spec §7/§11):** Station D (dates/timeline — Quarter only), per-country strengths / Station-E fee picks (planning-grade, `strengths=1`/`specials` empty), probability-weighted rollup (probability captured, rollup unweighted). No task implements these.
- **No `vcl-submission.js` change:** Phase 2 only consumes its API + `VCL_SG_LOGIC.computeAllowedProcedureKinds`; the module and `lookup.php`/`build_zip.py` are untouched (no new asset).
- **Type consistency:** `engines` shape (incl. `SUB`), the `Submission`/`PlanLine` shapes, and the `computeLineResult` return (`{fee, feeByCountry, hours:{min,max,expected}, complete}`) are identical across Tasks 1–6. `computeRollup`/`computeFte`/`searchEntries`/`savePlan` are reused unchanged.
- **Parity anchor:** Task 5's acceptance cross-checks one Worksharing and one Super-Grouping submission against the SAME submission in the Guided Workflow — since both call `VCL_SUBMISSION`, the numbers must match, which is the whole point of the redesign.
