# Guided Workflow — RA-Hours Transparency & Product Information — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Guided Workflow a collapsible "How the RA hours are calculated" box (on every station) and a Product-Information block in Station A, and feed PI hours into the shared RA-hours engine so the Workflow's figure is finally correct.

**Architecture:** Additive only. A new pure function `computePiAddHours` lands in the existing dual-export module `vcl-workload-hours.js` (unit-tested under Node). `raHoursFor` in `vcl-workload.js` calls it and gains PI inputs; the factor table `F` and its provenance `F_META` are exposed read-only on `window.VCL_WORKLOAD` so the Workflow can render the methodology tables from the single source of truth. `vcl-workflow.js` gains the Station-A PI UI, passes PI through `raEffort()`, and renders the methodology box after the live preview. The standalone Workload tool's behaviour is unchanged.

**Tech Stack:** Vanilla ES5-style JS (browser IIFE + CommonJS dual export), Node's built-in `assert` for tests, WordPress `wp_register_script` enqueue (unchanged here), Python `build_zip.py` for packaging (unchanged here).

**Reference spec:** `docs/superpowers/specs/2026-07-31-workflow-ra-hours-transparency-and-pi-design.md`

## Global Constraints

- Factor VALUES stay single-source in `F` (`vcl-workload.js`); the Workflow reads them via a new read-only export, never re-declares them.
- PI per-deliverable hours are type-dependent: **Type IA 1 h · IB 2 h · II 4 h**, from `F.productInfo` (workbook `Faktoren` H63:J66). Do not hard-code these anywhere else.
- PI gate default **OFF** → PI adds 0 RA hours; the Workflow figure is unchanged from today when the gate is off.
- No field-level factor/hours pills in the Workflow — transparency lives only in the collapsible box.
- The green Workflow base design is unchanged; the box uses the Workload identity colour (`--workload #7A3350`, `--workload-bg #F5E9EE`), the PI chips use the existing green `.vcl-wf-opt`.
- The standalone Workload tool's rendered output/behaviour is unchanged; the only edits to `vcl-workload.js` are additive (PI in `raHoursFor`, two new export fields).
- No new plugin files → `build_zip.py`'s FILES list and `lookup.php` enqueue are untouched (the pure module `vcl-workload-hours.js` is already registered and packaged).
- Node tests live in repo-root `tests/`, run individually: `node tests/<file>.test.js`.
- **Commits require explicit user approval (per CLAUDE.md).** The `git commit` steps are listed for completeness; ask the user before running any of them. Conventional Commits.
- **Open item (flagged in spec):** the PI type for a grouped, mixed-type submission uses the **highest** type via `primaryType()`. It is routed through one helper `piType()` so that, if the domain rule turns out to be "per variation", only that helper changes. Confirm with the user before treating this as final.
- Paths are relative to the repo root `D:\Claude\Variation Fee Calculator`.

---

### Task 1: Pure PI-hours function + Node tests

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workload-hours.js` (add one function + export it)
- Test: `tests/vcl-workload-hours.test.js` (add cases)

**Interfaces:**
- Produces: `computePiAddHours(piInRA, piDocs, type, productInfo) -> Number` — sum of type-dependent per-deliverable hours for the ticked docs, or `0` when the gate is off / inputs missing. `piDocs` = `{ smpc, leaflet, labelling, mockups }` booleans; `type` = `'IA' | 'IB' | 'II'`; `productInfo` = `F.productInfo` shape (`{ smpc:{IA,IB,II}, ... }`). Added to the module's `module.exports` **and** `window.VCL_WORKLOAD_HOURS`.

- [ ] **Step 1: Add failing tests**

Append these cases to `tests/vcl-workload-hours.test.js`, immediately before the final `console.log('\n' + ...)` summary line:

```js
var PI = {
  smpc:      { IA: 1, IB: 2, II: 4 },
  leaflet:   { IA: 1, IB: 2, II: 4 },
  labelling: { IA: 1, IB: 2, II: 4 },
  mockups:   { IA: 1, IB: 2, II: 4 }
};
t('pi: gate off -> 0', function () {
  assert.strictEqual(H.computePiAddHours(false, { smpc: true, leaflet: true }, 'II', PI), 0);
});
t('pi: II, SmPC + leaflet -> 8', function () {
  assert.strictEqual(H.computePiAddHours(true, { smpc: true, leaflet: true }, 'II', PI), 8);
});
t('pi: IB, all four -> 8', function () {
  assert.strictEqual(H.computePiAddHours(true, { smpc: true, leaflet: true, labelling: true, mockups: true }, 'IB', PI), 8);
});
t('pi: IA, SmPC only -> 1', function () {
  assert.strictEqual(H.computePiAddHours(true, { smpc: true }, 'IA', PI), 1);
});
t('pi: nothing ticked -> 0', function () {
  assert.strictEqual(H.computePiAddHours(true, {}, 'II', PI), 0);
});
t('pi: missing productInfo -> 0', function () {
  assert.strictEqual(H.computePiAddHours(true, { smpc: true }, 'II', null), 0);
});
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `node tests/vcl-workload-hours.test.js`
Expected: the six `pi:` cases FAIL with `H.computePiAddHours is not a function`; the existing 9 still pass.

