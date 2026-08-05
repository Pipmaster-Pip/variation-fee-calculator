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

  // Demo seed so the very first render (before Task 4 wires localStorage) shows real, styled
  // numbers instead of an empty shell. Replaced by the persisted plan in Task 4.
  function demoLines() {
    var l1 = BUD.newLine("demo-1");
    l1.product = "Product A"; l1.type = "IB";
    l1.procedure = { kind: "mrpdcp", rms: "DE", cms: ["FR", "ES"] };
    l1.quarter = "Q2";
    var l2 = BUD.newLine("demo-2");
    l2.product = "Product B"; l2.type = "IA";
    l2.procedure = { kind: "national", nat: "DE" };
    l2.quarter = "Q1";
    return [l1, l2];
  }

  var state = { lines: demoLines(), hoursPerHead: 1500, resultsById: {} };
  var container = null;

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
  }

  window.VCL_BUDGET = {
    render: function (col) {
      container = col;
      rerender();
    },
  };
})();
