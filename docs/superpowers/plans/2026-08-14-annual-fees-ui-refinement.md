# Annual Fees UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Budget tool's Annual-Fees section so it reads as one system with the Variations table, tidy the Agency-fees tile, and add a Combined/Variations/Annual filter to the breakdown boxes.

**Architecture:** Pure client-side edits to two files — `assets/js/vcl-budget.js` (rendering + a new view-mode in `state`) and `assets/css/vcl-budget-style.css`. No engine changes: `computeRollup`, `computeAnnualRollup`, and `mergeBreakdown` already expose the three breakdown sources the toggle needs. The Annual table gains an expandable detail row mirroring the existing Variations detail (`renderDetailRow`).

**Tech Stack:** Vanilla ES5-style JS (IIFE, no framework), hand-written CSS, WordPress plugin shortcode. No JS test runner in this project — verification is manual in **real Chrome** (the in-app browser screenshot tool is unreliable here, per project notes).

## Global Constraints

- Source dir: `D:\Claude\Variation Fee Calculator\variation-fee-calculator\`. Edit files there.
- No engine edits (`vcl-budget-engine.js` stays as-is).
- Bugfix discipline: change only the relevant lines; no wholesale reformatting.
- Commit messages: Conventional Commits, English.
- **Commits/deploy run only on the user's explicit go** (project rule). Each task's "Commit" step is prepared but must be confirmed before running. No `git push` unless asked.
- Button label is exactly `+ Add variation line`. Column header is exactly `Special cases`.
- Breakdown toggle scope = Variante A: breakdown boxes only; Agency/RA/FTE tiles unchanged.
- Verify every visual change in real Chrome, not the in-app browser.

---

## File structure

- `assets/js/vcl-budget.js` — all rendering + the new `state.breakdownMode`. Functions touched: `renderRollupTiles`, `annualTariffCell`, `renderAnnualTable`, `renderBreakdownPanel`, `rerender`, `onTableClick`, `onHeaderClick`, `renderAnnualEditor` (paintNav); new `renderAnnualDetailRow`.
- `assets/css/vcl-budget-style.css` — remove agency stripe; add special-cases-cell, segmented-control, and Annual-wrapper overflow rules.

---

## Task 1: Agency-fees tile cleanup

**Files:**
- Modify: `assets/js/vcl-budget.js:352-353`
- Modify: `assets/css/vcl-budget-style.css:54`

**Interfaces:**
- Consumes: `annualRollup.totalEur`, `fmtEUR`, `escapeHtml` (existing).
- Produces: nothing new.

- [ ] **Step 1: Remove the `/yr` suffix on the Annual-fee value**

In `vcl-budget.js`, the agency rows HTML (`renderRollupTiles`) currently reads:

```js
      '<div class="vcl-bud-agency__row"><span>Annual fee</span><span class="vcl-bud-agency__val">' +
      escapeHtml(fmtEUR(annualRollup.totalEur)) + " /yr</span></div>" +
```

Change the second line to drop `" /yr"`:

```js
      '<div class="vcl-bud-agency__row"><span>Annual fee</span><span class="vcl-bud-agency__val">' +
      escapeHtml(fmtEUR(annualRollup.totalEur)) + "</span></div>" +
```

- [ ] **Step 2: Remove the red left stripe**

In `vcl-budget-style.css`, delete this rule entirely (line 54):

```css
.vcl-app .vcl-bud-tile.vcl-bud-agency { border-left: 3px solid var(--budget); }
```

- [ ] **Step 3: Verify in Chrome**

Load a page with the Budget tool and a plan containing both variation lines and annual fees. Expected: the Agency-fees tile has no coloured left stripe; the "Annual fee" value shows a bare `€X` (no `/yr`) whose right edge lines up with the "Variations" and "Total this year" values.

- [ ] **Step 4: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js assets/css/vcl-budget-style.css
git commit -m "fix(budget): drop agency-tile stripe and /yr suffix, align annual value"
```

---

## Task 2: Label changes (header button, column header, export header)

**Files:**
- Modify: `assets/js/vcl-budget.js:804` (header button)
- Modify: `assets/js/vcl-budget.js:721` (table column header)
- Modify: `assets/js/vcl-budget.js:1828` (export sheet header)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Rename the header action button**