- [ ] **Step 3: Implement `computePiAddHours`**

In `variation-fee-calculator/assets/js/vcl-workload-hours.js`, add this function directly after `computeSgCounterKinds` (before the `var api = {` block):

```js
  // Product-information hours: per ticked deliverable, scaled by the variation type (IA/IB/II).
  // Zero when PI is not managed in RA (gate off) or the factor table is missing. Values come from
  // F.productInfo (passed in) so this stays pure and the factors keep their single source.
  function computePiAddHours(piInRA, piDocs, type, productInfo) {
    if (!piInRA || !productInfo) return 0;
    piDocs = piDocs || {};
    var keys = ['smpc', 'leaflet', 'labelling', 'mockups'];
    var h = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (piDocs[k] && productInfo[k]) h += (productInfo[k][type] || 0);
    }
    return h;
  }
```

Then add it to the `api` object (alongside `computeSubmissionAddHours` and `computeSgCounterKinds`):

```js
    computePiAddHours: computePiAddHours,
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node tests/vcl-workload-hours.test.js`
Expected: PASS — `15/15 passed`.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add tests/vcl-workload-hours.test.js variation-fee-calculator/assets/js/vcl-workload-hours.js
git commit -m "feat(workload): add pure PI-hours helper with tests"
```

---

### Task 2: Wire PI into `raHoursFor` and expose `F` / `F_META`

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workload.js` — `raHoursFor` (1321-1346) doc comment + body; the `window.VCL_WORKLOAD` export (1348-1352)

**Interfaces:**
- Consumes: `WLH.computePiAddHours` from Task 1.
- Produces: `raHoursFor` opts gain `piInRA` (bool), `productInfo` (`{smpc,leaflet,labelling,mockups}` bools), `piType` (`'IA'|'IB'|'II'`, optional — defaults to `opts.type`). `window.VCL_WORKLOAD.factors` (the `F` table, read-only) and `.factorsMeta` (`F_META`) for the Workflow's methodology box.

- [ ] **Step 1: Extend the `raHoursFor` doc comment**

Replace the opts list in the comment (lines 1316-1320) so it names the new inputs. Change the comment block to:

```js
  // RA preparation hours for one (primary) procedure, mirroring computeRaHours() but from
  // explicit inputs. opts: { type, substance, procedure, cmsCount, grouping, worksharing,
  // annualUpdate, superGrouping, groupingCounts:{IA,IB,II}, worksharingProcs:{national,mrpdcp},
  // superGroupingProcs:{national,mrpdcp,cp}, annualUpdateIaCount,
  // piInRA, productInfo:{smpc,leaflet,labelling,mockups}, piType }. The per-item add-hours sum and
  // the PI hours are delegated to the shared pure module so this API and the tool's own view never
  // diverge. PI defaults to nothing when piInRA is falsy, so existing callers are unaffected.
```

- [ ] **Step 2: Add the PI term to the return value**

In `raHoursFor`, replace the last two lines of the function (currently):

```js
    let add = WLH.computeSubmissionAddHours(procOptions, counts, F.submission);
    if (o.procedure === "mrpdcp") add += (F.cmsHoursPer || 0) * (o.cmsCount || 0);
    return base * (pf * af * sf) + add;
```

with:

```js
    let add = WLH.computeSubmissionAddHours(procOptions, counts, F.submission);
    if (o.procedure === "mrpdcp") add += (F.cmsHoursPer || 0) * (o.cmsCount || 0);
    const pi = WLH.computePiAddHours(o.piInRA, o.productInfo, o.piType || o.type, F.productInfo);
    return base * (pf * af * sf) + add + pi;
```

