# Editable RA Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add their own hour adjustment (plus or minus) on top of the benchmark RA hours, per block, in both the Guided Workflow's Station C and the Budget Planning line editor.

**Architecture:** The benchmark stays the single source of truth in `vcl-workload-hours.js`; a new
`sel.hourAdjust` input carries four integer deltas (`core`, `cmc`, `pi`, `compilation`) that the
engine clamps, applies to the composed sections, and reports both per block and as its own itemised
line. The deltas live on `Submission.raTasks.hourAdjust`, so both tools reach them through the
existing shared `vcl-submission.js`. The station itself becomes one shared renderer,
`vcl-ra-tasks-ui.js`, used by the Guided Workflow and the Budget editor so the two can never drift.

**Tech Stack:** Plain ES5-style browser JS (dual-mode: `window.*` + `module.exports`), WordPress
plugin PHP for enqueueing, hand-rolled Node assertion scripts under `test/` and `tests/`.

**Spec:** `docs/superpowers/specs/2026-09-03-editable-ra-hours-design.md`
**Approved mockup:** <https://claude.ai/code/artifact/f0bb70ab-3795-4917-83ee-0720578f37da>

## Global Constraints

- Working directory for every command: `D:\Claude\Variation Fee Calculator` (the git root). The
  plugin itself lives in `variation-fee-calculator/`.
- **Bump both** `Version:` in `variation-fee-calculator/variation-fee-calculator.php` (line 5) and
  `VFC_VERSION` (line 15) to **1.22.0** — the project rule is to bump on every change.
- Plugin JS is ES5-flavoured and IIFE-wrapped, dual-mode (`window.X` in the browser,
  `module.exports` under Node). No build step, no bundler, no new dependencies.
- All CSS is scoped under `.vcl-app` — never a bare element or unscoped class selector.
- Step size is **1 h**, both directions; `−` disabled once a block's min would fall below 0.
- An adjustment shifts min and max by the same amount, so the band keeps its width.
- Adjustments of switched-off blocks are preserved in state but contribute 0 hours.
- Grouping / worksharing / super-grouping get **no** stepper of their own; they belong to the
  `core` block.
- Budget plan storage version stays **3** (the new field is additive and defaults to zeros).
- Do not commit anything the user has not asked for beyond each task's own files, and do not
  `git push` — the project rule is that pushes happen only on explicit request.

---

### Task 1: Hour adjustments in the workload engine

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workload-hours.js`
- Test: `test/test-additive-workload.js` (append to the existing script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `computeAdditiveWorkload(HD, sel)` accepts `sel.hourAdjust = { core, cmc, pi, compilation }`
    (integers, may be negative, all optional).
  - Its return value gains two keys:
    - `adjust: { core, cmc, pi, compilation }` — the **applied** (clamped, gated) deltas in hours.
    - `blocks: { core, cmc, pi, compilation }` — each `{ min, max }`, benchmark **plus** applied
      adjustment; the per-block band the station UI renders. `core` = `raCore + submissionRa`,
      `pi` = `pi`, `cmc` = `cmcCore + submissionCmc`, `compilation` = `compilation`.
  - `items.ra` gains `{ label: "Own adjustment · RA preparation", min: d, max: d, own: true }` and
    `{ label: "Own adjustment · Product information", ... }`; `items.cmc` and `items.compilation`
    gain `{ label: "Own adjustment", ... }` — each only when its applied delta is non-zero.
  - `composeSections(parts)` adds the applied deltas into the matching sections and the total.

- [ ] **Step 1: Write the failing test**

Append to `test/test-additive-workload.js`, immediately above its final summary block (the lines
starting `console.log("\n" + ...)` / `process.exit(...)` — keep those last):

```js
// --- Hour adjustments: the user's own delta on top of the benchmark. --------------------------
// Baseline case: Type IB, MRP/DCP with 3 CMS, chemical API, all three optional modules on.
function withAdjust(hourAdjust) {
  return WLH.computeAdditiveWorkload(HD, {
    type: "IB", procedure: "mrpdcp", cmsCount: 3, activeSubstance: "chemical",
    piDocs: { smpc: true },
    modules: { pi: true, cmc: true, compilation: true },
    hourAdjust: hourAdjust,
  });
}
var adjBase = withAdjust(null);
var adjBaseSec = WLH.composeSections(adjBase);

eq(adjBase.adjust, { core: 0, cmc: 0, pi: 0, compilation: 0 }, "adjust: no input -> all zero");
approx(adjBase.blocks.core.min, adjBase.raCore.min + adjBase.submissionRa.min,
  "blocks.core.min = raCore + submissionRa");
approx(adjBase.blocks.cmc.max, adjBase.cmcCore.max + adjBase.submissionCmc.max,
  "blocks.cmc.max = cmcCore + submissionCmc");

// +6 h on CMC shifts min AND max by 6, and lands in the CMC section and the total.
var adjCmc = withAdjust({ cmc: 6 });
var adjCmcSec = WLH.composeSections(adjCmc);
approx(adjCmc.adjust.cmc, 6, "adjust: +6 h on CMC is applied as +6");
approx(adjCmc.blocks.cmc.min - adjBase.blocks.cmc.min, 6, "adjust: +6 h shifts the CMC block min");
approx(adjCmc.blocks.cmc.max - adjBase.blocks.cmc.max, 6, "adjust: +6 h shifts the CMC block max");
approx(adjCmcSec.cmc.min - adjBaseSec.cmc.min, 6, "adjust: +6 h shifts the CMC section min");
approx(adjCmcSec.total.max - adjBaseSec.total.max, 6, "adjust: +6 h shifts the grand total max");

// A negative delta is clamped so the block's min never goes below 0; min and max shift by the
// SAME clamped amount, so the band keeps its width.
var hugeNeg = withAdjust({ core: -1000 });
approx(hugeNeg.adjust.core, -adjBase.blocks.core.min, "adjust: negative delta clamps at -min");
approx(hugeNeg.blocks.core.min, 0, "adjust: clamped negative leaves the block min at 0");
approx(hugeNeg.blocks.core.max - hugeNeg.blocks.core.min,
  adjBase.blocks.core.max - adjBase.blocks.core.min, "adjust: clamping keeps the band width");

// A switched-off block ignores its stored adjustment entirely.
var offAdj = WLH.computeAdditiveWorkload(HD, {
  type: "IB", procedure: "national", modules: { pi: false, cmc: false, compilation: false },
  hourAdjust: { cmc: 12, pi: 5, compilation: 3 },
});
eq({ cmc: offAdj.adjust.cmc, pi: offAdj.adjust.pi, compilation: offAdj.adjust.compilation },
  { cmc: 0, pi: 0, compilation: 0 }, "adjust: gates off -> stored adjustments contribute nothing");

