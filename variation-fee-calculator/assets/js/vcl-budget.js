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
  // for the initial render and by the station-stepper click handler in renderModal(), which
  // repaints the stepper's own classes in place rather than tearing down the whole modal.
  function stationBody(host) {
    host.innerHTML = "";
    if (modalState.station === "A") renderStationA(host);
    else if (modalState.station === "B") renderStationPlaceholder(host, "Procedures", "Procedure & country selection arrives with Station B in the next update.");
    else renderStationPlaceholder(host, "RA tasks", "RA-effort toggles arrive with Station C in the next update.");
  }

  function renderStationPlaceholder(host, title, note) {
    host.appendChild(el("div", "vcl-bud-body__title", escapeHtml(title)));
    host.appendChild(el("div", "vcl-bud-body__sub", escapeHtml(note)));
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
        modalState.station = s.key;
        paintStepper();
        stationBody(card);
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
    modal.appendChild(el("p", "vcl-bud-modal__summary", escapeHtml(summaryLine(d))));

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

    var linesRows = [["Product", "Variation", "Type", "Procedure", "Countries", "Quarter", "Probability", "Fee (EUR)", "Hours (min)", "Hours (max)", "Hours (expected)"]];
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var procLabel = line.procedure.kind === "mrpdcp" ? "MRP/DCP" : (line.procedure.kind === "cp" ? "CP" : "National");
      var ccs = BUD.lineCountries(line).map(function (c) { return c.cc; }).join(", ");
      linesRows.push([
        line.product || "", line.variationLabel || "", line.type || "", procLabel, ccs,
        line.quarter || "", line.probability, r.fee,
        Math.round(r.hours.min), Math.round(r.hours.max), Math.round(r.hours.expected),
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
