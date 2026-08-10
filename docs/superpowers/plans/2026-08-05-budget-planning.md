# Budget Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Budget Planning" tool to the Variation Toolbox WordPress plugin: a
portfolio-wide annual plan of precise, per-variation lines, each priced/timed through the
existing fee and RA-hours engines, rolled up into annual totals, FTE, and by-market/by-product
breakdowns, persisted in `localStorage`, exportable to Excel.

**Architecture:** A new pure "engine" module (`vcl-budget-engine.js`, dual Node/browser export,
mirrors the existing `vcl-workload-hours.js` split) adapts one plan line into calls against the
two engines the Guided Workflow already uses (`VCLCALC.computeFees`, `VCL_WORKLOAD_HOURS.*`) and
rolls the per-line results up. A new DOM view module (`vcl-budget.js`, same IIFE/`render(col)`
pattern as `vcl-workflow.js`) owns the UI and calls the engine module. No existing file's
behaviour changes.

**Tech Stack:** Vanilla JS (no framework, no build step — matches the rest of the plugin), plain
Node `require()` for tests (no test framework, matches `test/test-additive-workload.js`),
SheetJS/XLSX (already loaded as `vclcalc-xlsx`) for Excel export.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-05-budget-planning-design.md` — read it before
  starting; this plan implements it task-by-task.
- **Language:** all UI copy is **English** — no German strings anywhere in `vcl-budget.js` /
  `vcl-budget-style.css`.
- **Terminology:** the reference/lead authority in an MRP/DCP procedure is always called **RMS**,
  never "Lead". The procedure kind is always presented as **"MRP/DCP"** (never bare "MRP") —
  matches `vcl-workflow.js:147` (`procLabel`) and `vcl-calc-app.js:224` (role labels).
- **No engine changes:** `vcl-calc-app.js` and `vcl-workload-hours.js` are not modified. All
  pricing/hours logic is reached through their existing public APIs
  (`VCLCALC.computeFees`, `VCLCALC.countries`, `VCL_WORKLOAD_HOURS.computeAdditiveWorkload`,
  `.composeSections`, `.pertExpected`, `.typeBucket`).
- **No confirmation dialogs:** the codebase never uses `window.confirm`/`alert` for destructive
  actions (verified: no matches in `assets/js`) — delete/duplicate act immediately, no popup.
- **Persistence key:** `localStorage` key `vcl_budget_plan_v1`, versioned JSON payload.
- **Class prefix:** `.vcl-bud-*` for all new CSS classes (own namespace, following the
  `.vcl-wf-*` / `.vcl-tt-*` / `.vcl-wl-*` precedent — see `vcl-workload-style.css:8-13`).
- **Model selection for subagents executing this plan:** Task 1 (pure logic) → Sonnet. Tasks 2–6
  (DOM/CSS/wiring) → Haiku is enough for the mechanical parts (CSS, wiring, table rendering);
  use Sonnet for the modal editor's engine-integration logic (Task 5) and the rollup
  wiring (Task 4). No task in this plan needs Opus — no grouping/worksharing edge cases are
  touched (those stay inside the untouched engines).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `variation-fee-calculator/assets/js/vcl-budget-engine.js` | new | Pure: line factory, engine adapters, rollup/FTE math, variation search, `localStorage` load/save. Dual-exported (`window.VCL_BUDGET_ENGINE` + `module.exports`), like `vcl-workload-hours.js`. |
| `variation-fee-calculator/assets/js/vcl-budget.js` | new | DOM view: renders the tool, owns UI state, calls `VCL_BUDGET_ENGINE`. `window.VCL_BUDGET = { render(col) }`, like `vcl-workflow.js`. |
| `variation-fee-calculator/assets/css/vcl-budget-style.css` | new | All styling for the view, scoped under `.vcl-app`, own `--budget` token. |
| `test/test-budget-engine.js` | new | Node test for `vcl-budget-engine.js` (project's framework-less pattern). |
| `test/manual/budget-harness.html` | new | Dev-only standalone page to preview the tool without WordPress (never shipped — not in `build_zip.py`'s `FILES`). |
| `variation-fee-calculator/includes/lookup.php` | modify | Register/enqueue the two new scripts + stylesheet; add the `#vcl-budgetCol` column div. |
| `variation-fee-calculator/assets/js/vcl-app.js` | modify | New nav tile, tab, view-dispatch, column-visibility wiring — same shape as the existing five. |
| `variation-fee-calculator/build_zip.py` | modify | Add the two new asset files to `FILES`. |

---

### Task 1: Pure budget engine — adapters, rollup, FTE, search, persistence

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-budget-engine.js`
- Test: `test/test-budget-engine.js`

**Interfaces:**
- Produces (consumed by Task 2 onward, all on `window.VCL_BUDGET_ENGINE` in the browser /
  the `module.exports` object in Node):
  - `newLine(id) -> line` — a blank plan line.
  - `lineCountries(line) -> [{cc, role, strengths}]`
  - `lineHoursSel(line) -> sel` (the shape `VCL_WORKLOAD_HOURS.computeAdditiveWorkload` expects)
  - `computeLineResult(line, engines) -> {fee, feeByCountry, hours:{min,max,expected}, complete}`
    where `engines = {computeFees, workload, workloadData}` (dependency-injected so the pure
    module never touches `window` directly)
  - `computeRollup(lines, resultsById) -> {totals:{fee,hoursMin,hoursMax,hoursExpected}, byMarket:[{key,value}], byProduct:[{key,value}]}` (both breakdown arrays sorted descending by value)
  - `computeFte(totalHours, hoursPerHead) -> number`
  - `searchEntries(entries, query) -> matching entries (max 20)`
  - `defaultPlan() -> {version:1, hoursPerHead:1500, lines:[]}`
  - `loadPlan(storage) -> plan` (never throws; falls back to `defaultPlan()`)
  - `savePlan(storage, plan) -> boolean` (true on success, false if storage threw)
  - `STORAGE_KEY` = `"vcl_budget_plan_v1"`

- [ ] **Step 1: Write the test file**

Create `test/test-budget-engine.js`:

```js
// Node unit test for the budget engine (vcl-budget-engine.js). Run from the project root:
// node test/test-budget-engine.js
// Loads the REAL additive-workload engine (already covered by test-additive-workload.js) to
// verify the adapter wires into it correctly, and a deterministic STUB for VCLCALC.computeFees
// (vcl-calc-app.js is DOM-coupled at load time and cannot run under Node — see
// docs/superpowers/specs/2026-08-05-budget-planning-design.md).
// Lives outside the plugin folder (dev-only, never shipped); paths reach into the plugin's assets.
"use strict";

global.window = {};
require("../variation-fee-calculator/assets/js/vcl-workload-hours-data.js");
var WLH = require("../variation-fee-calculator/assets/js/vcl-workload-hours.js");
var HD = global.window.VCL_WORKLOAD_HD;
var BUD = require("../variation-fee-calculator/assets/js/vcl-budget-engine.js");

var failures = 0;
function eq(actual, expected, msg) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS " : "  FAIL ") + msg +
    (ok ? "" : " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  if (!ok) failures++;
}
function approx(a, b, msg) {
  var ok = Math.abs(a - b) < 1e-9;
  console.log((ok ? "  PASS " : "  FAIL ") + msg + (ok ? "" : " — expected " + b + ", got " + a));
  if (!ok) failures++;
}

console.log("Budget engine tests\n");

// --- 1. newLine() shape.
var l = BUD.newLine("x1");
eq(l.id, "x1", "newLine sets id");
eq(l.procedure, { kind: "national", nat: null, rms: null, cms: [] }, "newLine default procedure");
eq(l.type, null, "newLine starts with no type");
eq(l.probability, 100, "newLine defaults probability to 100");

// --- 2. lineCountries(): national / mrpdcp / cp.
eq(BUD.lineCountries({ procedure: { kind: "national", nat: null } }), [], "national w/o country = []");
eq(BUD.lineCountries({ procedure: { kind: "national", nat: "DE" } }),
  [{ cc: "DE", role: "national", strengths: 1 }], "national DE");
eq(BUD.lineCountries({ procedure: { kind: "mrpdcp", rms: "DE", cms: ["FR", "ES"] } }), [
  { cc: "DE", role: "RMS", strengths: 1 },
  { cc: "FR", role: "CMS", strengths: 1 },
  { cc: "ES", role: "CMS", strengths: 1 },
], "mrpdcp RMS+CMS");
eq(BUD.lineCountries({ procedure: { kind: "cp", ema: "EU" } }),
  [{ cc: "EU", role: "EMA", strengths: 1 }], "cp uses EMA cc");

