# Type-IA Submission-Mode Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent advancing (Guided Workflow) or saving a line (Budget Planning) when every variation is Type IA but no bundling mode (Super-Grouping / Annual Update) has been selected.

**Architecture:** Extend the existing `stationComplete("B")` completeness predicate in both tools to additionally require a submission mode when `allVariationsAreIA()` is true, and add a co-located inline hint under the submission-type chips. No new files, no new dependencies — two focused edits per file.

**Tech Stack:** Vanilla JS (IIFE modules on `window`), WordPress plugin. No build step, no JS test runner. Verification is behavioral in the browser (real Chrome preferred; the in-app Browser pane is a fallback).

## Global Constraints

- No new dependencies, no build tooling — plain vanilla JS matching surrounding style (2-space indent, `var`/`const` as already used per file).
- IAIN must NOT be affected: `allVariationsAreIA()` already tests strict `type === 'IA'`, excluding IAIN. Do not change that predicate.
- Bugfix discipline (project rule): change only the relevant lines; no reformatting of untouched code.
- Do NOT run `git commit` / `git push` autonomously. Commits happen only on the user's explicit go.
- Verification screenshots: prefer real Chrome; the in-app browser screenshot tool is unreliable for this project.

---

### Task 1: Guided Workflow — gate `Next` + hint (`vcl-workflow.js`)

**Files:**
- Modify: `assets/js/vcl-workflow.js` — `stationComplete` Station-B branch (line 460); submission-type block in `buildStationB` (lines 745-746)

**Interfaces:**
- Consumes (already defined in this module): `procComplete(p)`, `allVariationsAreIA()`, `state.submission.mode`, `el(tag, cls, html)`.
- Produces: no new exported symbols. Behavioral change only: `stationComplete("B")` now returns `false` while `allVariationsAreIA() && !state.submission.mode`.

- [ ] **Step 1: Tighten the Station-B completeness predicate**

In `assets/js/vcl-workflow.js`, replace line 460:

```js
    if (key === "B") return procComplete(state.procedure);
```

with:

```js
    // Type-IA-only submissions must choose a bundling mode (Super-Grouping /
    // Annual Update) before advancing -- a Type IA is never submitted on its own.
    if (key === "B") return procComplete(state.procedure) && (!allVariationsAreIA() || !!state.submission.mode);
```

- [ ] **Step 2: Add the co-located hint under the SG/AU chips**

In `buildStationB`, the Type-IA branch currently ends with the existing hint paragraph (line 746). Immediately after that `body.appendChild(el("p", "vcl-wf-hint", "Available because ..."));` line, add:

```js
      if (!state.submission.mode) {
        body.appendChild(el("p", "vcl-wf-hint vcl-wf-hint--req", "Select Super-Grouping or Annual Update to continue — a Type IA is never submitted on its own."));
      }
```

- [ ] **Step 3: Browser verification — Type-IA-only blocks until a mode is chosen**

Open the Guided Workflow (real Chrome, or `preview_start` then navigate to the tool page). Build a submission with **three Type IA** variations, reach Station B, complete the procedure (e.g. National → Germany).

Expected:
- `Next →` is **disabled**.
- The req-hint text ("Select Super-Grouping or Annual Update to continue …") is visible under the chips.
- Click **Super-Grouping** → `Next →` becomes **enabled**, hint disappears.
- Click **Super-Grouping** again (toggles mode back to `null`) → `Next →` **disabled** again, hint reappears.

- [ ] **Step 4: Browser verification — non-IA path unchanged**

Change one variation so not all are Type IA (mixed). Expected: the **Worksharing** branch shows (no SG/AU chips, no req-hint), and `Next →` enables as soon as the procedure is complete — exactly as before this change.

- [ ] **Step 5: Browser verification — IAIN unaffected**

Add an IAIN variation. Expected: `allVariationsAreIA()` is false → SG/AU chips absent (Worksharing branch), `Next →` behaves as today. Confirms the 14-day IAIN case is untouched.

- [ ] **Step 6: Capture proof + await commit go**

Take a screenshot of Station B in the blocked state (disabled `Next` + hint) and the enabled state after selecting a mode. Do NOT commit yet — report results and wait for the user's explicit go before any `git commit`.

---

### Task 2: Budget Planning — gate `Next` / `Save line` + hint (`vcl-budget.js`)

**Files:**
- Modify: `assets/js/vcl-budget.js` — `stationComplete` Station-B branch (lines 529-536); submission-type section around the Type-IA hint (line 1004)

**Interfaces:**
- Consumes (already available in this module): `SUB.allVariationsAreIA(sub, engines())`, `sub.mode`, `engines()`, `el(...)`. `stationComplete(key, sub)` receives `sub`; the submission-type render has `sub` and the local `allIA` in scope (line 957: `var allIA = SUB.allVariationsAreIA(sub, engines());`).
- Produces: no new exported symbols. Behavioral change only: `stationComplete("B", sub)` now returns `false` while Type-IA-only with `!sub.mode`; this also gates the final `+ Add line` / `Save line` button (line 1273, which ANDs `stationComplete("A") && stationComplete("B")`).

- [ ] **Step 1: Tighten the Station-B completeness predicate**

In `assets/js/vcl-budget.js`, replace the Station-B branch (lines 529-536):

