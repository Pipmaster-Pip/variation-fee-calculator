# Super-Grouping & Annual Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two Type-IA-only submission modes — Annual Update and Super-Grouping — to the Guided Workflow, reusing the Worksharing pricing machinery and adding a 12-month deadline plus a chapter-C multi-RMS eligibility warning.

**Architecture:** Approach A (mode enum + shared additional-procedures list). All *pure* eligibility/date logic lives in a new, dual-mode (browser global + CommonJS) module `assets/js/vcl-sg-logic.js` so it is unit-testable in Node without a browser. `vcl-workflow.js` gets thin wrappers that read `state` and delegate to that module, plus UI/pricing/export changes. Worksharing is not rewritten — its gates are widened from "is worksharing" to "is lead-priced / is multi-procedure".

**Tech Stack:** Vanilla JS IIFE (browser), WordPress PHP enqueue, Node v24 (test runner via built-in `assert`, no dependencies), `docx` browser library (already loaded).

## Global Constraints

- Naming: always write the term as **"Super-Grouping"** (with hyphen) in all UI copy, comments, and docs.
- Only Type IA (never IAIN or IB/II) triggers the AU/SG buttons.
- No new npm dependencies, no `package.json`, no `node_modules`. Tests are plain `node <file>` scripts using the built-in `assert` module.
- Do not change any existing visual design/layout. The only new visual component is the `.vcl-wf-warn` banner.
- Do not rewrite existing Worksharing behaviour — only widen its gates.
- **Commits/pushes require explicit user approval** (project rule overrides the skill's "frequent commits"): each "Commit" step stages the change and asks the user before running `git commit`. Never `git push` unless asked.
- Comments and commit messages in English. Conventional Commits (`feat:`, `fix:`).
- After every JS edit, run `node --check <file>` and it must pass.

---

## File Structure

- **Create:** `assets/js/vcl-sg-logic.js` — pure eligibility/date functions (dual-mode export). One responsibility: Super-Grouping/Annual-Update rules with no DOM/state dependency.
- **Create:** `tests/vcl-sg-logic.test.js` — framework-less Node test for the above.
- **Modify:** `includes/lookup.php` — register/enqueue `vcl-sg-logic.js` before `vcl-workflow.js` and add it as a dependency.
- **Modify:** `assets/js/vcl-workflow.js` — state field, mode helpers/wrappers, Station B buttons + SG lead + shared procedure-list helper, Station C date + deadline, Station D pricing-gate widening, chapter-C banner, .docx export section.
- **Modify:** `assets/css/vcl-workflow-style.css` — new `.vcl-wf-warn` banner class only.

---

## Task 1: Pure logic module `vcl-sg-logic.js` + Node tests

**Files:**
- Create: `assets/js/vcl-sg-logic.js`
- Test: `tests/vcl-sg-logic.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all on `window.VCL_SG_LOGIC` in the browser, and `module.exports` in Node):
  - `computeAllVariationsAreIA(baseType: string|null, groupingTypes: (string|null)[]) -> boolean`
  - `computeAnnualUpdateDeadline(isoDateStr: string) -> Date|null`  (implementation date + 12 calendar months, month-end clamped)
  - `computeDistinctRms(procedures: {kind:string, rms?:string}[]) -> string[]` (sorted unique RMS of `mrpdcp` procedures)
  - `computeSuperGroupingConflicts(variations: {code?:string,title?:string,chapter?:string}[], procedures: {kind:string,rms?:string}[]) -> {code:string|null,title:string,chapter:'C',rmsList:string[]}[]`

- [ ] **Step 1: Write the failing test**

Create `tests/vcl-sg-logic.test.js`:

```javascript
'use strict';
var assert = require('assert');
var L = require('../assets/js/vcl-sg-logic.js');

var total = 0, failed = 0;
function t(name, fn) {
  total++;
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.error('FAIL - ' + name + ': ' + e.message); }
}

t('allVariationsAreIA: base IA + grouping all IA -> true', function () {
  assert.strictEqual(L.computeAllVariationsAreIA('IA', ['IA', 'IA']), true);
});
t('allVariationsAreIA: any non-IA -> false', function () {
  assert.strictEqual(L.computeAllVariationsAreIA('IA', ['IB']), false);
});
t('allVariationsAreIA: no variations -> false', function () {
  assert.strictEqual(L.computeAllVariationsAreIA(null, []), false);
});