// Each non-zero adjustment shows as its own itemised line, tagged own:true.
var ownRa = adjCmc.items.cmc.filter(function (i) { return i.own; });
eq(ownRa.length, 1, "adjust: CMC delta adds exactly one own:true item line");
eq({ label: ownRa[0].label, min: ownRa[0].min, max: ownRa[0].max },
  { label: "Own adjustment", min: 6, max: 6 }, "adjust: CMC item line is labelled and carries the delta");
var adjBoth = withAdjust({ core: 3, pi: -2 });
var raOwn = adjBoth.items.ra.filter(function (i) { return i.own; }).map(function (i) { return i.label; });
eq(raOwn, ["Own adjustment · RA preparation", "Own adjustment · Product information"],
  "adjust: the two RA-section deltas are labelled apart");
eq(adjBase.items.ra.filter(function (i) { return i.own; }).length, 0,
  "adjust: zero delta adds no item line");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node test/test-additive-workload.js
```

Expected: FAIL lines such as `FAIL adjust: no input -> all zero — expected {"core":0,...}, got undefined`
and a non-zero exit code.

- [ ] **Step 3: Implement the adjustment layer**

In `variation-fee-calculator/assets/js/vcl-workload-hours.js`, add these helpers directly above
`computeAdditiveWorkload`:

```js
  // ---- user hour adjustments ------------------------------------------------------------------
  // The benchmark workbook is the default; a department that works differently adds its own delta
  // per block. Deltas are whole hours and may be negative. Applying a delta shifts min AND max by
  // the same amount, so the band keeps its width, and it is clamped so a block's min never goes
  // below 0 (a block cannot cost less than no work at all).
  var ADJUST_KEYS = ["core", "cmc", "pi", "compilation"];
  function normalizeHourAdjust(raw) {
    var out = {};
    raw = raw || {};
    for (var i = 0; i < ADJUST_KEYS.length; i++) {
      var k = ADJUST_KEYS[i];
      var v = raw[k];
      out[k] = (typeof v === "number" && isFinite(v)) ? Math.round(v) : 0;
    }
    return out;
  }
  function sumParts(a, b) {
    return { min: (a ? a.min : 0) + (b ? b.min : 0), max: (a ? a.max : 0) + (b ? b.max : 0) };
  }
  // The delta actually applied: 0 when the block's gate is off, otherwise never below -min.
  function applicableAdjust(delta, base, gateOn) {
    if (!gateOn || !delta) return 0;
    return Math.max(delta, -base.min);
  }
  function shiftBand(base, delta) { return { min: base.min + delta, max: base.max + delta }; }
```

Then replace the tail of `computeAdditiveWorkload` — everything from the `// Itemised lines per
visible section.` comment down to and including its `return { ... };` — with:

```js
    // Per-block bands (the four cards Station "RA tasks" renders) plus the user's own adjustment.
    // Blocks map onto the engine parts as: core = RA core + the grouped/shared submission
    // modifiers, pi = product information, cmc = CMC core + its modifiers, compilation = the
    // compilation & submission sheet.
    var rawAdjust = normalizeHourAdjust(sel.hourAdjust);
    var blockBase = {
      core: sumParts(raCore, submissionRa),
      pi: pi,
      cmc: sumParts(cmcCore, submissionCmc),
      compilation: compilation,
    };
    var gates = { core: true, pi: !!modules.pi, cmc: !!modules.cmc, compilation: !!modules.compilation };
    var adjust = {}, blocks = {};
    for (var ai = 0; ai < ADJUST_KEYS.length; ai++) {
      var ak = ADJUST_KEYS[ai];
      adjust[ak] = applicableAdjust(rawAdjust[ak], blockBase[ak], gates[ak]);
      blocks[ak] = shiftBand(blockBase[ak], adjust[ak]);
    }

    // Itemised lines per visible section. Core rows are already itemised by the summers; PI, the
    // grouped/shared modifiers (and the per-CMS row, inside sumFlat) collapse to one line each.
    // Each non-zero own adjustment is appended as its own line, tagged own:true so the UI can
    // colour it apart from the benchmark rows.
    function ownItem(label, delta) { return { label: label, min: delta, max: delta, own: true }; }

    var raItems = (raCore.items || []).slice();
    if (modules.pi && (pi.min || pi.max)) raItems.push({ label: piLabel(sel.piDocs), min: pi.min, max: pi.max });
    (submissionRa.items || []).forEach(function (it) { raItems.push(it); });
    if (adjust.core) raItems.push(ownItem("Own adjustment · RA preparation", adjust.core));
    if (adjust.pi) raItems.push(ownItem("Own adjustment · Product information", adjust.pi));

    var cmcItems = (cmcCore.items || []).slice();
    (submissionCmc.items || []).forEach(function (it) { cmcItems.push(it); });
    if (adjust.cmc) cmcItems.push(ownItem("Own adjustment", adjust.cmc));

    var compItems = (compilation.items || []).slice();
    if (adjust.compilation) compItems.push(ownItem("Own adjustment", adjust.compilation));

    return {
      raCore: raCore, pi: pi, submissionRa: submissionRa,
      cmcCore: cmcCore, submissionCmc: submissionCmc,
      compilation: compilation,
      adjust: adjust, blocks: blocks,
      items: { ra: raItems, cmc: cmcItems, compilation: compItems },
    };
```

Then replace `composeSections` with:

```js
  // Compose the confirmed "Variant A" three-section view from the granular parts. Returns each
  // section's {min,max} subtotal plus the grand total. CMC only counts into the total when its
  // gate is on (its part is already zero otherwise, so the sum is correct either way). The user's
  // own adjustments (already clamped and gated by computeAdditiveWorkload) are added into the
  // section they belong to: RA carries both the core and the product-information delta.
  function composeSections(parts) {
    var adj = parts.adjust || { core: 0, cmc: 0, pi: 0, compilation: 0 };
    var ra = { min: parts.raCore.min + parts.pi.min + parts.submissionRa.min + adj.core + adj.pi,
               max: parts.raCore.max + parts.pi.max + parts.submissionRa.max + adj.core + adj.pi };
    var cmc = { min: parts.cmcCore.min + parts.submissionCmc.min + adj.cmc,
                max: parts.cmcCore.max + parts.submissionCmc.max + adj.cmc };
    var compilation = { min: parts.compilation.min + adj.compilation,
                        max: parts.compilation.max + adj.compilation };
    var total = { min: ra.min + cmc.min + compilation.min,
                  max: ra.max + cmc.max + compilation.max };
    return { ra: ra, cmc: cmc, compilation: compilation, total: total };
  }
```

Finally add the two new helpers to the exported `api` object, next to `composeSections`:

```js
    normalizeHourAdjust: normalizeHourAdjust,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node test/test-additive-workload.js
