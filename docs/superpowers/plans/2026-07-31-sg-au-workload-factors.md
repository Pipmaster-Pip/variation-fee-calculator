# SG & AU Workload Factors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Workload Planning tool's Super-Grouping and Annual Update RA-hours factors in line with the maintained workbook, and give Super-Grouping the per-procedure counters (national/MRP-DCP/CP, CP-exclusive) it needs to use its new hours.

**Architecture:** Extract the submission "per-item" hours sum and the SG counter-visibility rule into a new pure, dual-export module `vcl-workload-hours.js` (same pattern as `vcl-sg-logic.js`), unit-tested under Node. The `vcl-workload.js` IIFE keeps the factor table (`F`) — per the SCOPE note in `vcl-workload-data.js` — but delegates the sum to the pure module and reads the visibility rule from it. UI and the "How this estimate is built" panel gain SG rows.

**Tech Stack:** Vanilla ES5-style JS (browser IIFE + CommonJS dual export), Node's built-in `assert` for tests, Python `build_zip.py` for packaging, WordPress `wp_register_script` enqueue.

**Reference spec:** `docs/superpowers/specs/2026-07-31-sg-au-workload-factors-design.md`

## Global Constraints

- Source of truth for every factor value is `Workload_RA_Stunden_Faktoren.xlsx`: SG factor `1.2`, SG per further procedure national/MRP-DCP/CP each `1`, AU per Type IA `0.5`, Grouping per Type IA `0.5`.
- All RA-hours factor VALUES stay in the `F` object in `vcl-workload.js` (SCOPE note in `vcl-workload-data.js` forbids moving them). The new module holds pure FUNCTIONS only; factors are passed in as arguments.
- New module must be dual-export: `module.exports` for Node + `window.VCL_WORKLOAD_HOURS` for the browser (copy the footer of `vcl-sg-logic.js` verbatim in shape).
- `build_zip.py`'s `FILES` list is exact — any new plugin file must be added there or the build fails on "unlisted files".
- Tests run individually: `node tests/<file>.test.js`; they live in the repo-root `tests/`, outside the plugin folder, and are NOT in `build_zip.py`'s `FILES`.
- CP exclusivity: a `cp` main procedure shows only the CP counter; a `national`/`mrpdcp` main procedure shows national + MRP/DCP and hides CP.
- **Commits require explicit user approval (per CLAUDE.md).** The `git commit` steps below are listed for completeness; ask the user before running any of them. Commit messages follow Conventional Commits.
- Paths are relative to the repo root `D:\Claude\Variation Fee Calculator`.

---

### Task 1: Pure hours module + Node tests

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-workload-hours.js`
- Test: `tests/vcl-workload-hours.test.js`

**Interfaces:**
- Produces:
  - `computeSubmissionAddHours(procOptions, counts, submissionF) -> Number` — sum of per-item hours across worksharing, grouping, annualUpdate, superGrouping. `procOptions` = `{worksharing, grouping, annualUpdate, superGrouping}` booleans; `counts` = object with `worksharingNational, worksharingMrpdcp, groupingIA, groupingIB, groupingII, annualUpdateIaCount, superGroupingNational, superGroupingMrpdcp, superGroupingCp` numbers; `submissionF` = `F.submission` shape.
  - `computeSgCounterKinds(procedure) -> Array<string>` — `['cp']` when `procedure === 'cp'`, else `['national','mrpdcp']`.
  - Exposed as `module.exports` and `window.VCL_WORKLOAD_HOURS`.

- [ ] **Step 1: Write the failing test**

Create `tests/vcl-workload-hours.test.js`:

```js
'use strict';
var assert = require('assert');
var H = require('../variation-fee-calculator/assets/js/vcl-workload-hours.js');

var total = 0, failed = 0;
function t(name, fn) {
  total++;
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.error('FAIL - ' + name + ': ' + e.message); }
}