// --- 3. lineHoursSel(): maps a line onto the engine's sel shape.
var sel = BUD.lineHoursSel({
  type: "IB", procedure: { kind: "mrpdcp", rms: "DE", cms: ["FR", "ES"] },
  activeSubstance: "chemical", piDocs: { smpc: true }, modules: { cmc: true },
  submission: { grouping: { on: false } },
});
eq(sel.type, "IB", "sel.type");
eq(sel.procedure, "mrpdcp", "sel.procedure");
eq(sel.cmsCount, 2, "sel.cmsCount counts CMS array");
eq(sel.activeSubstance, "chemical", "sel.activeSubstance");
eq(sel.modules, { cmc: true }, "sel.modules");

// --- 4. computeLineResult(): hours side wired to the REAL engine — cross-check against calling
//        WLH directly with the same sel, so this test tracks the adapter, not engine internals
//        (those are already covered by test-additive-workload.js).
function stubComputeFees(input) {
  var perCountry = input.countries.map(function (c) {
    return { cc: c.cc, role: c.role, total: 100 + (c.role === "RMS" ? 50 : 0) };
  });
  return { countries: perCountry, grandTotal: perCountry.reduce(function (s, c) { return s + c.total; }, 0) };
}
var line1 = { id: "l1", product: "Product A", type: "IA",
  procedure: { kind: "national", nat: "DE" }, modules: {}, submission: {} };
var engines = { computeFees: stubComputeFees, workload: WLH, workloadData: HD };
var r1 = BUD.computeLineResult(line1, engines);
eq(r1.fee, 100, "computeLineResult: stub fee for one national country");
eq(r1.feeByCountry, [{ cc: "DE", total: 100 }], "computeLineResult: per-country fee breakdown");
eq(r1.complete, true, "computeLineResult: complete when type+countries set");
var directParts = WLH.computeAdditiveWorkload(HD, BUD.lineHoursSel(line1));
var directSections = WLH.composeSections(directParts);
var directExpected = WLH.pertExpected(directSections.total.min, directSections.total.max);
eq(r1.hours, { min: directSections.total.min, max: directSections.total.max, expected: directExpected },
  "computeLineResult: hours match a direct WLH call with the same sel");

// --- 5. computeLineResult(): incomplete line (no country) is safe, not a crash.
var incomplete = { id: "l2", type: null, procedure: { kind: "national", nat: null }, modules: {}, submission: {} };
var r2 = BUD.computeLineResult(incomplete, engines);
eq(r2.fee, 0, "computeLineResult: incomplete line fee = 0");
eq(r2.complete, false, "computeLineResult: incomplete line flagged");
eq(r2.hours, { min: 0, max: 0, expected: 0 }, "computeLineResult: incomplete line hours = 0");

// --- 6. computeRollup(): sums totals, groups by market (per-country fee, not an even split) and
//        by product.
var line2 = { id: "l2b", product: "Product B", type: "II",
  procedure: { kind: "mrpdcp", rms: "DE", cms: ["FR"] }, modules: {}, submission: {} };
var r3 = BUD.computeLineResult(line2, engines); // DE=150 (RMS), FR=100 -> fee 250
var rollup = BUD.computeRollup([line1, line2], { l1: r1, l2b: r3 });
eq(rollup.totals.fee, 350, "computeRollup: total fee sums lines");
eq(rollup.byMarket, [
  { key: "DE", value: 250 }, { key: "FR", value: 100 },
], "computeRollup: by-market sums per-country fees across lines, sorted desc");
eq(rollup.byProduct, [
  { key: "Product B", value: 250 }, { key: "Product A", value: 100 },
], "computeRollup: by-product sums line fees, sorted desc");

// --- 7. computeFte(): straightforward division, guarded against a zero/missing denominator.
approx(BUD.computeFte(1500, 1500), 1, "computeFte: 1500h at 1500h/head = 1 FTE");
approx(BUD.computeFte(750, 1500), 0.5, "computeFte: half");
eq(BUD.computeFte(100, 0), 0, "computeFte: zero hoursPerHead guarded, returns 0");
eq(BUD.computeFte(100, null), 0, "computeFte: missing hoursPerHead guarded, returns 0");

// --- 8. searchEntries(): case-insensitive match on code/title/keywords, capped, empty query = [].
var fixtureEntries = [
  { code: "E.1", title: "Change in the (invented) name of the finished product", keywords: ["invented name", "trade name"] },
  { code: "Q.I.a.1", title: "Change in the manufacture of the active substance", keywords: ["manufacturing process"] },
];
eq(BUD.searchEntries(fixtureEntries, ""), [], "searchEntries: empty query = no results");
eq(BUD.searchEntries(fixtureEntries, "e.1").length, 1, "searchEntries: matches by code, case-insensitive");
eq(BUD.searchEntries(fixtureEntries, "active substance").length, 1, "searchEntries: matches by title");
eq(BUD.searchEntries(fixtureEntries, "trade name").length, 1, "searchEntries: matches by keyword");
eq(BUD.searchEntries(fixtureEntries, "zzz"), [], "searchEntries: no match = []");