```js
    if (key === "B") {
      var procs = SUB.multiProcedureMode(sub) ? sub.procedures : [sub.procedures[0]];
      var procsOk = procs.every(function (p) {
        return p.kind === "cp" || (p.kind === "national" && p.nat) || (p.kind === "mrpdcp" && p.rms);
      });
      var leadOk = !SUB.leadPricingActive(sub) || !!sub.lead;
      return procsOk && leadOk;
    }
```

with:

```js
    if (key === "B") {
      var procs = SUB.multiProcedureMode(sub) ? sub.procedures : [sub.procedures[0]];
      var procsOk = procs.every(function (p) {
        return p.kind === "cp" || (p.kind === "national" && p.nat) || (p.kind === "mrpdcp" && p.rms);
      });
      var leadOk = !SUB.leadPricingActive(sub) || !!sub.lead;
      // Type-IA-only submissions must choose a bundling mode before the line is complete.
      var modeOk = !SUB.allVariationsAreIA(sub, engines()) || !!sub.mode;
      return procsOk && leadOk && modeOk;
    }
```

- [ ] **Step 2: Add the co-located hint under the SG/AU chips**

Locate the Type-IA hint in the submission-type section (line 1004, the paragraph beginning "Available because every listed variation is Type IA."). Immediately after that hint paragraph is appended, add — using the `allIA` and `sub` already in scope:

```js
        if (allIA && !sub.mode) {
          host.appendChild(el("p", "vcl-bud-hint vcl-bud-hint--req", "Select Super-Grouping or Annual Update to continue — a Type IA is never submitted on its own."));
        }
```

(Use the same append target — `host` — and `el` helper the neighbouring hint uses; match the exact variable names present at that line when editing.)

- [ ] **Step 3: Browser verification — save is blocked until a mode is chosen**

Open Budget Planning, add a line, build **three Type IA** variations, reach Station B, complete the procedure.

Expected:
- On Station B, `Next →` is **disabled** and the req-hint shows under the chips.
- Advancing is impossible until **Super-Grouping** or **Annual Update** is selected.
- On the final station, `+ Add line` / `Save line` is **disabled** while no mode is set (it ANDs `stationComplete("B")`), and **enabled** once a mode is chosen.

- [ ] **Step 4: Browser verification — mixed types unchanged**

Make the variations mixed (not all IA). Expected: Worksharing branch, no req-hint; `Next` and `Save line` behave as before the change.

- [ ] **Step 5: Capture proof + await commit go**

Screenshot the blocked Station B (disabled `Next` + hint) and the enabled `Save line` after a mode is selected. Do NOT commit yet — report and wait for the user's explicit go.

---

### Task 3: Optional CSS for the `--req` hint variant

**Files:**
- Inspect: `assets/css/*.css` (whichever holds `.vcl-wf-hint` / `.vcl-bud-hint`)
- Modify (only if needed): the same CSS file

**Interfaces:**
- Consumes: existing `.vcl-wf-hint` / `.vcl-bud-hint` styles.
- Produces: optional `.vcl-wf-hint--req` / `.vcl-bud-hint--req` modifier for subtle emphasis (e.g. slightly stronger colour).

- [ ] **Step 1: Check whether a modifier is needed**

Grep for the hint classes to find the stylesheet:

```bash
grep -rn "vcl-wf-hint\|vcl-bud-hint" assets/css
```

If the base hint style is already legible for the required-action message, **skip this task** — the `--req` class is harmless without a rule (YAGNI).

- [ ] **Step 2: (If desired) add a minimal emphasis rule**

Append to the relevant CSS file, matching the palette already used for hints/warnings:

```css
.vcl-wf-hint--req,
.vcl-bud-hint--req { color: #8a6d00; font-weight: 600; }
```

- [ ] **Step 3: Browser verification**

Reload; confirm the req-hint is visually distinct from the neutral explanatory hint and readable in the tool's normal theme.

---

## Self-Review

**Spec coverage:**
- GW `Next` gate → Task 1 Step 1. ✔
- Budget `Next` + `Add/Save line` gate → Task 2 Step 1 (finish button ANDs `stationComplete("B")`). ✔
- UX hint under chips, both tools → Task 1 Step 2, Task 2 Step 2. ✔
- IAIN unaffected → verified in Task 1 Step 5; predicate untouched (Global Constraints). ✔
- Rejected alternatives (auto-default, block-later) → not implemented, by design. ✔
- Testing matrix (5 spec cases) → covered across Task 1 Steps 3-5 and Task 2 Steps 3-4. ✔

**Placeholder scan:** No TBD/TODO; every code step shows exact old→new code. Task 3 is explicitly optional/skippable, not a placeholder.

**Type consistency:** `allVariationsAreIA()` (GW, no args) vs `SUB.allVariationsAreIA(sub, engines())` (Budget) — the two tools' correct respective signatures, matching existing call sites (`vcl-workflow.js:211`, `vcl-budget.js:957`). Hint classes consistent between spec and plan (`--req`). Mode field: `state.submission.mode` (GW) / `sub.mode` (Budget), matching each module's state shape.

## Execution Handoff

Verification is browser-based (no JS test runner in this repo). Commits are withheld until the user's explicit go, per project rule.