```

Expected: every line `PASS`, exit code 0 — including the pre-existing assertions, which must not
change (they pass no `hourAdjust`, so all deltas are 0).

- [ ] **Step 5: Run the neighbouring suites to prove nothing regressed**

```bash
node test/test-submission.js && node test/test-budget-engine.js && node tests/vcl-workload-hours.test.js
```

Expected: all three pass with exit code 0.

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workload-hours.js test/test-additive-workload.js
git commit -m "feat(hours): let the workload engine apply per-block user hour adjustments

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Carry the adjustment through the shared Submission module

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-submission.js` (`computeSubmissionHours`)
- Test: `test/test-submission.js` (append)

**Interfaces:**
- Consumes: `computeAdditiveWorkload(HD, { ..., hourAdjust })` and the `adjust` / `blocks` keys from
  Task 1.
- Produces: `computeSubmissionHours(sub, engines)` reads `sub.raTasks.hourAdjust` and its return
  value gains `adjust` (the applied deltas) and `blocks` (the four per-block bands), alongside the
  existing `parts`, `items`, `sections`, `total`, `min`, `max`, `expected`.

- [ ] **Step 1: Write the failing test**

Append to `test/test-submission.js`, above its final summary/exit block:

```js
// --- Hour adjustments travel from Submission.raTasks.hourAdjust into the hours result. ---------
function subWithAdjust(hourAdjust) {
  return {
    mode: null,
    variations: [{ code: null, variantId: undefined, type: "IB" }],
    procedures: [{ kind: "national", nat: "DE", rms: null, cms: [] }],
    lead: null,
    raTasks: { cmc: true, compilation: false, pi: false, piDocs: {}, activeSubstance: "chemical",
               hourAdjust: hourAdjust },
    strengths: { default: 1, overrides: {} },
    specials: { line: {}, ws: {}, lead: null },
  };
}
var hBase = SUB.computeSubmissionHours(subWithAdjust(null), engines);
var hAdj = SUB.computeSubmissionHours(subWithAdjust({ core: 4, cmc: -2 }), engines);

approx(hAdj.adjust.core, 4, "submission: +4 h core adjustment reaches the engine");
approx(hAdj.total.min - hBase.total.min, 2, "submission: +4 core and -2 cmc net +2 on the total min");
approx(hAdj.blocks.core.min - hBase.blocks.core.min, 4, "submission: blocks.core carries the delta");
approx(hAdj.expected - hBase.expected, 2, "submission: the PERT expected value moves with the delta");

var hMissing = SUB.computeSubmissionHours(subWithAdjust(undefined), engines);
eq(hMissing.adjust, { core: 0, cmc: 0, pi: 0, compilation: 0 },
  "submission: a submission without hourAdjust behaves exactly as before");
```

If `test/test-submission.js` names its engine bundle differently from `engines` or its helpers
differently from `eq` / `approx`, use that file's own names — read the top of the file first.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node test/test-submission.js
```

Expected: FAIL with a `TypeError` on `hAdj.adjust.core` (reading a property of `undefined`) or a
`FAIL submission: ...` line, and a non-zero exit code.

- [ ] **Step 3: Implement**

In `computeSubmissionHours` in `variation-fee-calculator/assets/js/vcl-submission.js`, pass the
adjustment into the engine call by adding one property to the object literal, directly after
`piDocs: sub.raTasks.piDocs,`:

```js
      // The user's own per-block hour adjustment (Station "RA tasks" steppers). The engine clamps
      // and gates it; a submission stored before this feature simply has none.
      hourAdjust: sub.raTasks.hourAdjust,
```

and widen the returned object (the `return { parts: parts, ... }` statement at the end of the
function) to:

```js
    return { parts: parts, items: parts.items, sections: sections, total: sections.total,
      adjust: parts.adjust, blocks: parts.blocks,
      min: sections.total.min, max: sections.total.max,
      expected: engines.workload.pertExpected(sections.total.min, sections.total.max) };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node test/test-submission.js
```

Expected: all lines PASS, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-submission.js test/test-submission.js
git commit -m "feat(hours): pass Submission.raTasks.hourAdjust through to the workload engine

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Persist the adjustment in the Budget plan

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget-engine.js` (`emptySubmission`,
  `migrateRaTasks`, `normalizeSubmission`)
- Test: `test/test-budget-engine.js` (append)

**Interfaces:**
- Consumes: `Submission.raTasks.hourAdjust` from Task 2.
- Produces: `emptySubmission().raTasks.hourAdjust === { core: 0, cmc: 0, pi: 0, compilation: 0 }`;
  `normalizeSubmission(raw)` always returns a valid `hourAdjust` object with those four integer
  keys, whatever the input; the stored plan version stays `3`.

- [ ] **Step 1: Write the failing test**

Append to `test/test-budget-engine.js`, above its final summary/exit block:

```js
// --- Hour adjustments survive save/load and never come back malformed. -------------------------
eq(BUD.emptySubmission().raTasks.hourAdjust, { core: 0, cmc: 0, pi: 0, compilation: 0 },
  "budget: a fresh submission starts with zero hour adjustments");

var normKept = BUD.normalizeSubmission({ raTasks: { hourAdjust: { core: 5, cmc: -3 } } });
eq(normKept.raTasks.hourAdjust, { core: 5, cmc: -3, pi: 0, compilation: 0 },
  "budget: stored adjustments are kept, missing keys default to 0");

var normJunk = BUD.normalizeSubmission({ raTasks: { hourAdjust: { core: "7", pi: null, cmc: 1.4, nope: 9 } } });
eq(normJunk.raTasks.hourAdjust, { core: 0, cmc: 1, pi: 0, compilation: 0 },
  "budget: non-numeric adjustments fall back to 0, fractions round, unknown keys are dropped");

var normLegacy = BUD.normalizeSubmission({ raTasks: { cmc: true } });
eq(normLegacy.raTasks.hourAdjust, { core: 0, cmc: 0, pi: 0, compilation: 0 },
  "budget: a plan stored before this feature loads with zero adjustments");
```

If the file's assertion helpers or the exported name for `normalizeSubmission` differ, use that
file's own names — read the top of the file first.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node test/test-budget-engine.js
```

Expected: FAIL lines reporting `got undefined` for `raTasks.hourAdjust`, non-zero exit code.

- [ ] **Step 3: Implement**

In `variation-fee-calculator/assets/js/vcl-budget-engine.js`:

Add this helper directly above `emptySubmission`:

```js
  // The user's own per-block hour adjustments (Station "RA tasks" steppers), validated: exactly the
  // four known keys, whole hours, negatives allowed. Anything else recovers to 0 rather than
  // throwing — a hand-edited or older localStorage plan must still load.
  var HOUR_ADJUST_KEYS = ["core", "cmc", "pi", "compilation"];
  function normalizeHourAdjust(raw) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var out = {};
    HOUR_ADJUST_KEYS.forEach(function (k) {
      var v = raw[k];
      out[k] = (typeof v === "number" && isFinite(v)) ? Math.round(v) : 0;
    });
    return out;
  }
