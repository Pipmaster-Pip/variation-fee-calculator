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

  function engines() {
    return {
      computeFees: window.VCLCALC && window.VCLCALC.computeFees,
      workload: window.VCL_WORKLOAD_HOURS,
      workloadData: window.VCL_WORKLOAD_HD,
    };
  }

  var plan = BUD.loadPlan(window.localStorage);
  var state = { lines: plan.lines, hoursPerHead: plan.hoursPerHead, resultsById: {}, storageOk: true };
  var container = null;
  var modalState = null; // null when closed, else { editingId, draft, query, searchResults }

  function openModalFor(id) {
    var existing = id && state.lines.find(function (l) { return l.id === id; });
    modalState = {
      editingId: id || null,
      draft: existing ? JSON.parse(JSON.stringify(existing)) : BUD.newLine("line-" + Date.now() + "-" + Math.floor(Math.random() * 1000)),
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
    modalState = null;
    saveState();
    rerender();
  }

  function saveState() {
    var ok = BUD.savePlan(window.localStorage, { version: 1, hoursPerHead: state.hoursPerHead, lines: state.lines });
    if (!ok && state.storageOk) { state.storageOk = false; rerender(); }
    else if (ok && !state.storageOk) { state.storageOk = true; }
  }

  function recomputeResults() {
    var eng = engines();
    state.resultsById = {};
    state.lines.forEach(function (line) {
      state.resultsById[line.id] = BUD.computeLineResult(line, eng);
    });
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

  function renderTable() {
    var wrap = el("div");
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines"));
    head.appendChild(el("span", null, state.lines.length + " lines"));
    wrap.appendChild(head);

    var tableWrap = el("div", "vcl-bud-table-wrap");
    var table = el("table", "vcl-bud-table");
    table.innerHTML =
      "<thead><tr><th>Product</th><th>Variation</th><th>Type</th><th>Procedure</th>" +
      "<th>Countries</th><th>Quarter</th><th style=\"text-align:right\">Fee</th>" +
      "<th style=\"text-align:right\">Hours (PERT)</th><th></th></tr></thead>";
    var tbody = el("tbody");
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var tr = el("tr");
      var procLabel = line.procedure.kind === "mrpdcp"
        ? "MRP/DCP" + (line.procedure.rms ? " · RMS " + line.procedure.rms : "")
        : (line.procedure.kind === "cp" ? "CP" : "National");
      var ccChips = BUD.lineCountries(line).map(function (c) {
        return '<span class="vcl-bud-cc-chip">' + escapeHtml(c.cc) + "</span>";
      }).join("");
      var typeBadge = line.type
        ? '<span class="vcl-bud-type-badge vcl-bud-type-badge--' + line.type.toLowerCase() + '">' + escapeHtml(line.type) + "</span>"
        : "—";
      var feeCell = r.complete
        ? '<td class="vcl-bud-num">' + escapeHtml(fmtEUR(r.fee)) + "</td>"
        : '<td class="vcl-bud-num"><span class="vcl-bud-warn">Countries incomplete</span></td>';
      var hoursCell = r.complete
        ? '<td class="vcl-bud-num">' + Math.round(r.hours.expected) + ' h<div class="vcl-bud-hours-band">' +
          Math.round(r.hours.min) + "–" + Math.round(r.hours.max) + "</div></td>"
        : '<td class="vcl-bud-num">—</td>';
      tr.innerHTML =
        "<td>" + escapeHtml(line.product || "—") + "</td>" +
        "<td>" + escapeHtml(line.variationLabel || "—") + "</td>" +
        "<td>" + typeBadge + "</td>" +
        "<td class=\"mono\">" + escapeHtml(procLabel) + "</td>" +
        "<td>" + ccChips + "</td>" +
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
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
    return wrap;
  }

  function rerender() {
    if (!container) return;
    recomputeResults();
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
      '<button type="button" class="vcl-bud-btn" data-act="export">⭳ Export to Excel</button>' +
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--primary" data-act="new-line">+ New line</button>';
    header.appendChild(actions);
    container.appendChild(header);

    container.appendChild(renderRollupTiles(rollup));

    var breakdown = el("div", "vcl-bud-breakdown");
    breakdown.appendChild(renderBreakdownPanel("By market", rollup.byMarket, rollup.totals.fee));
    breakdown.appendChild(renderBreakdownPanel("By product", rollup.byProduct, rollup.totals.fee));
    container.appendChild(breakdown);

    container.appendChild(renderTable());

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
  function populateSearchResults(host) {
    if (!host) return;
    var d = modalState.draft;
    host.innerHTML = "";
    host.style.display = modalState.searchResults.length ? "" : "none";
    modalState.searchResults.forEach(function (entry) {
      var item = el("button", "vcl-bud-search-result", escapeHtml(entry.code + " — " + entry.title));
      item.type = "button";
      item.addEventListener("click", function () {
        d.variationCode = entry.code;
        d.variationLabel = entry.code + " — " + entry.title;
        var types = typesForEntry(entry);
        d.type = types[0] || d.type;
        modalState.query = "";
        modalState.searchResults = [];
        rerender();
      });
      host.appendChild(item);
    });
  }

  function renderModal() {
    var d = modalState.draft;
    var overlay = el("div", "vcl-bud-modal-overlay");
    var modal = el("div", "vcl-bud-modal");

    var head = el("div", "vcl-bud-modal__head");
    head.appendChild(el("h2", null, modalState.editingId ? "Edit plan line" : "New plan line"));
    var closeBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", closeModal);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    // Product
    var productField = el("div", "vcl-bud-field");
    productField.appendChild(el("label", "vcl-bud-field-label", "Product"));
    var productInput = el("input", "vcl-bud-input");
    productInput.type = "text"; productInput.value = d.product;
    productInput.addEventListener("input", function () { d.product = productInput.value; });
    productField.appendChild(productInput);
    modal.appendChild(productField);

    // Variation search
    var varField = el("div", "vcl-bud-field");
    varField.appendChild(el("label", "vcl-bud-field-label", "Variation"));
    var varInput = el("input", "vcl-bud-input");
    varInput.type = "text";
    varInput.placeholder = "Search by code or keyword ...";
    varInput.value = modalState.query || d.variationLabel || "";
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
    if (d.variationCode) {
      var typesRow = el("div");
      typesRow.style.marginTop = "8px";
      var entry = ENTRIES.find(function (e) { return e.code === d.variationCode; });
      var availableTypes = entry ? typesForEntry(entry) : ["IA", "IB", "II"];
      availableTypes.forEach(function (t) {
        var badge = el("span", "vcl-bud-type-badge vcl-bud-type-badge--" + t.toLowerCase() + (t === d.type ? " is-active" : ""), escapeHtml(t));
        badge.addEventListener("click", function () { d.type = t; rerender(); });
        typesRow.appendChild(badge);
        typesRow.appendChild(document.createTextNode(" "));
      });
      varField.appendChild(typesRow);
    }
    modal.appendChild(varField);

    // Procedure + RMS
    var procRow = el("div", "vcl-bud-field vcl-bud-field-row");
    var procCol = el("div");
    procCol.appendChild(el("label", "vcl-bud-field-label", "Procedure"));
    var procSelect = el("select", "vcl-bud-select");
    ["national", "mrpdcp", "cp"].forEach(function (kind) {
      var opt = el("option", null, kind === "mrpdcp" ? "MRP/DCP" : (kind === "cp" ? "CP" : "National"));
      opt.value = kind;
      if (d.procedure.kind === kind) opt.selected = true;
      procSelect.appendChild(opt);
    });
    procSelect.addEventListener("change", function () {
      d.procedure = { kind: procSelect.value, nat: null, rms: null, cms: [] };
      if (procSelect.value === "cp") d.procedure.ema = findEmaCc();
      rerender();
    });
    procCol.appendChild(procSelect);
    procRow.appendChild(procCol);

    if (d.procedure.kind === "mrpdcp") {
      var rmsCol = el("div");
      rmsCol.appendChild(el("label", "vcl-bud-field-label", "RMS (Reference Member State)"));
      var rmsSelect = el("select", "vcl-bud-select");
      rmsSelect.appendChild(el("option", null, "—"));
      countriesByRole("RMS").forEach(function (c) {
        var opt = el("option", null, escapeHtml(c.cc + " — " + c.name));
        opt.value = c.cc;
        if (d.procedure.rms === c.cc) opt.selected = true;
        rmsSelect.appendChild(opt);
      });
      rmsSelect.addEventListener("change", function () { d.procedure.rms = rmsSelect.value || null; rerender(); });
      rmsCol.appendChild(rmsSelect);
      procRow.appendChild(rmsCol);
    } else if (d.procedure.kind === "national") {
      var natCol = el("div");
      natCol.appendChild(el("label", "vcl-bud-field-label", "Country"));
      var natSelect = el("select", "vcl-bud-select");
      natSelect.appendChild(el("option", null, "—"));
      countriesByRole("national").forEach(function (c) {
        var opt = el("option", null, escapeHtml(c.cc + " — " + c.name));
        opt.value = c.cc;
        if (d.procedure.nat === c.cc) opt.selected = true;
        natSelect.appendChild(opt);
      });
      natSelect.addEventListener("change", function () { d.procedure.nat = natSelect.value || null; rerender(); });
      natCol.appendChild(natSelect);
      procRow.appendChild(natCol);
    }
    modal.appendChild(procRow);

    // CMS checkboxes (MRP/DCP only)
    if (d.procedure.kind === "mrpdcp") {
      var ccField = el("div", "vcl-bud-field");
      ccField.appendChild(el("label", "vcl-bud-field-label", "Countries (CMS)"));
      var checks = el("div", "vcl-bud-cc-checks");
      countriesByRole("CMS").forEach(function (c) {
        if (c.cc === d.procedure.rms) return; // RMS cannot also be a CMS
        var label = el("label", "vcl-bud-cc-check");
        var cb = el("input"); cb.type = "checkbox";
        cb.checked = d.procedure.cms.indexOf(c.cc) !== -1;
        cb.addEventListener("change", function () {
          var i = d.procedure.cms.indexOf(c.cc);
          if (cb.checked && i === -1) d.procedure.cms.push(c.cc);
          if (!cb.checked && i !== -1) d.procedure.cms.splice(i, 1);
          rerender();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + c.cc));
        checks.appendChild(label);
      });
      ccField.appendChild(checks);
      modal.appendChild(ccField);
    }

    // Quarter + Probability
    var qpRow = el("div", "vcl-bud-field vcl-bud-field-row");
    var qCol = el("div");
    qCol.appendChild(el("label", "vcl-bud-field-label", "Quarter"));
    var qSelect = el("select", "vcl-bud-select");
    ["Q1", "Q2", "Q3", "Q4"].forEach(function (q) {
      var opt = el("option", null, q); opt.value = q;
      if (d.quarter === q) opt.selected = true;
      qSelect.appendChild(opt);
    });
    qSelect.addEventListener("change", function () { d.quarter = qSelect.value; });
    qCol.appendChild(qSelect);
    qpRow.appendChild(qCol);

    var pCol = el("div");
    pCol.appendChild(el("label", "vcl-bud-field-label", "Probability"));
    var pSelect = el("select", "vcl-bud-select");
    [100, 75, 50, 25].forEach(function (p) {
      var opt = el("option", null, p + "%" + (p === 100 ? " (firm)" : "")); opt.value = String(p);
      if (d.probability === p) opt.selected = true;
      pSelect.appendChild(opt);
    });
    pSelect.addEventListener("change", function () { d.probability = parseInt(pSelect.value, 10); });
    pCol.appendChild(pSelect);
    qpRow.appendChild(pCol);
    modal.appendChild(qpRow);

    // Live preview
    var preview = BUD.computeLineResult(d, engines());
    var liveResult = el("div", "vcl-bud-live-result");
    var feeItem = el("div");
    feeItem.innerHTML = '<div class="lbl">Fee</div><div class="val">' + escapeHtml(fmtEUR(preview.fee)) + "</div>";
    liveResult.appendChild(feeItem);
    var hoursItem = el("div");
    hoursItem.innerHTML = '<div class="lbl">RA hours</div><div class="val">' + Math.round(preview.hours.expected) +
      ' h <span class="band">' + Math.round(preview.hours.min) + "–" + Math.round(preview.hours.max) + "</span></div>";
    liveResult.appendChild(hoursItem);
    modal.appendChild(liveResult);

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
    saveState();
    rerender();
  }
  function deleteLine(id) {
    state.lines = state.lines.filter(function (l) { return l.id !== id; });
    saveState();
    rerender();
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