// --- 9. loadPlan()/savePlan(): fake storage, plus a throwing storage to prove the fallback.
function fakeStorage() {
  var data = {};
  return { getItem: function (k) { return data[k] || null; }, setItem: function (k, v) { data[k] = v; } };
}
function throwingStorage() {
  return {
    getItem: function () { throw new Error("blocked"); },
    setItem: function () { throw new Error("blocked"); },
  };
}
var store = fakeStorage();
eq(BUD.loadPlan(store), BUD.defaultPlan(), "loadPlan: empty storage returns defaultPlan()");
var plan = { version: 1, hoursPerHead: 1600, lines: [line1] };
eq(BUD.savePlan(store, plan), true, "savePlan: succeeds against working storage");
eq(BUD.loadPlan(store), plan, "loadPlan: round-trips what savePlan wrote");
eq(BUD.loadPlan(throwingStorage()), BUD.defaultPlan(), "loadPlan: falls back to defaultPlan() when storage throws");
eq(BUD.savePlan(throwingStorage(), plan), false, "savePlan: returns false when storage throws");
eq(BUD.loadPlan({ getItem: function () { return "not json"; } }), BUD.defaultPlan(),
  "loadPlan: falls back to defaultPlan() on unparsable JSON");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/test-budget-engine.js`
Expected: `Error: Cannot find module '../variation-fee-calculator/assets/js/vcl-budget-engine.js'`

- [ ] **Step 3: Implement the engine module**

Create `variation-fee-calculator/assets/js/vcl-budget-engine.js`:

```js
// Pure Budget Planning helpers: no DOM, no window state read directly (engines are passed in).
// Dual-mode: attaches to window.VCL_BUDGET_ENGINE in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser. Mirrors the split already
// used for vcl-workload-hours.js — see docs/superpowers/specs/2026-08-05-budget-planning-design.md.
(function (root) {
  "use strict";

  var STORAGE_KEY = "vcl_budget_plan_v1";

  function newLine(id) {
    return {
      id: id,
      product: "",
      variationCode: null,
      variationLabel: "",
      type: null,
      procedure: { kind: "national", nat: null, rms: null, cms: [] },
      activeSubstance: null,
      piDocs: {},
      modules: { pi: false, cmc: false, compilation: false },
      submission: {},
      quarter: null,
      probability: 100,
    };
  }

  // -> [{cc, role, strengths}], the shape VCLCALC.computeFees expects. Mirrors
  // vcl-workflow.js:124-135 (procCountries), fixed at strengths=1 (no per-line strength UI in
  // the MVP — see spec).
  function lineCountries(line) {
    var p = (line && line.procedure) || {};
    if (p.kind === "national") return p.nat ? [{ cc: p.nat, role: "national", strengths: 1 }] : [];
    if (p.kind === "cp") return p.ema ? [{ cc: p.ema, role: "EMA", strengths: 1 }] : [];
    if (p.kind === "mrpdcp") {
      var out = [];
      if (p.rms) out.push({ cc: p.rms, role: "RMS", strengths: 1 });
      (p.cms || []).forEach(function (cc) { out.push({ cc: cc, role: "CMS", strengths: 1 }); });
      return out;
    }
    return [];
  }

  // -> the sel shape VCL_WORKLOAD_HOURS.computeAdditiveWorkload expects. Mirrors
  // vcl-workflow.js:462-482 (raEffort), simplified: worksharing/grouping/AU/SG counts are not
  // exposed at line level in the MVP (each plan line is one standalone variation).
  function lineHoursSel(line) {
    var p = (line && line.procedure) || {};
    return {
      type: line.type,
      procedure: p.kind || "national",
      cmsCount: p.kind === "mrpdcp" ? (p.cms || []).length : 0,
      activeSubstance: line.activeSubstance || null,
      piDocs: line.piDocs || {},
      modules: line.modules || { pi: false, cmc: false, compilation: false },
      submission: line.submission || {},
    };
  }

  // engines = { computeFees, workload, workloadData } — dependency-injected so this module never
  // touches `window` itself (keeps it Node-testable). In the browser, Task 2 wires
  // computeFees: window.VCLCALC.computeFees, workload: window.VCL_WORKLOAD_HOURS,
  // workloadData: window.VCL_WORKLOAD_HD.
  function computeLineResult(line, engines) {
    engines = engines || {};
    var countries = lineCountries(line);
    var complete = !!(countries.length && line.type);

    var fee = 0, feeByCountry = [];
    if (complete && engines.computeFees && engines.workload) {
      var counts = { IA: 0, IB: 0, II: 0 };
      var bucket = engines.workload.typeBucket(line.type);
      if (bucket) counts[bucket] = 1;
      var feesResult = engines.computeFees({ countries: countries, counts: counts });
      fee = feesResult.grandTotal || 0;
      feeByCountry = (feesResult.countries || []).map(function (c) {
        return { cc: c.cc, total: c.total || 0 };
      });
    }

    var hours = { min: 0, max: 0, expected: 0 };
    if (complete && engines.workload && engines.workload.computeAdditiveWorkload && engines.workloadData) {
      var parts = engines.workload.computeAdditiveWorkload(engines.workloadData, lineHoursSel(line));
      var sections = engines.workload.composeSections(parts);
      hours = {
        min: sections.total.min,
        max: sections.total.max,
        expected: engines.workload.pertExpected(sections.total.min, sections.total.max),
      };
    }

    return { fee: fee, feeByCountry: feeByCountry, hours: hours, complete: complete };
  }

  function sortDesc(map) {
    return Object.keys(map)
      .map(function (k) { return { key: k, value: map[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // resultsById: { [line.id]: computeLineResult(...) }, precomputed by the caller (Task 4) so
  // this stays pure and doesn't need the engines itself.
  function computeRollup(lines, resultsById) {
    var totals = { fee: 0, hoursMin: 0, hoursMax: 0, hoursExpected: 0 };
    var byMarket = {}, byProduct = {};
    (lines || []).forEach(function (line) {
      var r = resultsById[line.id];
      if (!r) return;
      totals.fee += r.fee;
      totals.hoursMin += r.hours.min;
      totals.hoursMax += r.hours.max;
      totals.hoursExpected += r.hours.expected;
      var product = line.product || "(unnamed product)";
      byProduct[product] = (byProduct[product] || 0) + r.fee;
      r.feeByCountry.forEach(function (c) {
        byMarket[c.cc] = (byMarket[c.cc] || 0) + c.total;
      });
    });
    return { totals: totals, byMarket: sortDesc(byMarket), byProduct: sortDesc(byProduct) };
  }

  function computeFte(totalHours, hoursPerHead) {
    if (!hoursPerHead || hoursPerHead <= 0) return 0;
    return totalHours / hoursPerHead;
  }

  // entries: window.VCL_DATA.ENTRIES shape ({code, title, keywords[]}). Capped to 20 so the
  // dropdown in Task 5 stays short.
  function searchEntries(entries, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    return (entries || []).filter(function (e) {
      if ((e.code || "").toLowerCase().indexOf(q) !== -1) return true;
      if ((e.title || "").toLowerCase().indexOf(q) !== -1) return true;
      return (e.keywords || []).some(function (k) { return k.toLowerCase().indexOf(q) !== -1; });
    }).slice(0, 20);
  }

  function defaultPlan() { return { version: 1, hoursPerHead: 1500, lines: [] }; }

  function loadPlan(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return defaultPlan();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.lines)) return defaultPlan();
      return parsed;
    } catch (e) {
      return defaultPlan();
    }
  }

  function savePlan(storage, plan) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(plan));
      return true;
    } catch (e) {
      return false;
    }
  }

  var api = {
    newLine: newLine,
    lineCountries: lineCountries,
    lineHoursSel: lineHoursSel,
    computeLineResult: computeLineResult,
    computeRollup: computeRollup,
    computeFte: computeFte,
    searchEntries: searchEntries,
    defaultPlan: defaultPlan,
    loadPlan: loadPlan,
    savePlan: savePlan,
    STORAGE_KEY: STORAGE_KEY,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_BUDGET_ENGINE = api;
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/test-budget-engine.js`
Expected: `All tests passed.` (exit code 0)

- [ ] **Step 5: Commit**

```bash
git add test/test-budget-engine.js "variation-fee-calculator/assets/js/vcl-budget-engine.js"
git commit -m "feat: add pure budget-planning engine (adapters, rollup, FTE, search, persistence)"
```

---

### Task 2: Styled DOM shell + dev harness (first visible preview)

Renders the tool against a small hardcoded demo plan (not yet the real persisted plan — that's
Task 4) so the full pipe (engine → rollup → styled DOM) is visible and screenshot-able as early
as possible. "New line" / row actions are inert placeholders in this task; Task 4/5 wire them up.

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-budget.js`
- Create: `variation-fee-calculator/assets/css/vcl-budget-style.css`
- Create: `test/manual/budget-harness.html`

**Interfaces:**
- Consumes: `window.VCL_BUDGET_ENGINE.{computeLineResult, computeRollup, computeFte}` (Task 1).
- Produces: `window.VCL_BUDGET = { render(col) }` (consumed by Task 3's WordPress wiring and by
  the harness). Internal `state` (module-local) gains `lines`, `hoursPerHead`, `resultsById` —
  documented here since Task 4/5 extend them:
  ```js
  state = {
    lines: [ /* line objects, shape from VCL_BUDGET_ENGINE.newLine() */ ],
    hoursPerHead: 1500,
    resultsById: { /* [line.id]: computeLineResult(...) output, recomputed on every change */ },
  }
  ```

- [ ] **Step 1: Write the stylesheet**

Create `variation-fee-calculator/assets/css/vcl-budget-style.css` (adapted from the
brainstorming mockup approved by the user; class prefix `.vcl-bud-*`; identity colour reuses the
burgundy freed by the standalone Workload tool's removal earlier today, renamed so the token
isn't tied to that retired tool's name):

```css
/* ============================================================================
 * Budget Planning -- styles for the "Budget Planning" view of the Variation
 * Toolbox. Own local class namespace (.vcl-bud-*), following the same
 * precedent as the other per-view stylesheets (.vcl-wf-*, .vcl-tt-*, .vcl-wl-*).
 * ============================================================================ */

.vcl-app {
  /* Reuses the hex value freed by today's standalone-Workload-tool removal
     (was --workload in vcl-workload-style.css) under a name that matches this
     tool instead -- no new colour added to the palette. */
  --budget: #7A3350;
  --budget-bg: #F5E9EE;
  --budget-tint: rgba(122, 51, 80, 0.06);
}

.vcl-app .budget-col { grid-column: 2; grid-row: 1; padding: 28px 6px 40px 0; }

.vcl-app .vcl-bud-header {
  padding: 0 0 20px; margin-bottom: 24px; border-bottom: 1px solid var(--border);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap;
}
.vcl-app .vcl-bud-header h2 { font-family: "IBM Plex Serif", serif; font-weight: 600; font-size: 22px; margin: 0 0 6px; }
.vcl-app .vcl-bud-header p { margin: 0; color: var(--muted); font-size: 14px; }
.vcl-app .vcl-bud-header__actions { display: flex; align-items: center; gap: 10px; flex: none; }

.vcl-app .vcl-bud-btn {
  font-family: inherit; font-size: 13.5px; font-weight: 600; padding: 9px 16px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--panel); color: var(--ink); cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px;
}
.vcl-app .vcl-bud-btn:hover { border-color: var(--budget); }
.vcl-app .vcl-bud-btn--primary { background: var(--budget); border-color: var(--budget); color: #fff; }
.vcl-app .vcl-bud-btn--primary:hover { background: #612941; }
.vcl-app .vcl-bud-btn--ghost { border-color: transparent; background: transparent; padding: 9px 10px; }
.vcl-app .vcl-bud-btn--ghost:hover { background: var(--border-soft); border-color: transparent; }
.vcl-app .vcl-bud-btn--small { font-size: 12px; padding: 6px 10px; }
.vcl-app .vcl-bud-btn--danger:hover { border-color: var(--ii); color: var(--ii); }

.vcl-app .vcl-bud-rollup { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px; }
.vcl-app .vcl-bud-tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.vcl-app .vcl-bud-tile__label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; margin: 0 0 8px; }
.vcl-app .vcl-bud-tile__value { font-family: "IBM Plex Serif", serif; font-size: 27px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 0; line-height: 1.15; }
.vcl-app .vcl-bud-tile__sub { font-size: 12.5px; color: var(--muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
.vcl-app .vcl-bud-tile--fte .vcl-bud-tile__value { color: var(--budget); }
.vcl-app .vcl-bud-fte-input { width: 62px; font-family: "IBM Plex Mono", monospace; font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 5px; background: var(--paper); color: var(--ink); font-variant-numeric: tabular-nums; }

.vcl-app .vcl-bud-breakdown { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 26px; }
.vcl-app .vcl-bud-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px 12px; }
.vcl-app .vcl-bud-panel h3 { font-size: 13px; margin: 0 0 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.vcl-app .vcl-bud-bdrow { display: grid; grid-template-columns: 90px 1fr 64px; align-items: center; gap: 10px; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--border-soft); }
.vcl-app .vcl-bud-bdrow:last-child { border-bottom: none; }
.vcl-app .vcl-bud-bdbar { height: 7px; border-radius: 4px; background: var(--border-soft); overflow: hidden; }
.vcl-app .vcl-bud-bdbar > span { display: block; height: 100%; background: var(--budget); border-radius: 4px; }
.vcl-app .vcl-bud-bdval { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }

.vcl-app .vcl-bud-table-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.vcl-app .vcl-bud-table-head h3 { font-size: 15px; margin: 0; font-weight: 600; font-family: "IBM Plex Serif", serif; }
.vcl-app .vcl-bud-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
.vcl-app table.vcl-bud-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 880px; }
.vcl-app table.vcl-bud-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; padding: 10px 12px; background: var(--border-soft); white-space: nowrap; }
.vcl-app table.vcl-bud-table td { padding: 10px 12px; border-top: 1px solid var(--border-soft); vertical-align: middle; }
.vcl-app table.vcl-bud-table tbody tr:hover { background: var(--budget-tint); }
.vcl-app .vcl-bud-cc-chip { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 10.5px; padding: 1px 5px; border-radius: 4px; background: var(--border-soft); color: var(--muted); margin: 1px 2px 1px 0; }
.vcl-app .vcl-bud-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.vcl-app .vcl-bud-hours-band { color: var(--ink-faint); font-size: 11.5px; }
.vcl-app .vcl-bud-row-actions { display: flex; gap: 2px; white-space: nowrap; }
.vcl-app .vcl-bud-warn { display: inline-flex; align-items: center; gap: 5px; color: var(--ib); font-size: 12px; font-weight: 600; }
.vcl-app .vcl-bud-warn::before { content: "!"; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; background: var(--ib-bg); font-size: 10px; }
.vcl-app .vcl-bud-table tfoot td { padding: 11px 12px; font-weight: 600; border-top: 2px solid var(--border); background: var(--border-soft); font-variant-numeric: tabular-nums; }

.vcl-app .vcl-bud-modal-overlay { position: fixed; inset: 0; background: rgba(20,25,32,.42); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 50; }
.vcl-app .vcl-bud-modal { width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; background: var(--panel); border-radius: 14px; padding: 24px 26px 22px; box-shadow: 0 12px 40px rgba(10,15,25,.28); }
.vcl-app .vcl-bud-modal__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.vcl-app .vcl-bud-modal__head h2 { font-family: "IBM Plex Serif", serif; font-size: 18px; margin: 0; font-weight: 600; }
.vcl-app .vcl-bud-modal__sub { font-size: 12.5px; color: var(--muted); margin: 0 0 18px; }
.vcl-app .vcl-bud-field { margin-bottom: 14px; }
.vcl-app .vcl-bud-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.vcl-app .vcl-bud-field-label { display: block; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 5px; }
.vcl-app .vcl-bud-input, .vcl-app .vcl-bud-select { width: 100%; font-family: inherit; font-size: 13.5px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--paper); color: var(--ink); }
.vcl-app .vcl-bud-input:focus, .vcl-app .vcl-bud-select:focus { outline: none; border-color: var(--budget); }
.vcl-app .vcl-bud-cc-checks { display: flex; flex-wrap: wrap; gap: 6px; border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px; background: var(--paper); }
.vcl-app .vcl-bud-cc-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; padding: 4px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--border-soft); font-family: "IBM Plex Mono", monospace; cursor: pointer; }
.vcl-app .vcl-bud-cc-check input { accent-color: var(--budget); }
.vcl-app .vcl-bud-type-badge { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 5px; cursor: pointer; border: 1px solid transparent; }
.vcl-app .vcl-bud-type-badge--ia { color: var(--ia); background: var(--ia-bg); }
.vcl-app .vcl-bud-type-badge--ib { color: var(--ib); background: var(--ib-bg); }
.vcl-app .vcl-bud-type-badge--ii { color: var(--ii); background: var(--ii-bg); }
.vcl-app .vcl-bud-type-badge.is-active { border-color: currentColor; }
.vcl-app .vcl-bud-search-results { border: 1px solid var(--border); border-radius: 7px; margin-top: 4px; max-height: 180px; overflow-y: auto; background: var(--panel); }
.vcl-app .vcl-bud-search-result { display: block; width: 100%; text-align: left; padding: 8px 10px; font-size: 12.5px; border: none; background: none; cursor: pointer; border-bottom: 1px solid var(--border-soft); }
.vcl-app .vcl-bud-search-result:hover { background: var(--budget-tint); }
.vcl-app .vcl-bud-live-result { margin-top: 18px; border-top: 1px dashed var(--border); padding-top: 14px; display: flex; justify-content: space-between; align-items: baseline; }
.vcl-app .vcl-bud-live-result .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.vcl-app .vcl-bud-live-result .val { font-family: "IBM Plex Serif", serif; font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
.vcl-app .vcl-bud-live-result .val .band { font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 400; color: var(--ink-faint); margin-left: 4px; }
.vcl-app .vcl-bud-modal__foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
```

- [ ] **Step 2: Write the view module**

Create `variation-fee-calculator/assets/js/vcl-budget.js`:

```js
// Budget Planning -- the Variation Toolbox's portfolio-wide annual plan. Self-contained like the
// Guided Workflow: vcl-app.js only wires the nav button and calls window.VCL_BUDGET.render(col);
// everything below manages its own state and rerender. Uses window.VCL_BUDGET_ENGINE for all
// pricing/hours/rollup math (no logic duplicated here) and the shared VCLCALC / VCL_WORKLOAD_HOURS
// engines for the actual computation.
(function () {
  "use strict";

  var BUD = window.VCL_BUDGET_ENGINE;
  var DATA = window.VCL_DATA || {};
  var ENTRIES = DATA.ENTRIES || [];

  function engines() {
    return {
      computeFees: window.VCLCALC && window.VCLCALC.computeFees,
      workload: window.VCL_WORKLOAD_HOURS,
      workloadData: window.VCL_WORKLOAD_HD,
    };
  }

  // Demo seed so the very first render (before Task 4 wires localStorage) shows real, styled
  // numbers instead of an empty shell. Replaced by the persisted plan in Task 4.
  function demoLines() {
    var l1 = BUD.newLine("demo-1");
    l1.product = "Product A"; l1.type = "IB";
    l1.procedure = { kind: "mrpdcp", rms: "DE", cms: ["FR", "ES"] };
    l1.quarter = "Q2";
    var l2 = BUD.newLine("demo-2");
    l2.product = "Product B"; l2.type = "IA";
    l2.procedure = { kind: "national", nat: "DE" };
    l2.quarter = "Q1";
    return [l1, l2];
  }

  var state = { lines: demoLines(), hoursPerHead: 1500, resultsById: {} };
  var container = null;

  function recomputeResults() {
    var eng = engines();
    state.resultsById = {};
    state.lines.forEach(function (line) {
      state.resultsById[line.id] = BUD.computeLineResult(line, eng);
    });
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtEUR(v) {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
  }

  function renderRollupTiles(rollup) {
    var wrap = el("div", "vcl-bud-rollup");
    var feeTile = el("div", "vcl-bud-tile");
    feeTile.appendChild(el("p", "vcl-bud-tile__label", "Annual fees"));
    feeTile.appendChild(el("p", "vcl-bud-tile__value", escapeHtml(fmtEUR(rollup.totals.fee))));
    feeTile.appendChild(el("p", "vcl-bud-tile__sub", state.lines.length + " plan lines"));
    wrap.appendChild(feeTile);

    var hoursTile = el("div", "vcl-bud-tile");
    hoursTile.appendChild(el("p", "vcl-bud-tile__label", "Annual RA hours"));
    hoursTile.appendChild(el("p", "vcl-bud-tile__value", Math.round(rollup.totals.hoursExpected) + " h"));
    hoursTile.appendChild(el("p", "vcl-bud-tile__sub",
      "Range " + Math.round(rollup.totals.hoursMin) + "–" + Math.round(rollup.totals.hoursMax) + " h (min–max)"));
    wrap.appendChild(hoursTile);

    var fte = BUD.computeFte(rollup.totals.hoursExpected, state.hoursPerHead);
    var fteTile = el("div", "vcl-bud-tile vcl-bud-tile--fte");
    fteTile.appendChild(el("p", "vcl-bud-tile__label", "FTE required"));
    fteTile.appendChild(el("p", "vcl-bud-tile__value", fte.toFixed(2) + " FTE"));
    var sub = el("p", "vcl-bud-tile__sub");
    sub.appendChild(document.createTextNode("at "));
    var fteInput = el("input", "vcl-bud-fte-input");
    fteInput.type = "text";
    fteInput.value = String(state.hoursPerHead);
    fteInput.addEventListener("change", function () {
      var v = parseInt(fteInput.value, 10);
      state.hoursPerHead = (v > 0) ? v : state.hoursPerHead;
      rerender();
    });
    sub.appendChild(fteInput);
    sub.appendChild(document.createTextNode(" h / head / year"));
    fteTile.appendChild(sub);
    wrap.appendChild(fteTile);
    return wrap;
  }

  function renderBreakdownPanel(title, rows, total) {
    var panel = el("div", "vcl-bud-panel");
    panel.appendChild(el("h3", null, escapeHtml(title)));
    rows.slice(0, 6).forEach(function (row) {
      var r = el("div", "vcl-bud-bdrow");
      r.appendChild(el("span", null, escapeHtml(row.key)));
      var bar = el("span", "vcl-bud-bdbar");
      var fill = el("span");
      fill.style.width = (total ? Math.round((row.value / total) * 100) : 0) + "%";
      bar.appendChild(fill);
      r.appendChild(bar);
      r.appendChild(el("span", "vcl-bud-bdval", escapeHtml(fmtEUR(row.value))));
      panel.appendChild(r);
    });
    return panel;
  }

  function renderTable() {
    var wrap = el("div");
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines"));
    head.appendChild(el("span", null, state.lines.length + " lines"));
    wrap.appendChild(head);

    var tableWrap = el("div", "vcl-bud-table-wrap");
    var table = el("table", "vcl-bud-table");
    table.innerHTML =
      "<thead><tr><th>Product</th><th>Variation</th><th>Type</th><th>Procedure</th>" +
      "<th>Countries</th><th>Quarter</th><th style=\"text-align:right\">Fee</th>" +
      "<th style=\"text-align:right\">Hours (PERT)</th><th></th></tr></thead>";
    var tbody = el("tbody");
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var tr = el("tr");
      var procLabel = line.procedure.kind === "mrpdcp"
        ? "MRP/DCP" + (line.procedure.rms ? " · RMS " + line.procedure.rms : "")
        : (line.procedure.kind === "cp" ? "CP" : "National");
      var ccChips = BUD.lineCountries(line).map(function (c) {
        return '<span class="vcl-bud-cc-chip">' + escapeHtml(c.cc) + "</span>";
      }).join("");
      var typeBadge = line.type
        ? '<span class="vcl-bud-type-badge vcl-bud-type-badge--' + line.type.toLowerCase() + '">' + escapeHtml(line.type) + "</span>"
        : "—";
      var feeCell = r.complete
        ? '<td class="vcl-bud-num">' + escapeHtml(fmtEUR(r.fee)) + "</td>"
        : '<td class="vcl-bud-num"><span class="vcl-bud-warn">Countries incomplete</span></td>';
      var hoursCell = r.complete
        ? '<td class="vcl-bud-num">' + Math.round(r.hours.expected) + ' h<div class="vcl-bud-hours-band">' +
          Math.round(r.hours.min) + "–" + Math.round(r.hours.max) + "</div></td>"
        : '<td class="vcl-bud-num">—</td>';
      tr.innerHTML =
        "<td>" + escapeHtml(line.product || "—") + "</td>" +
        "<td>" + escapeHtml(line.variationLabel || "—") + "</td>" +
        "<td>" + typeBadge + "</td>" +
        "<td class=\"mono\">" + escapeHtml(procLabel) + "</td>" +
        "<td>" + ccChips + "</td>" +
        "<td>" + escapeHtml(line.quarter || "—") + "</td>" +
        feeCell + hoursCell +
        '<td class="vcl-bud-row-actions">' +
        '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small" data-act="duplicate" title="Duplicate">⧉</button>' +
        '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small" data-act="edit" title="Edit">✎</button>' +
        '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small vcl-bud-btn--danger" data-act="delete" title="Delete">✕</button>' +
        "</td>";
      tr.dataset.lineId = line.id;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
    return wrap;
  }

  function rerender() {
    if (!container) return;
    recomputeResults();
    var rollup = BUD.computeRollup(state.lines, state.resultsById);

    container.innerHTML = "";
    var header = el("div", "vcl-bud-header");
    var left = el("div");
    left.appendChild(el("h2", null, "Budget Planning"));
    left.appendChild(el("p", null, "Portfolio-wide annual plan: fees &amp; RA effort across all products and markets."));
    header.appendChild(left);
    var actions = el("div", "vcl-bud-header__actions");
    actions.innerHTML =
      '<button type="button" class="vcl-bud-btn" data-act="export">⭳ Export to Excel</button>' +
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--primary" data-act="new-line">+ New line</button>';
    header.appendChild(actions);
    container.appendChild(header);

    container.appendChild(renderRollupTiles(rollup));

    var breakdown = el("div", "vcl-bud-breakdown");
    breakdown.appendChild(renderBreakdownPanel("By market", rollup.byMarket, rollup.totals.fee));
    breakdown.appendChild(renderBreakdownPanel("By product", rollup.byProduct, rollup.totals.fee));
    container.appendChild(breakdown);

    container.appendChild(renderTable());
  }

  window.VCL_BUDGET = {
    render: function (col) {
      container = col;
      rerender();
    },
  };
})();
```

- [ ] **Step 3: Write the dev harness**

Create `test/manual/budget-harness.html` (dev-only — replicates the real plugin's exact markup
for the pieces `vcl-calc-app.js` needs at load time, so the real fee engine runs unmodified; not
listed in `build_zip.py` and never shipped):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Budget Planning — dev harness</title>
<link rel="stylesheet" href="../../variation-fee-calculator/assets/css/vcl-style.css" />
<link rel="stylesheet" href="../../variation-fee-calculator/assets/css/vcl-calc-style.css" />
<link rel="stylesheet" href="../../variation-fee-calculator/assets/css/vcl-budget-style.css" />
<style>
  body { margin: 0; padding: 24px; background: #EFEFEC; font-family: -apple-system, sans-serif; }
  .vclcalc-app { display: none; } /* real calculator markup kept only so vcl-calc-app.js has its DOM hooks */
</style>
</head>
<body>
  <div class="vcl-app">
    <div class="layout">
      <div class="budget-col" id="vcl-budgetCol"></div>
      <div class="vclcalc-app" id="vclcalc-app">
        <div class="rail" id="vclcalc-rail"></div>
        <div id="vclcalc-stepContent"></div>
        <div class="src"><div class="fx-status-row"><span id="vclcalc-fxStatus"></span></div></div>
      </div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-data.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-calc-data.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-calc-app.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-workload-hours-data.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-workload-hours.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-budget-engine.js"></script>
  <script src="../../variation-fee-calculator/assets/js/vcl-budget.js"></script>
  <script>
    window.VCL_BUDGET.render(document.getElementById("vcl-budgetCol"));
  </script>
</body>
</html>
```

- [ ] **Step 4: Verify in the browser**

Open `test/manual/budget-harness.html` in the Claude Browser pane (`preview_start` with the file
path). Check `read_console_messages` for errors, `read_page` to confirm the header, three rollup
tiles (with non-zero € and hours from the two demo lines), two breakdown panels, and a two-row
table all render. Screenshot as proof.

- [ ] **Step 5: Commit**

```bash
git add "variation-fee-calculator/assets/js/vcl-budget.js" \
  "variation-fee-calculator/assets/css/vcl-budget-style.css" \
  test/manual/budget-harness.html
git commit -m "feat: add Budget Planning view shell with dev harness"
```

---

### Task 3: Wire into the WordPress plugin

Makes the tool reachable from the real `[variation_classification_lookup]` shortcode, alongside
the other five views — no behaviour change to any of them.

**Files:**
- Modify: `variation-fee-calculator/includes/lookup.php`
- Modify: `variation-fee-calculator/assets/js/vcl-app.js`
- Modify: `variation-fee-calculator/build_zip.py`

**Interfaces:**
- Consumes: `window.VCL_BUDGET.render(col)` (Task 2).
- Produces: nothing new for later tasks — this is purely wiring.

- [ ] **Step 1: Register and enqueue the new assets**

In `variation-fee-calculator/includes/lookup.php`, right after the `vcl-workflow` registration
block (after line 193, before the `vclcalc-xlsx` registration), add:

```php
	$budget_engine_file = VFC_PLUGIN_DIR . 'assets/js/vcl-budget-engine.js';
	$budget_engine_ver  = file_exists( $budget_engine_file ) ? filemtime( $budget_engine_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-budget-engine',
		VFC_PLUGIN_URL . 'assets/js/vcl-budget-engine.js',
		array(),
		$budget_engine_ver,
		true
	);

	$budget_app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-budget.js';
	$budget_app_ver  = file_exists( $budget_app_file ) ? filemtime( $budget_app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-budget',
		VFC_PLUGIN_URL . 'assets/js/vcl-budget.js',
		array( 'vcl-data', 'vcl-calc-app', 'vcl-workload-hours', 'vcl-workload-hours-data', 'vcl-budget-engine' ),
		$budget_app_ver,
		true
	);

	$budget_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-budget-style.css';
	$budget_style_ver  = file_exists( $budget_style_file ) ? filemtime( $budget_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-budget-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-budget-style.css',
		array( 'vcl-style' ),
		$budget_style_ver
	);
```

- [ ] **Step 2: Enqueue in the shortcode**

In the same file, in `vcl_shortcode()`, right after `wp_enqueue_style( 'vcl-calc-style' );`
(around line 257), add:

```php
	wp_enqueue_style( 'vcl-budget-style' );
```

And right after `wp_enqueue_script( 'vcl-calc-app' );` (around line 261), add:

```php
	wp_enqueue_script( 'vcl-budget-engine' );
	wp_enqueue_script( 'vcl-budget' );
```

- [ ] **Step 3: Add the column div and auto-render**

In the same file, right after the `vcl-workflowCol` div (after line 357), add:

```php
		<div class="budget-col hidden" id="vcl-budgetCol"></div>
```

`vcl-budget.js` (Task 2) does not render itself automatically in the plugin context — it only
renders when `vcl-app.js` calls `VCL_BUDGET.render(el.budgetCol)`, same as `VCL_WORKFLOW`. Step 4
below adds that call.

- [ ] **Step 4: Add the nav tile, tab, and view dispatch**

In `variation-fee-calculator/assets/js/vcl-app.js`:

1. Add the column reference next to `workflowCol` (line 138):

```js
    budgetCol: document.getElementById("vcl-budgetCol"),
```

2. Add the visibility flag and toggle next to the `isWorkflow`/`workflowCol` block (lines 196, 205):

```js
    const isBudget = state.view === "budget";
```

  and extend the `el.detailCol` hidden-toggle condition (line 198) to include `|| isBudget`, and
  add:

```js
    if (el.budgetCol) el.budgetCol.classList.toggle("hidden", !isBudget);
```

3. Add a "Budget Planning" tab in `renderBrowse()`, right after the Guided Workflow tab block
   (after line 2041, i.e. after `el.browseTree.appendChild(workflowDivider);`):

```js
    const budgetBtn = document.createElement("button");
    budgetBtn.type = "button";
    budgetBtn.className = "tab" + (state.view === "budget" ? " tab--active" : "");
    budgetBtn.style.setProperty("--accent", "var(--budget)");
    budgetBtn.style.setProperty("--tint", "var(--budget-tint)");
    budgetBtn.style.setProperty("--tab-bg", "var(--budget-bg)");
    budgetBtn.innerHTML = `
      <span class="tab__code">Budget Planning</span>
      <span class="tab__title">Plan next year's fees and RA effort across your portfolio.</span>
    `;
    budgetBtn.addEventListener("click", () => {
      state.view = "budget";
      state.classifyOpen = false;
      state.guidanceOpen = false;
      renderBrowse();
      switchViewVisibility();
      if (window.VCL_BUDGET) window.VCL_BUDGET.render(el.budgetCol);
      jumpToTop();
    });
    el.browseTree.appendChild(budgetBtn);
    const budgetDivider = document.createElement("div");
    budgetDivider.className = "tabs-divider tabs-divider--flush";
    el.browseTree.appendChild(budgetDivider);
```

4. Add the overview card in `OVERVIEW_DESTINATIONS` (line 3222), right after the `workflow` entry:

```js
    { dest: "budget", label: "Budget Planning", color: "var(--budget)", desc: "Plan next year's fees and RA effort across your portfolio." },
```

5. Add the overview-card dispatch branch, right after the `dest === "workflow"` branch (line 3206):

```js
    else if (dest === "budget") { state.view = "budget"; if (window.VCL_BUDGET) window.VCL_BUDGET.render(el.budgetCol); }
```

- [ ] **Step 5: Add the two new files to the build**

In `variation-fee-calculator/build_zip.py`, in the `FILES` list, right after
`"assets/js/vcl-workload-hours-data.js",` (line 43), add:

```python
    "assets/js/vcl-budget-engine.js",
    "assets/js/vcl-budget.js",
    "assets/css/vcl-budget-style.css",
```

- [ ] **Step 6: Verify the build script accepts the new files**

Run: `python build_zip.py`
Expected: builds successfully, no "unlisted files" error, file count increases by 3 vs. the
previous build.

- [ ] **Step 7: Commit**

```bash
git add "variation-fee-calculator/includes/lookup.php" \
  "variation-fee-calculator/assets/js/vcl-app.js" build_zip.py
git commit -m "feat: wire Budget Planning into the plugin (nav tile, tab, enqueue)"
```

---

### Task 4: Real persistence, FTE input, duplicate/delete

Replaces Task 2's hardcoded demo plan with the actual persisted plan, and makes duplicate/delete
work. "New line" and row "Edit" remain inert until Task 5 adds the modal.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`

**Interfaces:**
- Consumes: `VCL_BUDGET_ENGINE.{loadPlan, savePlan, defaultPlan}` (Task 1).
- Produces: `saveState()` (module-local, called after every mutation) — Task 5's modal Apply/
  Cancel handlers call this too.

- [ ] **Step 1: Replace the demo seed with persisted load, add save-on-change**

In `vcl-budget.js`, replace:

```js
  var state = { lines: demoLines(), hoursPerHead: 1500, resultsById: {} };
  var container = null;
```

with:

```js
  var plan = BUD.loadPlan(window.localStorage);
  var state = { lines: plan.lines, hoursPerHead: plan.hoursPerHead, resultsById: {}, storageOk: true };
  var container = null;

  function saveState() {
    var ok = BUD.savePlan(window.localStorage, { version: 1, hoursPerHead: state.hoursPerHead, lines: state.lines });
    if (!ok && state.storageOk) { state.storageOk = false; rerender(); }
    else if (ok && !state.storageOk) { state.storageOk = true; }
  }
```

Delete the now-unused `demoLines()` function.

- [ ] **Step 2: Show the storage-failure banner**

In `rerender()`, right after `container.innerHTML = "";`, add:

```js
    if (!state.storageOk) {
      container.appendChild(el("div", "vcl-bud-warn", "Your plan isn't being saved in this browser."));
    }
```

- [ ] **Step 3: Wire the FTE input to save**

In `renderRollupTiles`, in the `fteInput` change handler, after `state.hoursPerHead = ...;`, add:

```js
      saveState();
```

(before the existing `rerender();` call — save first, then rerender, so a rerender mid-save can't
race a stale value).

- [ ] **Step 4: Wire row actions (duplicate, delete) and the table's click delegation**

Add one delegated click handler, set up once in `render()`:

```js
  function duplicateLine(id) {
    var src = state.lines.find(function (l) { return l.id === id; });
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = "line-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    var idx = state.lines.indexOf(src);
    state.lines.splice(idx + 1, 0, copy);
    saveState();
    rerender();
  }
  function deleteLine(id) {
    state.lines = state.lines.filter(function (l) { return l.id !== id; });
    saveState();
    rerender();
  }
  function onTableClick(evt) {
    var btn = evt.target.closest("button[data-act]");
    if (!btn) return;
    var tr = btn.closest("tr[data-line-id]");
    var id = tr && tr.dataset.lineId;
    if (btn.dataset.act === "duplicate" && id) duplicateLine(id);
    if (btn.dataset.act === "delete" && id) deleteLine(id);
    // "edit" is wired in Task 5.
  }
```

In `window.VCL_BUDGET.render`, attach the delegated listener once per mount:

```js
  window.VCL_BUDGET = {
    render: function (col) {
      container = col;
      container.removeEventListener("click", onTableClick);
      container.addEventListener("click", onTableClick);
      rerender();
    },
  };
```

- [ ] **Step 5: Verify in the browser**

Reload `test/manual/budget-harness.html`. Confirm the plan now starts empty (no demo lines —
`localStorage` is empty on first load). Use the browser console to seed a line for manual
verification:

```js
javascript_tool: `
  var BUD = window.VCL_BUDGET_ENGINE;
  var l = BUD.newLine('t1'); l.product = 'Test'; l.type = 'IA';
  l.procedure = { kind: 'national', nat: 'DE' };
  window.localStorage.setItem(BUD.STORAGE_KEY, JSON.stringify({ version: 1, hoursPerHead: 1500, lines: [l] }));
  location.reload();
`
```

After reload, confirm the line appears, fee/hours are non-zero, clicking "⧉" duplicates it (now
2 rows), clicking "✕" on one removes it (back to 1 row), and reloading again keeps whatever was
last saved (persistence round-trip confirmed).

- [ ] **Step 6: Commit**

```bash
git add "variation-fee-calculator/assets/js/vcl-budget.js"
git commit -m "feat: persist the budget plan to localStorage, wire duplicate/delete"
```

---

### Task 5: Modal editor (New line / Edit)

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`

**Interfaces:**
- Consumes: `BUD.searchEntries`, `window.VCL_DATA.ENTRIES`, `window.VCLCALC.countries()`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add modal state and open/close handlers**

Add to the module-local state:

```js
  var modalState = null; // null when closed, else { editingId, draft, query, searchResults }

  function openModalFor(id) {
    var existing = id && state.lines.find(function (l) { return l.id === id; });
    modalState = {
      editingId: id || null,
      draft: existing ? JSON.parse(JSON.stringify(existing)) : BUD.newLine("line-" + Date.now() + "-" + Math.floor(Math.random() * 1000)),
      query: "",
      searchResults: [],
    };
    rerender();
  }
  function closeModal() { modalState = null; rerender(); }
  function applyModal() {
    var idx = state.lines.findIndex(function (l) { return l.id === modalState.draft.id; });
    if (idx === -1) state.lines.push(modalState.draft);
    else state.lines[idx] = modalState.draft;
    modalState = null;
    saveState();
    rerender();
  }
```

- [ ] **Step 2: Wire "New line" and row "Edit" to open the modal**

Extend `onTableClick`:

```js
    if (btn.dataset.act === "edit" && id) openModalFor(id);
```

Add a header-level delegated handler (header buttons are re-created every `rerender()`, so attach
to `container` once, like the table):

```js
  function onHeaderClick(evt) {
    var btn = evt.target.closest("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "new-line") openModalFor(null);
    if (btn.dataset.act === "export") exportExcel(); // Task 6
  }
```

Register it alongside `onTableClick` in `render()`:

```js
      container.removeEventListener("click", onHeaderClick);
      container.addEventListener("click", onHeaderClick);
```

- [ ] **Step 3: Render the modal**

Add `renderModal()` and call it from `rerender()` (append at the very end, after the table):

```js
  function countriesByRole(role) {
    var all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    return all.filter(function (c) { return c.roles.indexOf(role) !== -1; });
  }
  function findEmaCc() {
    var all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    var ema = all.find(function (c) { return c.roles.indexOf("EMA") !== -1; });
    return ema ? ema.cc : null;
  }
  function typesForEntry(entry) {
    var seen = {};
    (entry.variants || []).forEach(function (v) { if (v.type) seen[v.type] = true; });
    return Object.keys(seen);
  }

  function renderModal() {
    var d = modalState.draft;
    var overlay = el("div", "vcl-bud-modal-overlay");
    var modal = el("div", "vcl-bud-modal");

    var head = el("div", "vcl-bud-modal__head");
    head.appendChild(el("h2", null, modalState.editingId ? "Edit plan line" : "New plan line"));
    var closeBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", closeModal);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    // Product
    var productField = el("div", "vcl-bud-field");
    productField.appendChild(el("label", "vcl-bud-field-label", "Product"));
    var productInput = el("input", "vcl-bud-input");
    productInput.type = "text"; productInput.value = d.product;
    productInput.addEventListener("input", function () { d.product = productInput.value; });
    productField.appendChild(productInput);
    modal.appendChild(productField);

    // Variation search
    var varField = el("div", "vcl-bud-field");
    varField.appendChild(el("label", "vcl-bud-field-label", "Variation"));
    var varInput = el("input", "vcl-bud-input");
    varInput.type = "text";
    varInput.placeholder = "Search by code or keyword ...";
    varInput.value = modalState.query || d.variationLabel || "";
    varInput.addEventListener("input", function () {
      modalState.query = varInput.value;
      modalState.searchResults = BUD.searchEntries(ENTRIES, modalState.query);
      rerender();
    });
    varField.appendChild(varInput);
    if (modalState.searchResults.length) {
      var results = el("div", "vcl-bud-search-results");
      modalState.searchResults.forEach(function (entry) {
        var item = el("button", "vcl-bud-search-result", escapeHtml(entry.code + " — " + entry.title));
        item.type = "button";
        item.addEventListener("click", function () {
          d.variationCode = entry.code;
          d.variationLabel = entry.code + " — " + entry.title;
          var types = typesForEntry(entry);
          d.type = types[0] || d.type;
          modalState.query = "";
          modalState.searchResults = [];
          rerender();
        });
        results.appendChild(item);
      });
      varField.appendChild(results);
    }
    if (d.variationCode) {
      var typesRow = el("div");
      typesRow.style.marginTop = "8px";
      var entry = ENTRIES.find(function (e) { return e.code === d.variationCode; });
      var availableTypes = entry ? typesForEntry(entry) : ["IA", "IB", "II"];
      availableTypes.forEach(function (t) {
        var badge = el("span", "vcl-bud-type-badge vcl-bud-type-badge--" + t.toLowerCase() + (t === d.type ? " is-active" : ""), escapeHtml(t));
        badge.addEventListener("click", function () { d.type = t; rerender(); });
        typesRow.appendChild(badge);
        typesRow.appendChild(document.createTextNode(" "));
      });
      varField.appendChild(typesRow);
    }
    modal.appendChild(varField);

    // Procedure + RMS
    var procRow = el("div", "vcl-bud-field vcl-bud-field-row");
    var procCol = el("div");
    procCol.appendChild(el("label", "vcl-bud-field-label", "Procedure"));
    var procSelect = el("select", "vcl-bud-select");
    ["national", "mrpdcp", "cp"].forEach(function (kind) {
      var opt = el("option", null, kind === "mrpdcp" ? "MRP/DCP" : (kind === "cp" ? "CP" : "National"));
      opt.value = kind;
      if (d.procedure.kind === kind) opt.selected = true;
      procSelect.appendChild(opt);
    });
    procSelect.addEventListener("change", function () {
      d.procedure = { kind: procSelect.value, nat: null, rms: null, cms: [] };
      if (procSelect.value === "cp") d.procedure.ema = findEmaCc();
      rerender();
    });
    procCol.appendChild(procSelect);
    procRow.appendChild(procCol);

    if (d.procedure.kind === "mrpdcp") {
      var rmsCol = el("div");
      rmsCol.appendChild(el("label", "vcl-bud-field-label", "RMS (Reference Member State)"));
      var rmsSelect = el("select", "vcl-bud-select");
      rmsSelect.appendChild(el("option", null, "—"));
      countriesByRole("RMS").forEach(function (c) {
        var opt = el("option", null, escapeHtml(c.cc + " — " + c.name));
        opt.value = c.cc;
        if (d.procedure.rms === c.cc) opt.selected = true;
        rmsSelect.appendChild(opt);
      });
      rmsSelect.addEventListener("change", function () { d.procedure.rms = rmsSelect.value || null; rerender(); });
      rmsCol.appendChild(rmsSelect);
      procRow.appendChild(rmsCol);
    } else if (d.procedure.kind === "national") {
      var natCol = el("div");
      natCol.appendChild(el("label", "vcl-bud-field-label", "Country"));
      var natSelect = el("select", "vcl-bud-select");
      natSelect.appendChild(el("option", null, "—"));
      countriesByRole("national").forEach(function (c) {
        var opt = el("option", null, escapeHtml(c.cc + " — " + c.name));
        opt.value = c.cc;
        if (d.procedure.nat === c.cc) opt.selected = true;
        natSelect.appendChild(opt);
      });
      natSelect.addEventListener("change", function () { d.procedure.nat = natSelect.value || null; rerender(); });
      natCol.appendChild(natSelect);
      procRow.appendChild(natCol);
    }
    modal.appendChild(procRow);

    // CMS checkboxes (MRP/DCP only)
    if (d.procedure.kind === "mrpdcp") {
      var ccField = el("div", "vcl-bud-field");
      ccField.appendChild(el("label", "vcl-bud-field-label", "Countries (CMS)"));
      var checks = el("div", "vcl-bud-cc-checks");
      countriesByRole("CMS").forEach(function (c) {
        if (c.cc === d.procedure.rms) return; // RMS cannot also be a CMS
        var label = el("label", "vcl-bud-cc-check");
        var cb = el("input"); cb.type = "checkbox";
        cb.checked = d.procedure.cms.indexOf(c.cc) !== -1;
        cb.addEventListener("change", function () {
          var i = d.procedure.cms.indexOf(c.cc);
          if (cb.checked && i === -1) d.procedure.cms.push(c.cc);
          if (!cb.checked && i !== -1) d.procedure.cms.splice(i, 1);
          rerender();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + c.cc));
        checks.appendChild(label);
      });
      ccField.appendChild(checks);
      modal.appendChild(ccField);
    }

    // Quarter + Probability
    var qpRow = el("div", "vcl-bud-field vcl-bud-field-row");
    var qCol = el("div");
    qCol.appendChild(el("label", "vcl-bud-field-label", "Quarter"));
    var qSelect = el("select", "vcl-bud-select");
    ["Q1", "Q2", "Q3", "Q4"].forEach(function (q) {
      var opt = el("option", null, q); opt.value = q;
      if (d.quarter === q) opt.selected = true;
      qSelect.appendChild(opt);
    });
    qSelect.addEventListener("change", function () { d.quarter = qSelect.value; });
    qCol.appendChild(qSelect);
    qpRow.appendChild(qCol);

    var pCol = el("div");
    pCol.appendChild(el("label", "vcl-bud-field-label", "Probability"));
    var pSelect = el("select", "vcl-bud-select");
    [100, 75, 50, 25].forEach(function (p) {
      var opt = el("option", null, p + "%" + (p === 100 ? " (firm)" : "")); opt.value = String(p);
      if (d.probability === p) opt.selected = true;
      pSelect.appendChild(opt);
    });
    pSelect.addEventListener("change", function () { d.probability = parseInt(pSelect.value, 10); });
    pCol.appendChild(pSelect);
    qpRow.appendChild(pCol);
    modal.appendChild(qpRow);

    // Live preview
    var preview = BUD.computeLineResult(d, engines());
    var liveResult = el("div", "vcl-bud-live-result");
    var feeItem = el("div");
    feeItem.innerHTML = '<div class="lbl">Fee</div><div class="val">' + escapeHtml(fmtEUR(preview.fee)) + "</div>";
    liveResult.appendChild(feeItem);
    var hoursItem = el("div");
    hoursItem.innerHTML = '<div class="lbl">RA hours</div><div class="val">' + Math.round(preview.hours.expected) +
      ' h <span class="band">' + Math.round(preview.hours.min) + "–" + Math.round(preview.hours.max) + "</span></div>";
    liveResult.appendChild(hoursItem);
    modal.appendChild(liveResult);

    // Footer
    var foot = el("div", "vcl-bud-modal__foot");
    var cancelBtn = el("button", "vcl-bud-btn", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", closeModal);
    var applyBtn = el("button", "vcl-bud-btn vcl-bud-btn--primary", "Apply");
    applyBtn.type = "button";
    applyBtn.addEventListener("click", applyModal);
    foot.appendChild(cancelBtn);
    foot.appendChild(applyBtn);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    return overlay;
  }
```

At the end of `rerender()`, add:

```js
    if (modalState) container.appendChild(renderModal());
```

- [ ] **Step 4: Verify in the browser**

Reload the harness. Click "+ New line": modal opens. Type "invented name" in the Variation field
→ a search result appears (from the real `VCL_DATA.ENTRIES`); click it → type badges appear,
click "IB" → live preview updates. Pick Procedure "MRP/DCP", pick an RMS, tick two CMS boxes →
live preview fee/hours change. Click "Apply" → modal closes, the new row appears in the table
with correct fee/hours matching the preview. Click "✎" on a row → modal reopens pre-filled with
that line's data. Click "Cancel" → no change. Screenshot as proof.

- [ ] **Step 5: Commit**

```bash
git add "variation-fee-calculator/assets/js/vcl-budget.js"
git commit -m "feat: add the plan-line editor modal (variation search, RMS/CMS, live preview)"
```

---

### Task 6: Excel export + final acceptance pass

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`

**Interfaces:**
- Consumes: `window.XLSX` (already loaded via the `vclcalc-xlsx` script, enqueued transitively
  through `vcl-calc-app`).
- Produces: nothing further — this is the last task.

- [ ] **Step 1: Implement `exportExcel()`**

Add to `vcl-budget.js` (referenced by `onHeaderClick`'s `data-act="export"` from Task 5):

```js
  function exportExcel() {
    if (typeof XLSX === "undefined") {
      alert("Excel export library not loaded. Please check your internet connection and try again.");
      return;
    }
    var rollup = BUD.computeRollup(state.lines, state.resultsById);

    var wb = XLSX.utils.book_new();

    var linesRows = [["Product", "Variation", "Type", "Procedure", "Countries", "Quarter", "Probability", "Fee (EUR)", "Hours (min)", "Hours (max)", "Hours (expected)"]];
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var procLabel = line.procedure.kind === "mrpdcp" ? "MRP/DCP" : (line.procedure.kind === "cp" ? "CP" : "National");
      var ccs = BUD.lineCountries(line).map(function (c) { return c.cc; }).join(", ");
      linesRows.push([
        line.product || "", line.variationLabel || "", line.type || "", procLabel, ccs,
        line.quarter || "", line.probability, r.fee,
        Math.round(r.hours.min), Math.round(r.hours.max), Math.round(r.hours.expected),
      ]);
    });
    var wsLines = XLSX.utils.aoa_to_sheet(linesRows);
    XLSX.utils.book_append_sheet(wb, wsLines, "Plan lines");

    var rollupRows = [
      ["Annual fees (EUR)", rollup.totals.fee],
      ["Annual RA hours (expected)", Math.round(rollup.totals.hoursExpected)],
      ["Annual RA hours (min)", Math.round(rollup.totals.hoursMin)],
      ["Annual RA hours (max)", Math.round(rollup.totals.hoursMax)],
      ["FTE required", BUD.computeFte(rollup.totals.hoursExpected, state.hoursPerHead).toFixed(2)],
      ["Hours per head per year", state.hoursPerHead],
      [], ["By market", "Fee (EUR)"],
    ].concat(rollup.byMarket.map(function (r) { return [r.key, r.value]; }))
     .concat([[], ["By product", "Fee (EUR)"]])
     .concat(rollup.byProduct.map(function (r) { return [r.key, r.value]; }));
    var wsRollup = XLSX.utils.aoa_to_sheet(rollupRows);
    XLSX.utils.book_append_sheet(wb, wsRollup, "Rollup");

    var dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, "budget-plan-" + dateStr + ".xlsx");
  }
```

- [ ] **Step 2: Verify in the browser**

Reload the harness with at least 2 plan lines present. Click "⭳ Export to Excel". Check
`read_network_requests` / the browser's download list for `budget-plan-<date>.xlsx`. If a file
download can be inspected, confirm it has two sheets ("Plan lines", "Rollup") with the expected
columns.

- [ ] **Step 3: Full manual acceptance pass**

Per the spec's "Done when": in the harness, create ~5 lines across 2 products and 3 markets
(mixing National and MRP/DCP procedures, at least one incomplete line with no countries picked).
Confirm:
- Rollup tiles, by-market, and by-product all match hand-computed sums of the table's own rows.
- The incomplete line shows the "Countries incomplete" chip, doesn't crash, and doesn't pollute
  the rollup with wrong numbers.
- Reloading the page keeps the plan (persistence).
- Duplicate, edit, delete all behave as in Tasks 4–5.
- Excel export succeeds.

Then repeat the same pass through the real plugin: `python build_zip.py`, note this needs a
WordPress install with the plugin ZIP uploaded (manual step the user performs — see
`working-instructions-variation-toolbox` memory) to confirm the tile/tab/column appear correctly
in the real shortcode context, not just the harness.

- [ ] **Step 4: Commit**

```bash
git add "variation-fee-calculator/assets/js/vcl-budget.js"
git commit -m "feat: add Excel export for the budget plan"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1/5), engines untouched (all tasks call public APIs only),
  compact modal not a wizard (Task 5), duplicate + multi-country entry (Task 4/5), MVP rollups
  annual+FTE+by-market+by-product (Task 2/4), localStorage with fallback banner (Task 4), Excel
  export two sheets (Task 6), English copy + RMS/MRP-DCP terminology (Global Constraints, checked
  throughout), incomplete-line edge case (Task 2/6), nav tile + wiring (Task 3), tests (Task 1).
  Phase-2 items (quarter/probability rollups, grouping savings, annual fees, .docx) intentionally
  have no task — out of scope per spec.
- **Type consistency checked:** `computeLineResult` return shape (`{fee, feeByCountry, hours, complete}`)
  is used identically in Task 2 (table/tiles), Task 4 (unchanged), Task 5 (live preview), Task 6
  (export) — no renamed fields across tasks. `line.procedure.kind` values (`national`/`mrpdcp`/`cp`)
  match `vcl-workflow.js`'s own vocabulary throughout, so a future engine change stays compatible.
- **No placeholders:** every step above has complete, runnable code — no "add validation here" or
  "similar to Task N" left unexpanded.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-05-budget-planning.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