var SF = {
  worksharing:   { factor: 1.2, perNational: 1, perMrpdcp: 2 },
  grouping:      { factor: 1.2, perIA: 0.5, perIB: 1, perII: 2 },
  annualUpdate:  { factor: 1.2, perIA: 0.5 },
  superGrouping: { factor: 1.2, perNational: 1, perMrpdcp: 1, perCp: 1 }
};
function counts(over) {
  var base = {
    worksharingNational: 0, worksharingMrpdcp: 0,
    groupingIA: 0, groupingIB: 0, groupingII: 0,
    annualUpdateIaCount: 0,
    superGroupingNational: 0, superGroupingMrpdcp: 0, superGroupingCp: 0
  };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

t('addHours: nothing ticked -> 0', function () {
  assert.strictEqual(H.computeSubmissionAddHours({}, counts(), SF), 0);
});
t('addHours: SG CP-only, 2 CP procedures -> 2', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ superGrouping: true }, counts({ superGroupingCp: 2 }), SF), 2);
});
t('addHours: SG national + MRP/DCP -> 2', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ superGrouping: true }, counts({ superGroupingNational: 1, superGroupingMrpdcp: 1 }), SF), 2);
});
t('addHours: AU 4 x Type IA at 0.5 -> 2', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ annualUpdate: true }, counts({ annualUpdateIaCount: 4 }), SF), 2);
});
t('addHours: Grouping 2 x IA (0.5) + 1 x II (2) -> 3', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ grouping: true }, counts({ groupingIA: 2, groupingII: 1 }), SF), 3);
});
t('addHours: inactive option is ignored even if counts set', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ superGrouping: false }, counts({ superGroupingCp: 5 }), SF), 0);
});
t('sgKinds: cp -> [cp]', function () {
  assert.deepStrictEqual(H.computeSgCounterKinds('cp'), ['cp']);
});
t('sgKinds: national -> [national, mrpdcp]', function () {
  assert.deepStrictEqual(H.computeSgCounterKinds('national'), ['national', 'mrpdcp']);
});
t('sgKinds: mrpdcp -> [national, mrpdcp]', function () {
  assert.deepStrictEqual(H.computeSgCounterKinds('mrpdcp'), ['national', 'mrpdcp']);
});