- [ ] **Step 3: Expose the factor table and its provenance**

Replace the `window.VCL_WORKLOAD` export (lines 1348-1352) with:

```js
  window.VCL_WORKLOAD = {
    render: function (container) { if (!container) return; mountedContainer = container; rerender(); },
    schedule: computeSchedule,
    raHours: raHoursFor,
    // Read-only views of the factor table and its provenance, so the Guided Workflow can render its
    // "How the RA hours are calculated" box from the same numbers (single source). Treat as read-only.
    factors: F,
    factorsMeta: F_META,
  };
```

- [ ] **Step 4: Regression-check the module tests + a manual sanity call**

Run: `node tests/vcl-workload-hours.test.js`
Expected: PASS — `15/15 passed` (the module is unchanged here; this confirms the shared shape still holds).

Then code-verify: a `raHoursFor` call **without** any PI fields returns exactly what it did before (PI term is `0` because `o.piInRA` is undefined). This guards the standalone Workload tool and the Workflow's existing figure.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workload.js
git commit -m "feat(workload): raHoursFor honours PI; expose factors/meta for the workflow"
```

---

### Task 3: Workflow state fields + Station A Product-Information UI

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` — `state` (after line 48), `buildStationA` (after 570), `resetAll` (around 502-508), new `buildProductInfo` function
- Modify: `variation-fee-calculator/assets/css/vcl-workflow-style.css` — PI gate switch styles

**Interfaces:**
- Produces: `state.piInRA` (bool, default `false`), `state.piDocs` (`{smpc,leaflet,labelling,mockups}` bools, default all `false`), `state.methodOpen` (bool, default `false`, used in Task 5). Consumed by Tasks 4 and 5.

- [ ] **Step 1: Add the new state fields**

In the `state` object, immediately after `activeSubstance: null, // ...` (line 48), add:

```js
    // Product information (Station A): gate + which documents this change touches.
    piInRA: false,
    piDocs: { smpc: false, leaflet: false, labelling: false, mockups: false },
    // "How the RA hours are calculated" box open/closed (persists across stations).
    methodOpen: false,
```

- [ ] **Step 2: Reset them in `resetAll`**

In `resetAll`, right after the line that resets the Station A fields (`state.pickedCode = null; ... state.activeSubstance = null;`, line 502), add:

```js
    state.piInRA = false; state.piDocs = { smpc: false, leaflet: false, labelling: false, mockups: false };
    state.methodOpen = false;
```

- [ ] **Step 3: Call the PI builder at the end of Station A**

In `buildStationA`, replace the final call `buildGroupingList(body);` (line 570) with:

```js
    buildGroupingList(body);

    // 4) Product information -- a property of the change itself (which documents it touches),
    // known here at classification time, independent of procedure/countries. Only meaningful once
    // a variation/type is set.
    if (hasVariation()) buildProductInfo(body);
```

- [ ] **Step 4: Add the `buildProductInfo` function**

Add this function immediately after `buildSubstance` (after its closing brace, line 588):

```js
  // Station A: does RA prepare the product information for this change, and which documents does it
  // touch? Gate defaults OFF (another department carries PI -> no RA hours). Chips reuse the green
  // .vcl-wf-opt look; the per-document hours are shown only in the methodology box, never as pills.
  function buildProductInfo(body) {
    const head = el("div", "vcl-wf-flabel", "Product information");
    head.style.marginTop = "16px";
    body.appendChild(head);

    const gate = el("label", "vcl-wf-switch" + (state.piInRA ? " is-on" : ""));
    gate.innerHTML = '<span class="vcl-wf-switch__track"><span class="vcl-wf-switch__thumb"></span></span>'
      + '<span class="vcl-wf-switch__label">Product information managed in RA</span>';
    gate.addEventListener("click", (e) => { e.preventDefault(); state.piInRA = !state.piInRA; rerender(); });
    body.appendChild(gate);

    if (!state.piInRA) {
      body.appendChild(el("p", "vcl-wf-hint", "Off: another department prepares the product information — it adds no RA hours."));
      return;
    }

    body.appendChild(el("p", "vcl-wf-hint", "Which documents does this change touch?"));
    const opts = el("div", "vcl-wf-opts");
    [
      { key: "smpc", label: "SmPC" },
      { key: "leaflet", label: "Package leaflet" },
      { key: "labelling", label: "Labelling" },
      { key: "mockups", label: "Mock-ups" },
    ].forEach((o) => {
      const chip = el("button", "vcl-wf-opt" + (state.piDocs[o.key] ? " is-on" : ""), escapeHtml(o.label));
      chip.type = "button";
      chip.addEventListener("click", () => { state.piDocs[o.key] = !state.piDocs[o.key]; rerender(); });
      opts.appendChild(chip);
    });
    body.appendChild(opts);
  }
```

