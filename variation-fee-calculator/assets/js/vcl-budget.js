// Budget Planning -- the Variation Toolbox's portfolio-wide annual plan. Self-contained like the
// Guided Workflow: vcl-app.js only wires the nav button and calls window.VCL_BUDGET.render(col);
// everything below manages its own state and rerender. Uses window.VCL_BUDGET_ENGINE for all
// pricing/hours/rollup math (no logic duplicated here) and the shared VCLCALC / VCL_WORKLOAD_HOURS
// engines for the actual computation.
(function () {
  "use strict";

  var BUD = window.VCL_BUDGET_ENGINE;
  var DATA = window.VCL_DATA || {};
  var ENTRIES = DATA.ENTRIES || [];

  // Full shape VCL_SUBMISSION's API expects (see vcl-submission.js header) -- SUB is the
  // module itself so computeLineResult/renderModal/renderTable all delegate pricing/hours to
  // the single shared engine instead of reimplementing anything here.
  function engines() {
    return {
      SUB: window.VCL_SUBMISSION,
      computeFees: window.VCLCALC && window.VCLCALC.computeFees,
      countries: (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [],
      feeRows: (window.VCLCALC_DATA && window.VCLCALC_DATA.FEE_ROWS) || [],
      workload: window.VCL_WORKLOAD_HOURS,
      workloadData: window.VCL_WORKLOAD_HD,
      sgLogic: window.VCL_SG_LOGIC,
    };
  }

  // ---- per-submission summary helpers for the plan-lines table (pure) ----
  var SUB = window.VCL_SUBMISSION;
  function variationsSummary(sub) {
    var n = sub.variations.length;
    if (n === 0) return "—";
    if (n === 1) return escapeHtml(sub.variations[0].code || sub.variations[0].type || "1 variation");
    var c = SUB.feeCounts(sub); // {IA,IB,II}
    var mix = ["IA", "IB", "II"].filter(function (k) { return c[k] > 0; }).map(function (k) { return c[k] + " " + k; }).join("·");
    return n + " · " + mix;
  }
  function proceduresSummary(sub) {
    var nat = 0, mrp = 0, cp = 0, cms = 0;
    sub.procedures.forEach(function (p) {
      if (p.kind === "national") nat++;
      else if (p.kind === "mrpdcp") { mrp++; cms += (p.cms || []).length; }
      else if (p.kind === "cp") cp++;
    });
    var bits = [];
    if (nat) bits.push(nat + " nat");
    if (mrp) bits.push(mrp + " MRP/DCP" + (cms ? " (" + cms + " CMS)" : ""));
    if (cp) bits.push(cp + " CP");
    return bits.join(" · ") || "—";
  }
  var MODE_LABEL = { worksharing: "Worksharing", superGrouping: "Super-Grouping", annualUpdate: "Annual Update", grouping: "Grouping", single: "Single" };

  var plan = BUD.loadPlan(window.localStorage);
  var state = { lines: plan.lines, hoursPerHead: plan.hoursPerHead, resultsById: {}, storageOk: true };
  var container = null;
  var modalState = null; // null when closed, else { editingId, draft, station, query, searchResults }

  // Per-line result cache, keyed by line id, kept current by the mutation points below
  // (applyModal/duplicateLine/deleteLine) rather than rebuilt wholesale on every render -- see
  // spec's "Very large plans (50+ lines)" edge case. This is the only "recompute everything"
  // pass; every other update touches just the one line that changed.
  function recomputeLine(line) {
    state.resultsById[line.id] = BUD.computeLineResult(line, engines());
  }
  state.lines.forEach(recomputeLine);

  function openModalFor(id) {
    var existing = id && state.lines.find(function (l) { return l.id === id; });
    modalState = {
      editingId: id || null,
      draft: existing ? JSON.parse(JSON.stringify(existing)) : BUD.newLine("line-" + Date.now() + "-" + Math.floor(Math.random() * 1000)),
      station: "A", // stations editor always opens on Station A (Variations)
      query: "",
      searchResults: [],
    };
    rerender();
  }
  function closeModal() { modalState = null; rerender(); }
  function applyModal() {
    // Final guard: never persist a strategy that is no longer allowed for the current variations.
    normalizeModeEnablement(modalState.draft.submission);
    var idx = state.lines.findIndex(function (l) { return l.id === modalState.draft.id; });
    if (idx === -1) state.lines.push(modalState.draft);
    else state.lines[idx] = modalState.draft;
    recomputeLine(modalState.draft);
    modalState = null;
    saveState();
    rerender();
  }

  function saveState() {
    var ok = BUD.savePlan(window.localStorage, { version: 1, hoursPerHead: state.hoursPerHead, lines: state.lines });
    if (!ok && state.storageOk) { state.storageOk = false; rerender(); }
    else if (ok && !state.storageOk) { state.storageOk = true; }
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtEUR(v) {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
  }
  // The real dataset's type vocabulary (IA, IAIN, IB, "IB (unforeseen)", II) is wider than the
  // 3-value badge CSS (--ia/--ib/--ii). Bucket into those three rather than lowercasing the raw
  // type as the class suffix (mirrors vcl-app.js:233 typeBadgeClass's startsWith bucketing) --
  // the badge TEXT still shows the full raw type string, only the CSS class is bucketed.
  function typeBucketClass(type) {
    var t = String(type || "");
    if (t.indexOf("IA") === 0) return "ia";
    if (t.indexOf("IB") === 0) return "ib";
    if (t.indexOf("II") === 0) return "ii";
    return "";
  }

  function renderRollupTiles(rollup) {
    var wrap = el("div", "vcl-bud-rollup");
    var feeTile = el("div", "vcl-bud-tile");
    feeTile.appendChild(el("p", "vcl-bud-tile__label", "Annual fees"));
    feeTile.appendChild(el("p", "vcl-bud-tile__value", escapeHtml(fmtEUR(rollup.totals.fee))));
    feeTile.appendChild(el("p", "vcl-bud-tile__sub", state.lines.length + " plan lines"));
    wrap.appendChild(feeTile);

    var hoursTile = el("div", "vcl-bud-tile");
    hoursTile.appendChild(el("p", "vcl-bud-tile__label", "Annual RA hours"));
    hoursTile.appendChild(el("p", "vcl-bud-tile__value", Math.round(rollup.totals.hoursExpected) + " h"));
    hoursTile.appendChild(el("p", "vcl-bud-tile__sub",
      "Range " + Math.round(rollup.totals.hoursMin) + "–" + Math.round(rollup.totals.hoursMax) + " h (min–max)"));
    wrap.appendChild(hoursTile);

    var fte = BUD.computeFte(rollup.totals.hoursExpected, state.hoursPerHead);
    var fteTile = el("div", "vcl-bud-tile vcl-bud-tile--fte");
    fteTile.appendChild(el("p", "vcl-bud-tile__label", "FTE required"));
    fteTile.appendChild(el("p", "vcl-bud-tile__value", fte.toFixed(2) + " FTE"));
    var sub = el("p", "vcl-bud-tile__sub");
    sub.appendChild(document.createTextNode("at "));
    var fteInput = el("input", "vcl-bud-fte-input");
    fteInput.type = "text";
    fteInput.value = String(state.hoursPerHead);
    fteInput.addEventListener("change", function () {
      var v = parseInt(fteInput.value, 10);
      state.hoursPerHead = (v > 0) ? v : state.hoursPerHead;
      saveState();
      rerender();
    });
    sub.appendChild(fteInput);
    sub.appendChild(document.createTextNode(" h / head / year"));
    fteTile.appendChild(sub);
    wrap.appendChild(fteTile);
    return wrap;
  }

  function renderBreakdownPanel(title, rows, total) {
    var panel = el("div", "vcl-bud-panel");
    panel.appendChild(el("h3", null, escapeHtml(title)));
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

  function renderTable(rollup) {
    var wrap = el("div");
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines"));
    head.appendChild(el("span", null, state.lines.length + " lines"));
    wrap.appendChild(head);

    var tableWrap = el("div", "vcl-bud-table-wrap");
    var table = el("table", "vcl-bud-table");
    table.innerHTML =
      "<thead><tr><th>Product</th><th>Mode</th><th>Variations</th><th>Procedures</th>" +
      "<th>Quarter</th><th style=\"text-align:right\">Fee</th>" +
      "<th style=\"text-align:right\">Hours (PERT)</th><th></th></tr></thead>";
    var tbody = el("tbody");
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var sub = line.submission;
      var tr = el("tr");
      var mode = SUB.displayMode(sub);
      var modePill = '<span class="vcl-bud-mode-pill vcl-bud-mode-pill--' + mode + '">' + escapeHtml(MODE_LABEL[mode]) + "</span>";
      var feeCell = r.complete
        ? '<td class="vcl-bud-num">' + escapeHtml(fmtEUR(r.fee)) + "</td>"
        : '<td class="vcl-bud-num"><span class="vcl-bud-warn">Countries incomplete</span></td>';
      var hoursCell = r.complete
        ? '<td class="vcl-bud-num">' + Math.round(r.hours.expected) + ' h<div class="vcl-bud-hours-band">' +
          Math.round(r.hours.min) + "–" + Math.round(r.hours.max) + "</div></td>"
        : '<td class="vcl-bud-num">—</td>';
      tr.innerHTML =
        "<td>" + escapeHtml(line.product || "—") + "</td>" +
        "<td>" + modePill + "</td>" +
        "<td>" + variationsSummary(sub) + "</td>" +
        "<td class=\"vcl-bud-proc-summary\">" + proceduresSummary(sub) + "</td>" +
        "<td>" + escapeHtml(line.quarter || "—") + "</td>" +
        feeCell + hoursCell +
        '<td class="vcl-bud-row-actions">' +
        '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small" data-act="duplicate" title="Duplicate">⧉</button>' +
        '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small" data-act="edit" title="Edit">✎</button>' +
        '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small vcl-bud-btn--danger" data-act="delete" title="Delete">✕</button>' +
        "</td>";
      tr.dataset.lineId = line.id;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // Footer row with column totals -- spec-mandated (docs/superpowers/specs/2026-08-05-budget-
    // planning-design.md); the CSS (.vcl-bud-table tfoot td) has been shipping unused until now.
    // Sums come from the rollup the caller already computed, not a second recompute here.
    var tfoot = el("tfoot");
    var totalTr = el("tr");
    totalTr.innerHTML =
      '<td colspan="5">Total</td>' +
      '<td class="vcl-bud-num">' + escapeHtml(fmtEUR(rollup.totals.fee)) + "</td>" +
      '<td class="vcl-bud-num">' + Math.round(rollup.totals.hoursExpected) + " h</td>" +
      "<td></td>";
    tfoot.appendChild(totalTr);
    table.appendChild(tfoot);

    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
    return wrap;
  }

  function rerender() {
    if (!container) return;
    var rollup = BUD.computeRollup(state.lines, state.resultsById);

    container.innerHTML = "";
    if (!state.storageOk) {
      container.appendChild(el("div", "vcl-bud-warn", "Your plan isn't being saved in this browser."));
    }
    var header = el("div", "vcl-bud-header");
    var left = el("div");
    left.appendChild(el("h2", null, "Budget Planning"));
    left.appendChild(el("p", null, "Portfolio-wide annual plan: fees &amp; RA effort across all products and markets."));
    header.appendChild(left);
    var actions = el("div", "vcl-bud-header__actions");
    actions.innerHTML =
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--ghost" data-act="clear-plan">Clear plan</button>' +
      '<button type="button" class="vcl-bud-btn" data-act="export">⭳ Export to Excel</button>' +
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--primary" data-act="new-line">+ New line</button>';
    header.appendChild(actions);
    container.appendChild(header);

    container.appendChild(renderRollupTiles(rollup));

    var breakdown = el("div", "vcl-bud-breakdown");
    breakdown.appendChild(renderBreakdownPanel("By market", rollup.byMarket, rollup.totals.fee));
    breakdown.appendChild(renderBreakdownPanel("By product", rollup.byProduct, rollup.totals.fee));
    container.appendChild(breakdown);

    container.appendChild(renderTable(rollup));

    if (modalState) container.appendChild(renderModal());
  }

  // Worksharing / Super-Grouping / Annual Update are EU-only procedures: these three authorities
  // are not offered for a national line once a multi-procedure/annual-update strategy is active
  // (mirrors vcl-workflow.js's NON_EU_PROCEDURE_COUNTRIES gate on cd.nationalEU).
  var NON_EU_PROCEDURE_COUNTRIES = ["CH", "RS", "UK"];

  function countriesByRole(role) {
    var all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    return all.filter(function (c) { return c.roles.indexOf(role) !== -1; });
  }
  function findEmaCc() {
    var all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    var ema = all.find(function (c) { return c.roles.indexOf("EMA") !== -1; });
    return ema ? ema.cc : null;
  }
  function typesForEntry(entry) {
    var seen = {};
    (entry.variants || []).forEach(function (v) { if (v.type) seen[v.type] = true; });
    return Object.keys(seen);
  }

  // Targeted update: rebuilds only the results host, leaving the search <input> (and its focus/
  // caret) untouched. A full rerender() on every keystroke would recreate the input and drop focus.
  // Picking a result APPENDS a new variation onto d.submission.variations (Station A can hold
  // several -- two or more is a Grouping) rather than overwriting a single variationCode field.
  function populateSearchResults(host) {
    if (!host) return;
    var d = modalState.draft;
    host.innerHTML = "";
    host.style.display = modalState.searchResults.length ? "" : "none";
    modalState.searchResults.forEach(function (entry) {
      var item = el("button", "vcl-bud-search-result", escapeHtml(entry.code + " — " + entry.title));
      item.type = "button";
      item.addEventListener("click", function () {
        var types = typesForEntry(entry);
        d.submission.variations.push({ code: entry.code, variantId: null, type: types[0] || null });
        modalState.query = "";
        modalState.searchResults = [];
        rerender(); // click, not a keystroke -- safe to fully rerender (no focus to preserve)
      });
      host.appendChild(item);
    });
  }

  // The three stations of the editor. B (Procedures) and C (RA tasks) get real bodies in Task 5;
  // this task wires the shell + stepper + Station A (Variations) only.
  var STATIONS = [
    { key: "A", label: "Variations" },
    { key: "B", label: "Procedures" },
    { key: "C", label: "RA tasks" },
  ];

  // "Done" gates for the stepper's checkmark state -- purely cosmetic (unlike the Guided
  // Workflow's `reached` gate, every station here is always clickable; a plan line can be applied
  // with any subset filled in and revisited later).
  function stationDone(key, sub) {
    if (key === "A") return sub.variations.length > 0;
    if (key === "B") return sub.procedures.some(function (p) { return !!(p.nat || p.rms || p.kind === "cp"); });
    var rt = sub.raTasks || {};
    return !!(rt.cmc || rt.compilation || rt.pi);
  }

  // De-emphasised one-line summary shown under the live-preview strip.
  function summaryLine(d) {
    var sub = d.submission;
    var mode = SUB.displayMode(sub);
    var nVar = sub.variations.length;
    var nProc = sub.procedures.length;
    return MODE_LABEL[mode] + " · " + nVar + " variation" + (nVar === 1 ? "" : "s") +
      " · " + nProc + " procedure" + (nProc === 1 ? "" : "s") +
      " · " + (sub.lead || "—") + " · " + (d.quarter || "—");
  }

  // Dispatches on modalState.station and (re)builds only the body card's contents -- used both
  // for the initial render and by refreshEditor(), which repaints the stepper + body + preview in
  // place rather than tearing down the whole modal.
  function stationBody(host) {
    host.innerHTML = "";
    if (modalState.station === "A") renderStationA(host);
    else if (modalState.station === "B") renderStationB(host);
    else renderStationC(host);
  }

  // Targeted editor refresh (Task 5, Step 5): repaint the stepper's done/active classes, rebuild
  // the current station's body card, refresh the live preview strip and the summary line -- WITHOUT
  // a full container-level rerender(). Used for every Station B/C mutation (all of which are chip /
  // select / checkbox clicks, never a text-input keystroke). Station A keeps its own rerender()
  // path because of its focus-sensitive search <input> (see populateSearchResults). The host
  // references are captured by renderModal() each time the modal is (re)built.
  function refreshEditor() {
    if (!modalState) return;
    // Clear any now-invalid strategy BEFORE the body/preview repaint, independent of the active
    // station (Station A refreshes never run renderStationB's own clear).
    normalizeModeEnablement(modalState.draft.submission);
    if (modalState.paintStepper) modalState.paintStepper();
    if (modalState.bodyHost) stationBody(modalState.bodyHost);
    if (modalState.previewHost) renderPreviewStrip(modalState.previewHost);
    if (modalState.summaryHost) modalState.summaryHost.textContent = summaryLine(modalState.draft);
  }

  // ---- Station A: Variations ----
  function renderStationA(host) {
    var sub = modalState.draft.submission;
    host.appendChild(el("div", "vcl-bud-body__title", "Variations"));
    host.appendChild(el("div", "vcl-bud-body__sub", "Which variation, or variations, are you submitting? Two or more are priced as a Grouping."));

    // Search field: focus-safe targeted-update pattern (populateSearchResults only ever rebuilds
    // the results host below, never this input) -- see populateSearchResults for why that matters.
    var varField = el("div", "vcl-bud-field");
    varField.appendChild(el("label", "vcl-bud-field-label", "Search variation"));
    var varInput = el("input", "vcl-bud-input");
    varInput.type = "text";
    varInput.placeholder = "Search by code or keyword ...";
    varInput.value = modalState.query || "";
    varInput.addEventListener("input", function () {
      modalState.query = varInput.value;
      modalState.searchResults = BUD.searchEntries(ENTRIES, modalState.query);
      populateSearchResults(document.getElementById("vcl-bud-search-results"));
    });
    varField.appendChild(varInput);
    var results = el("div", "vcl-bud-search-results");
    results.id = "vcl-bud-search-results";
    varField.appendChild(results);
    populateSearchResults(results);
    host.appendChild(varField);

    // Quick-add without a classification code (e.g. "just a Type IB, no code yet") -- the row's
    // type badges (all three IA/IB/II, since no entry constrains it) let the user set it after.
    var addBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "+ Add variation");
    addBtn.type = "button";
    addBtn.addEventListener("click", function () {
      sub.variations.push({ code: null, variantId: null, type: null });
      rerender();
    });
    host.appendChild(addBtn);

    var list = el("div", "vcl-bud-var-list");
    sub.variations.forEach(function (v, idx) { list.appendChild(renderVariationRow(v, idx)); });
    host.appendChild(list);

    if (sub.variations.length >= 2) {
      host.appendChild(el("p", "vcl-bud-hint", sub.variations.length + " variations — this line is priced as a Grouping."));
    }
  }

  function renderVariationRow(v, idx) {
    var sub = modalState.draft.submission;
    var row = el("div", "vcl-bud-var-row");
    var entry = v.code ? ENTRIES.find(function (e) { return e.code === v.code; }) : null;

    var main = el("div", "vcl-bud-var-row__main");
    if (entry) main.innerHTML = '<span class="vcl-bud-var-row__code">' + escapeHtml(entry.code) + "</span> " + escapeHtml(entry.title);
    else if (v.code) main.innerHTML = '<span class="vcl-bud-var-row__code">' + escapeHtml(v.code) + "</span>";
    else main.innerHTML = '<span class="vcl-bud-var-row__muted">No classification code</span>';
    row.appendChild(main);

    var types = entry ? typesForEntry(entry) : ["IA", "IB", "II"];
    var badges = el("div", "vcl-bud-var-row__types");
    types.forEach(function (t) {
      var badge = el("span", "vcl-bud-type-badge vcl-bud-type-badge--" + typeBucketClass(t) + (t === v.type ? " is-active" : ""), escapeHtml(t));
      badge.addEventListener("click", function () { v.type = t; rerender(); });
      badges.appendChild(badge);
    });
    row.appendChild(badges);

    var rm = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small vcl-bud-btn--danger", "✕");
    rm.type = "button";
    rm.setAttribute("aria-label", "Remove variation");
    rm.addEventListener("click", function () {
      sub.variations.splice(idx, 1);
      rerender();
    });
    row.appendChild(rm);
    return row;
  }

  // ---- Station B: Procedures + multi-authorisation strategy ----
  // A labelled country <select> in the budget field style: options are country objects
  // ({cc,name,roles}) from countriesByRole(); onPick receives the chosen cc (or null).
  function countrySelectField(labelText, list, current, onPick, disabled) {
    var field = el("div", "vcl-bud-field");
    field.appendChild(el("label", "vcl-bud-field-label", escapeHtml(labelText)));
    var sel = el("select", "vcl-bud-select");
    if (disabled) sel.disabled = true; // locked field (e.g. CP-forced EMA lead) -- shows current, no picking
    var opt0 = el("option", null, "— select —"); opt0.value = "";
    if (!current) opt0.selected = true;
    sel.appendChild(opt0);
    list.forEach(function (c) {
      var o = el("option", null, escapeHtml((c.name || c.cc) + " (" + c.cc + ")")); o.value = c.cc;
      if (current === c.cc) o.selected = true;
      sel.appendChild(o);
    });
    // A <select> change only fires on a finalised choice (no keystroke focus risk) -- safe to
    // targeted-refresh the editor.
    sel.addEventListener("change", function () { onPick(sel.value || null); });
    field.appendChild(sel);
    return field;
  }

  // Kind chips (National / MRP-DCP / CP) for one procedure. In a Super-Grouping the kinds NOT in
  // VCL_SG_LOGIC.computeAllowedProcedureKinds are disabled (CP-exclusivity is the shared module's
  // job, never reimplemented here); outside SG every kind stays selectable.
  function procKindChips(p) {
    var sub = modalState.draft.submission;
    var kinds = [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }];
    var allowed = SUB.sgActive(sub) ? engines().sgLogic.computeAllowedProcedureKinds(sub.procedures, p) : null;
    var row = el("div", "vcl-bud-chips");
    kinds.forEach(function (it) {
      var isAllowed = !allowed || allowed.indexOf(it.k) !== -1;
      var chip = el("button", "vcl-bud-chip" + (p.kind === it.k ? " is-on" : "") + (isAllowed ? "" : " is-disabled"), escapeHtml(it.l));
      chip.type = "button";
      if (!isAllowed) {
        chip.disabled = true;
        chip.title = it.k === "cp"
          ? "Not allowed together with national/MRP-DCP procedures in Super-Grouping"
          : "Not allowed together with CP in Super-Grouping";
      } else {
        chip.addEventListener("click", function () {
          p.kind = it.k;
          if (it.k === "cp") p.ema = SUB.emaCc(engines()); // recorded for display; pricing reads emaCc directly
          refreshEditor();
        });
      }
      row.appendChild(chip);
    });
    return row;
  }

  // CMS multi-select for an MRP/DCP procedure -- reuses the budget checkbox chip style; the current
  // RMS is excluded from the offered CMS.
  function cmsChecks(p) {
    var wrap = el("div", "vcl-bud-field");
    wrap.appendChild(el("label", "vcl-bud-field-label", "CMS (Concerned Member States)"));
    var box = el("div", "vcl-bud-cc-checks");
    countriesByRole("CMS").forEach(function (c) {
      if (c.cc === p.rms) return; // the RMS cannot also be a CMS
      var on = (p.cms || []).indexOf(c.cc) !== -1;
      var label = el("label", "vcl-bud-cc-check");
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on;
      cb.addEventListener("change", function () {
        if (cb.checked) { if (p.cms.indexOf(c.cc) === -1) p.cms.push(c.cc); }
        else p.cms = p.cms.filter(function (x) { return x !== c.cc; });
        refreshEditor();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + c.cc));
      label.title = c.name || c.cc;
      box.appendChild(label);
    });
    wrap.appendChild(box);
    return wrap;
  }

  function renderProcedureRow(p, idx) {
    var sub = modalState.draft.submission;
    var card = el("div", "vcl-bud-proc-card");
    var head = el("div", "vcl-bud-proc-card__head");
    head.appendChild(el("span", "vcl-bud-proc-card__title", idx === 0 ? "Primary procedure" : "Procedure " + (idx + 1)));
    // Remove only for the added procedures (procedures[1..]); the base procedure[0] is permanent.
    if (idx >= 1) {
      var rm = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small vcl-bud-btn--danger", "✕");
      rm.type = "button"; rm.setAttribute("aria-label", "Remove procedure");
      rm.addEventListener("click", function () { sub.procedures.splice(idx, 1); refreshEditor(); });
      head.appendChild(rm);
    }
    card.appendChild(head);
    card.appendChild(procKindChips(p));

    if (p.kind === "national") {
      // EU-only national list once a multi-procedure / annual-update strategy is active.
      var euOnly = SUB.multiProcedureMode(sub) || SUB.auActive(sub);
      var natList = countriesByRole("national").filter(function (c) {
        return !euOnly || NON_EU_PROCEDURE_COUNTRIES.indexOf(c.cc) === -1;
      });
      card.appendChild(countrySelectField("Country", natList, p.nat, function (cc) { p.nat = cc; refreshEditor(); }));
    } else if (p.kind === "mrpdcp") {
      card.appendChild(countrySelectField("RMS (Reference Member State)", countriesByRole("RMS"), p.rms, function (cc) {
        p.rms = cc; p.cms = (p.cms || []).filter(function (x) { return x !== cc; }); refreshEditor();
      }));
      card.appendChild(cmsChecks(p));
      card.appendChild(el("p", "vcl-bud-hint", "Each selected CMS is charged its own national fee. The RMS cannot also be a CMS."));
    } else if (p.kind === "cp") {
      card.appendChild(el("p", "vcl-bud-hint", "CP · EMA — centralised procedure, one authority (EMA), no country selection."));
    }
    return card;
  }

  // Strategy-enablement rule shared by the chips (renderStationB) AND the always-on normaliser.
  // Mirrors the Guided Workflow (vcl-workflow.js:735/828): a mixed submission may only Worksharing;
  // an all-Type-IA one may only Super-Group / Annual-Update. Clearing an invalidated mode must run
  // on EVERY modal render/refresh -- not just when Station B happens to paint -- so the always-on
  // preview strip and Apply can never price a strategy that is no longer allowed. Example: pick
  // Worksharing on a mixed line in Station B, return to Station A and delete the last non-IA
  // variation; without this, sub.mode stays "worksharing" and the line prices/persists as an
  // all-IA worksharing the Guided Workflow forbids. Returns allIA so the chip block can reuse it
  // and can never disagree with the clear.
  function normalizeModeEnablement(sub) {
    var allIA = SUB.allVariationsAreIA(sub, engines());
    if (sub.mode === "worksharing" && allIA) sub.mode = null;
    if ((sub.mode === "superGrouping" || sub.mode === "annualUpdate") && !allIA) sub.mode = null;
    // Symmetric with the mode-clear above: a Centralised (CP) procedure inside an active
    // Worksharing/Super-Grouping always leads the group via the EMA (mirrors the Guided Workflow's
    // forced-EMA lead, vcl-workflow.js:2244/947 -- see renderStationB's lead block for the
    // corresponding UI lock/hint). This force must run from every normalize call-site
    // (refreshEditor, renderModal, applyModal), not just whenever Station B happens to paint --
    // otherwise a line persisted/migrated BEFORE this rule existed (CP + a stale non-EMA
    // sub.lead) could be re-opened and Applied from Station A/C without Station B ever
    // repainting, silently persisting a stale RMS lead that misprices.
    if (SUB.leadPricingActive(sub) && sub.procedures.some(function (p) { return p.kind === "cp"; })) {
      sub.lead = SUB.emaCc(engines());
    }
    return allIA;
  }

  function renderStationB(host) {
    var sub = modalState.draft.submission;

    // Same enablement rule the preview/Apply paths already ran; reuse it so chip state and the
    // invalidated-mode clear can never diverge.
    var allIA = normalizeModeEnablement(sub);

    host.appendChild(el("div", "vcl-bud-body__title", "Procedures"));
    host.appendChild(el("div", "vcl-bud-body__sub", "How is it submitted, and where? Fees are per country, so the countries are set here."));

    // --- Strategy chips (opt-in Worksharing / Super-Grouping / Annual Update) ---
    host.appendChild(el("div", "vcl-bud-section-label", "Multi-authorisation strategy"));
    var chips = el("div", "vcl-bud-chips");
    [
      { mode: "worksharing", label: "Worksharing", disabled: allIA },
      { mode: "superGrouping", label: "Super-Grouping", disabled: !allIA },
      { mode: "annualUpdate", label: "Annual Update", disabled: !allIA },
    ].forEach(function (s) {
      var on = sub.mode === s.mode;
      var chip = el("button", "vcl-bud-chip" + (on ? " is-on" : "") + (s.disabled ? " is-disabled" : ""), escapeHtml(s.label));
      chip.type = "button";
      if (s.disabled) { chip.disabled = true; }
      else chip.addEventListener("click", function () { sub.mode = on ? null : s.mode; refreshEditor(); });
      chips.appendChild(chip);
    });
    host.appendChild(chips);

    // With no strategy set, show the DERIVED state (Single / Grouping) as a non-interactive label.
    if (!sub.mode) {
      var dm = SUB.displayMode(sub); // "single" | "grouping"
      var derived = el("div", "vcl-bud-derived");
      derived.innerHTML = "No multi-authorisation strategy — priced as <strong>" + escapeHtml(MODE_LABEL[dm]) + "</strong>.";
      host.appendChild(derived);
    } else {
      host.appendChild(el("p", "vcl-bud-hint", allIA
        ? "Type-IA-only: Super-Grouping shares the change across several authorisations; Annual Update keeps it within this one."
        : "Worksharing shares the change across several procedures or authorisations."));
    }

    // --- Procedure rows: base procedure always; extras only in WS/SG (multiProcedureMode) ---
    host.appendChild(el("div", "vcl-bud-section-label", "Procedures"));
    var list = el("div", "vcl-bud-proc-list");
    var procs = SUB.multiProcedureMode(sub) ? sub.procedures : [sub.procedures[0]];
    procs.forEach(function (p, idx) { list.appendChild(renderProcedureRow(p, idx)); });
    host.appendChild(list);

    if (SUB.multiProcedureMode(sub)) {
      var add = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "+ Add procedure");
      add.type = "button";
      add.addEventListener("click", function () {
        var np = { kind: "national", nat: null, rms: null, cms: [] };
        // Respect CP-exclusivity from the outset: if 'national' is not allowed (a CP already sits
        // in the group), start the new procedure on the first allowed kind instead.
        if (SUB.sgActive(sub)) {
          var allowed = engines().sgLogic.computeAllowedProcedureKinds(sub.procedures, np);
          if (allowed.indexOf(np.kind) === -1) np.kind = allowed[0];
        }
        sub.procedures.push(np);
        refreshEditor();
      });
      host.appendChild(add);
    }

    // --- Lead (WS / SG only): RMS-role authorities + the EMA, writing d.submission.lead ---
    if (SUB.leadPricingActive(sub)) {
      var leadList = countriesByRole("RMS").slice();
      countriesByRole("EMA").forEach(function (c) {
        if (!leadList.some(function (x) { return x.cc === c.cc; })) leadList.push(c);
      });
      // Mirror the Guided Workflow (vcl-workflow.js:2244 / buildWorksharingLead:947): a Centralised
      // procedure in the group auto-leads it. Same condition as the GW -- leadPricingActive AND any
      // CP procedure -- so the lead is forced to the EMA and the select is locked; without this a
      // CP-in-Worksharing could keep an RMS lead, which leadPricingRole would then price under that
      // RMS's role -- a different fee than the GW's forced-EMA lead. No CP => selectable as before.
      // The sub.lead assignment itself now lives in normalizeModeEnablement (run at the top of this
      // function and from every other normalize call-site) so it's symmetric across all entry
      // points, not just whenever Station B happens to paint; hasCP is re-derived here only to
      // drive this select's lock/hint.
      var hasCP = sub.procedures.some(function (p) { return p.kind === "cp"; });
      host.appendChild(countrySelectField(
        SUB.sgActive(sub) ? "Super-Grouping RMS (lead)" : "Worksharing RMS (lead)",
        leadList, sub.lead, function (cc) { sub.lead = cc; refreshEditor(); }, hasCP));
      if (hasCP) {
        host.appendChild(el("p", "vcl-bud-hint", SUB.sgActive(sub)
          ? "Automatically the EMA — this Super-Grouping consists of Centralised procedures."
          : "Automatically the EMA, because a Centralised procedure (CP) is part of the worksharing."));
      }
    }
  }

  // ---- Station C: RA tasks ----
  // A switch-style gate row (track + thumb + label); clicking flips the boolean via onClick.
  function toggleGate(labelText, on, onClick) {
    var btn = el("button", "vcl-bud-toggle" + (on ? " is-on" : ""));
    btn.type = "button";
    btn.innerHTML = '<span class="vcl-bud-toggle__track"><span class="vcl-bud-toggle__thumb"></span></span>'
      + '<span class="vcl-bud-toggle__label">' + escapeHtml(labelText) + "</span>";
    btn.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return btn;
  }

  function renderStationC(host) {
    var rt = modalState.draft.submission.raTasks;
    host.appendChild(el("div", "vcl-bud-body__title", "RA tasks"));
    host.appendChild(el("div", "vcl-bud-body__sub", "Which activities fall to RA here? Core RA preparation is always included — switch on any extra module your department also handles."));

    // --- CMC dossier (+ active substance it depends on) ---
    host.appendChild(el("div", "vcl-bud-section-label", "CMC dossier"));
    host.appendChild(toggleGate("CMC dossier written in RA", !!rt.cmc, function () { rt.cmc = !rt.cmc; refreshEditor(); }));
    if (rt.cmc) {
      host.appendChild(el("p", "vcl-bud-hint", "The dossier effort depends on the active substance:"));
      var asChips = el("div", "vcl-bud-chips");
      [{ k: "chemical", l: "Chemically-synthesized API" }, { k: "biologic", l: "Biologic" }].forEach(function (o) {
        var chip = el("button", "vcl-bud-chip" + (rt.activeSubstance === o.k ? " is-on" : ""), escapeHtml(o.l));
        chip.type = "button";
        chip.addEventListener("click", function () { rt.activeSubstance = o.k; refreshEditor(); });
        asChips.appendChild(chip);
      });
      host.appendChild(asChips);
      if (!rt.activeSubstance) host.appendChild(el("p", "vcl-bud-hint", "Pick the active substance to include the CMC dossier hours."));
    } else {
      host.appendChild(el("p", "vcl-bud-hint", "Off: a separate CMC / quality unit writes the dossier — it adds no RA hours."));
    }

    // --- Product information (+ which documents the change touches) ---
    host.appendChild(el("div", "vcl-bud-section-label", "Product information"));
    host.appendChild(toggleGate("Product information managed in RA", !!rt.pi, function () { rt.pi = !rt.pi; refreshEditor(); }));
    if (rt.pi) {
      host.appendChild(el("p", "vcl-bud-hint", "Which documents does this change touch?"));
      var piChips = el("div", "vcl-bud-chips");
      // piDocs keys MUST match the workload engine's PI filter -- see vcl-workflow.js buildProductInfo
      // (smpc / leaflet / labelling / mockups), consumed via sub.raTasks.piDocs in vcl-submission.js.
      [{ k: "smpc", l: "SmPC" }, { k: "leaflet", l: "Package leaflet" }, { k: "labelling", l: "Labelling" }, { k: "mockups", l: "Mock-ups" }].forEach(function (o) {
        var chip = el("button", "vcl-bud-chip" + (rt.piDocs[o.k] ? " is-on" : ""), escapeHtml(o.l));
        chip.type = "button";
        chip.addEventListener("click", function () { rt.piDocs[o.k] = !rt.piDocs[o.k]; refreshEditor(); });
        piChips.appendChild(chip);
      });
      host.appendChild(piChips);
    } else {
      host.appendChild(el("p", "vcl-bud-hint", "Off: another department prepares the product information — it adds no RA hours."));
    }

    // --- Compilation & submission (docuBridge/Veeva + CESP) ---
    host.appendChild(el("div", "vcl-bud-section-label", "Compilation & submission"));
    host.appendChild(toggleGate("Compilation & submission in RA", !!rt.compilation, function () { rt.compilation = !rt.compilation; refreshEditor(); }));
    host.appendChild(el("p", "vcl-bud-hint", rt.compilation
      ? "Dossier compilation (docuBridge / Veeva), internal checks and CESP submission are done in RA."
      : "Off: dossier compilation and submission are handled elsewhere — they add no RA hours."));
  }

  // Emphasised live Fee / RA-hours preview, recomputed from the draft on every rerender via the
  // single shared engine (BUD.computeLineResult -> VCL_SUBMISSION) -- no pricing logic here.
  function renderPreviewStrip(host) {
    host.innerHTML = "";
    var preview = BUD.computeLineResult(modalState.draft, engines());
    var feeItem = el("div");
    feeItem.innerHTML = '<div class="lbl">Fee</div><div class="val">' +
      (preview.complete ? escapeHtml(fmtEUR(preview.fee)) : '<span class="vcl-bud-warn">Countries incomplete</span>') + "</div>";
    host.appendChild(feeItem);
    var hoursItem = el("div");
    hoursItem.innerHTML = '<div class="lbl">RA hours</div><div class="val">' +
      (preview.complete
        ? Math.round(preview.hours.expected) + ' h <span class="band">' + Math.round(preview.hours.min) + "–" + Math.round(preview.hours.max) + "</span>"
        : "—") + "</div>";
    host.appendChild(hoursItem);
    host.appendChild(el("p", "vcl-bud-live-result__note", "Grouping cap & worksharing lead pricing applied automatically."));
  }

  function renderModal() {
    var d = modalState.draft;
    var sub = d.submission;
    // Full rerenders (e.g. Station A variation edits) land here without touching Station B, so run
    // the enablement clear BEFORE the body card and the live preview strip are built below.
    normalizeModeEnablement(sub);
    var overlay = el("div", "vcl-bud-modal-overlay");
    var modal = el("div", "vcl-bud-modal");

    // Header
    var head = el("div", "vcl-bud-modal__head");
    var title = (modalState.editingId ? "Edit" : "New") + " plan line" + (d.product ? " — " + d.product : "");
    head.appendChild(el("h2", null, escapeHtml(title)));
    var closeBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", closeModal);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    // Meta row: Product / Quarter / Probability (moved out of the old single-station body)
    var metaRow = el("div", "vcl-bud-meta-row");
    var productCol = el("div", "vcl-bud-field");
    productCol.appendChild(el("label", "vcl-bud-field-label", "Product"));
    var productInput = el("input", "vcl-bud-input");
    productInput.type = "text"; productInput.value = d.product;
    // No rerender() here: this is a text input, same focus-safety rule as the search field --
    // rebuilding the DOM per keystroke would drop focus/caret mid-typing.
    productInput.addEventListener("input", function () { d.product = productInput.value; });
    productCol.appendChild(productInput);
    metaRow.appendChild(productCol);

    var qCol = el("div", "vcl-bud-field");
    qCol.appendChild(el("label", "vcl-bud-field-label", "Quarter"));
    var qSelect = el("select", "vcl-bud-select");
    var qPlaceholder = el("option", null, "—");
    qPlaceholder.value = "";
    if (!d.quarter) qPlaceholder.selected = true;
    qSelect.appendChild(qPlaceholder);
    ["Q1", "Q2", "Q3", "Q4"].forEach(function (q) {
      var opt = el("option", null, q); opt.value = q;
      if (d.quarter === q) opt.selected = true;
      qSelect.appendChild(opt);
    });
    // A <select> "change" only fires once a choice is finalised (no keystroke-level focus risk),
    // so it's safe to rerender -- and it needs to, to refresh the summary line's quarter.
    qSelect.addEventListener("change", function () { d.quarter = qSelect.value || null; rerender(); });
    qCol.appendChild(qSelect);
    metaRow.appendChild(qCol);

    var pCol = el("div", "vcl-bud-field");
    pCol.appendChild(el("label", "vcl-bud-field-label", "Probability"));
    var pSelect = el("select", "vcl-bud-select");
    [100, 75, 50, 25].forEach(function (p) {
      var opt = el("option", null, p + "%" + (p === 100 ? " (firm)" : "")); opt.value = String(p);
      if (d.probability === p) opt.selected = true;
      pSelect.appendChild(opt);
    });
    pSelect.addEventListener("change", function () { d.probability = parseInt(pSelect.value, 10); rerender(); });
    pCol.appendChild(pSelect);
    metaRow.appendChild(pCol);
    modal.appendChild(metaRow);

    // Station stepper (A · B · C) -- clicking a chip only swaps the body card's content via
    // stationBody() and repaints the stepper's own active/done classes in place; it does not
    // trigger a full container-level rerender() (nothing about the draft changed).
    var card = el("div", "vcl-bud-body");
    var stepper = el("div", "vcl-bud-stations");
    var stationButtons = {};
    function paintStepper() {
      STATIONS.forEach(function (s) {
        var btn = stationButtons[s.key];
        var active = modalState.station === s.key;
        var done = stationDone(s.key, sub);
        btn.className = "vcl-bud-station" + (active ? " is-active" : "") + (done ? " is-done" : "");
        btn.firstChild.innerHTML = done ? '<span aria-hidden="true">✓</span>' : s.key;
      });
    }
    STATIONS.forEach(function (s) {
      var btn = el("button", "vcl-bud-station");
      btn.type = "button";
      btn.appendChild(el("div", "vcl-bud-station__dot", s.key));
      btn.appendChild(el("div", "vcl-bud-station__label", escapeHtml(s.label)));
      btn.addEventListener("click", function () {
        // Switching stations changes no draft data, so a targeted refresh is enough (and repaints
        // the stepper's own active/done classes via refreshEditor -> paintStepper).
        modalState.station = s.key;
        refreshEditor();
      });
      stationButtons[s.key] = btn;
      stepper.appendChild(btn);
    });
    paintStepper();
    modal.appendChild(stepper);

    // Body card (Station A/B/C content)
    stationBody(card);
    modal.appendChild(card);

    // Live preview strip
    var strip = el("div", "vcl-bud-live-result");
    modal.appendChild(strip);
    renderPreviewStrip(strip);

    // De-emphasised summary line
    var summaryP = el("p", "vcl-bud-modal__summary", escapeHtml(summaryLine(d)));
    modal.appendChild(summaryP);

    // Capture the live host references for refreshEditor()'s targeted (non-full-rerender) updates.
    // Reset on every renderModal() so they always point at the current DOM nodes.
    modalState.paintStepper = paintStepper;
    modalState.bodyHost = card;
    modalState.previewHost = strip;
    modalState.summaryHost = summaryP;

    // Footer
    var foot = el("div", "vcl-bud-modal__foot");
    var cancelBtn = el("button", "vcl-bud-btn", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", closeModal);
    var applyBtn = el("button", "vcl-bud-btn vcl-bud-btn--primary", "Apply");
    applyBtn.type = "button";
    applyBtn.addEventListener("click", applyModal);
    foot.appendChild(cancelBtn);
    foot.appendChild(applyBtn);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    return overlay;
  }

  function duplicateLine(id) {
    var src = state.lines.find(function (l) { return l.id === id; });
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = "line-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    var idx = state.lines.indexOf(src);
    state.lines.splice(idx + 1, 0, copy);
    recomputeLine(copy);
    saveState();
    rerender();
  }
  function deleteLine(id) {
    state.lines = state.lines.filter(function (l) { return l.id !== id; });
    delete state.resultsById[id];
    saveState();
    rerender();
  }
  function clearPlan() {
    state.lines = [];
    state.resultsById = {};
    saveState();
    rerender();
  }

  function exportExcel() {
    if (typeof XLSX === "undefined") {
      alert("Excel export library not loaded. Please check your internet connection and try again.");
      return;
    }
    var rollup = BUD.computeRollup(state.lines, state.resultsById);

    var wb = XLSX.utils.book_new();

    var linesRows = [["Product", "Mode", "Variations", "Procedures", "Quarter", "Probability", "Fee (EUR)", "Hours (min)", "Hours (max)", "Hours (expected)"]];
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var sub = line.submission;
      var mode = SUB.displayMode(sub);
      // Incomplete lines (countries not fully specified) still show Mode/Variations/Procedures --
      // only the priced columns collapse to 0, mirroring the on-screen table's "Countries
      // incomplete" cell (r.complete === false).
      linesRows.push([
        line.product || "", MODE_LABEL[mode] || mode, variationsSummary(sub), proceduresSummary(sub),
        line.quarter || "", line.probability, r.complete ? r.fee : 0,
        r.complete ? Math.round(r.hours.min) : 0, r.complete ? Math.round(r.hours.max) : 0, r.complete ? Math.round(r.hours.expected) : 0,
      ]);
    });
    var wsLines = XLSX.utils.aoa_to_sheet(linesRows);
    XLSX.utils.book_append_sheet(wb, wsLines, "Plan lines");

    var rollupRows = [
      ["Annual fees (EUR)", rollup.totals.fee],
      ["Annual RA hours (expected)", Math.round(rollup.totals.hoursExpected)],
      ["Annual RA hours (min)", Math.round(rollup.totals.hoursMin)],
      ["Annual RA hours (max)", Math.round(rollup.totals.hoursMax)],
      ["FTE required", BUD.computeFte(rollup.totals.hoursExpected, state.hoursPerHead).toFixed(2)],
      ["Hours per head per year", state.hoursPerHead],
      [], ["By market", "Fee (EUR)"],
    ].concat(rollup.byMarket.map(function (r) { return [r.key, r.value]; }))
     .concat([[], ["By product", "Fee (EUR)"]])
     .concat(rollup.byProduct.map(function (r) { return [r.key, r.value]; }));
    var wsRollup = XLSX.utils.aoa_to_sheet(rollupRows);
    XLSX.utils.book_append_sheet(wb, wsRollup, "Rollup");

    var dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, "budget-plan-" + dateStr + ".xlsx");
  }

  function onTableClick(evt) {
    var btn = evt.target.closest("button[data-act]");
    if (!btn) return;
    var tr = btn.closest("tr[data-line-id]");
    var id = tr && tr.dataset.lineId;
    if (btn.dataset.act === "duplicate" && id) duplicateLine(id);
    if (btn.dataset.act === "delete" && id) deleteLine(id);
    if (btn.dataset.act === "edit" && id) openModalFor(id);
  }
  function onHeaderClick(evt) {
    var btn = evt.target.closest("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "new-line") openModalFor(null);
    if (btn.dataset.act === "export") exportExcel(); // Task 6
    if (btn.dataset.act === "clear-plan") clearPlan();
  }

  window.VCL_BUDGET = {
    render: function (col) {
      container = col;
      container.removeEventListener("click", onTableClick);
      container.addEventListener("click", onTableClick);
      container.removeEventListener("click", onHeaderClick);
      container.addEventListener("click", onHeaderClick);
      rerender();
    },
  };
})();
