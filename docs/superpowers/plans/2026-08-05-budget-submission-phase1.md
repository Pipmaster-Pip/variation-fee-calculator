# Budget Submission Model — Phase 1 Implementation Plan (shared engine extraction + GW refactor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Guided Workflow's fee/hours orchestration into a new pure, shared
`vcl-submission.js` module, and refactor the Guided Workflow to consume it — with **zero change to the
Guided Workflow's displayed numbers or behaviour**.

**Architecture:** A new pure module (`vcl-submission.js`, dual Node/browser export like
`vcl-workload-hours.js`) computes fees and RA hours for a canonical `Submission` object. The Guided
Workflow keeps its DOM and stations but builds a `Submission` from its `state` and delegates all
pricing/hours math to the shared module. No Budget-tool changes happen in this phase (that is Phase 2).
This phase's whole point is that the shared module becomes the single source of truth **without**
altering the Guided Workflow that already works.

**Tech Stack:** Vanilla JS (no framework, no build step). Node `require()` for tests (framework-less,
matching `test/test-budget-engine.js`). Reuses `VCLCALC.computeFees`, `VCLCALC.countries`,
`VCLCALC_DATA.FEE_ROWS`, `VCL_WORKLOAD_HOURS.*`, `VCL_SG_LOGIC.*` through their existing public APIs.

## Global Constraints

- **Prime directive — behaviour-preserving:** the Guided Workflow's displayed fees, RA hours,
  timeline, mode chips, and every other behaviour MUST be numerically and visually identical before
  and after this phase. Any diff in a displayed number is a bug, not an improvement.
- **Faithful move:** extraction tasks move existing Guided-Workflow functions into the new module
  changing ONLY (a) `state.X` reads → the corresponding `sub.X` per the Substitution Table below, and
  (b) `window.*` / global-data reads → injected `engines` / `data` parameters. Logic, branches,
  rounding, and comments are otherwise carried over verbatim. The plan gives each function's source
  location, new signature, and substitution notes rather than re-transcribing unchanged bodies —
  re-transcription would risk silently diverging from the source of truth. Review verifies
  logic-identity against the cited source lines plus the numeric parity gate (Task 5).
- **No engine edits:** `vcl-calc-app.js` and `vcl-workload-hours.js` internals are not modified; reach
  everything through their existing public APIs.
- **Module pattern:** `vcl-submission.js` is pure and DOM-free, dual-exported
  (`window.VCL_SUBMISSION` + `module.exports`), mirroring `vcl-workload-hours.js` / `vcl-sg-logic.js`.
- **Tests at repo root** `test/`, framework-less (`node test/<file>.js`), per project convention. New
  JS asset goes into `build_zip.py`'s `FILES` allowlist; enqueued in `includes/lookup.php` **before**
  `vcl-workflow`.
- **Commits:** per-task commits on branch `worktree-budget-planning`; no push, no merge. Trailer
  `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. English code comments.

### Substitution Table (Guided-Workflow `state` → `Submission`)

`Submission` (the canonical object, from the design spec §2) — `procedures[0]` is the primary
procedure, `procedures[1..]` the additional (worksharing/super-grouping) procedures;
`variations[0]` is the base variation, `variations[1..]` the grouped ones:

```
sub = {
  mode: null | 'worksharing' | 'superGrouping' | 'annualUpdate',
  variations: [ { code, variantId, type }, … ],
  procedures: [ { kind, nat, rms, cms:[], ema }, … ],
  lead: cc | null,
  raTasks: { cmc:bool, compilation:bool, pi:bool, piDocs:{smpc,leaflet,labelling,mockups}, activeSubstance:null|'chemical'|'biologic' },
  strengths: { default: 1, overrides: {} },
  specials: { line: {}, ws: {}, lead: null }   // fee sub-category picks, keyed "cc|role"; {}/null = engine default
}
```

| Guided-Workflow read | `Submission` equivalent |
|---|---|
| `currentType()` (base type) | `sub.variations[0] ? sub.variations[0].type : null` |
| `state.grouping` (additional variations) | `sub.variations.slice(1)` |
| `state.submission.grouping` (bool) | `sub.variations.length > 1` |
| `state.submission.mode` | `sub.mode` |
| `state.procedure` (primary) | `sub.procedures[0]` |
| `state.worksharing` (additional procedures) | `sub.procedures.slice(1)` |
| `state.worksharingLead` | `sub.lead` |
| `state.strengthsDefault` / `state.strengthsOverrides` | `sub.strengths.default` / `sub.strengths.overrides` |
| `state.specials` | `sub.specials.line` |
| `state.wsSpecials` | `sub.specials.ws` |
| `state.worksharingLeadSpecial` | `sub.specials.lead` |
| `state.activeSubstance` | `sub.raTasks.activeSubstance` |
| `state.piInRA` / `state.cmcInRA` / `state.compilationInRA` | `sub.raTasks.pi` / `.cmc` / `.compilation` |
| `state.piDocs` | `sub.raTasks.piDocs` |

`engines` / `data` injected surface (replaces the module's `window.*` reads):
```
engines = {
  computeFees: VCLCALC.computeFees,
  countries:   VCLCALC.countries(),        // [{cc,name,roles[]}]
  feeRows:     VCLCALC_DATA.FEE_ROWS,      // for special-option lookups & role resolution
  workload:    VCL_WORKLOAD_HOURS,
  workloadData:VCL_WORKLOAD_HD,
  sgLogic:     VCL_SG_LOGIC,               // computeAllVariationsAreIA, computeAllowedProcedureKinds
}
```

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `variation-fee-calculator/assets/js/vcl-submission.js` | new | Pure fee/hours orchestration + mode predicates + fee-special resolution for a `Submission`. Dual-export `window.VCL_SUBMISSION` + `module.exports`. |
| `test/test-submission.js` | new | Node unit tests for `vcl-submission.js` (derivation layer, fees, hours). |
| `variation-fee-calculator/assets/js/vcl-workflow.js` | modify | Add `submissionFromState()`; replace the extracted functions' bodies with delegations to `VCL_SUBMISSION`. No behaviour change. |
| `variation-fee-calculator/includes/lookup.php` | modify | Register + enqueue `vcl-submission`; make it a dependency of `vcl-workflow`. |
| `variation-fee-calculator/build_zip.py` | modify | Add `assets/js/vcl-submission.js` to `FILES`. |

Task order: build the shared module bottom-up and fully Node-tested (Tasks 1–4) **before** touching
the Guided Workflow (Task 5), so the risky integration lands last, on top of a proven module.

---

### Task 1: Module scaffold + derivation layer (pure, no engines)

The "reading" layer: mode predicates and variation/procedure counting. All pure functions of `sub`
only (no engines needed except `sgLogic` for the all-IA check).

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-submission.js`
- Create: `test/test-submission.js`
- Modify: `variation-fee-calculator/build_zip.py`

