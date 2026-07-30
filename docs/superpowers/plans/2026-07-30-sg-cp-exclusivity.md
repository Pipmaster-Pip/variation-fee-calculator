# Super-Grouping CP-Exclusivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Super-Grouping only, prevent mixing `cp` (Centralised Procedure) with `national`/`mrpdcp` procedures in the same group, while still allowing multiple `cp` procedures together — enforced by disabling the incompatible kind chip(s) in the procedure editor.

**Architecture:** One new pure function `computeAllowedProcedureKinds(procedures, currentProcedure)` in `vcl-sg-logic.js` (same dual-mode/testable pattern as the existing `compute*` functions), consumed by `procEditor()` in `vcl-workflow.js` only when `sgActive()` is true, to disable the appropriate kind chip(s) with a `title` tooltip. A matching `.is-disabled` CSS rule is added for the kind-chip class (`.vcl-wf-opt`), mirroring the existing `.vcl-wf-cc.is-disabled` rule used for the RMS-as-CMS chip.

**Tech Stack:** Vanilla JS (no framework, no build step for the JS itself), plain `assert`-based Node test runner (no test framework/dependency), plain CSS.

## Global Constraints

- Applies **only** to Super-Grouping (`sgActive()`). Worksharing (`wsActive()`) must render exactly as before — no chip is ever disabled there.
- Enforcement is a **hard block** (disabled chip), not a warning banner — this was an explicit user decision, do not build a banner instead.
- New function must follow the existing dual-mode export pattern in `vcl-sg-logic.js`: attach to `window.VCL_SG_LOGIC` in-browser, `module.exports` in Node.
- Tests live at the **repo root** `tests/vcl-sg-logic.test.js` (NOT inside the plugin folder) — the plugin's `build_zip.py` uses a hand-maintained file allowlist and fails the build on unlisted files.
- No new files are created by this plan — nothing to add to `build_zip.py`'s `FILES` allowlist.
- Commit message trailer required: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Commit on the current branch `feature/super-grouping-annual-update` — do not create a new branch, do not push.
- Repo root for all paths below: `D:\Claude\Variation Fee Calculator`.

---