console.log('\n' + (total - failed) + '/' + total + ' passed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/vcl-workload-hours.test.js`
Expected: FAIL — `Cannot find module '../variation-fee-calculator/assets/js/vcl-workload-hours.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `variation-fee-calculator/assets/js/vcl-workload-hours.js`:

```js
// Pure Workload-Planning hour helpers. No DOM, no window state.
// Dual-mode: attaches to window.VCL_WORKLOAD_HOURS in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser.
(function (root) {
  'use strict';

  // Sum of the per-item ("+ hours") add-ons across the ticked submission types. Factor
  // multipliers are applied elsewhere (submissionFactorProduct); this is only the additive part.
  function computeSubmissionAddHours(procOptions, counts, s) {
    procOptions = procOptions || {};
    counts = counts || {};
    s = s || {};
    var h = 0;
    if (procOptions.worksharing && s.worksharing) {
      h += (s.worksharing.perNational || 0) * (counts.worksharingNational || 0)
         + (s.worksharing.perMrpdcp || 0) * (counts.worksharingMrpdcp || 0);
    }
    if (procOptions.grouping && s.grouping) {
      h += (s.grouping.perIA || 0) * (counts.groupingIA || 0)
         + (s.grouping.perIB || 0) * (counts.groupingIB || 0)
         + (s.grouping.perII || 0) * (counts.groupingII || 0);
    }
    if (procOptions.annualUpdate && s.annualUpdate) {
      h += (s.annualUpdate.perIA || 0) * (counts.annualUpdateIaCount || 0);
    }
    if (procOptions.superGrouping && s.superGrouping) {
      h += (s.superGrouping.perNational || 0) * (counts.superGroupingNational || 0)
         + (s.superGrouping.perMrpdcp || 0) * (counts.superGroupingMrpdcp || 0)
         + (s.superGrouping.perCp || 0) * (counts.superGroupingCp || 0);
    }
    return h;
  }

  // Which SG per-procedure counters to show, given the single main procedure. CP cannot mix
  // with national/mrpdcp (mirrors the Guided Workflow's CP exclusivity): a CP main procedure
  // shows only the CP counter; anything else shows national + MRP/DCP.
  function computeSgCounterKinds(procedure) {
    return procedure === 'cp' ? ['cp'] : ['national', 'mrpdcp'];
  }

  var api = {
    computeSubmissionAddHours: computeSubmissionAddHours,
    computeSgCounterKinds: computeSgCounterKinds
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VCL_WORKLOAD_HOURS = api;
})(typeof window !== 'undefined' ? window : null);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/vcl-workload-hours.test.js`
Expected: PASS — `9/9 passed`.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add tests/vcl-workload-hours.test.js variation-fee-calculator/assets/js/vcl-workload-hours.js
git commit -m "feat(workload): add pure submission-hours + SG-counter-kinds module with tests"
```

---

### Task 2: Register and package the new module

**Files:**
- Modify: `variation-fee-calculator/includes/lookup.php:120-129` (add dependency + register new script before it)
- Modify: `build_zip.py:41` (add to `FILES`)

**Interfaces:**
- Consumes: `window.VCL_WORKLOAD_HOURS` from Task 1.
- Produces: `vcl-workload-hours` registered script handle, loaded before `vcl-workload`.

- [ ] **Step 1: Register the script in lookup.php**

Insert this block immediately BEFORE the `vcl-workload` registration (before line 120 `$workload_app_file = ...`):

```php
	// Workload pure hour helpers (window.VCL_WORKLOAD_HOURS). No dependencies; registered
	// before vcl-workload so its global is ready by the time that script runs.
	$workload_hours_file = VFC_PLUGIN_DIR . 'assets/js/vcl-workload-hours.js';
	$workload_hours_ver  = file_exists( $workload_hours_file ) ? filemtime( $workload_hours_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-workload-hours',
		VFC_PLUGIN_URL . 'assets/js/vcl-workload-hours.js',
		array(),
		$workload_hours_ver,
		true
	);
```

Then add `'vcl-workload-hours'` to the `vcl-workload` dependency array (line 126):

```php
		array( 'vcl-data', 'vcl-workload-data', 'vcl-workload-hours' ),
```

- [ ] **Step 2: Add the file to build_zip.py FILES**

In `build_zip.py`, add the line after `"assets/js/vcl-workload-data.js",` (line 40):

```python
    "assets/js/vcl-workload-hours.js",
```

- [ ] **Step 3: Run the build to verify packaging**

Run: `python build_zip.py`
Expected: `OK  ...variation-fee-calculator.zip` with the file count increased by one and no "unlisted files" error.

- [ ] **Step 4: Commit** (ask user first)

```bash
git add variation-fee-calculator/includes/lookup.php build_zip.py
git commit -m "build(workload): register and package vcl-workload-hours.js"
```

---

### Task 3: Update factor values and wire the IIFE to the pure module

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workload.js` — `F_META` (44-47), `F.submission` (55-60), `state` (133-144), `submissionAddHours` (227-234), `submissionPending` (235-242)

**Interfaces:**
- Consumes: `window.VCL_WORKLOAD_HOURS.computeSubmissionAddHours` from Task 1.
- Produces: `state.superGroupingNational/Mrpdcp/Cp` (numbers) consumed by Task 4's UI.

- [ ] **Step 1: Bump F_META.lastChecked**

In `F_META` (line 45), change:

```js
    lastChecked: "2026-07-31",
```

- [ ] **Step 2: Update F.submission factor values**

Replace the `submission` block (lines 55-60) with:

```js
    submission: {
      worksharing: { factor: 1.2, perNational: 1, perMrpdcp: 2 },
      grouping: { factor: 1.2, perIA: 0.5, perIB: 1, perII: 2 },
      annualUpdate: { factor: 1.2, perIA: 0.5 },
      superGrouping: { factor: 1.2, perNational: 1, perMrpdcp: 1, perCp: 1 },
    },
```

- [ ] **Step 3: Add SG counters to state**

After `annualUpdateIaCount: 0,` (line 139) add:

```js
    superGroupingNational: 0,
    superGroupingMrpdcp: 0,
    superGroupingCp: 0,
```

- [ ] **Step 4: Grab the module global near the top of the IIFE**

After `const WD = window.VCL_WORKLOAD_DATA;` and its guard (lines 16-17), add:

```js
  const WLH = window.VCL_WORKLOAD_HOURS;
  if (!WLH) return;
```

- [ ] **Step 5: Delegate submissionAddHours to the module**

Replace the whole `submissionAddHours` function (lines 227-234) with:

```js
  function submissionAddHours() {
    return WLH.computeSubmissionAddHours(state.procOptions, state, F.submission);
  }
```

(`state` carries all the count fields by name, so it doubles as the `counts` argument.)

- [ ] **Step 6: Extend submissionPending for SG per-procedure fields**

In `submissionPending` (line 240), replace the superGrouping line with one that also accounts for the new per-procedure hours:

```js
    if (state.procOptions.superGrouping && s.superGrouping.factor == null && s.superGrouping.perNational == null && s.superGrouping.perMrpdcp == null && s.superGrouping.perCp == null) return true;
```

- [ ] **Step 7: Verify the module tests still pass and factors are consistent**

Run: `node tests/vcl-workload-hours.test.js`
Expected: PASS — `9/9 passed` (unchanged; this task doesn't touch the module, but confirms nothing broke the shared shape).

- [ ] **Step 8: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workload.js
git commit -m "feat(workload): sync SG/AU/grouping factors to workbook, delegate add-hours to pure module"
```

---

### Task 4: SG counter UI + transparency panel rows

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workload.js` — `buildProcedureOptions` subRow (656-669), method add-ons table (1129-1137)

**Interfaces:**
- Consumes: `state.superGroupingNational/Mrpdcp/Cp` (Task 3), `WLH.computeSgCounterKinds` (Task 1), `F.submission.superGrouping.perNational/perMrpdcp/perCp` (Task 3).

- [ ] **Step 1: Add the SG counter block to the subRow**

In `buildProcedureOptions`, immediately after the `if (state.procOptions.annualUpdate) ...` line (line 668) and before `if (subRow.children.length) ...` (line 669), add:

```js
    if (state.procOptions.superGrouping) {
      const kinds = WLH.computeSgCounterKinds(state.procedure);
      const sg = F.submission.superGrouping;
      if (kinds.indexOf("national") !== -1) subRow.appendChild(numberField("vcl-wl-sg-nat", "Other procedures — national", state.superGroupingNational, (v) => { state.superGroupingNational = v; }, hoursPill(sg.perNational))); else state.superGroupingNational = 0;
      if (kinds.indexOf("mrpdcp") !== -1) subRow.appendChild(numberField("vcl-wl-sg-mrp", "Other procedures — MRP/DCP", state.superGroupingMrpdcp, (v) => { state.superGroupingMrpdcp = v; }, hoursPill(sg.perMrpdcp))); else state.superGroupingMrpdcp = 0;
      if (kinds.indexOf("cp") !== -1) subRow.appendChild(numberField("vcl-wl-sg-cp", "Other procedures — CP", state.superGroupingCp, (v) => { state.superGroupingCp = v; }, hoursPill(sg.perCp))); else state.superGroupingCp = 0;
    }
```

- [ ] **Step 2: Add SG rows to the "Add-ons" method table**

In the `methodTable("+ Add-ons ...")` array, after the Annual Update line (line 1136) add:

```js
      { label: "Super-Grouping · per national procedure", val: "+ " + s.superGrouping.perNational + " h", active: state.procOptions.superGrouping && state.superGroupingNational > 0 },
      { label: "Super-Grouping · per MRP/DCP procedure", val: "+ " + s.superGrouping.perMrpdcp + " h", active: state.procOptions.superGrouping && state.superGroupingMrpdcp > 0 },
      { label: "Super-Grouping · per CP procedure", val: "+ " + s.superGrouping.perCp + " h", active: state.procOptions.superGrouping && state.superGroupingCp > 0 },
```

- [ ] **Step 3: Browser verification — CP exclusivity + hours**

Start the preview and open the Workload tool. Pick a Type IA classification, tick **Super-Grouping**, then:
1. Set main procedure to **National** → confirm the subRow shows "national" and "MRP/DCP" SG counters, NO "CP" counter.
2. Enter national = 2 → confirm the RA-hours breakdown shows "+ Grouped / shared items 2 h" and the "How this estimate is built" panel lists "Super-Grouping · per national procedure + 1 h" active.
3. Switch main procedure to **CP** → confirm only the "CP" SG counter shows and `superGroupingNational` reset to 0 (the national field is gone and its hours dropped out of the total).

Capture a screenshot of each state as proof.

- [ ] **Step 4: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workload.js
git commit -m "feat(workload): SG per-procedure counters with CP exclusivity + panel rows"
```

---

### Task 5: Remove the stale workbook note (R62)

**Files:**
- Modify: `Workload_RA_Stunden_Faktoren.xlsx`, sheet "Faktoren", cell B62

**Interfaces:** none (documentation-only, no code).

- [ ] **Step 1: Clear cell B62 via Excel COM**

The cell holds "Super-Grouping hat (aktuell) keine mengenabhängigen Zusatzstunden – nur den Faktor in ⑤a.", which the new R55–57 rows contradict. **Must** use Word/Excel COM — never openpyxl (it drops the workbook's drawings).

Run (PowerShell):

```powershell
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$wb = $xl.Workbooks.Open("D:\Claude\Variation Fee Calculator\Workload_RA_Stunden_Faktoren.xlsx")
$ws = $wb.Worksheets.Item("Faktoren")
$ws.Range("B62").ClearContents() | Out-Null
$wb.Save()
$wb.Close($true)
$xl.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
```

- [ ] **Step 2: Verify the cell is empty**

Re-open read-only to confirm (reading with openpyxl never harms the drawings — only saving does):

Run:
```bash
python -c "import openpyxl; wb=openpyxl.load_workbook(r'D:/Claude/Variation Fee Calculator/Workload_RA_Stunden_Faktoren.xlsx', data_only=True); print(repr(wb['Faktoren']['B62'].value))"
```
Expected: `None`.

- [ ] **Step 3: Commit** (ask user first)

```bash
git add "Workload_RA_Stunden_Faktoren.xlsx"
git commit -m "docs(workload): remove stale 'SG has no per-item hours' note (R62)"
```

---

### Task 6: `raHoursFor` — add AU/SG and route the sum through the pure module

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workload.js` — `raHoursFor` (1306-1326) and its doc comment

**Interfaces:**
- Consumes: `WLH.computeSubmissionAddHours` (Task 1), `F.submission` (Task 3), `state`-independent (pure from `opts`).
- Produces: `window.VCL_WORKLOAD.raHours` now honours `opts.annualUpdate`, `opts.annualUpdateIaCount`, `opts.superGrouping`, `opts.superGroupingProcs` (consumed by Task 7).

- [ ] **Step 1: Replace `raHoursFor` with the AU/SG-aware, DRY version**

Replace the whole function and its comment (lines 1306-1326) with:

```js
  // RA preparation hours for one (primary) procedure, mirroring computeRaHours() but from
  // explicit inputs. opts: { type, substance, procedure, cmsCount, grouping, worksharing,
  // annualUpdate, superGrouping, groupingCounts:{IA,IB,II}, worksharingProcs:{national,mrpdcp},
  // superGroupingProcs:{national,mrpdcp,cp}, annualUpdateIaCount }. The per-item add-hours sum is
  // delegated to the shared pure module so this API and the tool's own view never diverge.
  function raHoursFor(opts) {
    const o = opts || {};
    const base = F.baseHours[o.type] || 0;
    let pf = F.procedure.national;
    if (o.procedure === "mrpdcp") pf = (o.cmsCount || 0) > F.procedure.cmsThreshold ? F.procedure.mrpdcpLarge : F.procedure.mrpdcpSmall;
    else if (o.procedure === "cp") pf = F.procedure.cp;
    const af = o.substance === "biologic" ? F.activeSubstance.biologic : (o.substance === "chemical" ? F.activeSubstance.chemical : 1);
    let sf = 1;
    if (o.grouping) sf *= F.submission.grouping.factor;
    if (o.worksharing) sf *= F.submission.worksharing.factor;
    if (o.annualUpdate) sf *= F.submission.annualUpdate.factor;
    if (o.superGrouping) sf *= F.submission.superGrouping.factor;
    const gc = o.groupingCounts || {};
    const wp = o.worksharingProcs || {};
    const sp = o.superGroupingProcs || {};
    const procOptions = { worksharing: o.worksharing, grouping: o.grouping, annualUpdate: o.annualUpdate, superGrouping: o.superGrouping };
    const counts = {
      worksharingNational: wp.national || 0, worksharingMrpdcp: wp.mrpdcp || 0,
      groupingIA: gc.IA || 0, groupingIB: gc.IB || 0, groupingII: gc.II || 0,
      annualUpdateIaCount: o.annualUpdateIaCount || 0,
      superGroupingNational: sp.national || 0, superGroupingMrpdcp: sp.mrpdcp || 0, superGroupingCp: sp.cp || 0,
    };
    let add = WLH.computeSubmissionAddHours(procOptions, counts, F.submission);
    if (o.procedure === "mrpdcp") add += (F.cmsHoursPer || 0) * (o.cmsCount || 0);
    return base * (pf * af * sf) + add;
  }
```

- [ ] **Step 2: Confirm the module tests still pass**

The add-hours behaviour for AU/SG is already covered by Task 1's module tests (SG CP-only, SG national+MRP/DCP, AU 4×IA). `raHoursFor` itself lives in the IIFE and is code-verified, not unit-tested.

Run: `node tests/vcl-workload-hours.test.js`
Expected: PASS — `9/9 passed`.

- [ ] **Step 3: Code-verify equivalence for the pre-existing grouping/worksharing paths**

Read the new `raHoursFor` and confirm: for a call with only `grouping`/`worksharing` set (the shape `raEffort()` sends today), the mapped `counts` reproduce the old inline sum exactly (`grouping.perIA×gc.IA + … + worksharing.perNational×wp.national + …`). This guards against a regression in the existing Guided-Workflow grouping/worksharing effort.

- [ ] **Step 4: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workload.js
git commit -m "feat(workload): raHoursFor honours AU/SG and reuses the pure add-hours module"
```

---

### Task 7: `raEffort()` passes AU/SG context, mode-exclusively

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` — add `sgProcKinds()` after `worksharingKinds()` (419), rewrite `raEffort()` (421-430)

**Interfaces:**
- Consumes: `raHoursFor` opts contract from Task 6; existing `auActive()`, `sgActive()`, `wsActive()`, `groupingBuckets()`, `worksharingKinds()`, `state.worksharing`.

- [ ] **Step 1: Add the `sgProcKinds()` helper**

Immediately after `worksharingKinds()` (after line 419's closing `}` and its `return k;`), add:

```js
  // Further Super-Grouping procedures counted by kind (incl. CP, unlike worksharingKinds). The
  // primary procedure (state.procedure) is the base and is not counted here.
  function sgProcKinds() {
    const k = { national: 0, mrpdcp: 0, cp: 0 };
    if (sgActive()) state.worksharing.forEach((p) => { if (k[p.kind] !== undefined) k[p.kind]++; });
    return k;
  }
```

- [ ] **Step 2: Rewrite the `raHours` call in `raEffort()`**

Replace the `window.VCL_WORKLOAD.raHours({ … })` object (lines 424-429) with:

```js
    return window.VCL_WORKLOAD.raHours({
      type: t, substance: state.activeSubstance, procedure: state.procedure.kind,
      cmsCount: state.procedure.kind === "mrpdcp" ? state.procedure.cms.length : 0,
      grouping: state.submission.grouping && !(auActive() || sgActive()), worksharing: wsActive(),
      groupingCounts: groupingBuckets(), worksharingProcs: worksharingKinds(),
      annualUpdate: auActive(), annualUpdateIaCount: auActive() ? 1 + groupingBuckets().IA : 0,
      superGrouping: sgActive(), superGroupingProcs: sgProcKinds(),
    });
```

- [ ] **Step 3: Code-verify mode exclusivity**

Read the change and confirm each mode sets exactly one submission factor:
- **grouping-only** (mode null, grouping entries, not all-IA): `grouping:true`, others false → grouping factor only.
- **worksharing** (`wsActive`): `worksharing:true`, `grouping:false` (auOrSg is false but mode is 'worksharing' so grouping may still be true if grouping entries exist — this matches pre-existing worksharing behaviour and is unchanged), AU/SG false.
- **AU** (`auActive`): `annualUpdate:true`, `grouping:false`, `worksharing:false`, `superGrouping:false`; `annualUpdateIaCount = 1 + groupingBuckets().IA`.
- **SG** (`sgActive`): `superGrouping:true`, `worksharing:false` (was `multiProcedureMode()`=true — the fix), `grouping:false`, `annualUpdate:false`; `superGroupingProcs` counts the further procedures incl. CP.

Note the intended behaviour change: SG effort previously used worksharing hours (MRP/DCP 2 h, CP uncounted); now uses SG hours (MRP/DCP 1 h, CP 1 h). Confirm this is what the diff produces.

- [ ] **Step 4: Syntax check**

Run: `node -e "new Function(require('fs').readFileSync('variation-fee-calculator/assets/js/vcl-workflow.js','utf8'))" && echo "syntax ok"`
Expected: `syntax ok` (parses the file; it won't execute the IIFE without a browser, but catches syntax errors).

- [ ] **Step 5: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js
git commit -m "feat(workflow): raEffort passes AU/SG context to workload engine, mode-exclusive"
```

---

## Self-Review

**Spec coverage:**
- SG factor 1.3→1.2 → Task 3 Step 2. ✓
- SG per-procedure hours (national/MRP-DCP/CP) → module Task 1 + values Task 3 + UI Task 4. ✓
- AU per IA 5→0.5 → Task 3 Step 2 + regression test Task 1. ✓
- Grouping per IA 1→0.5 → Task 3 Step 2 + test Task 1. ✓
- F_META bump → Task 3 Step 1. ✓
- Three SG counters + CP exclusivity → Task 4 Step 1 (via `computeSgCounterKinds`). ✓
- submissionAddHours / submissionPending → Task 3 Steps 5-6. ✓
- Method panel SG rows → Task 4 Step 2. ✓
- Tests → Task 1. ✓
- Workbook R62 cleanup → Task 5. ✓
- Enqueue + packaging of new module (implied by "changes to vcl-workload.js" + module extraction) → Task 2. ✓
- Addendum A: raHoursFor honours AU/SG + reuses pure module (DRY) → Task 6. ✓
- Addendum B: raEffort passes AU/SG context, mode-exclusive, `sgProcKinds()` with CP → Task 7. ✓
- Addendum: AU count = all Type-IA (1 + groupingBuckets().IA) → Task 7 Step 2. ✓
- Addendum: SG behaviour change (worksharing→SG hours) is intended → Task 7 Step 3 verification. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `computeSubmissionAddHours(procOptions, counts, s)` and `computeSgCounterKinds(procedure)` used identically in Tasks 1, 3, 4. `state` field names (`superGroupingNational/Mrpdcp/Cp`) and `F.submission.superGrouping.perNational/perMrpdcp/perCp` match across Tasks 3 and 4. ✓