**Interfaces — Produces** (on `window.VCL_SUBMISSION` / `module.exports`):
- `feeBucket(type) -> 'IA'|'IB'|'II'|null` — move of `vcl-workflow.js:153-159` verbatim.
- `feeCounts(sub) -> {IA,IB,II}` — move of `:161-167`; `currentType()`→`sub.variations[0]&&sub.variations[0].type`, `state.grouping`→`sub.variations.slice(1)`, drop the `state.submission.grouping` guard (iterate `sub.variations.slice(1)` unconditionally — grouped-ness is just "has more variations").
- `feeCountsTotal(c) -> number` — move of `:168` verbatim.
- `highestType(sub) -> 'IA'|'IB'|'II'|null` — move of `:172-178`; uses `feeCounts(sub)`.
- `primaryType(sub) -> type|null` — move of `:419-425`; base = `sub.variations[0]&&sub.variations[0].type`, iterate `sub.variations.slice(1)`, keep `typeRankOf` (move `:418`).
- `groupingBuckets(sub) -> {IA,IB,II}` — move of `:431-435`; iterate `sub.variations.slice(1)` unconditionally.
- `worksharingKinds(sub) -> {national,mrpdcp}` — move of `:436-440`; `multiProcedureMode(sub)` guard, iterate `sub.procedures.slice(1)`.
- `sgProcKinds(sub) -> {national,mrpdcp,cp}` — move of `:443-447`; `sgActive(sub)` guard, iterate `sub.procedures.slice(1)`.
- `wsActive(sub)`,`auActive(sub)`,`sgActive(sub)`,`leadPricingActive(sub)`,`multiProcedureMode(sub)`,`annualUpdateActive(sub)` — move of `:197-202`, each reading `sub.mode`.
- `allVariationsAreIA(sub, engines) -> bool` — move of `:204-209`; call `engines.sgLogic.computeAllVariationsAreIA(sub.variations[0]&&sub.variations[0].type, sub.variations.slice(1).map(v=>v.type))`.
- `allPricedProcedures(sub) -> [procedure]` — move of `allProcedures` `:179-183`; `[sub.procedures[0]].concat(multiProcedureMode(sub) ? sub.procedures.slice(1) : [])`.
- `displayMode(sub) -> 'worksharing'|'superGrouping'|'annualUpdate'|'grouping'|'single'` — **new** (design §2): return `sub.mode` if set, else `sub.variations.length > 1 ? 'grouping' : 'single'`.

- [ ] **Step 1: Write the module scaffold**

Create `variation-fee-calculator/assets/js/vcl-submission.js`:

```js
// Pure fee/hours orchestration for a canonical Submission object. No DOM, no direct window reads
// (engines/data are injected). Dual-mode: window.VCL_SUBMISSION in the browser + module.exports in
// Node. Mirrors vcl-workload-hours.js. The Guided Workflow (vcl-workflow.js) and the Budget tool
// (vcl-budget.js, Phase 2) both build a Submission and call these functions, so the two tools can
// never disagree. See docs/superpowers/specs/2026-08-05-budget-submission-model-design.md.
(function (root) {
  "use strict";

  // ---- derivation layer (pure, no engines except sgLogic) ----
  function feeBucket(type) {
    if (!type) return null;
    if (type.indexOf("II") === 0) return "II";
    if (type.indexOf("IB") === 0) return "IB";
    if (type.indexOf("IA") === 0) return "IA";
    return null;
  }
  function baseType(sub) { return (sub.variations[0] && sub.variations[0].type) || null; }
  function feeCounts(sub) {
    var c = { IA: 0, IB: 0, II: 0 };
    var bt = baseType(sub);
    if (bt) { var b = feeBucket(bt); if (b) c[b]++; }
    sub.variations.slice(1).forEach(function (g) { if (g.type) { var b2 = feeBucket(g.type); if (b2) c[b2]++; } });
    return c;
  }
  function feeCountsTotal(c) { return c.IA + c.IB + c.II; }
  function highestType(sub) {
    var c = feeCounts(sub);
    if (c.II) return "II"; if (c.IB) return "IB"; if (c.IA) return "IA"; return null;
  }
  function typeRankOf(type) { var b = feeBucket(type); return b === "II" ? 3 : b === "IB" ? 2 : b === "IA" ? 1 : 0; }
  function primaryType(sub) {
    var best = baseType(sub);
    sub.variations.slice(1).forEach(function (g) { if (g.type && typeRankOf(g.type) > typeRankOf(best)) best = g.type; });
    return best;
  }
  function groupingBuckets(sub) {
    var c = { IA: 0, IB: 0, II: 0 };
    sub.variations.slice(1).forEach(function (g) { if (g.type) { var b = feeBucket(g.type); if (b) c[b]++; } });
    return c;
  }
  function wsActive(sub) { return sub.mode === "worksharing"; }
  function auActive(sub) { return sub.mode === "annualUpdate"; }
  function sgActive(sub) { return sub.mode === "superGrouping"; }
  function leadPricingActive(sub) { return wsActive(sub) || sgActive(sub); }
  function multiProcedureMode(sub) { return wsActive(sub) || sgActive(sub); }
  function annualUpdateActive(sub) { return auActive(sub) || sgActive(sub); }
  function worksharingKinds(sub) {
    var k = { national: 0, mrpdcp: 0 };
    if (multiProcedureMode(sub)) sub.procedures.slice(1).forEach(function (p) { if (p.kind === "national") k.national++; else if (p.kind === "mrpdcp") k.mrpdcp++; });
    return k;
  }
  function sgProcKinds(sub) {
    var k = { national: 0, mrpdcp: 0, cp: 0 };
    if (sgActive(sub)) sub.procedures.slice(1).forEach(function (p) { if (k[p.kind] !== undefined) k[p.kind]++; });
    return k;
  }
  function allPricedProcedures(sub) {
    return [sub.procedures[0]].concat(multiProcedureMode(sub) ? sub.procedures.slice(1) : []);
  }
  function allVariationsAreIA(sub, engines) {
    return engines.sgLogic.computeAllVariationsAreIA(baseType(sub), sub.variations.slice(1).map(function (v) { return v.type; }));
  }
  function displayMode(sub) {
    if (sub.mode) return sub.mode;
    return sub.variations.length > 1 ? "grouping" : "single";
  }

  var api = {
    feeBucket: feeBucket, feeCounts: feeCounts, feeCountsTotal: feeCountsTotal, highestType: highestType,
    primaryType: primaryType, groupingBuckets: groupingBuckets, worksharingKinds: worksharingKinds,
    sgProcKinds: sgProcKinds, allPricedProcedures: allPricedProcedures, allVariationsAreIA: allVariationsAreIA,
    wsActive: wsActive, auActive: auActive, sgActive: sgActive, leadPricingActive: leadPricingActive,
    multiProcedureMode: multiProcedureMode, annualUpdateActive: annualUpdateActive, displayMode: displayMode,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_SUBMISSION = api;
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 2: Write the failing test**

Create `test/test-submission.js`:

```js
// Node unit test for vcl-submission.js. Run from the project root: node test/test-submission.js
// Loads the REAL workload + sg-logic engines (already covered by their own tests) so the adapters
// are checked against the real math; fees are checked with a deterministic stub computeFees (as in
// test-budget-engine.js, since vcl-calc-app.js is DOM-coupled and cannot run under Node).
"use strict";
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-workload-hours-data.js");
var WLH = require("../variation-fee-calculator/assets/js/vcl-workload-hours.js");
var HD = global.window.VCL_WORKLOAD_HD;
var SG = require("../variation-fee-calculator/assets/js/vcl-sg-logic.js");
var SUB = require("../variation-fee-calculator/assets/js/vcl-submission.js");

var failures = 0;
function eq(a, b, msg) {
  var ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? "  PASS " : "  FAIL ") + msg + (ok ? "" : " — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)));
  if (!ok) failures++;
}
var engines = { sgLogic: SG, workload: WLH, workloadData: HD };