### Task 1: `computeAllowedProcedureKinds()` pure function

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-sg-logic.js`
- Test: `tests/vcl-sg-logic.test.js`

**Interfaces:**
- Consumes: nothing new (pure function, no dependency on other tasks).
- Produces: `computeAllowedProcedureKinds(procedures, currentProcedure)` → `string[]` (subset of `['national','mrpdcp','cp']`), exported on `VCL_SG_LOGIC` and via `module.exports`, for Task 2 to call as `VCL_SG_LOGIC.computeAllowedProcedureKinds(...)`.

- [ ] **Step 1: Write the failing tests**

Open `tests/vcl-sg-logic.test.js` and insert the following block immediately after the existing `t('conflicts: only E/Q -> none', ...)` test (currently ending at line 71) and before the trailing `console.log('\n' + ...)` summary block:

```js
t('allowedKinds: no other procedures -> all three kinds', function () {
  var p1 = { kind: 'national' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1], p1), ['national', 'mrpdcp', 'cp']);
});
t('allowedKinds: other procedure is cp -> only cp allowed', function () {
  var p1 = { kind: 'cp' }, p2 = { kind: 'national' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2], p2), ['cp']);
});
t('allowedKinds: other procedure is national -> national+mrpdcp allowed, cp excluded', function () {
  var p1 = { kind: 'national' }, p2 = { kind: 'cp' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2], p2), ['national', 'mrpdcp']);
});
t('allowedKinds: other procedure is mrpdcp -> national+mrpdcp allowed, cp excluded', function () {
  var p1 = { kind: 'mrpdcp', rms: 'FR' }, p2 = { kind: 'cp' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2], p2), ['national', 'mrpdcp']);
});
t('allowedKinds: multiple cp procedures group together fine', function () {
  var p1 = { kind: 'cp' }, p2 = { kind: 'cp' }, p3 = { kind: 'cp' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2, p3], p3), ['cp']);
});
t('allowedKinds: cp takes precedence over national/mrpdcp deterministically', function () {
  var pCp = { kind: 'cp' }, pNat = { kind: 'national' }, pSelf = { kind: 'mrpdcp', rms: 'FR' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([pCp, pNat, pSelf], pSelf), ['cp']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/vcl-sg-logic.test.js`
Expected: the six new `allowedKinds:` lines print `FAIL - ... : L.computeAllowedProcedureKinds is not a function`, and the process exits with a non-zero code (the final summary line shows fewer passed than total).

- [ ] **Step 3: Implement the function**

In `variation-fee-calculator/assets/js/vcl-sg-logic.js`, add the new function after `computeSuperGroupingConflicts` (after its closing brace, before the `var api = {` line):

```js
  // Which procedure kinds may be added to a Super-Grouping group, given the OTHER procedures
  // already in it (currentProcedure is excluded by reference so it doesn't block its own choice).
  // CP cannot mix with national/mrpdcp: if any other procedure is 'cp', only 'cp' remains
  // selectable; if any other is 'national'/'mrpdcp', 'cp' is excluded. Empty group -> free choice.
  function computeAllowedProcedureKinds(procedures, currentProcedure) {
    var others = (procedures || []).filter(function (p) { return p && p !== currentProcedure; });
    if (others.some(function (p) { return p.kind === 'cp'; })) return ['cp'];
    if (others.some(function (p) { return p.kind === 'national' || p.kind === 'mrpdcp'; })) return ['national', 'mrpdcp'];
    return ['national', 'mrpdcp', 'cp'];
  }
```

Then update the `api` object to include it:

```js
  var api = {
    computeAllVariationsAreIA: computeAllVariationsAreIA,
    computeAnnualUpdateDeadline: computeAnnualUpdateDeadline,
    computeDistinctRms: computeDistinctRms,
    computeSuperGroupingConflicts: computeSuperGroupingConflicts,
    computeAllowedProcedureKinds: computeAllowedProcedureKinds
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/vcl-sg-logic.test.js`
Expected: all lines print `ok   - ...` including the six new `allowedKinds:` tests, final line reads `18/18 passed`, process exits 0.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-sg-logic.js tests/vcl-sg-logic.test.js
git commit -m "$(cat <<'EOF'
feat: add computeAllowedProcedureKinds for super-grouping CP exclusivity

Pure function determining which procedure kinds (national/mrpdcp/cp) may
still be picked in a super-grouping group, given the other procedures
already in it. CP cannot mix with national/mrpdcp; multiple cp procedures
may group together freely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire the block into `procEditor()` + CSS

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js:687-727` (the `procEditor` function)
- Modify: `variation-fee-calculator/assets/css/vcl-workflow-style.css` (new `.is-disabled` rule for `.vcl-wf-opt`)

**Interfaces:**
- Consumes: `VCL_SG_LOGIC.computeAllowedProcedureKinds(procedures, currentProcedure)` from Task 1 (global `VCL_SG_LOGIC`, same access pattern already used elsewhere in this file, e.g. line 168, 199, 206). `sgActive()` (vcl-workflow.js:162) and `allProcedures()` (vcl-workflow.js:142-146), both pre-existing.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Replace the kind-chip block in `procEditor()`**

In `variation-fee-calculator/assets/js/vcl-workflow.js`, replace:

```js
  // Reusable procedure editor: kind (National/MRP-DCP/CP) + country-level selection.
  function procEditor(host, p, o) {
    const kinds = [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }];
    const row = el("div", "vcl-wf-opts");
    kinds.forEach((it) => {
      const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm" + (p.kind === it.k ? " is-on" : ""), escapeHtml(it.l));
      chip.type = "button";
      chip.addEventListener("click", () => { p.kind = it.k; rerender(); });
      row.appendChild(chip);
    });
    host.appendChild(row);
```

with:

```js
  // Reusable procedure editor: kind (National/MRP-DCP/CP) + country-level selection.
  // In Super-Grouping, CP cannot mix with national/mrpdcp (computeAllowedProcedureKinds);
  // the incompatible kind chip(s) are disabled rather than shown as a later warning, so the
  // invalid combination can never be created. Worksharing is unaffected (allowedKinds stays null).
  function procEditor(host, p, o) {
    const kinds = [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }];
    const allowedKinds = sgActive() ? VCL_SG_LOGIC.computeAllowedProcedureKinds(allProcedures(), p) : null;
    const row = el("div", "vcl-wf-opts");
    kinds.forEach((it) => {
      const isAllowed = !allowedKinds || allowedKinds.indexOf(it.k) !== -1;
      const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm" + (p.kind === it.k ? " is-on" : "") + (isAllowed ? "" : " is-disabled"), escapeHtml(it.l));
      chip.type = "button";
      if (!isAllowed) {
        chip.disabled = true;
        chip.title = it.k === "cp"
          ? "Not allowed together with national/MRP-DCP procedures in Super-Grouping"
          : "Not allowed together with CP in Super-Grouping";
      }
      chip.addEventListener("click", () => { p.kind = it.k; rerender(); });
      row.appendChild(chip);
    });
    host.appendChild(row);
```

(The rest of `procEditor` — the `cd`/country-select block below — is unchanged.)

- [ ] **Step 2: Add the CSS rule**

In `variation-fee-calculator/assets/css/vcl-workflow-style.css`, find the existing block around line 297-314:

```css
.vcl-app .vcl-wf-opts { display: flex; flex-wrap: wrap; gap: 8px; }
.vcl-app .vcl-wf-opt {
```

Add a new rule directly after the `.vcl-wf-opt--sm` line (line 314), matching the existing `.vcl-wf-cc.is-disabled` pattern at line 361:

```css
.vcl-app .vcl-wf-opt.is-disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 3: Verify syntax**

Run: `node --check variation-fee-calculator/assets/js/vcl-workflow.js`
Expected: no output, exit code 0 (Node's syntax checker; this file requires a browser DOM to actually execute, so this only confirms no parse errors — functional verification happens in Step 4).

- [ ] **Step 4: Manual code-trace verification (no WordPress environment available in dev)**

This mirrors the project's established practice of code-verifying Guided-Workflow UI changes without a live WordPress instance (see `docs/superpowers/specs/2026-07-29-super-grouping-annual-update-design.md` §14 addendum). Trace through the new code by hand against these three scenarios and confirm the logic holds (no code changes in this step, just verification):

1. **Fresh Super-Grouping, base procedure only:** `allProcedures()` returns `[state.procedure]`. In `procEditor(host, state.procedure, ...)`, `p === state.procedure`, so `others` in `computeAllowedProcedureKinds` is empty → `allowedKinds = ['national','mrpdcp','cp']` → all three chips render without `is-disabled`. Correct: first procedure is a free choice.
2. **Base procedure is `national`, user adds a second procedure via "Add procedure":** `allProcedures()` returns `[state.procedure /* national */, newProcedure() /* national, the new entry */]`. Editing the new entry: `p` is the new entry, `others = [state.procedure]` (kind `national`) → `allowedKinds = ['national','mrpdcp']` → the `cp` chip gets `is-disabled` + `disabled` + the "Not allowed together with national/MRP-DCP..." title. Correct.
3. **Base procedure is `cp`, user adds a second procedure:** `others = [state.procedure]` (kind `cp`) → `allowedKinds = ['cp']` → both `national` and `mrpdcp` chips get `is-disabled`, `cp` stays enabled. Correct — matches "multiple CPs may group together."
4. **Worksharing regression check:** with `submission.mode === 'worksharing'`, `sgActive()` is `false`, so `allowedKinds = null` and `isAllowed` is `true` for every chip regardless of `allowedKinds.indexOf(...)` (short-circuited by `!allowedKinds`) — no chip is ever disabled in Worksharing. Correct, matches the Global Constraint.

Add a line item to the existing WP-Live-Test backlog (memory: `super-grouping-annual-update.md`, open point 3) noting this scenario should be exercised by hand once WordPress is available: build a Super-Grouping with a `cp` base procedure, add a second procedure, confirm `national`/`mrpdcp` are visibly greyed out with a tooltip.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/assets/css/vcl-workflow-style.css
git commit -m "$(cat <<'EOF'
fix: block mixing CP with national/mrpdcp in super-grouping procedure editor

procEditor() now disables the incompatible procedure-kind chip(s) when
Super-Grouping is active, using computeAllowedProcedureKinds(). CP cannot
be combined with national/mrpdcp procedures; multiple CP procedures may
still be grouped together. Worksharing is unaffected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-Implementation

After both tasks: have Opus review the diff (`git diff main...feature/super-grouping-annual-update` for these two commits, or just the two commits themselves) specifically for domain correctness against spec §14 — this was the user's explicit request (Opus reviews Super-Grouping domain logic; Sonnet implements). Then update memory (`super-grouping-annual-update.md`) to record this fix and fold the new WP-Live-Test scenario (Step 4 above) into its existing open-point list.
