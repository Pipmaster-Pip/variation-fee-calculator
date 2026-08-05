# Remove the standalone Workload Planning tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant standalone Workload Planning view while keeping the Guided Workflow's timeline unchanged.

**Architecture:** Extract the pure `computeSchedule` timeline engine (plus its `TIMING`/`ASSESS` constants) verbatim into a new `vcl-timeline.js`; point the Guided Workflow at it; then delete `vcl-workload.js` and its UI/admin wiring. Shared style/data files and the `workloadExcelUrl` config stay.

**Tech Stack:** Vanilla ES5-style browser JS (IIFE + `window.*` globals), PHP (WordPress enqueue/admin), framework-less Node tests, `build_zip.py` allowlist packager.

## Global Constraints

- **No visual change.** Only the "Workload Planning" nav tab, its view, and its overview card disappear. Every other view (Guided Workflow, Fee Calculator, Classification, Timetables, …) must look and behave identically.
- **No timeline behaviour change.** `computeSchedule` moves verbatim; identical numeric output.
- **Repo root** is `D:\Claude\Variation Fee Calculator` (parent of the `variation-fee-calculator/` plugin folder). Node tests live at repo-root `test/` and run from repo root.
- **New browser JS files** use the dual-export IIFE pattern: `(function(root){ ...; var api={...}; if (typeof module!=='undefined'&&module.exports) module.exports=api; if(root) root.VCL_X=api; })(typeof window!=='undefined'?window:null);`
- **`build_zip.py`** FILES is a hand-maintained allowlist (no glob) at repo root — every new plugin file MUST be added or the build fails with "unlisted files". Tests at repo-root `test/` are outside the plugin folder and are NOT listed.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Conventional-commit subjects.
- Branch: `feature/remove-standalone-workload-tool` (already checked out).

---

### Task 1: Extract the timeline engine into `vcl-timeline.js`

Move `computeSchedule` + `TIMING` + `ASSESS` verbatim into a new pure module, locked by a characterization test. Nothing is wired up or removed yet — after this task both the old tool and the GW still work exactly as before.

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-timeline.js`
- Test: `test/test-timeline.js` (repo root)

**Interfaces:**
- Produces: `window.VCL_TIMELINE.schedule(opts)` and `module.exports.schedule`.
  `opts = { type, iiSub, procedure, cmsCount, shared, clockStopFraction }`.
  Returns the schedule object `{ prepDays, validationDays, a1, a2, stop, showA2, pvar, closureDays, stopMin, stopMax, dPrepStart, dSub, dDay0, dA1End, dStopEnd, dEop, dClose, subToEop, totalDays }`, or `null` when `type` is unknown (e.g. a bare `"IA"`).

- [ ] **Step 1: Write the failing test**

Create `test/test-timeline.js`:

```js
// Node characterization test for the extracted timeline engine (vcl-timeline.js).
// Run from the project root: node test/test-timeline.js
// Locks computeSchedule's output so the verbatim move from vcl-workload.js cannot drift.
"use strict";
global.window = {};
var T = require("../variation-fee-calculator/assets/js/vcl-timeline.js");

var failures = 0;
function eq(label, got, want) {
  if (got !== want) { failures++; console.error("FAIL " + label + ": got " + got + ", want " + want); }
}

// 1) Type II 60-day, national, full clock stop -> fully specified case.
var s = T.schedule({ type: "II", iiSub: "60", procedure: "national", cmsCount: 0, shared: false, clockStopFraction: 1 });
eq("II60.prepDays", s.prepDays, 14);
eq("II60.validationDays", s.validationDays, 14);
eq("II60.a1", s.a1, 59);
eq("II60.a2", s.a2, 31);
eq("II60.stop", s.stop, 120);
eq("II60.showA2", s.showA2, true);
eq("II60.dEop", s.dEop, 238);
eq("II60.subToEop", s.subToEop, 224);
eq("II60.totalDays", s.totalDays, 245);