// helper: build a submission
function mk(o) {
  return Object.assign({ mode: null, variations: [], procedures: [], lead: null,
    raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
    strengths: { default: 1, overrides: {} }, specials: { line: {}, ws: {}, lead: null } }, o);
}

console.log("Submission — derivation layer\n");
var g = mk({ variations: [{ type: "IB" }, { type: "II" }, { type: "IAIN" }] });
eq(SUB.feeCounts(g), { IA: 1, IB: 1, II: 1 }, "feeCounts counts base + grouped, IAIN→IA");
eq(SUB.groupingBuckets(g), { IA: 1, IB: 0, II: 1 }, "groupingBuckets counts only the grouped (non-base)");
eq(SUB.primaryType(g), "II", "primaryType = highest across all variations");
eq(SUB.highestType(g), "II", "highestType = highest bucket");
eq(SUB.displayMode(g), "grouping", "displayMode = grouping when >1 variation, no strategy");
eq(SUB.displayMode(mk({ variations: [{ type: "II" }] })), "single", "displayMode = single for one variation");
eq(SUB.displayMode(mk({ mode: "worksharing", variations: [{ type: "II" }, { type: "IB" }] })), "worksharing", "displayMode = strategy when set");
var ws = mk({ mode: "worksharing", procedures: [{ kind: "national" }, { kind: "national" }, { kind: "mrpdcp" }] });
eq(SUB.worksharingKinds(ws), { national: 1, mrpdcp: 1 }, "worksharingKinds counts additional procedures by kind");
eq(SUB.multiProcedureMode(ws), true, "multiProcedureMode true for worksharing");
var sg = mk({ mode: "superGrouping", procedures: [{ kind: "cp" }, { kind: "cp" }, { kind: "cp" }] });
eq(SUB.sgProcKinds(sg), { national: 0, mrpdcp: 0, cp: 2 }, "sgProcKinds counts additional CPs");
eq(SUB.allVariationsAreIA(mk({ variations: [{ type: "IA" }, { type: "IAIN" }] }), engines), true, "allVariationsAreIA true for all-IA");
eq(SUB.allVariationsAreIA(g, engines), false, "allVariationsAreIA false when a II is present");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node test/test-submission.js`
Expected: `Error: Cannot find module '../variation-fee-calculator/assets/js/vcl-submission.js'` (before Step 1's file exists) — if Step 1 is already saved, instead expect all derivation assertions to run.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/test-submission.js`
Expected: `All tests passed.` (exit 0)

- [ ] **Step 5: Add the file to the build allowlist**

In `variation-fee-calculator/build_zip.py`, in the `FILES` list, right after the
`"assets/js/vcl-sg-logic.js",` entry, add:

```python
    "assets/js/vcl-submission.js",
```

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-submission.js test/test-submission.js "variation-fee-calculator/build_zip.py"
git commit -m "feat(submission): pure derivation layer (mode predicates, counts, displayMode)"
```

---

### Task 2: Fee-special resolution sub-layer

Move the fee-category ("special") resolution and role/strengths helpers. These read the fee-row data
and the per-line picks; the Budget tool leaves the picks empty (engine defaults), the Guided Workflow
uses them. Pure functions of `(sub, engines)`.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-submission.js`
- Modify: `test/test-submission.js`

**Interfaces — Produces** (add to `VCL_SUBMISSION`; all faithful moves per the Substitution Table):
- `strengthsFor(sub, cc) -> number` — move of `:117-121`; reads `sub.strengths.overrides[cc]` / `sub.strengths.default`.
- `procCountries(sub, p, engines) -> [{cc,role,strengths}]` — move of `:124-135`; `strengthsFor(sub, cc)`, EMA cc from `engines`-derived country data (add a small `emaCc(engines)` helper: `(engines.countries.find(c=>c.roles.indexOf('EMA')!==-1)||{}).cc`). `engines` is only dereferenced on the `cp` branch.
- `specialOptionsFor(cc, role, engines)` / `hasStandardRow(cc, role, engines)` — move of their current bodies (find them near `:253`+; they read `engines.feeRows` = `VCLCALC_DATA.FEE_ROWS`). Signature gains `engines`; body reads `engines.feeRows` instead of `feeRows()`.
- `isWorksharingSpecial(s)`,`wsSpecialKey(cc,role)`,`wsOptionsFor`,`nonWsOptionsFor`,`defaultSpecial` — moves of `:290`,`:289`,`:294-298`,`:316-318`,`:303-306`; pass `engines` down where they call `specialOptionsFor`/`hasStandardRow`.
- `wsPricingRole(role)` — move of `:288` (`WS_RMS_PRICES_AS = "CMS"` constant moves too, `:287`).
- `specialFor(sub, cc, role, engines)` — move of `:322-327`; `state.specials`→`sub.specials.line`.
- `wsSpecialFor(sub, cc, role, engines)` — move of `:308-313`; `state.wsSpecials`→`sub.specials.ws`.
- `leadPricingRole(sub, engines)` — move of `:338-344`; `state.worksharingLead`→`sub.lead`, `countryData().ema`→`emaCc(engines)`, `feeRows()`→`engines.feeRows`.
- `leadSpecial(sub, engines)` — move of `:329-335`; `state.worksharingLead`→`sub.lead`, `state.worksharingLeadSpecial`→`sub.specials.lead`.