t('deadline: 2026-03-15 -> 2027-03-15', function () {
  var d = L.computeAnnualUpdateDeadline('2026-03-15');
  assert.strictEqual(d.getFullYear(), 2027);
  assert.strictEqual(d.getMonth(), 2); // March = 2
  assert.strictEqual(d.getDate(), 15);
});
t('deadline: leap-day 2028-02-29 -> 2029-02-28 (clamped)', function () {
  var d = L.computeAnnualUpdateDeadline('2028-02-29');
  assert.strictEqual(d.getFullYear(), 2029);
  assert.strictEqual(d.getMonth(), 1); // Feb = 1
  assert.strictEqual(d.getDate(), 28);
});
t('deadline: empty -> null', function () {
  assert.strictEqual(L.computeAnnualUpdateDeadline(''), null);
});

t('distinctRms: only mrpdcp rms, unique + sorted', function () {
  assert.deepStrictEqual(
    L.computeDistinctRms([{ kind: 'mrpdcp', rms: 'PL' }, { kind: 'mrpdcp', rms: 'FR' }, { kind: 'national' }, { kind: 'mrpdcp', rms: 'FR' }]),
    ['FR', 'PL']
  );
});

t('conflicts: 2 RMS + a chapter-C variation -> reported', function () {
  var c = L.computeSuperGroupingConflicts(
    [{ code: 'C.I.z', title: 'Safety change', chapter: 'C' }, { code: 'E.1.a', title: 'Admin', chapter: 'E' }],
    [{ kind: 'mrpdcp', rms: 'FR' }, { kind: 'mrpdcp', rms: 'PL' }]
  );
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].code, 'C.I.z');
  assert.deepStrictEqual(c[0].rmsList, ['FR', 'PL']);
});
t('conflicts: single RMS -> none', function () {
  assert.strictEqual(L.computeSuperGroupingConflicts([{ code: 'C.1', chapter: 'C' }], [{ kind: 'mrpdcp', rms: 'FR' }]).length, 0);
});
t('conflicts: only E/Q -> none', function () {
  assert.strictEqual(L.computeSuperGroupingConflicts([{ code: 'E.1', chapter: 'E' }, { code: 'Q.1', chapter: 'Q' }], [{ kind: 'mrpdcp', rms: 'FR' }, { kind: 'mrpdcp', rms: 'PL' }]).length, 0);
});