- [ ] **Step 5: Add the switch CSS**

Append to `variation-fee-calculator/assets/css/vcl-workflow-style.css`:

```css
/* --- Station A: Product-information gate switch (workload-pink accent when on) --- */
.vcl-app .vcl-wf-switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; margin: 2px 0; }
.vcl-app .vcl-wf-switch__track { width: 38px; height: 22px; border-radius: 999px; background: #d8d8d2; position: relative; flex: none; transition: background .15s; }
.vcl-app .vcl-wf-switch__thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .15s; }
.vcl-app .vcl-wf-switch.is-on .vcl-wf-switch__track { background: var(--workflow); }
.vcl-app .vcl-wf-switch.is-on .vcl-wf-switch__thumb { left: 18px; }
.vcl-app .vcl-wf-switch__label { font-size: 12.5px; font-weight: 600; color: var(--ink, #222); }
```

- [ ] **Step 6: Syntax check**

Run: `node -e "new Function(require('fs').readFileSync('variation-fee-calculator/assets/js/vcl-workflow.js','utf8'))" && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 7: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/assets/css/vcl-workflow-style.css
git commit -m "feat(workflow): Product-information gate + document chips in Station A"
```

---

### Task 4: `raEffort()` passes PI through; `piType()` helper

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` — add `piType()` after `primaryType()` (410), rewrite the `raHours` call in `raEffort()` (431-438)

**Interfaces:**
- Consumes: `raHoursFor` PI opts from Task 2; `state.piInRA`, `state.piDocs` from Task 3; existing `primaryType()`.
- Produces: `piType()` — the single place that decides which type drives PI hours (consumed by Task 5's "This case" block).

- [ ] **Step 1: Add the `piType()` helper**

Immediately after the `primaryType()` function (after its closing brace, line 410), add:

```js
  // Which type drives the PI per-document hours. For a grouped, mixed-type submission this uses the
  // HIGHEST type (primaryType), consistent with how the group's timeline and RA effort are derived.
  // OPEN ITEM (see spec): if the domain rule turns out to be "per variation", change only this.
  function piType() { return primaryType(); }
```

- [ ] **Step 2: Pass PI into the `raHours` call**

In `raEffort()`, replace the object passed to `window.VCL_WORKLOAD.raHours({ ... })` (lines 431-438) with the same object plus three PI fields:

```js
    return window.VCL_WORKLOAD.raHours({
      type: t, substance: state.activeSubstance, procedure: state.procedure.kind,
      cmsCount: state.procedure.kind === "mrpdcp" ? state.procedure.cms.length : 0,
      grouping: state.submission.grouping && !(auActive() || sgActive()), worksharing: wsActive(),
      groupingCounts: groupingBuckets(), worksharingProcs: worksharingKinds(),
      annualUpdate: auActive(), annualUpdateIaCount: auActive() ? 1 + groupingBuckets().IA : 0,
      superGrouping: sgActive(), superGroupingProcs: sgProcKinds(),
      piInRA: state.piInRA, productInfo: state.piDocs, piType: piType(),
    });
```

- [ ] **Step 3: Code-verify the gate**

Read the change and confirm: with `state.piInRA === false` (default), `raHoursFor` adds `computePiAddHours(false, …) === 0`, so the live-preview RA figure is identical to today. With the gate on and e.g. `piDocs.smpc` on a Type II case, the figure rises by 4 h.

- [ ] **Step 4: Syntax check**

Run: `node -e "new Function(require('fs').readFileSync('variation-fee-calculator/assets/js/vcl-workflow.js','utf8'))" && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js
git commit -m "feat(workflow): raEffort feeds PI to the workload engine via piType()"
```

---

### Task 5: Methodology box shell + toggle, rendered on every station

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` — new `buildMethodBox()` + `wfMethTable()` helpers (near `buildLive`, ~1839), wire into `rerender` after `buildLive()` (1970-1972)
- Modify: `variation-fee-calculator/assets/css/vcl-workflow-style.css` — `.vcl-wf-meth*` styles