- [ ] **Step 1: Move the sub-layer into the module**

Add the functions above to `vcl-submission.js` (inside the IIFE, before the `api` object), faithful
moves per the Substitution Table. Add `emaCc(engines)` helper. Add each to `api`. (Bodies are carried
over verbatim from the cited lines with only the substitutions noted; do not alter branch logic.)

- [ ] **Step 2: Write the failing test**

Append to `test/test-submission.js` (before the final summary), using a stub `feeRows` data set so
the special-resolution is deterministic and Node-runnable:

```js
console.log("\nSubmission — fee-special sub-layer");
// Minimal FEE_ROWS-shaped fixture: DE Type II has a "simple" and a "…- worksharing" row (no plain
// standard), FR national has only a standard row.
var feeRowsFixture = [
  { cc: "DE - BfArM", role: "national", type: "II", label: "simple" },
  { cc: "DE - BfArM", role: "national", type: "II", label: "complex - worksharing" },
  { cc: "FR", role: "national", type: "II", label: null },
];
var feEng = { feeRows: feeRowsFixture, countries: [{ cc: "EU", roles: ["EMA"] }, { cc: "FR", roles: ["national","RMS","CMS"] }, { cc: "DE - BfArM", roles: ["national","RMS","CMS"] }] };
var s0 = mk({ specials: { line: {}, ws: {}, lead: null } });
eq(SUB.strengthsFor(mk({ strengths: { default: 3, overrides: { FR: 5 } } }), "FR"), 5, "strengthsFor honours per-cc override");
eq(SUB.strengthsFor(mk({ strengths: { default: 3, overrides: {} } }), "FR"), 3, "strengthsFor falls back to default");
eq(SUB.procCountries(mk({ strengths: { default: 1, overrides: {} } }), { kind: "mrpdcp", rms: "FR", cms: ["DE - BfArM"] }),
  [{ cc: "FR", role: "RMS", strengths: 1 }, { cc: "DE - BfArM", role: "CMS", strengths: 1 }], "procCountries flattens MRP/DCP to RMS+CMS");
eq(SUB.wsPricingRole("RMS"), "CMS", "wsPricingRole: a non-lead RMS prices as CMS in worksharing");
```

