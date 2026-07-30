# Live-Preview Highest-Type Badge + EU/EEA Jurisdiction Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs found during WP live-testing of the Guided Workflow: (1) the Live Preview's leading type badge shows the base variation's own type instead of the highest-severity type across the whole submission when no classification code was picked; (2) UK (post-Brexit), Switzerland, and Serbia are wrongly selectable as a "national" procedure country or as the Worksharing/Super-Grouping lead authority in Annual Update, Super-Grouping, and Worksharing — these three modes are EU-law constructs (Art. 7(2)(b) / Art. 20 VO (EG) 1234/2008) open only to EU member states plus Iceland and Norway (EEA/EFTA).

**Architecture:** Both fixes live entirely in `variation-fee-calculator/assets/js/vcl-workflow.js` (no changes to the shared fee-engine data or the standalone Fee Calculator — UK remains a valid standalone national jurisdiction there, per the project's supported-jurisdictions list). Task 1 adds a small `highestType()` helper reusing the already-correct `feeCounts()` tally. Task 2 adds a `NON_EU_PROCEDURE_COUNTRIES` denylist constant and applies it at three call sites (national-country picker, lead-authority dropdown, and a defensive reset in `rerender()` for values that were valid before a mode change and no longer are).

**Tech Stack:** Vanilla JS, no test harness for this file (DOM-rendering code) — verification is `node --check` + manual code trace, consistent with prior tasks on this branch.

## Global Constraints

- Repo root: `D:\Claude\Variation Fee Calculator`. Branch `feature/super-grouping-annual-update` (already checked out — do not create a branch, do not push).
- No changes to `vcl-calc-app.js`, `vcl-calc-data.js`, or any file outside `vcl-workflow.js` — the standalone Fee Calculator's country/role data must remain untouched (UK stays a valid standalone national jurisdiction there).
- `NON_EU_PROCEDURE_COUNTRIES = ['CH', 'RS', 'UK']` — exact three codes, no more, no less. Do not touch `IS`/`NO` (EEA/EFTA, stay eligible) or `EU` (the EMA/CP pseudo-code, stays eligible as lead).
- The restriction applies when Annual Update, Worksharing, OR Super-Grouping is active (i.e. `auActive() || multiProcedureMode()`, since `multiProcedureMode()` already covers WS + SG) — never to a plain single-procedure submission (mode `null`).
- Commit message trailer required: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` for implementer commits.

---

### Task 1: Live Preview highest-type badge

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js:141` (new helper, after `feeCountsTotal`) and `:1817` (the `state.typeOnly` branch of the live-preview chips)

**Interfaces:**
- Consumes: existing `feeCounts()` (`vcl-workflow.js:134-140`, unchanged) — already correctly tallies IA/IB/II across the base variation and every grouped entry.
- Produces: `highestType()` → `'IA'|'IB'|'II'|null`, used only by this task's own edit — no other task depends on it.

- [ ] **Step 1: Add the `highestType()` helper**

In `variation-fee-calculator/assets/js/vcl-workflow.js`, immediately after the existing `feeCountsTotal` function:

```js
  function feeCountsTotal(c) { return c.IA + c.IB + c.II; }
```

insert:

```js
  // Highest-severity type across the whole submission (base + grouping): a grouped bundle is
  // procedurally governed by its most complex member (IA < IB < II), so the live-preview's
  // "no classification code picked" badge must track this, not just the base's own type.
  function highestType() {
    const c = feeCounts();
    if (c.II) return "II";
    if (c.IB) return "IB";
    if (c.IA) return "IA";
    return null;
  }
```

- [ ] **Step 2: Use it in the live-preview `state.typeOnly` chip**

Find this block (currently `vcl-workflow.js:1812-1818`):

```js
    const variant = pickedVariant();
    if (variant) {
      const e = pickedEntry();
      chips.appendChild(el("span", "vcl-wf-chip", `${escapeHtml(e.code)} <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>`));
    } else if (state.typeOnly) {
      chips.appendChild(el("span", "vcl-wf-chip", `<span class="${typeBadgeClass(state.typeOnly)}">${escapeHtml(state.typeOnly)}</span>`));
    }
```

Replace only the `else if (state.typeOnly)` branch — leave the `if (variant)` branch untouched (it correctly labels a specific classification code with that code's own type; showing a different type next to that code would be factually wrong):

```js
    const variant = pickedVariant();
    if (variant) {
      const e = pickedEntry();
      chips.appendChild(el("span", "vcl-wf-chip", `${escapeHtml(e.code)} <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>`));
    } else if (state.typeOnly) {
      const ht = highestType() || state.typeOnly;
      chips.appendChild(el("span", "vcl-wf-chip", `<span class="${typeBadgeClass(ht)}">${escapeHtml(ht)}</span>`));
    }
```

(`highestType() || state.typeOnly` is a defensive fallback only — `highestType()` cannot actually return `null` once `state.typeOnly` is set, since `currentType()` then returns `state.typeOnly` and `feeCounts()` always counts it; keep the fallback anyway so this line can never render `null`.)

- [ ] **Step 3: Verify**

Run: `node --check variation-fee-calculator/assets/js/vcl-workflow.js`
Expected: exit 0, no output.

Manual trace (write this out in the report, don't just assert it): (a) base `state.typeOnly = 'IA'`, no grouping → `feeCounts() = {IA:1,IB:0,II:0}` → `highestType()` returns `'IA'` → badge shows IA (unchanged from today). (b) same base, plus one grouped entry with `type:'IB'` → `feeCounts() = {IA:1,IB:1,II:0}` → `highestType()` returns `'IB'` (checks II first, then IB) → badge now shows IB — this is the exact scenario from the bug report (screenshot showed a stale green "IA" that should have been a brown "IB"). (c) base `pickedVariant()` returns a variant of type `'IA'` for code `B.II.b.1`, plus a grouped `'II'` entry → the `if (variant)` branch is untouched, still shows `B.II.b.1 [IA]` — confirm this is correct (that specific code IS IA) and that only the separate "Grouping" tally chip (unaffected by this task) reflects the II.

- [ ] **Step 4: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js
git commit -m "$(cat <<'EOF'
fix: live-preview type-only badge shows highest severity, not base-only

The "no classification code picked" live-preview badge showed only the
base variation's own declared type, so adding a higher-severity grouped
variation (e.g. an IB alongside a typeOnly IA base) left the badge stuck
on the lower type. A grouped submission is procedurally governed by its
most complex member, so the badge now reports the highest IA/IB/II across
feeCounts() (base + grouping). The classification-code branch (which
labels a specific code with that code's own type) is unchanged -- showing
a different type there would misrepresent that code.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: EU/EEA-only jurisdiction restriction for AU/SG/WS

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` at four locations: the top-level constants (new), `countryData()` (`:73-87`), `procEditor()`'s national branch (`:709-711`), `buildWorksharingLead()` (`:848-874`), and `rerender()` (after the Super-Grouping family filter, `:1904-1907`).

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: `NON_EU_PROCEDURE_COUNTRIES` (module-level array constant) and `countryData().nationalEU` — used only within this task's own edits, no other task depends on them.

- [ ] **Step 1: Add the denylist constant**

In `variation-fee-calculator/assets/js/vcl-workflow.js`, find the top of the IIFE:

```js
  const DATA = window.VCL_DATA || {};
  const ENTRIES = DATA.ENTRIES || [];
  const WD = window.VCL_WORKLOAD_DATA || {};
```

Add immediately after:

```js
  // Annual Update, Super-Grouping, and Worksharing are EU-law multi-country submission
  // constructs (Art. 7(2)(b) / Art. 20 VO (EG) 1234/2008), open only to EU member states plus
  // Iceland and Norway (EEA/EFTA, full MRP/DCP participants). CH and RS are non-EU/EEA
  // national-only jurisdictions with no MRP/DCP role at all. The UK left the EU (Brexit) and
  // can no longer take part in any EU multi-country procedure -- it remains valid ONLY as a CMS
  // in MRP/DCP (a role this list never touches) and for the standalone single-country Fee
  // Calculator (a separate tool/file, unaffected by this list).
  const NON_EU_PROCEDURE_COUNTRIES = ["CH", "RS", "UK"];
```

- [ ] **Step 2: Add the filtered national list to `countryData()`**

Find (`vcl-workflow.js:73-87`):

```js
  function countryData() {
    if (COUNTRIES) return COUNTRIES;
    const all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    const nameOf = {};
    all.forEach((c) => { nameOf[c.cc] = c.name; });
    COUNTRIES = {
      all: all,
      nameOf: nameOf,
      national: all.filter((c) => c.roles.indexOf("national") !== -1).map((c) => c.cc),
      rms: all.filter((c) => c.roles.indexOf("RMS") !== -1).map((c) => c.cc),
      cms: all.filter((c) => c.roles.indexOf("CMS") !== -1).map((c) => c.cc),
      ema: (all.find((c) => c.roles.indexOf("EMA") !== -1) || {}).cc || null,
    };
    return COUNTRIES;
  }
```

Replace with (adds `nationalEU` and `leadEligible`, everything else unchanged):

```js
  function countryData() {
    if (COUNTRIES) return COUNTRIES;
    const all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    const nameOf = {};
    all.forEach((c) => { nameOf[c.cc] = c.name; });
    const national = all.filter((c) => c.roles.indexOf("national") !== -1).map((c) => c.cc);
    COUNTRIES = {
      all: all,
      nameOf: nameOf,
      national: national,
      nationalEU: national.filter((cc) => NON_EU_PROCEDURE_COUNTRIES.indexOf(cc) === -1),
      leadEligible: all.filter((c) => NON_EU_PROCEDURE_COUNTRIES.indexOf(c.cc) === -1),
      rms: all.filter((c) => c.roles.indexOf("RMS") !== -1).map((c) => c.cc),
      cms: all.filter((c) => c.roles.indexOf("CMS") !== -1).map((c) => c.cc),
      ema: (all.find((c) => c.roles.indexOf("EMA") !== -1) || {}).cc || null,
    };
    return COUNTRIES;
  }
```

(`rms`/`cms`/`ema` are untouched: `UK` never has an `RMS` or `EMA` role in the underlying fee data, so `cd.rms`/`cd.cms`/`cd.ema` already exclude it correctly today — confirm this yourself by reading the actual `rolesForCountry` output if you want independent proof, but do not modify anything in `vcl-calc-app.js`.)

- [ ] **Step 3: Restrict the "National" country picker in `procEditor()`**

Find (`vcl-workflow.js:709-711`):

```js
    const cd = countryData();
    if (p.kind === "national") {
      host.appendChild(countrySelect("Country", cd.national, p.nat, (cc) => { p.nat = cc; rerender(); }));
```

Replace with:

```js
    const cd = countryData();
    if (p.kind === "national") {
      // AU/WS/SG are EU-only procedures (NON_EU_PROCEDURE_COUNTRIES); a plain single-procedure
      // submission (mode null) keeps the full national list.
      const natList = (auActive() || multiProcedureMode()) ? cd.nationalEU : cd.national;
      host.appendChild(countrySelect("Country", natList, p.nat, (cc) => { p.nat = cc; rerender(); }));
```

(The rest of the `mrpdcp`/`cp` branches below are unchanged — leave them exactly as they are.)

- [ ] **Step 4: Restrict the lead-authority dropdown in `buildWorksharingLead()`**

Find (`vcl-workflow.js:848-864`):

```js
  function buildWorksharingLead(host, label) {
    const cd = countryData();
    const hasCP = worksharingHasCP();
    const wrap = el("div", "vcl-wf-field");
    wrap.appendChild(flabel(label || "Worksharing RMS (lead)", 12));
    const sel = document.createElement("select");
    sel.className = "vcl-wf-select";
    sel.disabled = hasCP;
    const opt0 = document.createElement("option");
    opt0.value = ""; opt0.textContent = "— select —";
    sel.appendChild(opt0);
    cd.all.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.cc; o.textContent = (c.name || c.cc) + " (" + c.cc + ")";
      if (state.worksharingLead === c.cc) o.selected = true;
      sel.appendChild(o);
    });
```

Replace only the `cd.all.forEach` line (everything else in this snippet stays character-for-character identical):

```js
    cd.leadEligible.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.cc; o.textContent = (c.name || c.cc) + " (" + c.cc + ")";
      if (state.worksharingLead === c.cc) o.selected = true;
      sel.appendChild(o);
    });
```

This function is only ever called when `multiProcedureMode()` is true (WS or SG — check the call site at `vcl-workflow.js:667-669` yourself to confirm, do not change that call site), so no extra mode check is needed here — the restriction always applies whenever this dropdown renders at all.

- [ ] **Step 5: Defensive reset in `rerender()` for stale values**

Find (`vcl-workflow.js:1904-1910`, immediately after the Super-Grouping family-filter block added in a prior task):

```js
    if (sgActive()) {
      const baseFamily = VCL_SG_LOGIC.computeAllowedProcedureKinds([state.procedure], {});
      state.worksharing = state.worksharing.filter((p) => baseFamily.indexOf(p.kind) !== -1);
    }
    // Lead authority: a Centralised procedure (EMA) auto-leads a worksharing or super-grouping
    // (the field locks) -- same rule for both modes since both price via the shared lead path.
    if (leadPricingActive() && worksharingHasCP()) state.worksharingLead = countryData().ema;
```

Insert a new block between the two, so the result reads:

```js
    if (sgActive()) {
      const baseFamily = VCL_SG_LOGIC.computeAllowedProcedureKinds([state.procedure], {});
      state.worksharing = state.worksharing.filter((p) => baseFamily.indexOf(p.kind) !== -1);
    }
    // AU/WS/SG are EU-only procedures: a "national" country or lead authority picked before the
    // mode was active (or before NON_EU_PROCEDURE_COUNTRIES existed) can otherwise survive as a
    // stale, no-longer-selectable value. Reset idempotently every render -- once already
    // consistent, this is a no-op.
    if (auActive() || multiProcedureMode()) {
      allProcedures().forEach((p) => {
        if (p.kind === "national" && p.nat && NON_EU_PROCEDURE_COUNTRIES.indexOf(p.nat) !== -1) p.nat = null;
      });
      if (state.worksharingLead && NON_EU_PROCEDURE_COUNTRIES.indexOf(state.worksharingLead) !== -1) state.worksharingLead = null;
    }
    // Lead authority: a Centralised procedure (EMA) auto-leads a worksharing or super-grouping
    // (the field locks) -- same rule for both modes since both price via the shared lead path.
    if (leadPricingActive() && worksharingHasCP()) state.worksharingLead = countryData().ema;
```

- [ ] **Step 6: Verify**

Run: `node --check variation-fee-calculator/assets/js/vcl-workflow.js`
Expected: exit 0, no output.

Manual trace (write out in the report):
1. **Worksharing active, base procedure `kind:'national', nat:'UK'` set before WS was turned on.** Trace `rerender()`: `auActive()` false, `multiProcedureMode()` true (WS active) → the new reset block runs → `allProcedures()` returns `[state.procedure, ...state.worksharing]` → `state.procedure.kind === 'national' && state.procedure.nat === 'UK'` → `NON_EU_PROCEDURE_COUNTRIES.indexOf('UK') !== -1` → `p.nat = null`. Confirm the field is cleared.
2. **Plain single-procedure submission (mode `null`), base `kind:'national', nat:'UK'`.** `auActive()` false, `multiProcedureMode()` false → reset block skipped entirely → `p.nat` stays `'UK'`. Confirm UK remains usable for a normal standalone submission.
3. **Open the "National" country picker while Annual Update is active.** `auActive()` true → `natList = cd.nationalEU` → confirm `cd.nationalEU` does not contain `'CH'`, `'RS'`, or `'UK'`, but does contain e.g. `'DE'`, `'IS'`, `'NO'`.
4. **Open the lead-authority dropdown while Super-Grouping is active with a CP procedure and one MRP/DCP procedure with RMS `'PL'`.** Confirm `cd.leadEligible` (used by the dropdown's option list) still contains `'EU'` (EMA) and `'PL'`, but not `'UK'`/`'CH'`/`'RS'` — i.e. the CP-forced-EMA behavior from the prior task is untouched by this change.
5. **Worksharing lead was previously set to `'CH'` (e.g. from before this fix existed), Worksharing still active, no CP.** `auActive()` false, `multiProcedureMode()` true → reset block runs → `state.worksharingLead === 'CH'` → `NON_EU_PROCEDURE_COUNTRIES.indexOf('CH') !== -1` → `state.worksharingLead = null`. Confirm the select falls back to "— select —" on next render (no crash, `sel.value` simply won't match any option).

- [ ] **Step 7: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-workflow.js
git commit -m "$(cat <<'EOF'
fix: restrict Annual Update/Super-Grouping/Worksharing to EU+EEA jurisdictions

Annual Update, Super-Grouping, and Worksharing are EU-law multi-country
submission constructs (Art. 7(2)(b) / Art. 20 VO (EG) 1234/2008) open only
to EU member states plus Iceland and Norway. UK (post-Brexit), Switzerland,
and Serbia were still selectable as a "national" procedure country and as
the WS/SG lead authority in these modes. Adds a NON_EU_PROCEDURE_COUNTRIES
denylist, restricted country lists at both picker call sites, and a
defensive reset in rerender() for values that were valid before a mode
change (or before this fix existed) and no longer are. The standalone Fee
Calculator and MRP/DCP's CMS role for the UK are unaffected -- both are
untouched by this change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-Implementation

After both tasks: dispatch an Opus review of the combined diff for domain correctness (same pattern as the CP-exclusivity slice) — specifically: (a) is `NON_EU_PROCEDURE_COUNTRIES` complete and correct (any other non-EU/EEA jurisdiction in `COUNTRY_NAMES` this list might have missed?), (b) does the defensive-reset block in Task 2 Step 5 actually close every path to a stale value the way the CP-exclusivity fix closed its mode-switch hole, (c) sanity-check Task 1's `highestType()` regulatory reasoning (grouped bundles follow their highest-classified member). Update the SDD ledger and `super-grouping-annual-update.md` memory afterward.