**Interfaces:**
- Consumes: `state.methodOpen` (Task 3), `window.VCL_WORKLOAD.factors` / `.factorsMeta` (Task 2).
- Produces: `buildMethodBox() -> HTMLElement`, `wfMethTable(title, rows, note) -> HTMLElement` (consumed by Task 6 to fill the panel).

- [ ] **Step 1: Add the box shell + a table helper**

Add these two functions immediately before `buildLive()` (line 1839):

```js
  // One factor table for the methodology box: a title and rows of {label, val, active}. The active
  // row (the one that applies to the current case) is highlighted; the pink value chip reuses the
  // Workload tool's look via .vcl-wf-meth-val.
  function wfMethTable(title, rows, note) {
    const wrap = el("div", "vcl-wf-meth-table");
    wrap.appendChild(el("div", "vcl-wf-meth-table__title", escapeHtml(title)));
    rows.forEach((r) => {
      const row = el("div", "vcl-wf-meth-row" + (r.active ? " is-active" : ""));
      row.innerHTML = '<span class="l">' + escapeHtml(r.label) + '</span>'
        + '<span class="vcl-wf-meth-val">' + escapeHtml(String(r.val)) + '</span>';
      wrap.appendChild(row);
    });
    if (note) wrap.appendChild(el("p", "vcl-wf-meth-note", escapeHtml(note)));
    return wrap;
  }

  // "How the RA hours are calculated" -- a collapsible box under the live preview, available on
  // every station. Reads factor VALUES from window.VCL_WORKLOAD.factors (single source) and the
  // current Workflow state; content is filled in buildMethodPanel (Task 6).
  function buildMethodBox() {
    const box = el("div", "vcl-wf-meth" + (state.methodOpen ? " is-open" : ""));
    const bar = el("button", "vcl-wf-meth-bar");
    bar.type = "button";
    bar.innerHTML = '<span class="i" aria-hidden="true">i</span>'
      + '<span class="t">How the RA hours are calculated</span>'
      + '<span class="chev" aria-hidden="true">' + (state.methodOpen ? "&#9652;" : "&#9662;") + '</span>';
    bar.addEventListener("click", () => { state.methodOpen = !state.methodOpen; rerender(); });
    box.appendChild(bar);
    if (state.methodOpen) box.appendChild(buildMethodPanel());
    return box;
  }

  // Placeholder panel -- filled in Task 6.
  function buildMethodPanel() {
    return el("div", "vcl-wf-meth-panel", '<div class="vcl-wf-meth-inner"></div>');
  }
```

- [ ] **Step 2: Render the box after the live preview**

In `rerender`, replace the block that appends the live preview (lines 1970-1972):

```js
    const live = buildLive();
    liveHost = live;
    root.appendChild(live);
```

with:

```js
    const live = buildLive();
    liveHost = live;
    root.appendChild(live);
    root.appendChild(buildMethodBox());
```

- [ ] **Step 3: Add the box CSS**

Append to `variation-fee-calculator/assets/css/vcl-workflow-style.css`:

```css
/* --- "How the RA hours are calculated" box (below the live preview, every station) --- */
/* Workload identity colour so it reads as the shared methodology, distinct from the green preview. */
.vcl-app .vcl-wf-meth { margin-top: 8px; border: 1px solid color-mix(in srgb, #7A3350 30%, #F5E9EE); border-radius: 12px; background: #fff; overflow: hidden; }
.vcl-app .vcl-wf-meth-bar { display: flex; align-items: center; gap: 8px; width: 100%; font: inherit; font-size: 12px; font-weight: 600; color: #7A3350; background: #F5E9EE; border: none; padding: 10px 14px; cursor: pointer; text-align: left; }
.vcl-app .vcl-wf-meth-bar .i { width: 16px; height: 16px; border-radius: 50%; background: #7A3350; color: #fff; font-size: 10px; font-style: italic; font-family: "IBM Plex Serif", serif; display: flex; align-items: center; justify-content: center; flex: none; }
.vcl-app .vcl-wf-meth-bar .t { flex: 1; }
.vcl-app .vcl-wf-meth-bar .chev { color: #7A3350; }
.vcl-app .vcl-wf-meth-panel { padding: 0; }
.vcl-app .vcl-wf-meth-inner { padding: 14px 16px; border-top: 1px solid color-mix(in srgb, #7A3350 18%, transparent); }
.vcl-app .vcl-wf-meth-table { margin: 0 0 14px; }
.vcl-app .vcl-wf-meth-table__title { font-size: 11px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: #7A3350; margin: 0 0 4px; }
.vcl-app .vcl-wf-meth-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 3px 0; border-top: .5px solid var(--line, #eee); color: var(--muted); }
.vcl-app .vcl-wf-meth-row:first-of-type { border-top: none; }
.vcl-app .vcl-wf-meth-row.is-active { color: var(--ink, #222); font-weight: 600; }
.vcl-app .vcl-wf-meth-val { font-family: "IBM Plex Sans", sans-serif; font-size: 11px; font-weight: 600; white-space: nowrap; border-radius: 999px; padding: 1px 8px; color: #7A3350; background: #F5E9EE; border: 1px solid color-mix(in srgb, #7A3350 25%, #F5E9EE); }
.vcl-app .vcl-wf-meth-note { font-size: 11px; color: var(--muted); line-height: 1.5; margin: 5px 0 0; }
.vcl-app .vcl-wf-meth-formula { font-family: "IBM Plex Mono", monospace; font-size: 11px; background: #F5E9EE; border-radius: 8px; padding: 8px 10px; color: var(--ink, #222); line-height: 1.6; margin: 0 0 14px; }
.vcl-app .vcl-wf-meth-h { font-size: 12px; font-weight: 700; color: var(--ink, #222); margin: 0 0 8px; }
.vcl-app .vcl-wf-meth-src { font-size: 11px; color: var(--muted); line-height: 1.5; margin-top: 6px; }
.vcl-app .vcl-wf-meth-src strong { color: var(--ink, #222); }
.vcl-app .vcl-wf-meth-dl { display: inline-block; margin-top: 8px; font-size: 11px; color: #7A3350; text-decoration: underline; text-underline-offset: 2px; }
```

- [ ] **Step 4: Browser verification — presence + toggle on every station**

Start the preview (Workflow tool). With no case selected and on Station A, confirm the "How the RA hours are calculated" bar shows under the live preview. Click it → the (empty) panel expands, chevron flips; click again → collapses. Advance to Stations B, C, D and confirm the bar is present on each and its open/closed state persists across station changes. Capture a screenshot of the bar open on one station.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/assets/css/vcl-workflow-style.css
git commit -m "feat(workflow): collapsible RA-hours methodology box on every station"
```

---

### Task 6: Fill the methodology panel — formula, factor tables, PI, this-case, source

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` — rewrite `buildMethodPanel()` (the placeholder from Task 5)

**Interfaces:**
- Consumes: `window.VCL_WORKLOAD.factors` (`F`) / `.factorsMeta` (`F_META`) from Task 2; `wfMethTable` from Task 5; `primaryType()`, `piType()`, `raEffort()`, `state.procedure`, `state.activeSubstance`, `state.submission`, `state.piDocs`, `state.piInRA`.

- [ ] **Step 1: Replace `buildMethodPanel` with the full content**

Replace the placeholder `buildMethodPanel` from Task 5 with:

```js
  // Full methodology panel: the RA-hours factor tables (values from the shared F), the PI table for
  // the current type, a "This case" resolution down to the live figure, and the source note. The
  // rows that apply to the current case are highlighted; the rest show what would change.
  function buildMethodPanel() {
    const F = window.VCL_WORKLOAD && window.VCL_WORKLOAD.factors;
    const META = (window.VCL_WORKLOAD && window.VCL_WORKLOAD.factorsMeta) || {};
    const panel = el("div", "vcl-wf-meth-panel");
    const inner = el("div", "vcl-wf-meth-inner");
    panel.appendChild(inner);
    if (!F) { inner.appendChild(el("p", "vcl-wf-meth-note", "Factor tables are not available.")); return panel; }

    const t = primaryType();
    const kind = state.procedure.kind;                       // 'national' | 'mrpdcp' | 'cp'
    const cms = kind === "mrpdcp" ? state.procedure.cms.length : 0;
    const large = cms > F.procedure.cmsThreshold;
    const fx = (n) => "\u00d7 " + fmtNum(n);

    // Formula
    inner.appendChild(el("div", "vcl-wf-meth-formula",
      "RA hours = Base[type] \u00d7 Procedure \u00d7 Active substance \u00d7 \u220f Submission factors"
      + "<br>&nbsp;&nbsp;+ CMS \u00d7 " + F.cmsHoursPer + " h + \u03a3 grouped items + \u03a3 Product information"));

    // Base hours
    inner.appendChild(wfMethTable("Base hours per variation type", [
      { label: "Type IA", val: F.baseHours.IA + " h", active: t === "IA" },
      { label: "Type IB", val: F.baseHours.IB + " h", active: t === "IB" },
      { label: "Type II", val: F.baseHours.II + " h", active: t === "II" },
    ], "The starting point, before any factor is applied."));

    // Procedure
    inner.appendChild(wfMethTable("\u00d7 Procedure", [
      { label: "National", val: fx(F.procedure.national), active: kind === "national" },
      { label: "Centralised (CP)", val: fx(F.procedure.cp), active: kind === "cp" },
      { label: "MRP/DCP, \u2264 " + F.procedure.cmsThreshold + " CMS", val: fx(F.procedure.mrpdcpSmall), active: kind === "mrpdcp" && !large },
      { label: "MRP/DCP, > " + F.procedure.cmsThreshold + " CMS", val: fx(F.procedure.mrpdcpLarge), active: kind === "mrpdcp" && large },
    ], "MRP/DCP also adds " + F.cmsHoursPer + " h per CMS on top."));

    // Active substance
    inner.appendChild(wfMethTable("\u00d7 Active substance", [
      { label: "Biologic", val: fx(F.activeSubstance.biologic), active: state.activeSubstance === "biologic" },
      { label: "Chemically-synthesized API", val: fx(F.activeSubstance.chemical), active: state.activeSubstance === "chemical" },
    ]));

    // Submission factors
    const s = F.submission;
    inner.appendChild(wfMethTable("\u00d7 Submission type", [
      { label: "Worksharing", val: fx(s.worksharing.factor), active: wsActive() },
      { label: "Grouping", val: fx(s.grouping.factor), active: state.submission.grouping && !(auActive() || sgActive()) },
      { label: "Annual Update", val: fx(s.annualUpdate.factor), active: auActive() },
      { label: "Super-Grouping", val: fx(s.superGrouping.factor), active: sgActive() },
    ], "These multiply together when several apply at once."));

    // Product information for the current type
    const pt = piType();
    const pi = F.productInfo;
    inner.appendChild(wfMethTable("+ Product information \u00b7 Type " + (pt || "\u2014") + " (hours per document)", [
      { label: "SmPC", val: "+ " + (pi.smpc[pt] || 0) + " h", active: state.piInRA && state.piDocs.smpc },
      { label: "Package leaflet", val: "+ " + (pi.leaflet[pt] || 0) + " h", active: state.piInRA && state.piDocs.leaflet },
      { label: "Labelling", val: "+ " + (pi.labelling[pt] || 0) + " h", active: state.piInRA && state.piDocs.labelling },
      { label: "Mock-ups", val: "+ " + (pi.mockups[pt] || 0) + " h", active: state.piInRA && state.piDocs.mockups },
    ], "Only counted when \u201cProduct information managed in RA\u201d is on. Hours scale with the variation type."));

    // This case -> the same figure the live preview shows
    const ra = raEffort();
    if (ra !== null) {
      inner.appendChild(el("div", "vcl-wf-meth-h", "This case"));
      inner.appendChild(wfMethTable("", [
        { label: "= RA workload (rounded up)", val: Math.ceil(ra) + " h", active: true },
      ], "Matches the live preview above. Open the factor rows to see which values drive it."));
    }

    // Source / provenance
    const src = el("div", "vcl-wf-meth-src");
    src.innerHTML = "<strong>Source:</strong> " + escapeHtml(META.workbook || "factor workbook")
      + " \u2014 sheet \u201cFaktoren\u201d. Last checked against it on <strong>" + escapeHtml(META.lastChecked || "\u2014") + "</strong>.";
    const excelUrl = (window.VCL_CONFIG && window.VCL_CONFIG.workloadExcelUrl) || "";
    if (excelUrl) {
      const a = document.createElement("a");
      a.className = "vcl-wf-meth-dl"; a.href = excelUrl; a.target = "_blank"; a.rel = "noopener";
      a.innerHTML = "\u2b07 Download the workbook (Excel)";
      src.appendChild(a);
    }
    inner.appendChild(src);
    return panel;
  }
```

