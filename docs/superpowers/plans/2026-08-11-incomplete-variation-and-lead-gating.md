# Incomplete-Variation & Lead Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop both tools from advancing with an unfilled additional variation, and stop the Guided Workflow from advancing past Procedures without the mandatory SG/WS lead.

**Architecture:** Three small guards. Disable "＋ Add variation" while an additional variation lacks a type (both tools); extend Guided Workflow `stationComplete("A")` to require every grouping row resolved and `stationComplete("B")` to require the lead. Budget already gates Station A completeness and the lead.

**Tech Stack:** Vanilla JS (IIFE modules). No build step, no JS test runner. Verification is browser-based (real Chrome; in-app Browser pane unreliable for this project).

## Global Constraints

- No new dependencies; plain vanilla JS matching surrounding style.
- Bugfix discipline: change only the relevant lines; no reformatting.
- Do NOT run `git commit` / `git push` autonomously — commits happen only on the user's explicit go.
- Empty grouping rows are already filtered from fee/IA counts; do not change counting logic.
- Verification screenshots: real Chrome (the in-app screenshot tool is unreliable here).

---

### Task 1: Guided Workflow — gate incomplete variations (A) + lead (B)

**Files:**
- Modify: `assets/js/vcl-workflow.js` — `stationComplete` (lines 458-463), `buildGroupingList` (lines 863-866)

**Interfaces:**
- Consumes (already defined in this module): `hasVariation()`, `state.grouping` (array of `{code, variantId, type, query}`), `procComplete(p)`, `allVariationsAreIA()`, `state.submission.mode`, `leadPricingActive()`, `state.worksharingLead`, `el(...)`.
- Produces: no new symbols. `stationComplete("A")` now also requires every grouping row to have a truthy `type`; `stationComplete("B")` now also requires a lead when `leadPricingActive()`. The "＋ Add variation" button becomes disabled while any grouping row lacks a type.

- [ ] **Step 1: Gate Station A on grouping completeness**

Replace line 459:

```js
    if (key === "A") return hasVariation();                          // active substance moved to "RA tasks"
```

with:

```js
    // Base variation resolved AND no half-entered additional variation left dangling.
    if (key === "A") return hasVariation() && state.grouping.every(function (g) { return !!g.type; });
```

- [ ] **Step 2: Gate Station B on the SG/WS lead**

Replace the Station-B line (currently):

```js
    // Type-IA-only submissions must choose a bundling mode (Super-Grouping /
    // Annual Update) before advancing -- a Type IA is never submitted on its own.
    if (key === "B") return procComplete(state.procedure) && (!allVariationsAreIA() || !!state.submission.mode);
```

with:

```js
    // Type-IA-only submissions must choose a bundling mode (Super-Grouping /
    // Annual Update) before advancing -- a Type IA is never submitted on its own.
    // Worksharing / Super-Grouping additionally require the lead authority.
    if (key === "B") return procComplete(state.procedure)
      && (!allVariationsAreIA() || !!state.submission.mode)
      && (!leadPricingActive() || !!state.worksharingLead);
```

- [ ] **Step 3: Disable "＋ Add variation" while a grouping row is incomplete**

In `buildGroupingList`, replace lines 863-866:

```js
    const add = el("button", "vcl-wf-add", "＋ Add variation");
    add.type = "button";
    add.addEventListener("click", () => { state.grouping.push({ code: null, variantId: undefined, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
```

with:

```js
    const add = el("button", "vcl-wf-add", "＋ Add variation");
    add.type = "button";
    // Block piling up empty rows: no new variation until the current ones carry a type.
    add.disabled = state.grouping.some((g) => !g.type);
    add.addEventListener("click", () => { state.grouping.push({ code: null, variantId: undefined, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
```

- [ ] **Step 4: Syntax check**

Run (from the plugin dir): `node --check assets/js/vcl-workflow.js` → expect no output (exit 0).

- [ ] **Step 5: Browser verification (real Chrome, hard-reload)**

- Station A: click "＋ Add variation" → empty row appears; "＋ Add variation" is disabled and `Next` is disabled. Pick a type (or code) → both re-enable. Remove the incomplete row (✕) → re-enabled.
- Station B: with SG active and lead "— select —", `Next` is disabled; select an RMS → enabled. (CP-based SG auto-locks EMA → enabled.)
- Regression: a fully-typed grouping list + chosen lead advances exactly as before.

- [ ] **Step 6: Report + await commit go**

Report the changed lines and `node --check` result. Do NOT commit.

---

### Task 2: Budget Planning — gate incomplete variations (A, add-button)

**Files:**
- Modify: `assets/js/vcl-budget.js` — `renderGroupingList` (lines 729-732)

**Interfaces:**
- Consumes (already available): `modalState.draft.submission` (as `sub`), `sub.variations` (array; index 0 is the base, 1.. are additional), `el(...)`, `rerender()`.
- Produces: no new symbols. The "＋ Add variation" button becomes disabled while any additional variation lacks a type. `stationComplete("A", sub)` already requires every variation typed, so Next is already gated — unchanged.

- [ ] **Step 1: Disable "＋ Add variation" while an additional variation is incomplete**

In `renderGroupingList`, replace lines 729-732:

```js
    var add = el("button", "vcl-bud-add", "＋ Add variation");
    add.type = "button";
    add.addEventListener("click", function () { sub.variations.push({ code: null, variantId: null, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
```

with:

```js
    var add = el("button", "vcl-bud-add", "＋ Add variation");
    add.type = "button";
    // Block piling up empty rows: no new variation until the additional ones carry a type.
    add.disabled = sub.variations.slice(1).some(function (v) { return !v.type; });
    add.addEventListener("click", function () { sub.variations.push({ code: null, variantId: null, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
```

- [ ] **Step 2: Syntax check**

Run (from the plugin dir): `node --check assets/js/vcl-budget.js` → expect no output (exit 0).

- [ ] **Step 3: Browser verification (real Chrome, hard-reload)**

- In a Budget line editor, Station A: click "＋ Add variation" → empty row; "＋ Add variation" disabled. Pick a type/code → re-enabled. `Next` is already blocked while the row is empty (existing all-typed gate) — confirm it stays blocked then enables once typed.
- Regression: a fully-typed list adds/advances as before.

- [ ] **Step 4: Report + await commit go**

Report changed lines and `node --check` result. Do NOT commit.

---

## Self-Review

**Spec coverage:**
- Bug A add-button, GW → Task 1 Step 3. ✔
- Bug A Next, GW → Task 1 Step 1. ✔
- Bug A add-button, Budget → Task 2 Step 1. ✔
- Bug A Next, Budget → already gated (spec + Task 2 interfaces note). ✔
- Bug B lead, GW → Task 1 Step 2. ✔
- Bug B lead, Budget → already gated, no change (spec). ✔

**Placeholder scan:** none; every code step shows exact old→new code.

**Type consistency:** grouping rows keyed by `type` in both tools; GW uses `state.grouping` + `state.worksharingLead` + `leadPricingActive()`; Budget uses `sub.variations`. `.some(...)`/`.every(...)` predicates match each tool's state shape. Button class per tool (`vcl-wf-add` / `vcl-bud-add`).

## Execution Handoff

Verification is browser-based (no JS test runner in this repo). Commits withheld until the user's explicit go.