In `rerender`, the actions HTML has:

```js
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--primary" data-act="new-line">+ New line</button>';
```

Change the label to `+ Add variation line` (keep `data-act="new-line"` — the handler key stays):

```js
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--primary" data-act="new-line">+ Add variation line</button>';
```

- [ ] **Step 2: Rename the Annual table column header**

In `renderAnnualTable`, the thead HTML has:

```js
      '<th>Special case / tariff</th><th style="text-align:right">Annual fee</th><th></th>' +
```

Change to:

```js
      '<th>Special cases</th><th style="text-align:right">Annual fee</th><th></th>' +
```

- [ ] **Step 3: Rename the export sheet column header**

In `exportExcel`, the annual rows header array reads:

```js
    var annualRows = [["Product", "Registration/track", "Markets", "Strengths", "Special case", "Annual fee (EUR)", "Coverage"]];
```

Change `"Special case"` to `"Special cases"`.

- [ ] **Step 4: Verify**

In Chrome: the header button reads `+ Add variation line` and still opens the new-line editor; the Annual table column header reads `Special cases`. Run "Export to Excel" — the Annual sheet's 5th column header reads `Special cases`.

- [ ] **Step 5: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js
git commit -m "refactor(budget): rename to 'Add variation line' and 'Special cases'"
```

---

## Task 3: Special-cases cell — only affected markets, plain text, no pills

**Files:**
- Modify: `assets/js/vcl-budget.js:650-676` (`annualTariffCell`)
- Modify: `assets/css/vcl-budget-style.css` (add `.vcl-bud-annual__sc*` rules)

**Interfaces:**
- Consumes: `res.byCountry` items `{ cc, role, tariffId, amountLocal, ccy, amountEur, status }` where `status ∈ {no-annual, turnover, no-rate, needs-pick, ok}`; `annualCountries()`, `BUD.findAnnualCountry`, `escapeHtml`.
- Produces: cell markup keeping the existing `select[data-line-id][data-cc]` contract that `onAnnualChange` reads.

- [ ] **Step 1: Replace `annualTariffCell`**

Replace the whole function body with a version that emits a line **only** for markets that carry a real special case — a multi-tariff `<select>` or a `turnover-based` status. Single-default ("auto") and `no-annual` markets are omitted. No `.vcl-bud-cc` pill.

```js
  // Special cases cell: only markets that carry an actual special case are listed -- a multi-tariff
  // <select> (unchanged data-line-id/data-cc contract for onAnnualChange) or a turnover-based note.
  // Single-default ("auto") and no-fee markets are omitted; a row with none shows an em dash. Plain
  // running text, no country pills.
  function annualTariffCell(row, res) {
    var list = res.byCountry || [];
    var countries = annualCountries();
    var lines = [];
    list.forEach(function (c) {
      var inner = null;
      if (c.status === "turnover") {
        inner = '<span class="vcl-bud-annual__track">turnover-based</span>';
      } else if (c.status === "no-annual") {
        return; // no fee -> not a special case
      } else {
        var entry = BUD.findAnnualCountry(countries, c.cc);
        if (entry && entry.tariffs && entry.tariffs.length > 1) {
          var opts = entry.tariffs.map(function (t) {
            return '<option value="' + escapeHtml(t.id) + '"' + (t.id === c.tariffId ? " selected" : "") + ">" +
              escapeHtml(t.label) + "</option>";
          }).join("");
          inner = '<select class="vcl-bud-select vcl-bud-select--tariff" data-line-id="' + escapeHtml(row.id) +
            '" data-cc="' + escapeHtml(c.cc) + '">' + opts + "</select>";
        } else {
          return; // single default tariff -> not a special case
        }
      }
      lines.push('<div class="vcl-bud-annual__sc-line"><span class="vcl-bud-annual__sc-cc">' +
        escapeHtml(c.cc) + "</span> " + inner + "</div>");
    });
    if (!lines.length) return '<span class="vcl-bud-annual__track">—</span>';
    return '<div class="vcl-bud-annual__sc">' + lines.join("") + "</div>";
  }