(Note: `specialFor`/`wsSpecialFor`/`leadSpecial` are exercised end-to-end in Task 3's fee test, where
they feed `computeSubmissionFees`; Task 2's assertions cover the deterministic pieces.)

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `node test/test-submission.js`
Expected before Step 1: FAIL (`SUB.strengthsFor is not a function`). After Step 1: `All tests passed.`

- [ ] **Step 4: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-submission.js test/test-submission.js
git commit -m "feat(submission): fee-category (special) resolution + strengths/role helpers"
```

---

### Task 3: `computeSubmissionFees(sub, engines)`

Assemble the per-procedure + lead pricing into one total plus a per-country breakdown. Faithful move
of `procPricedCountries`/`procFees`/`leadFees`/`grandTotalFees`, plus a **new** by-country aggregation
the Budget tool needs.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-submission.js`
- Modify: `test/test-submission.js`

**Interfaces — Produces:**
- `procPricedCountries(sub, p, engines) -> [{cc,role,strengths,special?}]` — move of `:367-378`;
  `leadPricingActive(sub)`, `specialFor(sub,…)`, `wsPricingRole`, `wsSpecialFor(sub,…)`, exclude
  `sub.lead`.
- `computeSubmissionFees(sub, engines) -> { total: number|null, byCountry: [{cc,total}] }` — assembles
  `feeCounts(sub)`, iterates `allPricedProcedures(sub)` calling `engines.computeFees({countries:
  procPricedCountries(sub,p,engines), counts})` (skip empty procedures / zero counts as `grandTotalFees`
  does), adds the lead via the `leadFees` logic (move of `:346-357`, `state.*`→`sub.*`), returns
  `total` = `null` when nothing is priceable (exactly as `grandTotalFees` `:385-393`), and `byCountry`
  = merge of every priced `computeFees(...).countries[].total` (and the lead's country) summed per cc.

- [ ] **Step 1: Add `computeSubmissionFees` + `leadFees` + `procFees` + `procPricedCountries`**

Add to `vcl-submission.js`. `computeSubmissionFees` (new assembly around the moved pieces):

```js
  function procFees(sub, p, counts, engines) {
    if (!engines.computeFees) return null;
    if (!procCountries(sub, p, engines).length || feeCountsTotal(counts) === 0) return { countries: [], grandTotal: 0 };
    return engines.computeFees({ countries: procPricedCountries(sub, p, engines), counts: counts });
  }
  function leadFees(sub, counts, engines) {
    if (!leadPricingActive(sub) || !sub.lead || !engines.computeFees) return null;
    if (feeCountsTotal(counts) === 0) return null;
    var s = leadSpecial(sub, engines);
    var r = engines.computeFees({
      countries: [{ cc: sub.lead, role: leadPricingRole(sub, engines), strengths: strengthsFor(sub, sub.lead), special: { IA: s, IB: s, II: s } }],
      counts: counts,
    });
    return (r.countries && r.countries[0]) || null;
  }
  function computeSubmissionFees(sub, engines) {
    var counts = feeCounts(sub);
    if (feeCountsTotal(counts) === 0) return { total: null, byCountry: [] };
    var byCc = {}; var total = 0; var any = false;
    allPricedProcedures(sub).forEach(function (p) {
      var r = procFees(sub, p, counts, engines);
      if (!r) return;
      total += r.grandTotal || 0;
      if (procCountries(sub, p, engines).length) any = true;
      (r.countries || []).forEach(function (c) { byCc[c.cc] = (byCc[c.cc] || 0) + (c.total || 0); });
    });
    if (leadPricingActive(sub)) {
      var lf = leadFees(sub, counts, engines);
      if (lf) { total += lf.total || 0; byCc[lf.cc] = (byCc[lf.cc] || 0) + (lf.total || 0); any = true; }
    }
    var byCountry = Object.keys(byCc).map(function (cc) { return { cc: cc, total: byCc[cc] }; });
    return { total: any ? total : null, byCountry: byCountry };
  }
```

Add `procPricedCountries`, `procFees`, `leadFees`, `computeSubmissionFees` to `api`.

- [ ] **Step 2: Write the failing test** (deterministic stub `computeFees`, mirroring `test-budget-engine.js`)

Append to `test/test-submission.js`:

```js
console.log("\nSubmission — computeSubmissionFees");
function stubFees(input) {
  var per = input.countries.map(function (c) { return { cc: c.cc, role: c.role, total: 100 + (c.role === "RMS" ? 50 : 0) + (c.role === "EMA" ? 200 : 0) }; });
  return { countries: per, grandTotal: per.reduce(function (s, c) { return s + c.total; }, 0) };
}
var feeEng = { computeFees: stubFees, feeRows: [], countries: [{ cc: "EU", roles: ["EMA"] }] };
// single national submission
var sSingle = mk({ variations: [{ type: "IA" }], procedures: [{ kind: "national", nat: "FR", cms: [] }] });
eq(SUB.computeSubmissionFees(sSingle, feeEng), { total: 100, byCountry: [{ cc: "FR", total: 100 }] }, "fees: single national");
// worksharing: lead DE excluded from its procedure, priced once as lead
var sWs = mk({ mode: "worksharing", lead: "DE - BfArM",
  variations: [{ type: "II" }],
  procedures: [{ kind: "national", nat: "DE - BfArM", cms: [] }, { kind: "national", nat: "FR", cms: [] }] });
var wsFees = SUB.computeSubmissionFees(sWs, feeEng);
eq(wsFees.total, 200, "fees: worksharing = lead DE (100) + FR (100), DE not double-charged");
// incomplete (no country) prices to null
eq(SUB.computeSubmissionFees(mk({ variations: [{ type: "IA" }], procedures: [{ kind: "national", nat: null, cms: [] }] }), feeEng).total, null, "fees: incomplete → null");
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `node test/test-submission.js` — FAIL before Step 1 (`computeSubmissionFees is not a function`),
`All tests passed.` after.

- [ ] **Step 4: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-submission.js test/test-submission.js
git commit -m "feat(submission): computeSubmissionFees (per-procedure + lead, by-country breakdown)"
```

---

### Task 4: `computeSubmissionHours(sub, engines)`

Faithful move of the Guided Workflow's `raEffort` (`:454-488`) — the additive-workload assembly.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-submission.js`
- Modify: `test/test-submission.js`

**Interfaces — Produces:**
- `computeSubmissionHours(sub, engines) -> { min, max, expected, parts, items, sections, total } | null`
  — move of `raEffort` `:454-488`; `primaryType(sub)`, `engines.workload`/`engines.workloadData`,
  `groupingBuckets(sub)`, `worksharingKinds(sub)`, `sgProcKinds(sub)`,
  `grouped = sub.variations.length>1 && !(auActive(sub)||sgActive(sub))`, `sub.procedures[0].kind` for
  `procedure`, `sub.procedures[0].cms.length` for `cmsCount`, `sub.raTasks.*` for the
  modules/piDocs/activeSubstance (keep the `biologic→biological` mapping verbatim). Returns the
  **superset** the Guided Workflow's transparency box already consumes (`parts`, `items`, `sections`,
  `total = sections.total = {min,max}`, `expected = pertExpected(min,max)`) plus the flat
  `min`/`max`/`expected` the Budget tool uses — so `raEffort()` becomes a thin pass-through (Task 5)
  and the Budget line result reads `.min`/`.max`/`.expected`. Returns `null` when no type / engine.

- [ ] **Step 1: Add `computeSubmissionHours`**

Add to `vcl-submission.js` (faithful move of `raEffort`; the additive-workload input object is
carried over verbatim with the substitutions above). Return the superset

```js
    var sections = engines.workload.composeSections(parts);
    return { parts: parts, items: parts.items, sections: sections, total: sections.total,
      min: sections.total.min, max: sections.total.max,
      expected: engines.workload.pertExpected(sections.total.min, sections.total.max) };
```

Add to `api`.

- [ ] **Step 2: Write the failing test** (real workload engine, cross-checked against a direct call)

Append to `test/test-submission.js`:

```js
console.log("\nSubmission — computeSubmissionHours (real engine)");
var sHours = mk({ variations: [{ type: "IB" }], procedures: [{ kind: "mrpdcp", rms: "DE - BfArM", cms: ["FR", "ES"] }] });
var h = SUB.computeSubmissionHours(sHours, engines);
// cross-check against calling the workload engine directly with the equivalent sel
var parts = WLH.computeAdditiveWorkload(HD, {
  type: "IB", procedure: "mrpdcp", cmsCount: 2, activeSubstance: null,
  modules: { pi: false, cmc: false, compilation: false }, piDocs: {},
  submission: {
    worksharing: { on: false, counts: { "national": 0, "MRP/DCP": 0 } },
    grouping: { on: false, counts: { "Type IA": 0, "Type IB": 0, "Type II": 0 } },
    annualUpdate: { on: false, counts: { "Type IA": 1 } },
    superGrouping: { on: false, counts: { "national": 0, "MRP/DCP": 0, "CP": 0 } },
  },
});
var sec = WLH.composeSections(parts);
eq({ min: h.min, max: h.max, expected: h.expected },
   { min: sec.total.min, max: sec.total.max, expected: WLH.pertExpected(sec.total.min, sec.total.max) },
   "hours match a direct workload-engine call with the equivalent sel");
eq(!!h.sections && !!h.parts, true, "hours result carries the transparency-box superset (sections, parts)");
eq(SUB.computeSubmissionHours(mk({ variations: [] }), engines), null, "hours: no variation → null");
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `node test/test-submission.js` — FAIL before Step 1, `All tests passed.` after.

- [ ] **Step 4: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-submission.js test/test-submission.js
git commit -m "feat(submission): computeSubmissionHours (additive workload assembly)"
```

---

### Task 5: Refactor the Guided Workflow to delegate + parity gate

Now swap the Guided Workflow's own calc bodies for delegations to the proven shared module, and prove
nothing changed. This is the only task that touches `vcl-workflow.js`.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js`
- Modify: `variation-fee-calculator/includes/lookup.php`

**Interfaces — Consumes:** everything on `window.VCL_SUBMISSION` from Tasks 1–4.

- [ ] **Step 1: Record the "before" parity numbers (browser)**

Before editing, open the current Guided Workflow in the dev harness / real Chrome and record the
displayed **fee total** and **RA-hours headline (+ min–max band)** for these five scenarios (write
them into `.superpowers/sdd/gw-parity-before.md`):
1. Single national Type II (one country).
2. Grouping: base II + a IB + a IA, one MRP/DCP (RMS + 2 CMS).
3. Worksharing: mixed types, 2 national + 1 MRP/DCP, a national lead.
4. Super-Grouping: 3× IA, 3 CP procedures.
5. Annual Update: 4× IA on one MRP/DCP.

(These are the read-only "golden" values the refactor must reproduce exactly.)

- [ ] **Step 2: Add `submissionFromState()` to vcl-workflow.js**

Add a builder that maps the Guided-Workflow `state` to a `Submission` per the Substitution Table:

```js
  // Build the canonical Submission the shared vcl-submission engine consumes. The Guided Workflow
  // keeps its own `state`; this is the single mapping point (Substitution Table in the Phase-1 plan).
  function submissionFromState() {
    var base = currentType();
    var variations = [];
    if (base) variations.push({ code: state.pickedCode, variantId: state.pickedVariantId, type: base });
    if (state.submission.grouping) state.grouping.forEach(function (g) { variations.push({ code: g.code, variantId: g.variantId, type: g.type }); });
    var procedures = [state.procedure].concat(multiProcedureMode() ? state.worksharing : []);
    return {
      mode: state.submission.mode,
      variations: variations,
      procedures: procedures,
      lead: state.worksharingLead,
      raTasks: { cmc: !!state.cmcInRA, compilation: !!state.compilationInRA, pi: state.piInRA, piDocs: state.piDocs, activeSubstance: state.activeSubstance },
      strengths: { default: state.strengthsDefault, overrides: state.strengthsOverrides },
      specials: { line: state.specials, ws: state.wsSpecials, lead: state.worksharingLeadSpecial },
    };
  }
  function subEngines() {
    return {
      computeFees: window.VCLCALC && window.VCLCALC.computeFees,
      countries: (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [],
      feeRows: (window.VCLCALC_DATA && window.VCLCALC_DATA.FEE_ROWS) || [],
      workload: window.VCL_WORKLOAD_HOURS, workloadData: window.VCL_WORKLOAD_HD, sgLogic: window.VCL_SG_LOGIC,
    };
  }
```

- [ ] **Step 3: Delegate the two public results**

Replace the body of `grandTotalFees()` with:
```js
  function grandTotalFees() { return window.VCL_SUBMISSION.computeSubmissionFees(submissionFromState(), subEngines()).total; }
```
Replace the body of `raEffort()` with a thin pass-through — `computeSubmissionHours` (Task 4) already
returns the exact superset (`{parts, items, sections, total, expected}` + flat `min`/`max`) the
transparency box consumes:
```js
  function raEffort() { return window.VCL_SUBMISSION.computeSubmissionHours(submissionFromState(), subEngines()); }
```

- [ ] **Step 4: Replace the remaining extracted functions with delegations**

For each function now living in `vcl-submission.js`, replace its `vcl-workflow.js` body with a
one-line delegation passing `submissionFromState()` (and `subEngines()` where needed): `feeCounts`,
`feeCountsTotal`, `highestType`, `primaryType`, `groupingBuckets`, `worksharingKinds`, `sgProcKinds`,
`allProcedures`→`allPricedProcedures`, `allVariationsAreIA`, `wsActive`/`auActive`/`sgActive`/
`leadPricingActive`/`multiProcedureMode`/`annualUpdateActive`, `procCountries`, `procPricedCountries`,
`leadFees`, `specialFor`/`wsSpecialFor`/`leadSpecial`/`leadPricingRole`/`wsPricingRole`/`strengthsFor`.
Keep each Guided-Workflow function name and call-signature as the display code already calls them
(e.g. `feeCounts()` stays zero-arg, internally `return window.VCL_SUBMISSION.feeCounts(submissionFromState())`).
Predicates that the mode-chip UI calls very frequently (`wsActive` etc.) may read `state.submission.mode`
directly if a delegation is gratuitous — but the counting/pricing functions MUST delegate so there is
one implementation.

- [ ] **Step 5: Enqueue the module before vcl-workflow**

In `variation-fee-calculator/includes/lookup.php`, register `vcl-submission` (same `wp_register_script`
+ `filemtime` pattern as the other assets) and add `'vcl-submission'` to `vcl-workflow`'s dependency
array so it loads first. Enqueue it in `vcl_shortcode()` alongside the other scripts.

- [ ] **Step 6: Run the module tests + parity gate (browser)**

Run: `node test/test-submission.js` → `All tests passed.`
Then reload the Guided Workflow in the harness / real Chrome and re-read the fee total and RA-hours
for the five scenarios from Step 1. **Every number must match `gw-parity-before.md` exactly.** Record
the "after" values in `.superpowers/sdd/gw-parity-after.md` and confirm equality. Check
`read_console_messages` for errors. (Also spot-check the timeline still renders — it reads
`primaryType`/`multiProcedureMode`, now delegated.)

- [ ] **Step 7: Commit**

```bash
git add "variation-fee-calculator/assets/js/vcl-workflow.js" "variation-fee-calculator/includes/lookup.php"
git commit -m "refactor(workflow): delegate fee/hours math to the shared vcl-submission module"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1 scope):** shared `Submission` model (§2) → Task 1's shape + all tasks;
  `vcl-submission.js` API `computeSubmissionFees`/`computeSubmissionHours` + predicates (§3) → Tasks
  1–4; Phase-1 extraction + behaviour-preserving GW refactor with the numeric parity safety net (§4
  Phase 1) → Task 5. Phase-2 items (budget line = submission, stations editor, table/rollup,
  migration) are intentionally **not** in this plan — they are Phase 2 (§4) and get their own plan.
- **`displayMode` / grouping-vs-mode:** the spec's corrected model (grouping derived, not a mode) is
  in Task 1 (`displayMode`) and the Substitution Table (`state.submission.grouping` → `variations.length>1`).
- **Parity is the gate:** Task 5's before/after browser check is the acceptance criterion — the
  Guided Workflow's fee/hours must be byte-identical. Node tests prove the module is correct; the
  browser parity proves the refactor changed nothing (the GW's own glue is DOM-coupled and not
  Node-runnable, so parity is verified where it actually runs).
- **Type consistency:** the `Submission` shape, the `engines` surface, and the function signatures are
  identical across Tasks 1–5 (see the Substitution Table + each task's Interfaces block). `raEffort`'s
  superset return shape is reconciled in Task 5 Step 3 (Task 4 returns the superset so `raEffort`
  becomes a pass-through).
- **No new behaviour, no new UI:** this phase adds a file and moves code; the only observable effect
  is "nothing changed," which is the point.