// 2) Type IAIN, national -> no A2, no clock stop.
var a = T.schedule({ type: "IAIN", procedure: "national", clockStopFraction: 1 });
eq("IAIN.prepDays", a.prepDays, 7);
eq("IAIN.showA2", a.showA2, false);
eq("IAIN.stop", a.stop, 0);
eq("IAIN.totalDays", a.totalDays, 58);

// 3) Unknown type (bare IA) -> null (Annual Update window, no individual clock).
eq("IA.null", T.schedule({ type: "IA", procedure: "national" }), null);

// 4) Validation branch by procedure/size/shared.
eq("mrpdcp.large", T.schedule({ type: "IB", procedure: "mrpdcp", cmsCount: 11 }).validationDays, 28);
eq("mrpdcp.small", T.schedule({ type: "IB", procedure: "mrpdcp", cmsCount: 5 }).validationDays, 21);
eq("cp.val", T.schedule({ type: "IB", procedure: "cp" }).validationDays, 7);
eq("shared.val", T.schedule({ type: "IB", procedure: "national", shared: true }).validationDays, 28);

// 5) clockStopFraction scales the stop (IB range 0..30).
eq("frac0", T.schedule({ type: "IB", procedure: "national", clockStopFraction: 0 }).stop, 0);
eq("frac05", T.schedule({ type: "IB", procedure: "national", clockStopFraction: 0.5 }).stop, 15);