```

In `emptySubmission()`, change the `raTasks` line to:

```js
      raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null,
                 hourAdjust: normalizeHourAdjust(null) },
```

In `migrateRaTasks(raw)`, add the field to the returned object (v1 plans never had one):

```js
      hourAdjust: normalizeHourAdjust(raw && raw.hourAdjust),
```

In `normalizeSubmission`, the `raTasks` branch currently reads (lines 151-155):

```js
      raTasks: (raw.raTasks && typeof raw.raTasks === "object")
        ? { cmc: !!raw.raTasks.cmc, compilation: !!raw.raTasks.compilation, pi: !!raw.raTasks.pi,
            piDocs: (raw.raTasks.piDocs && typeof raw.raTasks.piDocs === "object") ? raw.raTasks.piDocs : {},
            activeSubstance: raw.raTasks.activeSubstance || null }
```

Replace that object literal with:

```js
      raTasks: (raw.raTasks && typeof raw.raTasks === "object")
        ? { cmc: !!raw.raTasks.cmc, compilation: !!raw.raTasks.compilation, pi: !!raw.raTasks.pi,
            piDocs: (raw.raTasks.piDocs && typeof raw.raTasks.piDocs === "object") ? raw.raTasks.piDocs : {},
            activeSubstance: raw.raTasks.activeSubstance || null,
            hourAdjust: normalizeHourAdjust(raw.raTasks.hourAdjust) }
```

Leave the `: migrateRaTasks(raw)` fallback on the next line untouched — the `migrateRaTasks` edit
above already gives that branch its `hourAdjust`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node test/test-budget-engine.js
```