```

- [ ] **Step 2: Add the cell CSS**

Append to `vcl-budget-style.css` (near the other `.vcl-bud-annual__*` rules, ~line 386):

```css
.vcl-app .vcl-bud-annual__sc { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.vcl-app .vcl-bud-annual__sc-line { font-size: 12px; color: var(--ink); line-height: 1.5; display: inline-flex; align-items: center; gap: 6px; }
.vcl-app .vcl-bud-annual__sc-cc { font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 600; color: var(--muted); }
```

- [ ] **Step 3: Verify**

In Chrome, with an annual row like the MRP/DCP Ibuprofen example (IT/BG/MT/NL/UK/HU/EL/SE): the Special-cases cell now shows **only** MT, NL, UK (their tariff selects) and EL (`turnover-based`) — no `auto` rows, no country pills. A national row whose market has a single default tariff shows `—`. Changing a `<select>` still re-prices the row (write path unchanged).

- [ ] **Step 4: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js assets/css/vcl-budget-style.css
git commit -m "feat(budget): show only real special cases per market, plain, no pills"
```

---

## Task 4: Annual row expansion + move noisy notes into the detail

**Files:**
- Modify: `assets/js/vcl-budget.js` — add `renderAnnualDetailRow` (near `renderDetailRow`, ~line 483); edit `renderAnnualTable` fee cell + row loop (`:729`, `:743`); edit `onTableClick` (`:1893`).
- Modify: `assets/css/vcl-budget-style.css` — add `cursor: pointer` on `.vcl-bud-annual-row`.

**Interfaces:**
- Consumes: `res` from `BUD.computeAnnualRow` (`{ total, byCountry, computable }`), `row.coverage`, `BUD.prorationFactor`, `fmtEUR`, `fmtLocalAmount`, `escapeHtml`, `toggleExpand`, `state.expandedId`.
- Produces: `renderAnnualDetailRow(row, res) -> <tr.vcl-bud-detail-row>`.

- [ ] **Step 1: Add `renderAnnualDetailRow`**

Insert after `renderDetailRow` (after line 483). Colspan is 7 (the Annual table has 7 columns).

```js
  // Expandable per-annual-row detail, mirroring renderDetailRow: fee-by-market (EUR + local currency)
  // on the left, proration + turnover/no-rate qualifiers on the right. This is where the noisy notes
  // (local-currency amounts, "+ turnover-based") live now, so the compact fee cell stays clean.
  function renderAnnualDetailRow(row, res) {
    var tr = el("tr", "vcl-bud-detail-row");
    var td = el("td"); td.colSpan = 7;
    var box = el("div", "vcl-bud-detail");
    var grid = el("div", "vcl-bud-detail__grid");

    var left = el("div");
    left.appendChild(el("div", "vcl-bud-detail__sec", "Annual fee by market"));
    (res.byCountry || []).forEach(function (c) {
      var itm = el("div", "vcl-bud-detail__item");
      itm.appendChild(el("span", null, '<span class="vcl-bud-cc">' + escapeHtml(c.cc) + "</span>"));
      var rightText = (c.status === "turnover") ? "turnover-based"
        : (c.status === "no-annual") ? "no fee"
        : (c.status === "no-rate") ? "rate unavailable"
        : fmtEUR(c.amountEur);
      itm.appendChild(el("span", "vcl-bud-detail__h", escapeHtml(rightText)));
      left.appendChild(itm);
      if (c.ccy && c.ccy !== "EUR" && (c.status === "ok" || c.status === "needs-pick" || c.status === "no-rate")) {
        var sub = el("div", "vcl-bud-detail__sub");
        sub.appendChild(el("span", null, "in local currency"));
        sub.appendChild(el("span", null, c.cc + " " + fmtLocalAmount(c.amountLocal, c.ccy)));
        left.appendChild(sub);
      }
    });
    var tot = el("div", "vcl-bud-detail__total");
    tot.appendChild(el("span", null, "Total annual"));
    tot.appendChild(el("span", null, fmtEUR(res.total)));
    left.appendChild(tot);
    grid.appendChild(left);

    var rightCol = el("div");
    rightCol.appendChild(el("div", "vcl-bud-detail__sec", "Coverage & tariffs"));
    var factor = BUD.prorationFactor(row.coverage);
    var months = (row.coverage && row.coverage.mode === "partial")
      ? (5 - parseInt(String(row.coverage.fromQuarter || "").replace(/[^0-9]/g, ""), 10)) * 3 : 12;
    var pr = el("div", "vcl-bud-detail__item");
    pr.appendChild(el("span", null, "Proration"));
    pr.appendChild(el("span", "vcl-bud-detail__h", months + "/12 · " + Math.round(factor * 100) + "%"));
    rightCol.appendChild(pr);
    if (!res.computable) {
      var hasTurnover = (res.byCountry || []).some(function (c) { return c.status === "turnover"; });
      var hasNoRate = (res.byCountry || []).some(function (c) { return c.status === "no-rate"; });
      if (hasTurnover) rightCol.appendChild(el("p", "vcl-bud-hint", "Some markets are turnover-based and priced separately."));
      if (hasNoRate) rightCol.appendChild(el("p", "vcl-bud-hint", "Some markets have no resolvable FX rate."));
    }
    grid.appendChild(rightCol);

    box.appendChild(grid);
    td.appendChild(box); tr.appendChild(td);
    return tr;
  }
```

- [ ] **Step 2: Clean the fee cell + append the detail row in `renderAnnualTable`**

The row loop currently builds `feeHtml` with the notes and appends only `tr`:

```js
      var feeHtml = escapeHtml(fmtEUR(res.total)) + annualFeeCellNotes(res);
```

Change it to the clean EUR figure only:

```js
      var feeHtml = escapeHtml(fmtEUR(res.total));
```

Then, right after `tbody.appendChild(tr);` (line 743), append the detail row when this row is expanded:

```js
      tbody.appendChild(tr);
      if (state.expandedId === row.id) tbody.appendChild(renderAnnualDetailRow(row, res));
```

(`annualFeeCellNotes` is now unused; leave the function in place — removing it is optional cleanup, not required.)

- [ ] **Step 3: Make annual rows toggle on click**

In `onTableClick`, after the action-button `if (btn) { … }` block and before the line-row toggle (line 1893-1897), add a select guard and the annual toggle:

```js
    // A click on the tariff <select> inside an annual row must not toggle the row.
    if (evt.target.closest("select")) return;
    var annTr = evt.target.closest("tr.vcl-bud-annual-row[data-line-id]");
    if (annTr && annTr.dataset.lineId) { toggleExpand(annTr.dataset.lineId); return; }
```

- [ ] **Step 4: Add the pointer affordance**

Append to `vcl-budget-style.css`:

```css
.vcl-app .vcl-bud-annual-row { cursor: pointer; }
```

- [ ] **Step 5: Verify**

In Chrome: clicking an annual row expands a detail row styled like the Variations detail, showing per-market EUR amounts, local-currency sub-lines (e.g. `UK 8,724 GBP`), the proration line, and any turnover/no-rate hints. The compact "Annual fee" cell now shows only the clean `€X`. Opening a second row (annual or variation) closes the first — only one detail open at a time. Clicking a `<select>` does not collapse the row.

- [ ] **Step 6: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js assets/css/vcl-budget-style.css
git commit -m "feat(budget): expandable annual-row detail; clean the fee cell"
```

---

## Task 5: Fix column overflow, remove horizontal scrollbar, design parity

**Files:**
- Modify: `assets/js/vcl-budget.js:714` (annual `tableWrap` class), `:717-718` (colgroup)
- Modify: `assets/css/vcl-budget-style.css` (annual wrapper overflow)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. (Depends on Task 4 having moved the fee-cell notes out.)

- [ ] **Step 1: Tag the annual table wrapper and re-balance the columns**

In `renderAnnualTable`, change the wrapper to a modifier class:

```js
    var tableWrap = el("div", "vcl-bud-table-wrap vcl-bud-table-wrap--annual");
```

Then adjust the colgroup so the (now clean) fee column has room and the actions column is fixed. Replace:

```js
      '<colgroup><col style="width:5%"><col style="width:22%"><col style="width:24%">' +
      '<col style="width:6%"><col style="width:18%"><col style="width:14%"><col style="width:11%"></colgroup>' +
```

with:

```js
      '<colgroup><col style="width:5%"><col style="width:24%"><col style="width:24%">' +
      '<col style="width:6%"><col style="width:17%"><col style="width:15%"><col style="width:9%"></colgroup>' +
```

- [ ] **Step 2: Guard the wrapper against horizontal overflow**

Append to `vcl-budget-style.css`:

```css
.vcl-app .vcl-bud-table-wrap--annual { overflow-x: clip; }
```

- [ ] **Step 3: Verify**

In Chrome at the normal Budget-tool width: the Annual table shows no horizontal scrollbar; the "Annual fee" value and the ✎/✕ action icons sit in separate columns with clear space between them; fonts, padding, and row height match the Variations table above.

- [ ] **Step 4: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js assets/css/vcl-budget-style.css
git commit -m "fix(budget): re-balance annual columns and remove horizontal scrollbar"
```

---

## Task 6: "+ Add product" button — subtle, with a hint

**Files:**
- Modify: `assets/js/vcl-budget.js:704-709` (`renderAnnualTable` head)
- Modify: `assets/css/vcl-budget-style.css` (hint style)

**Interfaces:**
- Consumes: `planYearLabel()`, `el`.
- Produces: nothing new.

- [ ] **Step 1: Make the button ghost and add a hint**

In `renderAnnualTable`, the head currently is:

```js
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines — Annual maintenance fees"));
    var addBtn = el("button", "vcl-bud-btn vcl-bud-btn--primary", "+ Add product");
    addBtn.type = "button";
    addBtn.dataset.act = "add-annual";
    head.appendChild(addBtn);
    wrap.appendChild(head);
```

Change the button class to ghost and add a hint line under the button (wrap button + hint so they stack):

```js
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines — Annual maintenance fees"));
    var addWrap = el("div", "vcl-bud-annual__addwrap");
    var addBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost", "+ Add product");
    addBtn.type = "button";
    addBtn.dataset.act = "add-annual";
    addWrap.appendChild(addBtn);
    addWrap.appendChild(el("p", "vcl-bud-annual__addhint",
      "Add a product for which no variation is planned in " + escapeHtml(planYearLabel())));
    head.appendChild(addWrap);
    wrap.appendChild(head);
```

- [ ] **Step 2: Style the hint**

Append to `vcl-budget-style.css`:

```css
.vcl-app .vcl-bud-annual__addwrap { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.vcl-app .vcl-bud-annual__addhint { font-size: 11.5px; color: var(--muted); margin: 0; }
```

- [ ] **Step 3: Verify**

In Chrome: the "+ Add product" button is now quiet (ghost, not the filled budget colour); a muted hint reads "Add a product for which no variation is planned in <plan year>" (real year, never "XXX"). The button still opens the Add-product editor.

- [ ] **Step 4: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js assets/css/vcl-budget-style.css
git commit -m "feat(budget): make Add-product subtle with an explanatory hint"
```

---

## Task 7: "Add product" editor — escape without input

**Files:**
- Modify: `assets/js/vcl-budget.js:2299-2320` (`paintNav` inside `renderAnnualEditor`)

**Interfaces:**
- Consumes: `annualEditor.station`, `ANNUAL_STATION_ORDER`, `closeAnnualEditor`, `advanceAnnualStation`, `el`.
- Produces: nothing new.

- [ ] **Step 1: Replace the disabled Station-A "Back" with a "Back to plan"**

In `paintNav`, the back control is currently always a disabled-at-idx-0 "← Back":

```js
      var back = el("button", "vcl-bud-btn", "← Back");
      back.type = "button";
      back.disabled = idx === 0;
      back.addEventListener("click", function () { advanceAnnualStation(-1); });
      nav.appendChild(back);
```

Replace with: on the first station, an enabled "← Back to plan" that cancels; otherwise the normal step-back button:

```js
      if (idx === 0) {
        var toPlan = el("button", "vcl-bud-btn", "← Back to plan");
        toPlan.type = "button";
        toPlan.addEventListener("click", closeAnnualEditor);
        nav.appendChild(toPlan);
      } else {
        var back = el("button", "vcl-bud-btn", "← Back");
        back.type = "button";
        back.addEventListener("click", function () { advanceAnnualStation(-1); });
        nav.appendChild(back);
      }
```

- [ ] **Step 2: Verify**

In Chrome: click "+ Add product"; on the first station (Product) the nav shows an enabled "← Back to plan" that returns to the plan with nothing entered and no product added. On the second station the button reads "← Back" and steps back to Product. The top-right ✕ still cancels too.

- [ ] **Step 3: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js
git commit -m "fix(budget): allow leaving the Add-product editor without entering a product"
```

---

## Task 8: Breakdown split toggle (Combined / Variations / Annual)

**Files:**
- Modify: `assets/js/vcl-budget.js:140` (`state`), `:389-403` (`renderBreakdownPanel`), `:810-817` (`rerender` breakdown section), `:1899-1907` (`onHeaderClick`)
- Modify: `assets/css/vcl-budget-style.css` (segmented control + head)

**Interfaces:**
- Consumes: `rollup.byMarket`, `rollup.byProduct`, `rollup.totals.fee`, `annualRollup.byMarket`, `annualRollup.byProduct`, `annualRollup.totalEur`, `mergeBreakdown`, `renderBreakdownPanel`, `el`, `rerender`.
- Produces: `state.breakdownMode ∈ {"combined","var","ann"}`; `renderBreakdownPanel(title, rows, total, mode)`.

- [ ] **Step 1: Add the view-mode to state**

At the `state` declaration (line 140), add `breakdownMode: "combined"` (session-only; not persisted):

```js
  var state = { lines: plan.lines, annualLines: plan.annualLines || [], hoursPerHead: plan.hoursPerHead, resultsById: {}, storageOk: true, expandedId: null, sortKey: "quarter", sortDir: "desc", breakdownMode: "combined" };
```

- [ ] **Step 2: Make `renderBreakdownPanel` mode-aware with an empty state**

Extend the signature and add a fallback note when there are no rows:

```js
  function renderBreakdownPanel(title, rows, total, mode) {
    var panel = el("div", "vcl-bud-panel");
    panel.appendChild(el("h3", null, escapeHtml(title)));
    if (!rows || !rows.length) {
      var empty = (mode === "ann") ? "No annual spend" : (mode === "var") ? "No variation spend" : "No spend yet";
      panel.appendChild(el("p", "vcl-bud-hint", empty));
      return panel;
    }
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
```

- [ ] **Step 3: Render the segmented control and switch the source in `rerender`**

The current breakdown block (lines 812-817) is:

```js
    var combinedMarket = mergeBreakdown(rollup.byMarket, annualRollup.byMarket);
    var combinedProduct = mergeBreakdown(rollup.byProduct, annualRollup.byProduct);
    var combinedTotal = rollup.totals.fee + annualRollup.totalEur;
    var breakdown = el("div", "vcl-bud-breakdown");
    breakdown.appendChild(renderBreakdownPanel("By market", combinedMarket, combinedTotal));
    breakdown.appendChild(renderBreakdownPanel("By product", combinedProduct, combinedTotal));
```

Replace with a version that picks the source by `state.breakdownMode` and prepends a segmented control:

```js
    var combinedMarket = mergeBreakdown(rollup.byMarket, annualRollup.byMarket);
    var combinedProduct = mergeBreakdown(rollup.byProduct, annualRollup.byProduct);
    var combinedTotal = rollup.totals.fee + annualRollup.totalEur;
    var bdMode = state.breakdownMode || "combined";
    var srcMarket = bdMode === "var" ? rollup.byMarket : bdMode === "ann" ? annualRollup.byMarket : combinedMarket;
    var srcProduct = bdMode === "var" ? rollup.byProduct : bdMode === "ann" ? annualRollup.byProduct : combinedProduct;
    var srcTotal = bdMode === "var" ? rollup.totals.fee : bdMode === "ann" ? annualRollup.totalEur : combinedTotal;

    var bdSection = el("div", "vcl-bud-breakdown-section");
    var bdHead = el("div", "vcl-bud-breakdown-head");
    bdHead.appendChild(el("span", "vcl-bud-breakdown-title", "Agency spend breakdown"));
    var segHtml = [["combined", "Combined"], ["var", "Variations"], ["ann", "Annual"]].map(function (m) {
      return '<button type="button" class="vcl-bud-seg-btn' + (bdMode === m[0] ? " is-on" : "") +
        '" data-act="bd-mode" data-mode="' + m[0] + '">' + m[1] + "</button>";
    }).join("");
    bdHead.appendChild(el("div", "vcl-bud-seg", segHtml));
    bdSection.appendChild(bdHead);

    var breakdown = el("div", "vcl-bud-breakdown");
    breakdown.appendChild(renderBreakdownPanel("By market", srcMarket, srcTotal, bdMode));
    breakdown.appendChild(renderBreakdownPanel("By product", srcProduct, srcTotal, bdMode));
    bdSection.appendChild(breakdown);
```

Then, where the old code appended `breakdown` to the container, append `bdSection` instead. Find the append that follows (a `container.appendChild(breakdown);`) and change it to:

```js
    container.appendChild(bdSection);
```

- [ ] **Step 4: Handle the segment clicks in `onHeaderClick`**

In `onHeaderClick`, add a branch (alongside the existing `data-act` checks):

```js
    if (btn.dataset.act === "bd-mode") { state.breakdownMode = btn.dataset.mode; rerender(); return; }
```

- [ ] **Step 5: Style the segmented control**

Append to `vcl-budget-style.css`:

```css
.vcl-app .vcl-bud-breakdown-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.vcl-app .vcl-bud-breakdown-title { font-size: 13px; color: var(--muted); }
.vcl-app .vcl-bud-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.vcl-app .vcl-bud-seg-btn { font-size: 12.5px; padding: 6px 12px; border: 0; border-left: 1px solid var(--border); background: var(--paper); color: var(--muted); cursor: pointer; }
.vcl-app .vcl-bud-seg-btn:first-child { border-left: 0; }
.vcl-app .vcl-bud-seg-btn.is-on { background: var(--budget-bg); color: var(--budget); font-weight: 600; }
```

- [ ] **Step 6: Verify**

In Chrome, with a plan that has both variation lines and annual fees:
- Default is "Combined" → By market/By product totals equal today's combined figures.
- "Variations" → only variation spend; annual-only markets/products drop out; box totals equal `rollup.totals.fee`.
- "Annual" → only annual spend; variation-only markets (e.g. a DE line with no annual fee) drop out; totals equal the annual rollup total.
- The Agency-fees / RA-hours / FTE tiles are unchanged in every mode.
- With no annual lines, "Annual" mode shows "No annual spend" in both boxes.

- [ ] **Step 7: Commit (on approval)**

```bash
git add assets/js/vcl-budget.js assets/css/vcl-budget-style.css
git commit -m "feat(budget): add Combined/Variations/Annual breakdown toggle"
```

---

## Rollout (user-driven, after all tasks verified in Chrome)

Not a code task — do only on the user's go:
1. Rebuild the plugin ZIP via `build_zip.py` at the repo root.
2. Deploy to the NAS WordPress plugins dir (`X:\wordpress\wp-content\plugins\variation-fee-calculator\`).
3. Final acceptance pass in real Chrome on the live site.
4. `git push` only when the user asks.

---

## Self-review

- **Spec coverage:** §3.A→T1; §3.B(4 header)→T2; §3.B(5 special cases)→T3; §3.B(6 expand, 7 notes)→T4; §3.B(8 columns, 9 scrollbar, 10 parity)→T5; §3.C→T6; §3.D→T7; §3.E→T2; §3.F(14-18 toggle)→T8. All covered.
- **Placeholder scan:** none — every code step shows full before/after.
- **Type consistency:** `renderBreakdownPanel(title, rows, total, mode)` defined in T8.S2 and called with the 4th arg in T8.S3; `state.breakdownMode` set in T8.S1/S4 and read in T8.S3; `renderAnnualDetailRow(row, res)` defined in T4.S1 and called in T4.S2; `data-act="bd-mode"` emitted in T8.S3 and handled in T8.S4; `data-act="new-line"` key preserved in T2.S1. Consistent.