console.log('\n' + (total - failed) + '/' + total + ' passed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/vcl-sg-logic.test.js`
Expected: FAIL — `Cannot find module '../assets/js/vcl-sg-logic.js'`.

- [ ] **Step 3: Write the module**

Create `assets/js/vcl-sg-logic.js`:

```javascript
// Pure Super-Grouping / Annual Update rules. No DOM, no window state.
// Dual-mode: attaches to window.VCL_SG_LOGIC in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser.
(function (root) {
  'use strict';

  // Every variation in play is Type IA (base + grouped extras). Empty -> false.
  function computeAllVariationsAreIA(baseType, groupingTypes) {
    var types = [baseType].concat(groupingTypes || []).filter(function (t) { return !!t; });
    if (types.length === 0) return false;
    return types.every(function (t) { return t === 'IA'; });
  }

  // Implementation date + 12 calendar months. '' -> null. Month-end is clamped
  // (e.g. 2028-02-29 -> 2029-02-28) so the day never rolls into the next month.
  function computeAnnualUpdateDeadline(isoDateStr) {
    if (!isoDateStr) return null;
    var parts = String(isoDateStr).split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d) return null;
    var target = new Date(y + 1, m - 1, d);
    if (target.getMonth() !== (m - 1)) target = new Date(y + 1, m, 0); // clamp to last day of intended month
    return target;
  }

  // Sorted unique RMS codes across the MRP/DCP procedures.
  function computeDistinctRms(procedures) {
    var set = {};
    (procedures || []).forEach(function (p) {
      if (p && p.kind === 'mrpdcp' && p.rms) set[p.rms] = true;
    });
    return Object.keys(set).sort();
  }

  // Chapter-C multi-RMS conflicts: only when >= 2 distinct RMS AND >= 1 chapter-C
  // variation. Returns one entry per offending chapter-C variation.
  function computeSuperGroupingConflicts(variations, procedures) {
    var rms = computeDistinctRms(procedures);
    if (rms.length < 2) return [];
    return (variations || [])
      .filter(function (v) { return v && v.chapter === 'C'; })
      .map(function (v) { return { code: (v.code || null), title: (v.title || ''), chapter: 'C', rmsList: rms }; });
  }

  var api = {
    computeAllVariationsAreIA: computeAllVariationsAreIA,
    computeAnnualUpdateDeadline: computeAnnualUpdateDeadline,
    computeDistinctRms: computeDistinctRms,
    computeSuperGroupingConflicts: computeSuperGroupingConflicts
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VCL_SG_LOGIC = api;
})(typeof window !== 'undefined' ? window : null);
```

- [ ] **Step 4: Run tests + syntax check**

Run: `node tests/vcl-sg-logic.test.js`
Expected: PASS — `10/10 passed`.
Run: `node --check assets/js/vcl-sg-logic.js`
Expected: no output (valid).

- [ ] **Step 5: Commit (after user approval)**

```bash
git add assets/js/vcl-sg-logic.js tests/vcl-sg-logic.test.js
git commit -m "feat: add pure Super-Grouping/Annual Update logic module with Node tests"
```

---

## Task 2: Enqueue the module before the workflow script

**Files:**
- Modify: `includes/lookup.php` (the `wp_register_script`/`wp_enqueue_script` block that registers `vcl-workflow`, around lines 120–221)

**Interfaces:**
- Consumes: the file from Task 1.
- Produces: `window.VCL_SG_LOGIC` is guaranteed loaded before `vcl-workflow.js` runs.

- [ ] **Step 1: Locate the workflow enqueue**

Run: `grep -n "vcl-workflow" includes/lookup.php`
Expected: shows the `wp_register_script('vcl-workflow', ... , array( ... deps ... ), ...)` call and its dependency array.

- [ ] **Step 2: Register the new script and add the dependency**

Add a registration for the new handle next to the other `wp_register_script` calls, mirroring their argument style (use the same base-URL/`VCL_PLUGIN_URL` constant and version variable already used by the neighbouring calls):

```php
wp_register_script(
    'vcl-sg-logic',
    VCL_PLUGIN_URL . 'assets/js/vcl-sg-logic.js',
    array(),
    VCL_VERSION,
    true
);
```

Then add `'vcl-sg-logic'` to the **dependency array** of the `vcl-workflow` registration (so WordPress loads it first), e.g. change `array( 'vcl-data', 'vcl-workload', 'vcl-calc-app' )` to `array( 'vcl-sg-logic', 'vcl-data', 'vcl-workload', 'vcl-calc-app' )`. Use the exact handle/constant names found in Step 1.

> Note: `VCL_PLUGIN_URL` / `VCL_VERSION` are placeholders for whatever constants the neighbouring `wp_register_script` calls already use — copy those verbatim from Step 1's output; do not invent new ones.

- [ ] **Step 3: Verify the edit**

Run: `grep -n "vcl-sg-logic" includes/lookup.php`
Expected: two hits — the registration and the dependency array entry.

- [ ] **Step 4: Commit (after user approval)**

```bash
git add includes/lookup.php
git commit -m "feat: enqueue vcl-sg-logic before the guided workflow script"
```

---

## Task 3: State field + mode helpers in `vcl-workflow.js`

**Files:**
- Modify: `assets/js/vcl-workflow.js` (state object 29–61; `resetAll()` 406–418; new helpers near the other predicates ~139–160; the grouping-derive line 1665)

**Interfaces:**
- Consumes: `window.VCL_SG_LOGIC` (Task 1); existing `currentType()`, `state.grouping`, `allProcedures()`, `procCountries()`.
- Produces (module-internal helpers used by later tasks):
  - `wsActive() -> boolean` (redefined as `state.submission.mode === 'worksharing'`)
  - `auActive() -> boolean`, `sgActive() -> boolean`
  - `leadPricingActive() -> boolean` (`mode === 'worksharing' || mode === 'superGrouping'`)
  - `multiProcedureMode() -> boolean` (same condition as `leadPricingActive`)
  - `annualUpdateActive() -> boolean` (`mode === 'annualUpdate' || mode === 'superGrouping'`)
  - `allVariationsAreIA() -> boolean`
  - `variationsWithChapter() -> {code,title,type,chapter}[]`
  - `superGroupingConflicts() -> {code,title,chapter:'C',rmsList}[]`
  - `annualUpdateDeadline() -> Date|null`
  - `state.submission.mode`, `state.earliestImplDate`

- [ ] **Step 1: Replace the `submission` boolean and add the date field**

In the `state` object (29–61): change `submission: { grouping: false, worksharing: false }` to `submission: { grouping: false, mode: null }` and add `earliestImplDate: ""` next to `submissionDate`.

In `resetAll()` (406–418): change the corresponding reset line to `state.submission = { grouping: false, mode: null };` and add `state.earliestImplDate = "";`.

- [ ] **Step 2: Redefine `wsActive` and add the new predicates**

Find `wsActive()` (~line 153) and replace its body so it reads the mode; add the new predicates right after it:

```javascript
function wsActive() { return state.submission.mode === 'worksharing'; }
function auActive() { return state.submission.mode === 'annualUpdate'; }
function sgActive() { return state.submission.mode === 'superGrouping'; }
function leadPricingActive() { return wsActive() || sgActive(); }
function multiProcedureMode() { return wsActive() || sgActive(); }
function annualUpdateActive() { return auActive() || sgActive(); }

function allVariationsAreIA() {
  return VCL_SG_LOGIC.computeAllVariationsAreIA(
    currentType(),
    state.grouping.map(function (g) { return g.type; })
  );
}

// Base + grouped variations, each annotated with its classification chapter (E/Q/C/M).
function variationsWithChapter() {
  var out = [];
  var pushOne = function (code, title, type) {
    var chapter = null;
    if (code) {
      var e = (DATA.ENTRIES || []).filter(function (x) { return x.code === code; })[0];
      chapter = e ? e.chapter : null;
    }
    out.push({ code: code || null, title: title || '', type: type || null, chapter: chapter });
  };
  var v = pickedVariant(), e = pickedEntry();
  if (v) pushOne(e ? e.code : null, e ? e.title : '', v.type);
  else if (currentType()) pushOne(null, '', currentType());
  state.grouping.forEach(function (g) {
    if (!g.type) return;
    var ge = g.code ? (DATA.ENTRIES || []).filter(function (x) { return x.code === g.code; })[0] : null;
    pushOne(g.code || null, ge ? ge.title : '', g.type);
  });
  return out;
}

function superGroupingConflicts() {
  if (!sgActive()) return [];
  var procs = allProcedures().map(function (p) { return { kind: p.kind, rms: p.rms }; });
  return VCL_SG_LOGIC.computeSuperGroupingConflicts(variationsWithChapter(), procs);
}

function annualUpdateDeadline() {
  return VCL_SG_LOGIC.computeAnnualUpdateDeadline(state.earliestImplDate);
}
```

> `DATA`, `pickedVariant()`, `pickedEntry()`, `currentType()`, `allProcedures()` all already exist in this file (see explorer map). `DATA = window.VCL_DATA` at the top of the IIFE.

- [ ] **Step 3: Guard the mode against illegal states**

At the grouping-derive line (1665, currently `state.submission.grouping = state.grouping.some(function (g) { return g.type; });`), add directly beneath it:

```javascript
// Mode consistency: AU/SG require Type-IA-only; Worksharing requires NOT all-IA.
if ((state.submission.mode === 'annualUpdate' || state.submission.mode === 'superGrouping') && !allVariationsAreIA()) {
  state.submission.mode = null;
} else if (state.submission.mode === 'worksharing' && allVariationsAreIA()) {
  state.submission.mode = null;
}
```

- [ ] **Step 4: Migrate remaining `submission.worksharing` reads**

Run: `grep -n "submission.worksharing" assets/js/vcl-workflow.js`
For each hit (other than the ones already handled), replace `state.submission.worksharing` with `wsActive()`. Where the surrounding logic means "any multi-procedure mode" (the `allProcedures()` composition at ~139–143 and the fee summation gates), use `multiProcedureMode()` instead. Re-run the grep; expected: **zero** remaining `submission.worksharing` reads.

- [ ] **Step 5: Syntax check + browser smoke**

Run: `node --check assets/js/vcl-workflow.js`
Expected: valid.
Browser smoke (WordPress page with the workflow): pick an IB or II variation, confirm Worksharing still works exactly as before (chip appears, lead box, fees). No console errors.

- [ ] **Step 6: Commit (after user approval)**

```bash
git add assets/js/vcl-workflow.js
git commit -m "feat: introduce submission.mode enum and AU/SG mode predicates"
```

---

## Task 4: Station B — buttons, gating, SG lead, shared procedure list

**Files:**
- Modify: `assets/js/vcl-workflow.js` (Station B submission-type block 574–593; the Worksharing list/lead builders 654–669 / 1107–1131 area)

**Interfaces:**
- Consumes: `allVariationsAreIA()`, `wsActive/auActive/sgActive`, `multiProcedureMode()`, `superGroupingConflicts()` (Task 3).
- Produces: `buildExtraProcedureList(host, mode)` shared render helper; Station B renders AU/SG buttons + SG lead + list.

- [ ] **Step 1: Render the mode controls in Station B**

In the submission-type block (574–593), replace the single Worksharing chip with conditional controls. When `allVariationsAreIA()` render two chips using the existing chip markup/classes (copy the exact class names the Worksharing chip uses — do not invent styles); otherwise render the Worksharing chip as today:

```javascript
if (allVariationsAreIA()) {
  // Type-IA-only: Super-Grouping (first) and Annual Update replace Worksharing.
  var sg = el("button", "vcl-wf-chip" + (sgActive() ? " is-on" : ""), "Super-Grouping");
  sg.type = "button";
  sg.addEventListener("click", function () { state.submission.mode = sgActive() ? null : 'superGrouping'; rerender(); });
  var au = el("button", "vcl-wf-chip" + (auActive() ? " is-on" : ""), "Annual Update");
  au.type = "button";
  au.addEventListener("click", function () { state.submission.mode = auActive() ? null : 'annualUpdate'; rerender(); });
  chipRow.appendChild(sg); chipRow.appendChild(au);
  body.appendChild(el("p", "vcl-wf-hint", "Available because every listed variation is Type IA — Worksharing is not offered here. Super-Grouping shares the same Type IA change(s) across several authorisations; Annual Update keeps them within this one."));
} else {
  // existing Worksharing chip, unchanged — toggles state.submission.mode to 'worksharing'/null
}
```

> Use the exact chip class (`vcl-wf-chip` + the active modifier) and `el(...)` factory the current Worksharing chip uses; copy them from the code you are replacing. `chipRow`/`body` are whatever container the current block appends into — reuse it.

- [ ] **Step 2: Generalise the Worksharing lead + list to a shared helper**

Rename/extend the Worksharing additional-procedures builder (`buildWorksharingList`, ~655) to `buildExtraProcedureList(host, mode)`. Keep all behaviour; only the visible title depends on the mode:

```javascript
function buildExtraProcedureList(host, mode) {
  var label = (mode === 'superGrouping') ? "super-grouping" : "worksharing";
  // ... existing body, but the panel title becomes:
  head.appendChild(el("span", "vcl-wf-list__title", "Additional procedures (" + label + ")"));
  // ... rest unchanged (count badge, rows, "+ Add procedure")
}
```

Update the Station B call site so the lead box + list render whenever `multiProcedureMode()` (not only Worksharing), and the lead label reflects the mode:

```javascript
if (multiProcedureMode()) {
  buildWorksharingLead(body, /* label */ sgActive() ? "Super-Grouping RMS (lead)" : "Worksharing RMS (lead)");
  buildExtraProcedureList(body, state.submission.mode);
}
```

Extend `buildWorksharingLead` (1107) to accept an optional `label` argument and use it for the field label (default keeps "Worksharing RMS (lead)").

- [ ] **Step 3: Syntax check + browser verification**

Run: `node --check assets/js/vcl-workflow.js`
Browser: with an all-IA selection, Station B shows Super-Grouping + Annual Update (no Worksharing). Selecting Super-Grouping reveals "Super-Grouping RMS (lead)" + "Additional procedures (super-grouping)" + "+ Add procedure". Selecting Annual Update shows neither lead nor list. Add a non-IA variation → buttons disappear, Worksharing chip returns, mode resets. No console errors.

- [ ] **Step 4: Commit (after user approval)**

```bash
git add assets/js/vcl-workflow.js
git commit -m "feat: Station B AU/SG buttons, SG lead, shared additional-procedures list"
```

---

## Task 5: Station C — earliest implementation date + deadline

**Files:**
- Modify: `assets/js/vcl-workflow.js` (Station C 807–868; the IA placeholder text 833–836)

**Interfaces:**
- Consumes: `annualUpdateActive()`, `annualUpdateDeadline()`, `fmtDate()` (existing, 359), `addDays` not needed here.
- Produces: Station C date field + deadline rows.

- [ ] **Step 1: Add the date input and deadline block**

Where Station C handles the Type-IA case (833–836), when `annualUpdateActive()` render a date input bound to `state.earliestImplDate` and the computed deadline. Use the same `<input type="date">` pattern as `submissionDate` (812–816):

```javascript
if (annualUpdateActive()) {
  var lbl = el("div", "vcl-wf-label", "Frühestes Umsetzungsdatum (Implementation Date)");
  var di = document.createElement("input");
  di.type = "date"; di.className = "vcl-wf-select"; di.value = state.earliestImplDate;
  di.addEventListener("change", function () { state.earliestImplDate = di.value; rerender(); });
  body.appendChild(lbl); body.appendChild(di);

  var dl = annualUpdateDeadline();
  var box = el("div", "vcl-wf-daterow");
  box.innerHTML =
    '<div><span>Frühestes Umsetzungsdatum</span><b>' + (state.earliestImplDate ? fmtDate(new Date(state.earliestImplDate)) : '—') + '</b></div>' +
    '<div><span>Früheste Einreichung</span><b>ab Umsetzung — heute bereits möglich</b></div>' +
    '<div><span>Späteste Einreichung</span><b>' + (dl ? fmtDate(dl) + ' (Umsetzung + 12 Monate)' : '—') + '</b></div>';
  body.appendChild(box);
}
```

> Reuse existing class names where they exist (`vcl-wf-select`, label class used by other Station C labels); `vcl-wf-daterow` may be new but must use only existing tokens/inline styles consistent with the current look — no new colours. If a suitable info-row class already exists, use it instead.

- [ ] **Step 2: Syntax check + browser verification**

Run: `node --check assets/js/vcl-workflow.js`
Browser: in AU or SG mode, Station C shows the date field; entering `2026-03-15` shows "Späteste Einreichung 15.03.2027 (Umsetzung + 12 Monate)". Empty date → "—". (The +12-month maths itself is already covered by Task 1's tests.)

- [ ] **Step 3: Commit (after user approval)**

```bash
git add assets/js/vcl-workflow.js
git commit -m "feat: Station C earliest implementation date and annual-update deadline"
```

---

## Task 6: Station D — widen pricing gates to lead-priced modes

**Files:**
- Modify: `assets/js/vcl-workflow.js` (fee helpers 240–295; Station D 982–1102)

**Interfaces:**
- Consumes: `leadPricingActive()`, `multiProcedureMode()` (Task 3).
- Produces: SG priced exactly like Worksharing (lead once, excluded from procedures).

- [ ] **Step 1: Swap the pricing gates**

Replace the `wsActive()` gate in the pricing paths with `leadPricingActive()` so Super-Grouping follows the same lead-once/exclude-lead behaviour:
- `leadFees()` (248): `if (!leadPricingActive() || ...) return null;`
- `grandTotalFees()` (293): `if (leadPricingActive()) { const lf = leadFees(counts); ... }`
- `procPricedCountries()` (269–280): use `leadPricingActive()` in place of `wsActive()` for the lead-exclusion branch.
- Station D lead box (1004–1008) and the per-line "worksharing lead — priced above" note (1042–1052): gate on `leadPricingActive()`; where the label text says "worksharing", switch to a mode-aware label ("super-grouping lead — priced above" when `sgActive()`).

Leave the worksharing-specific fee-category selection (`wsSpecialFor`/`wsOptionsFor`) keyed on `leadPricingActive()` too, so SG reuses the same category rows (see Open Point in the spec).

- [ ] **Step 2: Syntax check + browser verification**

Run: `node --check assets/js/vcl-workflow.js`
Browser (reference example — Ibu 500, 5× IA, DE/PT/LT national + FR-RMS MRP + PL-RMS MRP, one authority chosen as SG lead): Station D charges the lead once and shows a €0 "…lead — priced above" line inside its own procedure; every other authorisation is charged its IA fees; grand total = lead fee + sum of the rest. Switch back to an IB/II Worksharing case → fees identical to before this change (no regression).

- [ ] **Step 3: Commit (after user approval)**

```bash
git add assets/js/vcl-workflow.js
git commit -m "feat: price Super-Grouping via the shared lead-based fee path"
```

---

## Task 7: Chapter-C multi-RMS warning banner + CSS

**Files:**
- Modify: `assets/js/vcl-workflow.js` (Station B, after the procedure list)
- Modify: `assets/css/vcl-workflow-style.css` (new `.vcl-wf-warn`)

**Interfaces:**
- Consumes: `superGroupingConflicts()` (Task 3).
- Produces: a non-blocking warning banner naming the chapter-C variation(s) and conflicting RMS.

- [ ] **Step 1: Render the banner when conflicts exist**

In Station B, after `buildExtraProcedureList(...)`, add:

```javascript
var conflicts = superGroupingConflicts();
if (conflicts.length) {
  var rms = conflicts[0].rmsList.join(" und ");
  var names = conflicts.map(function (c) { return c.code ? (c.code + (c.title ? " (" + c.title + ")" : "")) : "Type IA (Kapitel C)"; }).join(", ");
  var warn = el("div", "vcl-wf-warn");
  warn.innerHTML =
    '<div class="vcl-wf-warn__title">Kapitel-C-Änderung über zwei verschiedene RMS</div>' +
    '<div class="vcl-wf-warn__body">Die Kapitel-C-Variation(en) <b>' + escapeHtml(names) + '</b> können nicht über die RMS <b>' + escapeHtml(rms) + '</b> zusammen gebündelt werden. Entweder die C-Änderung aus dem Super-Grouping herausnehmen oder getrennt pro RMS einreichen. Kapitel E und Q bleiben unberührt.</div>';
  body.appendChild(warn);
}
```

> `escapeHtml` already exists in this file (used throughout). It does not block progression — Station C/D stay reachable.

- [ ] **Step 2: Add the banner CSS**

Append to `assets/css/vcl-workflow-style.css` (use only colours/tokens consistent with the existing stylesheet; a warm/amber accent + left stripe, matching the calm look of `vcl-wf-hint`):

```css
.vcl-wf-warn { border: 1px solid #e6c15a; border-left: 3px solid #c8912a; background: #fdf6e3; border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
.vcl-wf-warn__title { font-weight: 600; color: #8a5a12; margin-bottom: 4px; font-size: 13px; }
.vcl-wf-warn__body { color: #6f5312; font-size: 13px; line-height: 1.5; }
```

- [ ] **Step 3: Syntax check + browser verification**

Run: `node --check assets/js/vcl-workflow.js`
Browser (reference example) with a chapter-C IA variation added and both FR and PL as RMS: banner appears naming the C variation and "FR und PL". Remove the C variation OR reduce to one RMS → banner disappears. Only E/Q variations → no banner. Progression to Station C/D remains possible throughout.

- [ ] **Step 4: Commit (after user approval)**

```bash
git add assets/js/vcl-workflow.js assets/css/vcl-workflow-style.css
git commit -m "feat: chapter-C multi-RMS warning banner for Super-Grouping"
```

---

## Task 8: .docx export — Annual Update / Super-Grouping section + LoI

**Files:**
- Modify: `assets/js/vcl-workflow.js` (`exportSummaryDocx` 1330–1487; insert between Summary ~1396 and the Variations table ~1399)

**Interfaces:**
- Consumes: `annualUpdateActive()`, `sgActive()`, `annualUpdateDeadline()`, `allProcedures()`, `superGroupingConflicts()`, `fmtDate()`, existing `kv()` helper.
- Produces: a new export section; the existing Variations table doubles as the Letter of Intent for SG.

- [ ] **Step 1: Insert the export section**

After the Summary key-value block and before the Variations table is built, add (using the same `docx` primitives already imported at 1338 and the `kv()` helper at 1363):

```javascript
if (annualUpdateActive()) {
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 },
    children: [new TextRun(sgActive() ? "Super-Grouping" : "Annual Update")] }));
  children.push(kv("Modus", [new TextRun(sgActive() ? "Super-Grouping (Type IA)" : "Annual Update (Type IA)")]));
  children.push(kv("Frühestes Umsetzungsdatum", [new TextRun(state.earliestImplDate ? fmtDate(new Date(state.earliestImplDate)) : "—")]));
  var dl = annualUpdateDeadline();
  children.push(kv("Früheste Einreichung", [new TextRun("ab Umsetzung — heute bereits möglich")]));
  children.push(kv("Späteste Einreichung", [new TextRun(dl ? fmtDate(dl) + " (Umsetzung + 12 Monate)" : "—")]));

  if (sgActive()) {
    var lines = allProcedures().map(function (p) { return procDetail(p); }); // procDetail exists (1214)
    children.push(kv("Zulassungen / Verfahren", [new TextRun(lines.join("; "))]));
    var conf = superGroupingConflicts();
    if (conf.length) {
      var rms = conf[0].rmsList.join(" und ");
      var names = conf.map(function (c) { return c.code || "Type IA (Kapitel C)"; }).join(", ");
      children.push(kv("Hinweis Kapitel C", [new TextRun("Kapitel-C-Variation(en) " + names + " nicht über RMS " + rms + " gemeinsam bündelbar — herausnehmen oder pro RMS getrennt einreichen.")]));
    }
  }
}
```

> `procDetail(p)` (1214), `kv()` (1363), and the destructured `Paragraph/TextRun/HeadingLevel` (1338) all already exist. For SG the existing "Variations" table (1399–1427, Number/Title/Type) serves as the Letter of Intent across all authorisations — no separate table needed; optionally rename its heading to "Letter of Intent" when `sgActive()`.

- [ ] **Step 2: Syntax check + browser verification**

Run: `node --check assets/js/vcl-workflow.js`
Browser: in SG mode with the reference data and `2026-03-15`, click the summary export; the generated .docx contains a "Super-Grouping" section with the dates (späteste Einreichung 15.03.2027), the authorisations list, and — if a C-conflict exists — the chapter-C note; the Variations table is present as the LoI. In AU mode the section reads "Annual Update" without the authorisations list.

- [ ] **Step 3: Commit (after user approval)**

```bash
git add assets/js/vcl-workflow.js
git commit -m "feat: export Annual Update / Super-Grouping section and LoI in .docx"
```

---

## Task 9: Build the WordPress ZIP + final verification

**Files:**
- No source changes; produces the deliverable ZIP.

- [ ] **Step 1: Re-run the pure-logic tests and all syntax checks**

Run: `node tests/vcl-sg-logic.test.js` → `10/10 passed`.
Run: `node --check assets/js/vcl-sg-logic.js` and `node --check assets/js/vcl-workflow.js` → valid.

- [ ] **Step 2: Confirm the new file is packaged**

Ensure `build_zip.py` includes `assets/js/*.js` (it globs the assets dir). Run: `python build_zip.py`
Expected: `OK … variation-fee-calculator.zip` with a file count one higher than before (the new `vcl-sg-logic.js`).
Run: `unzip -l variation-fee-calculator.zip | grep vcl-sg-logic.js` → one hit.

- [ ] **Step 3: Walk the success criteria (spec §12)**

Manually verify each of the 7 success criteria from the spec in a WordPress instance (IA-only buttons; SG lead+list+LoI; SG fees == WS pattern; 15.03.2026→15.03.2027; chapter-C banner logic; no Worksharing regression; no design change beyond `.vcl-wf-warn`).

- [ ] **Step 4: Commit (after user approval)**

```bash
git add -A
git commit -m "chore: rebuild plugin ZIP with Super-Grouping/Annual Update"
```

---

## Self-Review (done at write time)

- **Spec coverage:** §1 modes → Tasks 3,4; §3 date granularity (single field) → Tasks 3,5; §fees WS-path → Task 6; §chapter-C warning → Tasks 1,3,7; §architecture Approach A → Tasks 3,4; §export + LoI → Task 8; §CSS banner → Task 7; §edge cases (mode guard, empty date, 1-RMS, lead double-count) → Tasks 1,3,6,7. All covered.
- **Placeholders:** none — every code step carries real code; `VCL_PLUGIN_URL`/`VCL_VERSION` explicitly flagged as "copy the neighbour's constant verbatim", not invented.
- **Type consistency:** `computeAllVariationsAreIA`, `computeAnnualUpdateDeadline`, `computeDistinctRms`, `computeSuperGroupingConflicts` names identical across Tasks 1/3; `leadPricingActive`/`multiProcedureMode`/`annualUpdateActive`/`sgActive`/`auActive`/`wsActive` used consistently in Tasks 3/4/6/8; `buildExtraProcedureList(host, mode)` defined in Task 4 and called there.
- **Open point carried from spec:** whether SG has dedicated fee-category rows — Task 6 reuses the WS rows via `leadPricingActive()` with standard fallback; flagged, not blocking.