if (failures) { console.error(failures + " assertion(s) failed"); process.exit(1); }
console.log("test-timeline.js: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `node test/test-timeline.js`
Expected: FAIL — `Cannot find module '../variation-fee-calculator/assets/js/vcl-timeline.js'`.

- [ ] **Step 3: Create the module**

Create `variation-fee-calculator/assets/js/vcl-timeline.js`. Copy `TIMING`, `ASSESS`, and `computeSchedule` **verbatim** from `assets/js/vcl-workload.js` (currently lines 83–101 and 1288–1314) — do not edit any number or expression:

```js
// Pure variation-timeline engine. No DOM, no window state.
// Dual-mode: attaches to window.VCL_TIMELINE in the browser and exports via module.exports
// in Node so it can be unit-tested without a browser. Extracted verbatim from vcl-workload.js
// (the standalone Workload Planning tool) so the Guided Workflow's Date & Timeline station keeps
// its exact output after that tool is removed.
(function (root) {
  "use strict";

  const TIMING = {
    prep: { IAIN: 7, IB: 7, "IB (unforeseen)": 14, II: 14 }, // fixed RA prep (IA = n.a., Annual Update)
    validation: { national: 14, cp: 7, mrpdcpSmall: 21, mrpdcpLarge: 28, worksharingGrouping: 28 }, // national provisional; cp 1 week (EMA only)
    closureDays: 7, // Closure by RA = EOP + 1 calendar week
  };
  // Assessment structure from the Timetables view: a1 = active days to the RSI/clock-stop point,
  // a2 = active days from resume to EOP, pvar = day the RMS circulates the PVAR,
  // stopMin..stopMax = clock-stop range (real days). Nominal EOP = a1 + a2 (II) or a1 (IB).
  const ASSESS = {
    IAIN: { a1: 30, a2: 0, pvar: 0, stopMin: 0, stopMax: 0 },
    IB: { a1: 30, a2: 30, pvar: 0, stopMin: 0, stopMax: 30 },
    "IB (unforeseen)": { a1: 30, a2: 30, pvar: 0, stopMin: 0, stopMax: 30 },
    II: {
      "30": { a1: 21, a2: 9, pvar: 15, stopMin: 0, stopMax: 20 },
      "60": { a1: 59, a2: 31, pvar: 40, stopMin: 0, stopMax: 120 },
      "90": { a1: 89, a2: 31, pvar: 70, stopMin: 0, stopMax: 150 },
    },
  };

  // Timeline schedule in calendar days from the submission (day 0 of the drawing = preparation
  // start). opts: { type, iiSub, procedure, cmsCount, shared, clockStopFraction }.
  function computeSchedule(opts) {
    const o = opts || {};
    const src = o.type === "II" ? ASSESS.II[o.iiSub || "60"] : ASSESS[o.type];
    if (!src) return null; // Type IA -> Annual Update window, no individual clock
    const range = src.stopMax - src.stopMin;
    const frac = (o.clockStopFraction == null) ? 1 : o.clockStopFraction;
    const stop = src.stopMax > 0 ? Math.round(src.stopMin + frac * range) : 0;
    const prep = (o.type === "II") ? TIMING.prep.II : (TIMING.prep[o.type] != null ? TIMING.prep[o.type] : 7);
    let validation;
    if (o.shared) validation = TIMING.validation.worksharingGrouping;
    else if (o.procedure === "mrpdcp") validation = (o.cmsCount || 0) > 10 ? TIMING.validation.mrpdcpLarge : TIMING.validation.mrpdcpSmall;
    else if (o.procedure === "cp") validation = TIMING.validation.cp;
    else validation = TIMING.validation.national;
    const showA2 = src.a2 > 0 && stop > 0;
    const dSub = prep;
    const dDay0 = prep + validation;
    const dA1End = dDay0 + src.a1;
    const dStopEnd = dA1End + stop;
    const dEop = dStopEnd + (showA2 ? src.a2 : 0);
    const dClose = dEop + TIMING.closureDays;
    return {
      prepDays: prep, validationDays: validation, a1: src.a1, a2: src.a2, stop: stop, showA2: showA2,
      pvar: src.pvar || 0, closureDays: TIMING.closureDays, stopMin: src.stopMin, stopMax: src.stopMax,
      dPrepStart: 0, dSub: dSub, dDay0: dDay0, dA1End: dA1End, dStopEnd: dStopEnd, dEop: dEop, dClose: dClose,
      subToEop: dEop - dSub, totalDays: dClose,
    };
  }

  var api = { schedule: computeSchedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_TIMELINE = api;
})(typeof window !== "undefined" ? window : null);
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `node test/test-timeline.js`
Expected: PASS — `test-timeline.js: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-timeline.js test/test-timeline.js
git commit -m "feat(timeline): extract pure computeSchedule into vcl-timeline.js"
```

---

### Task 2: Point the Guided Workflow at `vcl-timeline.js` and enqueue it

Rewire the GW's timeline call to the new module, register/enqueue `vcl-timeline` in WordPress, and swap the workflow's dependency so the new global is loaded first. After this task the GW gets its timeline from `vcl-timeline.js` in the browser; the old tool is still present and still works via its own internal copy.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` (`~514–517`, `~1992`)
- Modify: `variation-fee-calculator/includes/lookup.php` (`~157`, `~190`)

**Interfaces:**
- Consumes: `window.VCL_TIMELINE.schedule(opts)` from Task 1.

- [ ] **Step 1: Rewire the GW call site**

In `assets/js/vcl-workflow.js`, `workflowSchedule()` (currently `~514`), replace the two `window.VCL_WORKLOAD` references with `window.VCL_TIMELINE`:

```js
  function workflowSchedule() {
    const t = primaryType();
    if (!t || !window.VCL_TIMELINE || !window.VCL_TIMELINE.schedule) return null;
    return window.VCL_TIMELINE.schedule({
      type: t, iiSub: state.iiSub, procedure: state.procedure.kind,
      cmsCount: state.procedure.kind === "mrpdcp" ? state.procedure.cms.length : 0,
      shared: state.submission.grouping || multiProcedureMode(),
      clockStopFraction: state.clockStopFraction,
    });
  }
```

- [ ] **Step 2: Fix the stale comment**

In `assets/js/vcl-workflow.js` (`~1992`), the `buildMethodBox` comment still says it reads `window.VCL_WORKLOAD.factors` — no code reads `.factors`. Replace that sentence so it no longer references the removed global:

```js
  // "How the RA hours are calculated" -- a collapsible box under the live preview, available on
  // every station. Reads the current Workflow state and the additive engine
  // (window.VCL_WORKLOAD_HOURS + window.VCL_WORKLOAD_HD); content is filled in buildMethodPanel.
```

- [ ] **Step 3: Register + enqueue `vcl-timeline`, swap the workflow dependency**

In `includes/lookup.php`, add a `vcl-timeline` registration (no dependencies) — place it just before the `vcl-workflow` registration (`~184`):

```php
	$timeline_file = VFC_PLUGIN_DIR . 'assets/js/vcl-timeline.js';
	$timeline_ver  = file_exists( $timeline_file ) ? filemtime( $timeline_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-timeline',
		VFC_PLUGIN_URL . 'assets/js/vcl-timeline.js',
		array(),
		$timeline_ver,
		true
	);
```

Then change the `vcl-workflow` dependency array (`~190`) from `'vcl-workload'` to `'vcl-timeline'`:

```php
		array( 'vcl-sg-logic', 'vcl-data', 'vcl-timeline', 'vcl-calc-app' ),
```

Add the matching enqueue next to the others (`~260`, after `wp_enqueue_script( 'vcl-app' );`):

```php
	wp_enqueue_script( 'vcl-timeline' );
```

- [ ] **Step 4: Verify tests still pass and PHP has no syntax error**

Run (from repo root):
```bash
node test/test-timeline.js
php -l "variation-fee-calculator/includes/lookup.php"
```
Expected: timeline test PASS; `No syntax errors detected in .../lookup.php`.
(If `php` is unavailable locally, note it and rely on the WordPress smoke test the user runs after deploy.)

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/includes/lookup.php
git commit -m "refactor(workflow): read timeline from vcl-timeline, enqueue it"
```

---

### Task 3: Delete the standalone tool and its UI wiring

Remove `vcl-workload.js`, its nav tab, view column, overview card, and its WordPress enqueue/registration, plus the build allowlist entry. After this task there is no Workload Planning tool anywhere and the app still loads; the GW timeline is unaffected (it uses `vcl-timeline.js` from Task 2).

**Files:**
- Delete: `variation-fee-calculator/assets/js/vcl-workload.js`
- Modify: `variation-fee-calculator/assets/js/vcl-app.js` (`~84`, `~138`, `~197`, `~200`, `~207`, `~2227–2246`, `~3227`, `~3257`)
- Modify: `variation-fee-calculator/includes/lookup.php` (`~147–156`, `~259`, `~357`)
- Modify: `build_zip.py` (repo root, FILES list `~40`)

- [ ] **Step 1: Remove the nav button block in `vcl-app.js`**

Delete the entire Workload Planning nav-button block (currently `~2227–2246`) — from the `const workloadBtn = document.createElement("button");` line through the `workloadBtn` click handler and its `appendChild`. Delete the whole block including the comment above it that begins "Workload Planning: a separate, self-contained view…".

- [ ] **Step 2: Remove the remaining `vcl-app.js` workload references**

- `~138`: delete the `workloadCol: document.getElementById("vcl-workloadCol"),` line from the `el` map.
- `~197`: delete `const isWorkload = state.view === "workload";`.
- `~200`: in the `el.detailCol.classList.toggle("hidden", …)` expression, remove the `|| isWorkload` term.
- `~207`: delete the `el.workloadCol.classList.toggle("hidden", !isWorkload);` line.
- `~84`: in the `state.view` enum comment, remove `"workload" | ` from the list.
- `~3257`: delete the `{ dest: "workload", label: "Workload Planning", … }` entry from `OVERVIEW_DESTINATIONS`.
- `~3227`: delete the dispatch branch `else if (dest === "workload") state.view = "workload";`.

- [ ] **Step 3: Remove the column div and enqueue/registration in `lookup.php`**

- `~357`: delete `<div class="workload-col hidden" id="vcl-workloadCol"></div>`.
- `~147–156`: delete the `$workload_app_file` / `$workload_app_ver` lines and the whole `wp_register_script( 'vcl-workload', … )` call.
- `~259`: delete `wp_enqueue_script( 'vcl-workload' );`.
- Leave untouched: `vcl-workload-style` (style), `vcl-workload-data`, the workload-hours chain, and the `workloadExcelUrl` localize entry (all still used by the Guided Workflow).

- [ ] **Step 4: Delete the file and update the build allowlist**

```bash
git rm variation-fee-calculator/assets/js/vcl-workload.js
```
In `build_zip.py` FILES, delete the line `"assets/js/vcl-workload.js",` and add `"assets/js/vcl-timeline.js",` (keep the list alphabetical/grouped with the other `assets/js/vcl-workload-*` entries).

- [ ] **Step 5: Verify the build and tests**

Run (from repo root):
```bash
python build_zip.py
node test/test-timeline.js
```
Expected: build completes with no "unlisted files" error and produces the ZIP; timeline test still PASS.
Grep to confirm no stale references remain:
```bash
grep -rn "VCL_WORKLOAD\b\|vcl-workloadCol\|workloadBtn\|dest === \"workload\"" variation-fee-calculator/assets/js variation-fee-calculator/includes
```
Expected: no matches (note: `VCL_WORKLOAD_DATA`, `VCL_WORKLOAD_HOURS`, `VCL_WORKLOAD_HD` are different globals and must NOT be matched by `VCL_WORKLOAD\b`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove the redundant standalone Workload Planning tool"
```

---

### Task 4: Remove the Workload row from the admin settings page

Drop the now-orphaned "Workload Planning" Reference/Last-updated row from the Variation Toolbox settings section. Keep the Excel-URL field — the Guided Workflow still uses `workloadExcelUrl`.

**Files:**
- Modify: `variation-fee-calculator/includes/admin.php` (`~66`, `~90`, `~447–455`, `~543`)

- [ ] **Step 1: Remove the reference/date form row and its keys**

- `~447–455`: delete the `<th scope="row">Workload Planning</th>` row and its `vcl_reference_workload` / `vcl_last_updated_workload` inputs.
- `~66`: delete `'workload' => '2026-07-13',` from the `vcl_get_last_updated()` `$defaults`.
- `~90`: delete `'workload' => 'Internal departmental process model — durations not yet confirmed',` from the `vcl_get_reference_text()` `$defaults`.
- `~543`: remove `'workload'` from the `foreach ( array( 'classification', … 'workload' ) … )` allowlist that whitelists which keys get saved.
- Leave untouched: the Excel-URL field (`~296–300`), `vcl_handle_save_workload_excel` (`~581`), `vcl_get_workload_excel_url` (`~115`), and the `admin_post_vcl_save_workload_excel` hook (`~593`).

- [ ] **Step 2: Verify PHP has no syntax error**

Run (from repo root): `php -l "variation-fee-calculator/includes/admin.php"`
Expected: `No syntax errors detected`. (If `php` is unavailable, note it; the user's WordPress admin smoke test after deploy is the backstop.)

- [ ] **Step 3: Commit**

```bash
git add variation-fee-calculator/includes/admin.php
git commit -m "chore(admin): drop orphaned Workload Planning settings row"
```

---

## Manual verification (after deploy — no WP dev server locally)

The user runs these in the real WordPress site (the visual-unchanged constraint is checked here):
1. No "Workload Planning" tab in the toolbox nav; no "Workload Planning" card in the welcome overview.
2. Guided Workflow → Date & Timeline station renders the same dates/timeline as before this change.
3. Guided Workflow → "How the RA hours are calculated" box still shows the "⬇ Download the workbook (Excel)" link (proves `workloadExcelUrl` survived).
4. All other views (Fee Calculator, Classification, Timetables, Guidance) unchanged.
5. Admin → plugin settings: Workload Planning reference/date row gone; the Excel-URL field still present and saveable.