- [ ] **Step 2: Syntax check**

Run: `node -e "new Function(require('fs').readFileSync('variation-fee-calculator/assets/js/vcl-workflow.js','utf8'))" && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 3: Browser verification — content + consistency + PI effect**

Start the preview (Workflow tool). Pick a Type II classification, set Active substance = Biologic, procedure = National.
1. Open the methodology box → confirm the factor tables render, with Type II / National / Biologic rows highlighted.
2. Note the live-preview "RA workload" figure and the box's "This case → RA workload" figure — they must be **equal**.
3. In Station A, turn the PI gate ON and tick **SmPC** + **Package leaflet** → the RA figure rises by 8 h (Type II: 4 h each), the box's PI rows for SmPC/Leaflet highlight, and "This case" still equals the live preview.
4. Turn the PI gate OFF → the figure returns to its pre-PI value.

Capture a screenshot of the open box showing the highlighted rows and the matching "This case" total.

- [ ] **Step 4: Commit** (ask user first)

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js
git commit -m "feat(workflow): fill methodology panel with factors, PI and this-case breakdown"
```

---

### Task 7: Package check + final regression

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Confirm no packaging changes are needed**

No new plugin files were added (the PI helper lives in the already-registered `vcl-workload-hours.js`). Confirm `build_zip.py`'s FILES list and `lookup.php` enqueue are untouched by this plan.

Run: `python build_zip.py`
Expected: `OK ... variation-fee-calculator.zip`, file count **unchanged** from before this plan, no "unlisted files" error.

- [ ] **Step 2: Full test run**

Run: `node tests/vcl-workload-hours.test.js` and `node tests/vcl-sg-logic.test.js`
Expected: `15/15 passed` and the SG suite passes — nothing regressed.

- [ ] **Step 3: Standalone Workload tool unchanged**

Open the standalone **Workload Planning** tool in the preview and confirm its "How this estimate is built" section and RA figure render exactly as before (the edits to `vcl-workload.js` were additive: PI defaults to off for its own `computeRaHours`, and the two new export fields are read-only). Spot-check one reference case, e.g. Type II · MRP/DCP (3 CMS) · Biologic, against its pre-change value.

- [ ] **Step 4: Commit** (only if any doc/verification note changed; otherwise skip — ask user)

No code changes expected in this task.

---

## Self-Review

**Spec coverage:**
- Box "How the RA hours are calculated", below live preview, every station, downward accordion, workload-pink → Task 5 (shell/position/toggle/CSS) + Task 6 (content). ✓
- Box content = formula, factor tables, PI hours, this-case, xlsx/provenance → Task 6. ✓
- No field pills → honoured throughout (transparency only in the box). ✓
- PI block in Station A after variations, heading + green chips, gate default OFF → Task 3. ✓
- PI hours type-dependent (IA 1 / IB 2 / II 4) from F.productInfo → Task 1 (pure fn + tests) + Task 6 (display). ✓
- PI wired into shared engine (raHoursFor gains PI; raEffort passes it) → Task 2 + Task 4. ✓
- Factor values single-source in F; Workflow reads via export → Task 2 (expose) + Task 6 (consume). ✓
- Standalone Workload tool behaviour unchanged → Task 2 Step 4 + Task 7 Step 3. ✓
- Open item (PI type for mixed grouping = primaryType, routed through one helper) → Task 4 `piType()`, flagged. ✓
- No new files → packaging untouched → Task 7 Step 1. ✓

**Placeholder scan:** Task 5's `buildMethodPanel` is an explicit, labelled placeholder that Task 6 replaces in full — not a plan gap; every other step shows complete code. No TBD/TODO. ✓

**Type consistency:** `computePiAddHours(piInRA, piDocs, type, productInfo)` used identically in Task 1 (def/tests) and Task 2 (call). `state.piInRA` / `state.piDocs{smpc,leaflet,labelling,mockups}` / `state.methodOpen` named identically in Tasks 3, 4, 6. `window.VCL_WORKLOAD.factors` / `.factorsMeta` defined in Task 2, consumed in Task 6. `piType()` defined in Task 4, consumed in Task 6. `wfMethTable(title, rows, note)` defined in Task 5, consumed in Task 6. ✓