Expected: all lines PASS, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget-engine.js test/test-budget-engine.js
git commit -m "feat(budget): persist per-block RA hour adjustments in the plan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The shared "RA tasks" station renderer

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-ra-tasks-ui.js`
- Create: `variation-fee-calculator/assets/css/vcl-ra-tasks.css`
- Modify: `variation-fee-calculator/includes/lookup.php` (register + enqueue the two new assets)

**Interfaces:**
- Consumes: the `blocks` bands from Task 2 (`computeSubmissionHours(...).blocks`).
- Produces: `window.VCL_RA_TASKS.render(host, ctx)`, where

  ```js
  ctx = {
    raTasks,          // the live Submission.raTasks object — mutated in place
    blocks,           // { core, cmc, pi, compilation } of {min,max}, or null while unavailable
    compact,          // boolean: true in the Budget overlay (tighter spacing)
    onChange,         // called with no arguments after every mutation; the tool rerenders
  }
  ```

  `render` empties `host` and appends the four block cards described in the spec. It never reads
  `window` state itself, so both tools stay in charge of their own rerender.

- [ ] **Step 1: Create the renderer**

Create `variation-fee-calculator/assets/js/vcl-ra-tasks-ui.js`:

```js
// The "RA tasks" station, rendered once and used by BOTH the Guided Workflow (Station C) and the
// Budget line editor, so the two can never drift apart. Pure DOM + callbacks: it mutates the
// raTasks object it is handed and calls ctx.onChange(); it never reads global state and never
// computes hours itself (the bands come in via ctx.blocks, from VCL_SUBMISSION.computeSubmissionHours).
// Colours come from the host tool through --vcl-rat-accent* (see vcl-ra-tasks.css).
// See docs/superpowers/specs/2026-09-03-editable-ra-hours-design.md.
(function (root) {
  "use strict";

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Whole-hours-ish band: keeps half hours, drops a trailing ".0" (the workbook has 0.5 steps).
  function num(n) { return (Math.round(n * 10) / 10).toString().replace(/\.0$/, ""); }
  function bandHtml(b) { return num(b.min) + ' <span class="vcl-rat-dash">–</span> ' + num(b.max) + " h"; }

  var BLOCKS = [
    { key: "core", name: "RA preparation", always: true, tag: "always included" },
    { key: "cmc", name: "CMC dossier written in RA", gate: "cmc",
      onHint: "The dossier effort depends on the active substance:",
      offHint: "Off: a separate CMC / quality unit writes the dossier — it adds no RA hours." },
    { key: "pi", name: "Product information", gate: "pi",
      onHint: "Which documents does this change touch?",
      offHint: "Off: another department prepares the product information — it adds no RA hours." },
    { key: "compilation", name: "Compilation & submission", gate: "compilation",
      onHint: "Dossier compilation (docuBridge / Veeva), internal checks and CESP submission are done in RA.",
      offHint: "Off: dossier compilation and submission are handled elsewhere — they add no RA hours." },
  ];

  // Which blocks currently show their stepper. Keyed by block key; a block whose adjustment is
  // non-zero is always expanded, so this only tracks the "opened but still at 0" case. Module-level
  // (not per render) so the row survives the host tool's rerender on every click.
  var expanded = {};

  function adjustOf(raTasks, key) {
    var a = raTasks.hourAdjust || (raTasks.hourAdjust = { core: 0, cmc: 0, pi: 0, compilation: 0 });
    return a[key] || 0;
  }
  function setAdjust(raTasks, key, value) {
    if (!raTasks.hourAdjust) raTasks.hourAdjust = { core: 0, cmc: 0, pi: 0, compilation: 0 };
    raTasks.hourAdjust[key] = value;
  }

  function toggle(isOn, label, onClick) {
    var b = el("button", "vcl-rat-toggle" + (isOn ? " is-on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", isOn ? "true" : "false");
    b.setAttribute("aria-label", label);
    b.innerHTML = '<span class="vcl-rat-toggle__track"><span class="vcl-rat-toggle__thumb"></span></span>';
    b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  function chips(options, isOn, onPick) {
    var wrap = el("div", "vcl-rat-chips");
    options.forEach(function (o) {
      var c = el("button", "vcl-rat-chip" + (isOn(o.k) ? " is-on" : ""), esc(o.l));
      c.type = "button";
      c.addEventListener("click", function () { onPick(o.k); });
      wrap.appendChild(c);
    });
    return wrap;
  }

  // "Own adjustment  [−] ± 0 h [+]" plus, once non-zero, the untouched benchmark beside it.
  function adjustRow(ctx, block, base) {
    var raTasks = ctx.raTasks;
    var d = adjustOf(raTasks, block.key);
    var row = el("div", "vcl-rat-adj");
    row.appendChild(el("span", "vcl-rat-adj__label", "Own adjustment"));

    var st = el("span", "vcl-rat-stepper");
    // The lowest delta that still leaves the block at 0 h or more; mirrors the engine's clamp.
    var minDelta = base ? -base.min + d : -Infinity;

    var minus = el("button", null, "&minus;");
    minus.type = "button";
    minus.setAttribute("aria-label", "Decrease " + block.name + " by one hour");
    minus.disabled = base ? (d <= minDelta) : false;
    minus.addEventListener("click", function () {
      setAdjust(raTasks, block.key, d - 1);
      ctx.onChange();
    });

    var val = el("span", "vcl-rat-stepper__val" + (d === 0 ? " is-zero" : ""),
      d === 0 ? "&pm; 0 h" : (d > 0 ? "+ " : "&minus; ") + Math.abs(d) + " h");

    var plus = el("button", null, "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "Increase " + block.name + " by one hour");
    plus.addEventListener("click", function () {
      setAdjust(raTasks, block.key, d + 1);
      ctx.onChange();
    });

    st.appendChild(minus); st.appendChild(val); st.appendChild(plus);
    row.appendChild(st);

    if (d !== 0 && base) {
      row.appendChild(el("span", "vcl-rat-adj__base",
        "Benchmark " + num(base.min - d) + " – " + num(base.max - d) + " h"));
    }
    return row;
  }

  function adjustLink(ctx, block) {
    var row = el("div", "vcl-rat-adj");
    var b = el("button", "vcl-rat-link", "Adjust these hours");
    b.type = "button";
    b.addEventListener("click", function () { expanded[block.key] = true; ctx.onChange(); });
    row.appendChild(b);
    return row;
  }

  function render(host, ctx) {
    host.innerHTML = "";
    var rt = ctx.raTasks;
    var wrap = el("div", "vcl-rat" + (ctx.compact ? " is-compact" : ""));

    BLOCKS.forEach(function (block) {
      var on = block.always ? true : !!rt[block.gate];
      var base = (ctx.blocks && ctx.blocks[block.key]) || null;
      var card = el("div", "vcl-rat-block" + (block.always ? " is-core" : "") + (on ? "" : " is-off"));

      var top = el("div", "vcl-rat-block__top");
      var id = el("div", "vcl-rat-block__id");
      if (!block.always) {
        id.appendChild(toggle(on, block.name, function () { rt[block.gate] = !rt[block.gate]; ctx.onChange(); }));
      }
      id.appendChild(el("span", "vcl-rat-block__name", esc(block.name)));
      if (block.tag) id.appendChild(el("span", "vcl-rat-tag", esc(block.tag)));
      top.appendChild(id);
      top.appendChild(el("span", "vcl-rat-hrs" + (on && base ? "" : " is-none"),
        on ? (base ? bandHtml(base) : "—") : "not in RA"));
      card.appendChild(top);

      if (block.always) {
        card.appendChild(el("p", "vcl-rat-hint", "Based on your variations &amp; procedures — including any grouping, worksharing or super-grouping."));
      } else {
        card.appendChild(el("p", "vcl-rat-hint", on ? esc(block.onHint) : esc(block.offHint)));
      }

      if (on && block.key === "cmc") {
        card.appendChild(chips(
          [{ k: "biologic", l: "Biologic" }, { k: "chemical", l: "Chemically-synthesized API" }],
          function (k) { return rt.activeSubstance === k; },
          function (k) { rt.activeSubstance = k; ctx.onChange(); }));
        if (!rt.activeSubstance) {
          card.appendChild(el("p", "vcl-rat-hint", "Pick the active substance to include the CMC dossier hours."));
        }
      }
      if (on && block.key === "pi") {
        // piDocs keys MUST match the workload engine's PI filter (smpc / leaflet / labelling /
        // mockups), consumed via sub.raTasks.piDocs in vcl-submission.js.
        card.appendChild(chips(
          [{ k: "smpc", l: "SmPC" }, { k: "leaflet", l: "Package leaflet" },
           { k: "labelling", l: "Labelling" }, { k: "mockups", l: "Mock-ups" }],
          function (k) { return !!(rt.piDocs && rt.piDocs[k]); },
          function (k) {
            if (!rt.piDocs) rt.piDocs = {};
            rt.piDocs[k] = !rt.piDocs[k];
            ctx.onChange();
          }));
      }

      if (on) {
        var d = adjustOf(rt, block.key);
        if (d === 0 && !expanded[block.key]) card.appendChild(adjustLink(ctx, block));
        else card.appendChild(adjustRow(ctx, block, base));
      }

      wrap.appendChild(card);
    });

    host.appendChild(wrap);
  }

  var api = { render: render };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_RA_TASKS = api;
})(typeof window !== "undefined" ? window : null);
```

- [ ] **Step 2: Create the stylesheet**

Create `variation-fee-calculator/assets/css/vcl-ra-tasks.css`. Every selector is scoped under
`.vcl-app`; the accent comes from `--vcl-rat-accent*`, which each host tool sets (Task 5/6):

```css
/* Shared "RA tasks" station (Guided Workflow Station C + Budget line editor). The host tool sets
   --vcl-rat-accent / --vcl-rat-accent-bg / --vcl-rat-accent-tint to its own identity colour, so
   the same markup reads green in the Guided Workflow and plum in Budget Planning. */
.vcl-app .vcl-rat { display: flex; flex-direction: column; gap: 14px; }
.vcl-app .vcl-rat.is-compact { gap: 10px; }

.vcl-app .vcl-rat-block {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vcl-app .vcl-rat.is-compact .vcl-rat-block { padding: 11px 13px; gap: 8px; }
.vcl-app .vcl-rat-block.is-core {
  background: var(--vcl-rat-accent-tint);
  border-color: color-mix(in srgb, var(--vcl-rat-accent) 40%, var(--border));
}
.vcl-app .vcl-rat-block.is-off { opacity: .72; }

.vcl-app .vcl-rat-block__top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.vcl-app .vcl-rat-block__id { display: flex; align-items: center; gap: 10px; min-width: 0; }
.vcl-app .vcl-rat-block__name { font-weight: 600; }
.vcl-app .vcl-rat-tag {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
  color: var(--vcl-rat-accent); background: var(--vcl-rat-accent-bg);
  border-radius: 999px; padding: 3px 8px; white-space: nowrap;
}
.vcl-app .vcl-rat-hrs {
  font-family: var(--figure); font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap;
}
.vcl-app .vcl-rat-hrs.is-none { color: var(--ink-faint); font-weight: 400; }
.vcl-app .vcl-rat-dash { color: var(--ink-faint); font-weight: 400; }
.vcl-app .vcl-rat-hint { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }

/* toggle */
.vcl-app .vcl-rat-toggle {
  border: none; background: none; padding: 0; cursor: pointer; flex: 0 0 auto; line-height: 0;
}
.vcl-app .vcl-rat-toggle__track {
  display: inline-block; position: relative; width: 42px; height: 23px; border-radius: 999px;
  background: var(--border); transition: background .15s;
}
.vcl-app .vcl-rat-toggle__thumb {
  position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .25); transition: transform .15s;
}
.vcl-app .vcl-rat-toggle.is-on .vcl-rat-toggle__track { background: var(--vcl-rat-accent); }
.vcl-app .vcl-rat-toggle.is-on .vcl-rat-toggle__thumb { transform: translateX(19px); }
.vcl-app .vcl-rat-toggle:focus-visible { outline: 2px solid var(--vcl-rat-accent); outline-offset: 2px; border-radius: 999px; }

/* chips */
.vcl-app .vcl-rat-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.vcl-app .vcl-rat-chip {
  font: inherit; font-size: 12px; border: 1px solid var(--border); border-radius: 999px;
  padding: 4px 11px; background: var(--panel); color: var(--muted); cursor: pointer;
}
.vcl-app .vcl-rat-chip.is-on {
  border-color: var(--vcl-rat-accent); background: var(--vcl-rat-accent-bg);
  color: var(--vcl-rat-accent); font-weight: 600;
}
.vcl-app .vcl-rat-chip:focus-visible { outline: 2px solid var(--vcl-rat-accent); outline-offset: 2px; }

/* adjustment row */
.vcl-app .vcl-rat-adj {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  border-top: 1px dashed var(--border); padding-top: 10px;
}
.vcl-app .vcl-rat-adj__label { font-size: 12.5px; color: var(--muted); }
.vcl-app .vcl-rat-adj__base {
  font-size: 12.5px; font-weight: 600; color: var(--history);
  font-family: var(--figure); font-variant-numeric: tabular-nums;
}
.vcl-app .vcl-rat-stepper {
  display: inline-flex; align-items: center; background: var(--panel);
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
}
.vcl-app .vcl-rat-stepper button {
  font: inherit; font-size: 15px; font-weight: 600; line-height: 1; width: 30px; height: 30px;
  border: none; background: transparent; color: var(--vcl-rat-accent); cursor: pointer;
}
.vcl-app .vcl-rat-stepper button:hover { background: var(--vcl-rat-accent-bg); }
.vcl-app .vcl-rat-stepper button:disabled { color: var(--ink-faint); cursor: not-allowed; background: transparent; }
.vcl-app .vcl-rat-stepper button:focus-visible { outline: 2px solid var(--vcl-rat-accent); outline-offset: -2px; }
.vcl-app .vcl-rat-stepper__val {
  min-width: 64px; text-align: center; padding: 5px 6px; font-weight: 600;
  font-family: var(--figure); font-variant-numeric: tabular-nums;
  border-left: 1px solid var(--border); border-right: 1px solid var(--border);
}
.vcl-app .vcl-rat-stepper__val.is-zero { color: var(--ink-faint); font-weight: 500; }
.vcl-app .vcl-rat-link {
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--vcl-rat-accent);
  background: none; border: none; padding: 0; cursor: pointer;
  text-decoration: underline; text-underline-offset: 3px;
}
.vcl-app .vcl-rat-link:focus-visible { outline: 2px solid var(--vcl-rat-accent); outline-offset: 2px; }

/* The "Own adjustment" line inside the methodology / breakdown boxes. */
.vcl-app .vcl-rat-own { color: var(--history); font-weight: 600; }
```

- [ ] **Step 3: Register and enqueue both assets**

In `variation-fee-calculator/includes/lookup.php`, directly after the `vcl-submission` registration
block (around line 217), add:

```php
	// Shared "RA tasks" station renderer (window.VCL_RA_TASKS), used by the Guided Workflow's
	// Station C and the Budget line editor so the two stay identical.
	$ra_tasks_file = VFC_PLUGIN_DIR . 'assets/js/vcl-ra-tasks-ui.js';
	$ra_tasks_ver  = file_exists( $ra_tasks_file ) ? filemtime( $ra_tasks_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-ra-tasks-ui',
		VFC_PLUGIN_URL . 'assets/js/vcl-ra-tasks-ui.js',
		array(),
		$ra_tasks_ver,
		true
	);

	$ra_tasks_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-ra-tasks.css';
	$ra_tasks_style_ver  = file_exists( $ra_tasks_style_file ) ? filemtime( $ra_tasks_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-ra-tasks-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-ra-tasks.css',
		array( 'vcl-style' ),
		$ra_tasks_style_ver
	);
```

Add `'vcl-ra-tasks-ui'` to the dependency arrays of both `vcl-workflow` (line ~225) and
`vcl-budget` (line ~279).

In the enqueue function (around line 393-402), add next to the other enqueues:

```php
	wp_enqueue_script( 'vcl-ra-tasks-ui' );
	wp_enqueue_style( 'vcl-ra-tasks-style' );
```

- [ ] **Step 4: Register both new files in the ZIP builder**

`build_zip.py` keeps its `FILES` list by hand and **fails the build** on any plugin file that is
not listed. Add the two new entries: put `"assets/js/vcl-ra-tasks-ui.js"` directly after
`"assets/js/vcl-submission.js"`, and `"assets/css/vcl-ra-tasks.css"` directly after
`"assets/css/vcl-budget-style.css"`.

Verify:

```bash
python build_zip.py
```

Expected: it prints a file count two higher than before (43 files) and no
`ERROR unlisted files in plugin folder` line.

- [ ] **Step 5: Verify the PHP parses and nothing else broke**

```bash
php -l variation-fee-calculator/includes/lookup.php
```

Expected: `No syntax errors detected`. If `php` is not on PATH, skip this step and rely on the
browser check in Task 5.

```bash
node test/test-additive-workload.js && node test/test-submission.js && node test/test-budget-engine.js
```

Expected: all pass (this task touches no engine code; the run guards against an accidental edit).

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-ra-tasks-ui.js variation-fee-calculator/assets/css/vcl-ra-tasks.css variation-fee-calculator/includes/lookup.php build_zip.py
git commit -m "feat(ui): add the shared RA-tasks station renderer with hour steppers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Guided Workflow Station C uses the shared renderer

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js`
  (`state` block ~line 50, `submissionFromState()` ~line 158, the station reset ~line 495,
  `buildStationRA()` ~line 583, and delete `buildSubstance()` / `buildProductInfo()`)
- Modify: `variation-fee-calculator/assets/css/vcl-workflow-style.css` (set the accent variables)

**Interfaces:**
- Consumes: `window.VCL_RA_TASKS.render(host, ctx)` from Task 4 and
  `VCL_SUBMISSION.computeSubmissionHours(...).blocks` from Task 2.
- Produces: `state.hourAdjust`, mapped into `submissionFromState().raTasks.hourAdjust`.

- [ ] **Step 1: Add the state field**

In the `state` object (around line 50-59), next to `piDocs`, add:

```js
    // The user's own per-block hour adjustment (Station "RA tasks" steppers), in whole hours.
    // Benchmark hours stay untouched; these deltas are added on top by the workload engine.
    hourAdjust: { core: 0, cmc: 0, pi: 0, compilation: 0 },
```

- [ ] **Step 2: Map it into the Submission**

In `submissionFromState()` (line ~158), extend the `raTasks` line to:

```js
      raTasks: { cmc: !!state.cmcInRA, compilation: !!state.compilationInRA, pi: state.piInRA, piDocs: state.piDocs, activeSubstance: state.activeSubstance, hourAdjust: state.hourAdjust },
```

- [ ] **Step 3: Reset it with the other RA-task fields**

In the reset path around line 495-496 (the lines setting `state.cmcInRA = false;` and
`state.piDocs = { ... }`), add:

```js
    state.hourAdjust = { core: 0, cmc: 0, pi: 0, compilation: 0 };
```

- [ ] **Step 4: Replace the station body**

Replace the whole of `buildStationRA(body)` (from its `function buildStationRA(body) {` line to its
closing brace) with:

```js
  // ---- Station "RA tasks": the four hour blocks, rendered by the SHARED component so this
  // station and the Budget line editor are one implementation. Hours per block come from the
  // shared workload engine; the steppers write state.hourAdjust, which submissionFromState()
  // hands back to that engine.
  function buildStationRA(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "RA tasks"));
    body.appendChild(el("div", "vcl-wf-body__sub", "Which activities fall to RA here? Core RA preparation is always included — switch on any extra module your department also handles. The hours come from the RA/CMC benchmark; adjust them where your department works differently."));

    const host = el("div", "vcl-wf-ratasks");
    body.appendChild(host);

    const ra = raEffort();
    window.VCL_RA_TASKS.render(host, {
      raTasks: {
        // A live view onto the workflow state: the component mutates these keys in place, so the
        // getters/setters below keep state.* as the single source of truth.
        get cmc() { return state.cmcInRA; }, set cmc(v) { state.cmcInRA = v; },
        get pi() { return state.piInRA; }, set pi(v) { state.piInRA = v; },
        get compilation() { return state.compilationInRA; }, set compilation(v) { state.compilationInRA = v; },
        get activeSubstance() { return state.activeSubstance; }, set activeSubstance(v) { state.activeSubstance = v; },
        piDocs: state.piDocs,
        hourAdjust: state.hourAdjust,
      },
      blocks: ra ? ra.blocks : null,
      // The engine's APPLIED deltas: it re-clamps against the current benchmark, so a stored
      // adjustment can differ from what actually counts. The component shows and steps from these.
      adjust: ra ? ra.adjust : null,
      // Namespaces the component's "stepper opened" state. The Guided Workflow renders one
      // station at a time, but the Budget tool renders one per plan line through the same module.
      id: "guided-workflow",
      compact: false,
      onChange: rerender,
    });
  }
```

Then delete the now-unused `buildSubstance(body)` and `buildProductInfo(body)` functions entirely
(the shared component renders both the substance chips and the PI document chips).

Search for any remaining callers before deleting:

```bash
grep -n "buildSubstance\|buildProductInfo" variation-fee-calculator/assets/js/vcl-workflow.js
```

Expected after the edit: no matches. If a call remains outside Station C, keep that function and
leave a comment naming its other caller.

- [ ] **Step 5: Colour the shared component green and colour the own-adjustment rows**

Append to `variation-fee-calculator/assets/css/vcl-workflow-style.css`:

```css
/* The shared RA-tasks station takes the Guided Workflow's identity colour. */
.vcl-app .vcl-wf-ratasks {
  --vcl-rat-accent: var(--workflow);
  --vcl-rat-accent-bg: var(--workflow-bg);
  --vcl-rat-accent-tint: var(--workflow-tint);
  margin-top: 16px;
}
/* "Own adjustment" rows inside the "How the RA hours are calculated" box read as an annotation
   on the benchmark, not as another benchmark row. */
.vcl-app .vcl-wf-meth-row.is-own .l,
.vcl-app .vcl-wf-meth-row.is-own .vcl-wf-meth-val { color: var(--history); font-weight: 600; }
```

- [ ] **Step 6: Mark the own-adjustment lines in the methodology box**

`methRow(label, val, cls)` already takes a class argument, so `methSection` only has to pass one.
Replace its item loop (line ~2102):

```js
    items.forEach((it) => sec.appendChild(methRow(it.label, raBand(it))));
```

with:

```js
    // An own adjustment is the user's own number, not a benchmark row — it carries its own class
    // so the box can colour it apart (see .vcl-wf-meth-row.is-own).
    items.forEach((it) => sec.appendChild(methRow(it.label, raBand(it), it.own ? "is-own" : null)));
```

- [ ] **Step 7: Verify in the browser**

Load the Guided Workflow on the NAS test site (or a local WordPress with the plugin) and check:

1. Station C shows four cards in the order RA preparation / CMC dossier / Product information /
   Compilation & submission, with the hour band right-aligned in each header.
2. "RA preparation" is tinted green, carries the `ALWAYS INCLUDED` badge, and has no toggle.
3. "Adjust these hours" expands to `Own adjustment [−] ± 0 h [+]`; `+` raises the block band and the
   total by 1 h per click, `−` lowers it; `−` greys out once the block reaches 0 h.
4. With a non-zero adjustment, the benchmark shows in ochre beside the stepper.
5. "How the RA hours are calculated" lists an ochre "Own adjustment · …" row inside the right
   section, and the total matches the station.
6. Switching a module off hides its stepper; switching it back on restores the previous number.
7. Going back to Station A and changing the variation type changes the benchmark band while the
   adjustment stays.

Note anything that fails and fix it before committing.

- [ ] **Step 8: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/assets/css/vcl-workflow-style.css
git commit -m "feat(workflow): render Station C from the shared RA-tasks component with hour steppers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Budget line editor uses the shared renderer

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js` (`renderStationC` ~line 1786; the
  per-line detail breakdown ~line 555-595)
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css`

**Interfaces:**
- Consumes: `window.VCL_RA_TASKS.render(host, ctx)` (Task 4), `BUD.computeLineResult(...)` (Task 3),
  `computeSubmissionHours(...).blocks` (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Replace the Budget station body**

Replace the whole of `renderStationC(host)` with:

```js
  // Station "RA tasks" in the line editor — the SAME shared component the Guided Workflow's
  // Station C uses, in the Budget tool's own colour. One implementation, so the two can't drift.
  function renderStationC(host) {
    var rt = modalState.draft.submission.raTasks;
    host.appendChild(el("div", "vcl-bud-body__title", "RA tasks"));
    host.appendChild(el("div", "vcl-bud-body__sub", "Which activities fall to RA here? Core RA preparation is always included — switch on any extra module your department also handles. The hours come from the RA/CMC benchmark; adjust them where your department works differently."));

    var box = el("div", "vcl-bud-ratasks");
    host.appendChild(box);

    var hours = SUB.computeSubmissionHours(modalState.draft.submission, engines());
    window.VCL_RA_TASKS.render(box, {
      raTasks: rt,
      blocks: hours ? hours.blocks : null,
      // The engine's APPLIED deltas (it re-clamps against the current benchmark), so the stepper
      // shows and steps from the value that actually counts.
      adjust: hours ? hours.adjust : null,
      // MUST be stable and unique per plan line: the component keys its "stepper opened" state by
      // this id, so a shared or missing id would leak one line's opened stepper onto every other.
      id: "budget-line-" + modalState.draft.id,
      compact: true,
      onChange: refreshEditor,
    });
  }
```

If this file's local alias for `vcl-submission.js` is not `SUB`, use whatever name the top of the
file defines (check with `grep -n "VCL_SUBMISSION" variation-fee-calculator/assets/js/vcl-budget.js`).

Then delete the `toggleGate` helper if `renderStationC` was its only caller:

```bash
grep -n "toggleGate" variation-fee-calculator/assets/js/vcl-budget.js
```

Expected: no matches after the edit; if other callers remain, keep the helper.

- [ ] **Step 2: Colour it plum and mark the own-adjustment rows**

Append to `variation-fee-calculator/assets/css/vcl-budget-style.css`:

```css
/* The shared RA-tasks station takes the Budget tool's identity colour. */
.vcl-app .vcl-bud-ratasks {
  --vcl-rat-accent: var(--plum);
  --vcl-rat-accent-bg: var(--plum-bg);
  --vcl-rat-accent-tint: var(--plum-tint);
  margin-top: 12px;
}
/* "Own adjustment" rows in the per-line breakdown read as an annotation on the benchmark. */
.vcl-app .vcl-bud-detail__item.is-own,
.vcl-app .vcl-bud-detail__item.is-own span { color: var(--history); font-weight: 600; }
```

- [ ] **Step 3: Mark the own-adjustment lines in the per-line breakdown**

In the expandable per-line detail, the local `section(title, items, subtotal)` helper (line ~573)
renders each item as:

```js
      items.forEach(function (it) {
        var row = el("div", "vcl-bud-detail__item");
```

Change that second line to:

```js
        // An own adjustment is the user's own number, not a benchmark row — its own class lets the
        // breakdown colour it apart (see .vcl-bud-detail__item.is-own).
        var row = el("div", "vcl-bud-detail__item" + (it.own ? " is-own" : ""));
```

- [ ] **Step 4: Verify in the browser**

On the Budget Planning tool:

1. Open a plan line's editor and go to the RA-tasks station: the same four cards as the Guided
   Workflow, in plum, slightly tighter.
2. Steppers move the hours; the live Fee / RA-hours preview strip updates on every click.
3. Save the line: the table's Hours (PERT) column and the annual totals reflect the adjustment.
4. Reload the page: the saved adjustment is still there (localStorage round-trip).
5. Expand the line's detail: the ochre "Own adjustment" row appears in the right section.
6. Use "Take over from your summary" in the Guided Workflow: the adjustment arrives in the Budget
   line.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): render the line editor's RA tasks from the shared component

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Exports name the adjustment, and the version bump

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` (the `.docx` export, ~line 1716)
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js` (the XLSX export, ~line 2028-2040)
- Modify: `variation-fee-calculator/variation-fee-calculator.php` (lines 5 and 15)

**Interfaces:**
- Consumes: `raEffort().adjust` (Guided Workflow) and `r.hours` / `line.submission.raTasks.hourAdjust`
  (Budget).
- Produces: nothing for later tasks — this is the last one.

- [ ] **Step 1: Name the adjustment in the .docx summary**

In the `.docx` export, replace the RA workload line (currently
`if (ra) children.push(kv("RA workload", [new TextRun(raExpectedText(ra) + " (" + raRangeBare(ra.total) + ")")]));`)
with:

```js
    if (ra) {
      // Never merge the user's own adjustment silently into the benchmark figure: the reader of
      // the summary must be able to see that a number was changed by hand.
      var adjTotal = ra.adjust ? (ra.adjust.core + ra.adjust.cmc + ra.adjust.pi + ra.adjust.compilation) : 0;
      var raText = raExpectedText(ra) + " (" + raRangeBare(ra.total) + ")";
      if (adjTotal) raText += " — incl. own adjustment " + (adjTotal > 0 ? "+" : "\u2212") + Math.abs(adjTotal) + " h";
      children.push(kv("RA workload", [new TextRun(raText)]));
    }
```

- [ ] **Step 2: Add an adjustment column to the Budget XLSX**

In the XLSX export, change the "Variations" sheet header row to end with an extra column:

```js
    var linesRows = [["Product", "Mode", "Variations", "Procedures", "Year", "Quarter", "Probability", "Variation Fee (EUR)", "Hours (min)", "Hours (max)", "Hours (expected)", "Hours (own adjustment)"]];
```

and append the matching value to each pushed row, after the `Hours (expected)` entry:

```js
        r.complete ? ownAdjustTotal(line.submission) : 0,
```

Add this helper next to the other export helpers in the same file:

```js
  // The user's own hour adjustment for a line, summed across the four blocks. Exported as its own
  // column so a reader can always separate the benchmark from what was changed by hand.
  function ownAdjustTotal(sub) {
    var a = (sub && sub.raTasks && sub.raTasks.hourAdjust) || {};
    return (a.core || 0) + (a.cmc || 0) + (a.pi || 0) + (a.compilation || 0);
  }
```

- [ ] **Step 3: Bump the version**

In `variation-fee-calculator/variation-fee-calculator.php`, change line 5 from
` * Version: 1.21.0` to ` * Version: 1.22.0`, and line 15 from
`define( 'VFC_VERSION', '1.21.0' );` to `define( 'VFC_VERSION', '1.22.0' );`.

Verify:

```bash
grep -n "1\.22\.0" variation-fee-calculator/variation-fee-calculator.php
```

Expected: two matching lines (5 and 15).

- [ ] **Step 4: Run the full suite one last time**

```bash
node test/test-additive-workload.js && node test/test-submission.js && node test/test-budget-engine.js && node test/test-timeline.js && node tests/vcl-workload-hours.test.js && node tests/vcl-sg-logic.test.js
```

Expected: every suite passes, exit code 0.

- [ ] **Step 5: Verify the exports in the browser**

1. Guided Workflow with a non-zero adjustment → export the summary `.docx` → the "RA workload" line
   ends with `— incl. own adjustment +6 h`.
2. Budget Planning with an adjusted line → export the workbook → the "Variations" sheet has the
   "Hours (own adjustment)" column carrying the delta.

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/variation-fee-calculator.php
git commit -m "feat(export): report the own hour adjustment in the .docx and XLSX exports (v1.22.0)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

Deployment is not part of this plan. Once the tasks are done, the usual route applies: build the
ZIP with `python build_zip.py`, deploy to the NAS test site for review, then upload to Ionos
(production) once the user confirms. The NAS deploy needs `dangerouslyDisableSandbox` — without it
it fails silently.
