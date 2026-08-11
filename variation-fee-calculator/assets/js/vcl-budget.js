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
  // module itself so computeLineResult/renderEditor/renderTable all delegate pricing/hours to
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
  // Variations cell: one colour-coded type-badge (+ classification code, if any) per variation,
  // inline. Aggregated by type ("3 × IA, 5 × IB, 1 × II") -- one colour-coded badge per distinct
  // type with its count, ordered IA < IB < II, rather than one pill per individual variation.
  function aggregateVariationTypes(sub) {
    var rank = { ia: 0, ib: 1, ii: 2 };
    var counts = {}, order = [];
    (sub.variations || []).forEach(function (v) {
      var t = v.type || "?";
      if (!(t in counts)) { counts[t] = 0; order.push(t); }
      counts[t]++;
    });
    return order.map(function (t) { return { type: t, count: counts[t] }; })
      .sort(function (a, b) {
        var ra = rank[typeBucketClass(a.type)]; var rb = rank[typeBucketClass(b.type)];
        if (ra == null) ra = 9; if (rb == null) rb = 9;
        if (ra !== rb) return ra - rb;
        return a.type < b.type ? -1 : (a.type > b.type ? 1 : 0);
      });
  }
  function variationsSummary(sub) {
    if (!sub.variations.length) return "—";
    // Plain text, neutral colour, one aggregated type per line ("2 × IB" / "1 × II") -- the colour-
    // coded badges read as visual noise in a dense table, so the type is spelled out inline.
    var rows = aggregateVariationTypes(sub).map(function (g) {
      return '<span class="vcl-bud-var-agg">' + g.count + " × " + escapeHtml(g.type) + "</span>";
    }).join("");
    return '<span class="vcl-bud-var-cell">' + rows + "</span>";
  }
  // The country code stored for a procedure can be composite ("DE - BfArM"); the table cell shows
  // just the 2-letter base so every chip stays compact.
  function ccShort(cc) {
    var s = String(cc == null ? "" : cc);
    var m = /^([A-Za-z]{2})/.exec(s);
    return m ? m[1] : s;
  }
  // Procedures cell: the procedures grouped by kind and stacked, one line per kind, so the *number*
  // of procedures is legible at a glance (i. e. "3 × nat. (HU, DE, IT)" / "3 × CP" / "RMS DE (+ 5
  // CMS), RMS LT (+ 10 CMS)"). Only the *visible* procedures are counted -- extras beyond the base
  // exist only in a multi-procedure (WS/SG) submission -- so this never over-counts hidden ones.
  function groupProcedures(sub) {
    var visible = SUB.multiProcedureMode(sub) ? sub.procedures : [sub.procedures[0]];
    var nat = [], cp = 0, mrp = [];
    visible.forEach(function (p) {
      if (p.kind === "national") nat.push(p.nat ? ccShort(p.nat) : "?");
      else if (p.kind === "cp") cp++;
      else if (p.kind === "mrpdcp") mrp.push(p);
    });
    return { nat: nat, cp: cp, mrp: mrp };
  }
  function proceduresSummary(sub) {
    if (!sub.procedures.length) return "—";
    // Plain text, neutral colour, one procedure-kind per line ("2 × nat. (PL, SE)" / "3 × CP" / one
    // line per MRP/DCP "RMS DE (+ 6 CMS)") -- the country chips read as visual noise, so codes are
    // spelled out inline.
    var g = groupProcedures(sub);
    var lines = [];
    if (g.nat.length) {
      lines.push('<span class="vcl-bud-proc-line">' + g.nat.length + " × nat. (" + escapeHtml(g.nat.join(", ")) + ")</span>");
    }
    if (g.cp) {
      lines.push('<span class="vcl-bud-proc-line">' + g.cp + " × CP</span>");
    }
    // Each MRP/DCP procedure gets its OWN line (national all-in-one, CP all-in-one, then one line per
    // MRP/DCP) so the column can be narrow and each procedure stays legible on its own row.
    g.mrp.forEach(function (p) {
      var rms = p.rms ? escapeHtml(ccShort(p.rms)) : "?";
      var n = (p.cms || []).length;
      lines.push('<span class="vcl-bud-proc-line">RMS ' + rms + " (+ " + n + " CMS)</span>");
    });
    return '<span class="vcl-bud-proc-cell">' + lines.join("") + "</span>";
  }
  // Plain-text variants of the two cell summaries, for the Excel export (the on-screen ones return
  // HTML markup, which a spreadsheet cell must never receive).
  function variationsText(sub) {
    if (!sub.variations.length) return "—";
    return aggregateVariationTypes(sub).map(function (g) { return g.count + " × " + g.type; }).join(", ");
  }
  function proceduresText(sub) {
    if (!sub.procedures.length) return "—";
    var g = groupProcedures(sub);
    var parts = [];
    if (g.nat.length) parts.push(g.nat.length + " × nat. (" + g.nat.join(", ") + ")");
    if (g.cp) parts.push(g.cp + " × CP");
    g.mrp.forEach(function (p) {
      parts.push("RMS " + (ccShort(p.rms) || "?") + " (+ " + (p.cms || []).length + " CMS)");
    });
    return parts.join("; ");
  }
  var MODE_LABEL = { worksharing: "Worksharing", superGrouping: "Super-Grouping", annualUpdate: "Annual Update", grouping: "Grouping", single: "Single" };

  // Inline SVG row-action icons (16px, stroke = currentColor) -- render identically on every
  // platform, unlike the glyph characters they replace (the ⧉ duplicate glyph fell back to a
  // "tofu" box on some systems -- see renderTable).
  var SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    duplicate: SVG + '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    edit: SVG + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    del: SVG + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };

  var plan = BUD.loadPlan(window.localStorage);
  // expandedId: id of the single currently-open detail row (only one line may be open at a time).
  var state = { lines: plan.lines, hoursPerHead: plan.hoursPerHead, resultsById: {}, storageOk: true, expandedId: null };
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
      // GW-style forward gating: a new line is a wizard (only A reached until each station is
      // completed); an existing line is fully reached so the user can jump A/B/C freely.
      reached: id ? { A: true, B: true, C: true } : { A: true, B: false, C: false },
      query: "",
      searchResults: [],
    };
    rerender();
  }
  function closeModal() { modalState = null; rerender(); scrollToTop(); }
  // After navigating to a new station (or back to the results) the viewport is still scrolled down at
  // the Next/finish button; bring the top of the tool back into view so the user starts at the top.
  function scrollToTop() {
    if (container && container.scrollIntoView) container.scrollIntoView({ block: "start" });
  }
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
    scrollToTop();
  }

  function saveState() {
    var ok = BUD.savePlan(window.localStorage, { version: 2, hoursPerHead: state.hoursPerHead, lines: state.lines });
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
    feeTile.appendChild(el("p", "vcl-bud-tile__label", "Variation fees"));
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

  // Whole-hours-ish band formatter for the detail rows: keeps half hours (matches the workbook's
  // raw ranges) but drops trailing ".0".
  function hNum(n) { var x = Math.round((n || 0) * 10) / 10; return String(x); }
  function hBand(mm) { if (!mm) return "—"; var lo = hNum(mm.min), hi = hNum(mm.max); return lo === hi ? lo + " h" : lo + "–" + hi + " h"; }

  // Expandable per-line detail (chosen "Variant A"): the itemised RA-hours breakdown grouped into
  // RA / CMC / Compilation sections (with subtotals + PERT total, matching the GW method box),
  // beside the fee-by-country and the probability-weighted expected value. Rendered as a full-width
  // <tr> appended under the line row.
  function renderDetailRow(line, r) {
    var tr = el("tr", "vcl-bud-detail-row");
    var td = el("td"); td.colSpan = 8;
    var box = el("div", "vcl-bud-detail");

    if (!r.complete || !r.hoursDetail) {
      box.appendChild(el("p", "vcl-bud-hint", "Set all countries for this line to see the fee and RA-hours breakdown."));
      td.appendChild(box); tr.appendChild(td); return tr;
    }

    var d = r.hoursDetail; // { items:{ra,cmc,compilation}, sections:{ra,cmc,compilation,total} }
    var grid = el("div", "vcl-bud-detail__grid");

    // Left column: itemised RA-hours build-up.
    var left = el("div");
    function section(title, items, subtotal) {
      if (!items || !items.length) return;
      left.appendChild(el("div", "vcl-bud-detail__sec", escapeHtml(title)));
      items.forEach(function (it) {
        var row = el("div", "vcl-bud-detail__item");
        row.appendChild(el("span", null, escapeHtml(it.label)));
        row.appendChild(el("span", "vcl-bud-detail__h", hBand(it)));
        left.appendChild(row);
      });
      var sub = el("div", "vcl-bud-detail__sub");
      sub.appendChild(el("span", null, "Subtotal · " + escapeHtml(title)));
      sub.appendChild(el("span", null, hBand(subtotal)));
      left.appendChild(sub);
    }
    section("RA activities", d.items.ra, d.sections.ra);
    section("CMC activities", d.items.cmc, d.sections.cmc);
    section("Compilation & submission", d.items.compilation, d.sections.compilation);
    var tot = el("div", "vcl-bud-detail__total");
    tot.appendChild(el("span", null, "RA workload total"));
    tot.appendChild(el("span", null, Math.round(r.hours.expected) + " h (" + hBand(d.sections.total) + ")"));
    left.appendChild(tot);
    grid.appendChild(left);

    // Right column: fee by country + probability-weighted expected value.
    var right = el("div");
    right.appendChild(el("div", "vcl-bud-detail__sec", "Fee by country"));
    (r.feeByCountry || []).forEach(function (f) {
      var row = el("div", "vcl-bud-detail__item");
      row.appendChild(el("span", null, '<span class="vcl-bud-cc">' + escapeHtml(ccShort(f.cc)) + "</span>"));
      row.appendChild(el("span", "vcl-bud-detail__h", escapeHtml(fmtEUR(f.total))));
      right.appendChild(row);
    });
    var feeSub = el("div", "vcl-bud-detail__sub");
    feeSub.appendChild(el("span", null, "Total fee"));
    feeSub.appendChild(el("span", null, escapeHtml(fmtEUR(r.fee))));
    right.appendChild(feeSub);

    var p = (line.probability == null) ? 100 : line.probability;
    right.appendChild(el("div", "vcl-bud-detail__sec", "Expected value (× " + p + "% probability)"));
    var ef = el("div", "vcl-bud-detail__item");
    ef.appendChild(el("span", null, "Expected fee"));
    ef.appendChild(el("span", "vcl-bud-detail__h", escapeHtml(fmtEUR(r.fee * p / 100))));
    right.appendChild(ef);
    var eh = el("div", "vcl-bud-detail__item");
    eh.appendChild(el("span", null, "Expected hours"));
    eh.appendChild(el("span", "vcl-bud-detail__h", Math.round(r.hours.expected * p / 100) + " h"));
    right.appendChild(eh);
    grid.appendChild(right);

    box.appendChild(grid);
    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  function renderTable(rollup) {
    var wrap = el("div");
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines"));
    wrap.appendChild(head);

    var tableWrap = el("div", "vcl-bud-table-wrap");
    var table = el("table", "vcl-bud-table");
    // Column widths: Product gets more room (long names were overrunning Mode), Procedures is
    // narrower now that each procedure sits on its own compact line, and Variations gets a touch
    // more for the single-row aggregated badges. <col> hints; auto table-layout still lets cells grow.
    table.innerHTML =
      '<colgroup><col style="width:14%"><col style="width:12%"><col style="width:17%">' +
      '<col style="width:17%"><col style="width:6%"><col style="width:9%">' +
      '<col style="width:12%"><col style="width:13%"></colgroup>' +
      "<thead><tr><th>Product</th><th>Mode</th><th>Variations</th><th>Procedures</th>" +
      "<th>Quarter</th><th style=\"text-align:right\">Fee</th>" +
      "<th style=\"text-align:right\">Hours (PERT)</th><th></th></tr></thead>";
    var tbody = el("tbody");
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var sub = line.submission;
      var expanded = state.expandedId === line.id;
      var tr = el("tr", "vcl-bud-line-row" + (expanded ? " is-expanded" : ""));
      var mode = SUB.displayMode(sub);
      // A Worksharing (or any explicit multi-procedure mode) that also bundles several variations is
      // ALSO a Grouping -- name both, since the mode pill alone would hide the grouping. Annual Update
      // and Super-Grouping carry their multi-variation intrinsically, so they get no extra pill; a
      // plain multi-variation line already reports "grouping" via displayMode (guarded below).
      var alsoGrouped = sub.variations.length > 1 && sub.mode !== "annualUpdate" && sub.mode !== "superGrouping";
      var modePill = '<span class="vcl-bud-mode-cell">';
      if (alsoGrouped && mode !== "grouping") {
        modePill += '<span class="vcl-bud-mode-pill vcl-bud-mode-pill--grouping">' + escapeHtml(MODE_LABEL.grouping) + "</span>";
      }
      modePill += '<span class="vcl-bud-mode-pill vcl-bud-mode-pill--' + mode + '">' + escapeHtml(MODE_LABEL[mode]) + "</span></span>";
      var feeCell = r.complete
        ? '<td class="vcl-bud-num">' + escapeHtml(fmtEUR(r.fee)) + "</td>"
        : '<td class="vcl-bud-num"><span class="vcl-bud-warn">Countries incomplete</span></td>';
      var hoursCell = r.complete
        ? '<td class="vcl-bud-num">' + Math.round(r.hours.expected) + ' h<div class="vcl-bud-hours-band">(' +
          Math.round(r.hours.min) + "–" + Math.round(r.hours.max) + " h)</div></td>"
        : '<td class="vcl-bud-num">—</td>';
      // The whole row is the expand toggle (handled in onTableClick, which excludes the action
      // buttons); only one row is open at a time -- no chevron affordance (removed per request).
      // Action icons are inline SVG (not glyph characters) so they render identically on every
      // platform -- the old ⧉ duplicate glyph fell back to a "tofu" box on some systems.
      tr.innerHTML =
        '<td class="vcl-bud-expcell">' + escapeHtml(line.product || "—") + "</td>" +
        "<td>" + modePill + "</td>" +
        "<td>" + variationsSummary(sub) + "</td>" +
        "<td class=\"vcl-bud-proc-summary\">" + proceduresSummary(sub) + "</td>" +
        "<td>" + escapeHtml(line.quarter || "—") + "</td>" +
        feeCell + hoursCell +
        '<td class="vcl-bud-row-actions">' +
        '<button type="button" class="vcl-bud-icon-btn" data-act="duplicate" aria-label="Duplicate" title="Duplicate">' + ICON.duplicate + "</button>" +
        '<button type="button" class="vcl-bud-icon-btn" data-act="edit" aria-label="Edit" title="Edit">' + ICON.edit + "</button>" +
        '<button type="button" class="vcl-bud-icon-btn vcl-bud-icon-btn--danger" data-act="delete" aria-label="Delete" title="Delete">' + ICON.del + "</button>" +
        "</td>";
      tr.dataset.lineId = line.id;
      tbody.appendChild(tr);
      if (expanded) tbody.appendChild(renderDetailRow(line, r));
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

    container.innerHTML = "";
    if (!state.storageOk) {
      container.appendChild(el("div", "vcl-bud-warn", "Your plan isn't being saved in this browser."));
    }

    // Editor is a full "takeover": while a line is being built/edited the station flow replaces the
    // dashboard (header actions + tiles + breakdown + table) entirely -- no pop-up overlay.
    if (modalState) {
      container.appendChild(renderEditor());
      return;
    }

    var rollup = BUD.computeRollup(state.lines, state.resultsById);
    var header = el("div", "vcl-bud-header");
    var left = el("div", "vcl-bud-header__intro");
    // Budget planning is done for the coming year (e.g. in 2026 you plan 2027), so surface the
    // plan year right in the heading.
    var planYear = new Date().getFullYear() + 1;
    left.appendChild(el("h2", null, 'Budget Planning <span class="vcl-bud-year">for ' + planYear + "</span>"));
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
        // Match the Guided Workflow: a single-variant code resolves immediately; a multi-variant
        // code leaves the base unresolved so Station A can show the descriptive variant list.
        var variants = entry.variants || [];
        var only = variants.length === 1 ? variants[0] : null;
        var v = { code: entry.code, variantId: only ? only.id : null, type: only ? only.type : null };
        // Picking sets the BASE variation (variations[0]); additional variations for a Grouping are
        // added via the grouping list once a base is chosen. If a (possibly emptied) base slot
        // already exists it's replaced in place so any additional variations keep their indices.
        if (d.submission.variations.length) d.submission.variations[0] = v;
        else d.submission.variations.push(v);
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

  var STATION_ORDER = ["A", "B", "C"];

  // Completion gate per station (GW-style): drives the stepper checkmark, the "Next" enablement,
  // and the final "Add/Save line" enablement. A is complete once every variation carries a type
  // (needed to price); B once every *visible* procedure has its authority/country resolved (and,
  // in a WS/SG lead scenario, a lead is chosen); C is always satisfiable (core RA prep is always
  // included, the optional modules are opt-in).
  function stationComplete(key, sub) {
    if (key === "A") return sub.variations.length > 0 && sub.variations.every(function (v) { return !!v.type; });
    if (key === "B") {
      var procs = SUB.multiProcedureMode(sub) ? sub.procedures : [sub.procedures[0]];
      var procsOk = procs.every(function (p) {
        return p.kind === "cp" || (p.kind === "national" && p.nat) || (p.kind === "mrpdcp" && p.rms);
      });
      var leadOk = !SUB.leadPricingActive(sub) || !!sub.lead;
      return procsOk && leadOk;
    }
    return true;
  }

  // Step one station forward/back. Forward is gated: it only advances if the current station is
  // complete, and it marks the destination "reached" so its stepper dot becomes clickable.
  function advanceStation(dir) {
    var sub = modalState.draft.submission;
    var i = STATION_ORDER.indexOf(modalState.station);
    var j = i + dir;
    if (j < 0 || j >= STATION_ORDER.length) return;
    if (dir > 0 && !stationComplete(modalState.station, sub)) return;
    var key = STATION_ORDER[j];
    if (dir > 0) modalState.reached[key] = true;
    modalState.station = key;
    refreshEditor();
    scrollToTop();
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
  // references are captured by renderEditor() each time the modal is (re)built.
  function refreshEditor() {
    if (!modalState) return;
    // Clear any now-invalid strategy BEFORE the body/preview repaint, independent of the active
    // station (Station A refreshes never run renderStationB's own clear).
    normalizeModeEnablement(modalState.draft.submission);
    if (modalState.paintStepper) modalState.paintStepper();
    if (modalState.paintNav) modalState.paintNav();
    if (modalState.bodyHost) stationBody(modalState.bodyHost);
    if (modalState.previewHost) renderPreviewStrip(modalState.previewHost);
    if (modalState.summaryHost) modalState.summaryHost.textContent = summaryLine(modalState.draft);
  }

  // ---- Station A: Variations -- mirrors the Guided Workflow's buildStationA exactly. ----
  // Empty base: "Classification" search + a "No classification code? Set the type directly:"
  // quick-pick. Once a base variation is chosen: a picked-header (+ Change) and the grouping list
  // for any further variations. variations[0] is always the base slot; variations[1..] are the
  // additional (grouping) variations.
  function renderStationA(host) {
    var sub = modalState.draft.submission;
    host.appendChild(el("div", "vcl-bud-body__title", "Variations"));
    host.appendChild(el("div", "vcl-bud-body__sub", "Which variation, or variations, are you submitting?"));

    var base = sub.variations[0];
    var baseSet = base && (base.code || base.type);

    if (!baseSet) {
      // Empty state: search + quick-pick, no grouping list yet (GW's early return).
      renderClassificationSearch(host);
      renderTypeQuickPick(host);
      return;
    }

    // A classification code is picked but its specific variant/type isn't chosen yet: show the
    // Guided-Workflow-exact descriptive variant list (title left, type badge right) and stop --
    // no grouping list until the base variation is fully resolved. Mirrors vcl-workflow.js
    // buildStationA's `if (!variant)` branch (which shows entry.variants, then returns early).
    var entry = base.code ? ENTRIES.find(function (e) { return e.code === base.code; }) : null;
    if (entry && !base.type) {
      renderPickedBaseHeader(host, base);
      renderVariantChooser(host, entry, base);
      return;
    }

    renderPickedBaseHeader(host, base);
    renderGroupingList(host);
  }

  // Guided-Workflow-exact variant list for a picked classification code: one full-width row per
  // variant (descriptive label left, type badge right), same structure as vcl-workflow.js
  // buildStationA. Picking a row resolves the base variation's variant id + type. Same look as the
  // GW, in the budget colour (via .vcl-bud-variant).
  function renderVariantChooser(host, entry, base) {
    var chooser = el("div", "vcl-bud-variants");
    (entry.variants || []).forEach(function (v) {
      var row = el("div", "vcl-bud-variant");
      row.innerHTML = '<span class="vcl-bud-variant__label">' + escapeHtml(v.label || entry.title) + "</span> " +
        '<span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(v.type) + '">' + escapeHtml(v.type) + "</span>";
      row.addEventListener("click", function () { base.variantId = v.id; base.type = v.type; rerender(); });
      chooser.appendChild(row);
    });
    host.appendChild(chooser);
  }

  // "Classification" search field (focus-safe targeted-update pattern: populateSearchResults only
  // ever rebuilds the results host below, never this input).
  function renderClassificationSearch(host) {
    var varField = el("div", "vcl-bud-field");
    varField.appendChild(el("label", "vcl-bud-field-label", "Classification"));
    var varInput = el("input", "vcl-bud-input");
    varInput.type = "text";
    varInput.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ...";
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
  }

  // "No classification code? Set the type directly:" -- sets the base variation's type with no code.
  function renderTypeQuickPick(host) {
    var wrap = el("div", "vcl-bud-quicktype");
    wrap.appendChild(el("div", "vcl-bud-quicktype__label", "No classification code? Set the type directly:"));
    var opts = el("div", "vcl-bud-chips");
    ["IA", "IB", "II"].forEach(function (t) {
      var chip = el("button", "vcl-bud-chip vcl-bud-chip--type",
        "Type " + escapeHtml(t) + ' <span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(t) + '">' + escapeHtml(t) + "</span>");
      chip.type = "button";
      chip.addEventListener("click", function () {
        var v = { code: null, variantId: null, type: t };
        if (modalState.draft.submission.variations.length) modalState.draft.submission.variations[0] = v;
        else modalState.draft.submission.variations.push(v);
        modalState.query = "";
        modalState.searchResults = [];
        rerender();
      });
      opts.appendChild(chip);
    });
    wrap.appendChild(opts);
    host.appendChild(wrap);
  }

  // Picked base header (+ Change) -- GW's buildPickedHeader / buildTypeOnlyHeader. When the picked
  // classification entry offers more than one type, a small type chooser lets the user switch.
  function renderPickedBaseHeader(host, base) {
    var entry = base.code ? ENTRIES.find(function (e) { return e.code === base.code; }) : null;
    var badge = base.type ? ' <span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(base.type) + '">' + escapeHtml(base.type) + "</span>" : "";
    var picked = el("div", "vcl-bud-picked");
    var label = el("span");
    if (entry) label.innerHTML = '<span class="vcl-bud-picked__code">' + escapeHtml(entry.code) + "</span> — " + escapeHtml(entry.title) + badge;
    else if (base.code) label.innerHTML = '<span class="vcl-bud-picked__code">' + escapeHtml(base.code) + "</span>" + badge;
    else label.innerHTML = "Variation type" + badge + ' <span class="vcl-bud-picked__muted">— no classification code</span>';
    picked.appendChild(label);
    var change = el("button", "vcl-bud-change", "Change");
    change.type = "button";
    change.addEventListener("click", function () {
      // Empty the base slot (keep it at index 0 so additional variations keep their indices) --
      // reverts to the search / quick-pick.
      modalState.draft.submission.variations[0] = { code: null, variantId: null, type: null };
      modalState.query = "";
      modalState.searchResults = [];
      rerender();
    });
    picked.appendChild(change);
    host.appendChild(picked);
  }

  // Additional variations (variations[1..]) -- GW's buildGroupingList. Two or more variations total
  // are priced as a Grouping.
  function renderGroupingList(host) {
    var sub = modalState.draft.submission;
    var panel = el("div", "vcl-bud-builder");
    var head = el("div", "vcl-bud-builder__head");
    head.appendChild(el("span", null, "Additional variations"));
    head.appendChild(el("span", "vcl-bud-count", String(Math.max(0, sub.variations.length - 1))));
    panel.appendChild(head);

    sub.variations.slice(1).forEach(function (v, i) { panel.appendChild(renderVariationRow(v, i + 1)); });

    var add = el("button", "vcl-bud-add", "＋ Add variation");
    add.type = "button";
    add.addEventListener("click", function () { sub.variations.push({ code: null, variantId: null, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
    host.appendChild(panel);

    if (sub.variations.length >= 2) {
      host.appendChild(el("p", "vcl-bud-hint", sub.variations.length + " variations — this line is priced as a Grouping."));
    }
  }

  // One additional (grouping) variation row -- mirrors the Guided Workflow's buildGroupingRow
  // state machine: resolved (code+title+badge, or bare type) → text; a code with several types →
  // a type chooser; empty → a per-row search + "or set the type directly:" quick-pick. The row's
  // search rebuilds only its own matches host (focus-safe), never the whole editor.
  function renderVariationRow(v, idx) {
    var sub = modalState.draft.submission;
    var row = el("div", "vcl-bud-brow");

    if (v.type) {
      row.classList.add("vcl-bud-brow--compact"); // single resolved line -> compact, vertically centered
      var main = el("div", "vcl-bud-brow__main");
      if (v.code) {
        var e0 = ENTRIES.find(function (x) { return x.code === v.code; });
        main.innerHTML = '<span class="vcl-bud-picked__code">' + escapeHtml(v.code) + "</span> " + escapeHtml(e0 ? e0.title : "") +
          ' <span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(v.type) + '">' + escapeHtml(v.type) + "</span>";
      } else {
        main.innerHTML = 'Type <span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(v.type) + '">' + escapeHtml(v.type) +
          '</span> <span class="vcl-bud-picked__muted">— no classification code</span>';
      }
      row.appendChild(main);
    } else if (v.code) {
      // Code picked, but its variant isn't chosen -- Guided-Workflow-exact descriptive variant
      // list (label left, type badge right), mirroring vcl-workflow.js buildGroupingRow.
      var e1 = ENTRIES.find(function (x) { return x.code === v.code; });
      var mainC = el("div", "vcl-bud-brow__main");
      mainC.innerHTML = '<span class="vcl-bud-picked__code">' + escapeHtml(v.code) + "</span> " + escapeHtml(e1 ? e1.title : "");
      var chooser = el("div", "vcl-bud-brow__pick vcl-bud-variants");
      (e1 && e1.variants ? e1.variants : []).forEach(function (variant) {
        var opt = el("div", "vcl-bud-variant");
        opt.innerHTML = '<span class="vcl-bud-variant__label">' + escapeHtml(variant.label || (e1 ? e1.title : "")) + "</span> " +
          '<span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(variant.type) + '">' + escapeHtml(variant.type) + "</span>";
        opt.addEventListener("click", function () { v.variantId = variant.id; v.type = variant.type; rerender(); });
        chooser.appendChild(opt);
      });
      mainC.appendChild(chooser);
      row.appendChild(mainC);
    } else {
      // Empty -- search by code/title, or set the type directly (no classification).
      var mainE = el("div", "vcl-bud-brow__main");
      var inp = el("input", "vcl-bud-brow__input");
      inp.type = "text";
      inp.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ...";
      inp.value = v.query || "";
      inp.addEventListener("input", function () { v.query = inp.value; renderMatches(); });
      mainE.appendChild(inp);
      var matches = el("div", "vcl-bud-brow__matches");
      mainE.appendChild(matches);
      var quick = el("div", "vcl-bud-brow__variants");
      quick.innerHTML = '<span class="vcl-bud-hint" style="margin:6px 6px 0 0;">or set the type directly:</span>';
      ["IA", "IB", "II"].forEach(function (t) {
        var b = el("button", "vcl-bud-chip vcl-bud-chip--type vcl-bud-chip--sm",
          "Type " + escapeHtml(t) + ' <span class="vcl-bud-type-badge vcl-bud-type-badge--' + typeBucketClass(t) + '">' + escapeHtml(t) + "</span>");
        b.type = "button";
        b.addEventListener("click", function () { v.type = t; v.code = null; v.variantId = null; rerender(); });
        quick.appendChild(b);
      });
      mainE.appendChild(quick);
      row.appendChild(mainE);
      renderMatches();
      function renderMatches() {
        matches.innerHTML = "";
        var q = (v.query || "").trim().toLowerCase();
        if (!q) return;
        ENTRIES.filter(function (e) {
          return e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1;
        }).slice(0, 6).forEach(function (e) {
          var m = el("button", "vcl-bud-brow__match");
          m.type = "button";
          m.innerHTML = '<span class="vcl-bud-var-row__code">' + escapeHtml(e.code) + "</span> " + escapeHtml(e.title);
          m.addEventListener("click", function () {
            // Single-variant code resolves immediately; else leave it for the variant list.
            v.code = e.code;
            var variants = e.variants || [];
            var only = variants.length === 1 ? variants[0] : null;
            v.variantId = only ? only.id : null;
            v.type = only ? only.type : null;
            rerender();
          });
          matches.appendChild(m);
        });
      }
    }

    var rm = el("button", "vcl-bud-rm", "✕");
    rm.type = "button";
    rm.setAttribute("aria-label", "Remove variation");
    rm.addEventListener("click", function () { sub.variations.splice(idx, 1); rerender(); });
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

  // CMS multi-select for an MRP/DCP procedure -- a GW-style clickable country-code chip grid
  // (mirrors vcl-workflow.js procEditor's vcl-wf-cgrid), NOT checkboxes. The current RMS is
  // excluded. Composite codes ("DE - BfArM") render as the base code + a tiny authority suffix.
  function cmsChips(p) {
    var wrap = el("div", "vcl-bud-field");
    wrap.appendChild(el("label", "vcl-bud-field-label", "CMS (Concerned Member States)"));
    var grid = el("div", "vcl-bud-cgrid");
    countriesByRole("CMS").forEach(function (c) {
      if (c.cc === p.rms) return; // the RMS cannot also be a CMS
      var on = (p.cms || []).indexOf(c.cc) !== -1;
      var m = /^([A-Za-z]{2})\s*[-–]\s*(.+)$/.exec(c.cc);
      var label = m ? escapeHtml(m[1]) + '<span class="vcl-bud-cc__sfx">' + escapeHtml(m[2]) + "</span>" : escapeHtml(c.cc);
      var chip = el("button", "vcl-bud-cc-chip-btn" + (on ? " is-on" : ""), label);
      chip.type = "button";
      chip.title = c.name || c.cc;
      chip.addEventListener("click", function () {
        if (on) p.cms = p.cms.filter(function (x) { return x !== c.cc; });
        else if (p.cms.indexOf(c.cc) === -1) p.cms.push(c.cc);
        refreshEditor();
      });
      grid.appendChild(chip);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // Inner content of one procedure: the kind chips (National / MRP-DCP / CP) + the country-level
  // fields for the chosen kind. Shared by the base procedure (rendered inline under "Procedure",
  // GW-style) and by each additional procedure card (in WS/SG).
  function procedureBody(host, p) {
    var sub = modalState.draft.submission;
    host.appendChild(procKindChips(p));
    if (p.kind === "national") {
      // EU-only national list once a multi-procedure / annual-update strategy is active.
      var euOnly = SUB.multiProcedureMode(sub) || SUB.auActive(sub);
      var natList = countriesByRole("national").filter(function (c) {
        return !euOnly || NON_EU_PROCEDURE_COUNTRIES.indexOf(c.cc) === -1;
      });
      host.appendChild(countrySelectField("Country", natList, p.nat, function (cc) { p.nat = cc; refreshEditor(); }));
    } else if (p.kind === "mrpdcp") {
      host.appendChild(countrySelectField("RMS (Reference Member State)", countriesByRole("RMS"), p.rms, function (cc) {
        p.rms = cc; p.cms = (p.cms || []).filter(function (x) { return x !== cc; }); refreshEditor();
      }));
      host.appendChild(cmsChips(p));
      host.appendChild(el("p", "vcl-bud-hint", "Each selected CMS is charged its own national fee. The RMS cannot also be a CMS."));
    } else if (p.kind === "cp") {
      host.appendChild(el("p", "vcl-bud-hint", "CP · EMA — centralised procedure, one authority (EMA), no country selection."));
    }
  }

  // An *additional* procedure (procedures[1..], WS/SG only) -- a removable card wrapping the shared
  // procedureBody. The base procedure (procedures[0]) is rendered inline by renderStationB instead.
  function renderProcedureRow(p, idx) {
    var sub = modalState.draft.submission;
    var card = el("div", "vcl-bud-proc-card");
    var head = el("div", "vcl-bud-proc-card__head");
    head.appendChild(el("span", "vcl-bud-proc-card__title", "Procedure " + (idx + 1)));
    var rm = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small vcl-bud-btn--danger", "✕");
    rm.type = "button"; rm.setAttribute("aria-label", "Remove procedure");
    rm.addEventListener("click", function () { sub.procedures.splice(idx, 1); refreshEditor(); });
    head.appendChild(rm);
    card.appendChild(head);
    procedureBody(card, p);
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
    // (refreshEditor, renderEditor, applyModal), not just whenever Station B happens to paint --
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

    // --- 1. Base procedure first (GW order): kind + country, rendered inline under "Procedure". ---
    host.appendChild(el("div", "vcl-bud-section-label", "Procedure"));
    procedureBody(host, sub.procedures[0]);

    // --- 2. Submission type: Worksharing (mixed), or Super-Grouping / Annual Update (all Type IA).
    // Only the applicable option(s) are offered, exactly as the Guided Workflow does. ---
    host.appendChild(el("div", "vcl-bud-section-label", "Submission type"));
    var chips = el("div", "vcl-bud-chips");
    (allIA
      ? [{ mode: "superGrouping", label: "Super-Grouping" }, { mode: "annualUpdate", label: "Annual Update" }]
      : [{ mode: "worksharing", label: "Worksharing" }]
    ).forEach(function (s) {
      var on = sub.mode === s.mode;
      var chip = el("button", "vcl-bud-chip" + (on ? " is-on" : ""), escapeHtml(s.label));
      chip.type = "button";
      chip.addEventListener("click", function () { sub.mode = on ? null : s.mode; refreshEditor(); });
      chips.appendChild(chip);
    });
    host.appendChild(chips);
    host.appendChild(el("p", "vcl-bud-hint", allIA
      ? "Available because every listed variation is Type IA. Super-Grouping shares the change across several authorisations; Annual Update keeps it within this one."
      : "Turn on when the change is shared across several procedures or authorisations. Grouping is applied automatically when you list more than one variation."));
    // With no submission type set, show the DERIVED state (Single / Grouping) as a plain label.
    if (!sub.mode) {
      var dm = SUB.displayMode(sub); // "single" | "grouping"
      var derived = el("div", "vcl-bud-derived");
      derived.innerHTML = "No submission type — priced as <strong>" + escapeHtml(MODE_LABEL[dm]) + "</strong>.";
      host.appendChild(derived);
    }

    // --- 3. Lead + additional procedures (WS / SG only, after the submission type is chosen). ---
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

    // Additional procedures (procedures[1..]) -- only in a multi-procedure submission (WS / SG).
    if (SUB.multiProcedureMode(sub)) {
      host.appendChild(el("div", "vcl-bud-section-label", "Additional procedures"));
      var list = el("div", "vcl-bud-proc-list");
      sub.procedures.slice(1).forEach(function (p, i) { list.appendChild(renderProcedureRow(p, i + 1)); });
      host.appendChild(list);
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

  function renderEditor() {
    var d = modalState.draft;
    var sub = d.submission;
    // Full rerenders (e.g. Station A variation edits) land here without touching Station B, so run
    // the enablement clear BEFORE the body card and the live preview strip are built below.
    normalizeModeEnablement(sub);
    var wrap = el("div", "vcl-bud-editor");

    // Header: a "Budget Planning for <year>" kicker (so the tool identity never disappears while a
    // line is being edited -- the editor is a full takeover of the dashboard) above the New/Edit
    // line title, and a ✕ that cancels back to the dashboard (discarding the draft copy).
    var head = el("div", "vcl-bud-editor__head");
    var titleWrap = el("div");
    var editorYear = new Date().getFullYear() + 1;
    // Same heading as the dashboard/result ("Budget Planning for <year>") so the editor reads as the
    // exact same tool; the New/Edit context becomes the subtitle (the dashboard's subtitle slot).
    titleWrap.appendChild(el("h2", null, 'Budget Planning <span class="vcl-bud-year">for ' + editorYear + "</span>"));
    var subtitle = (modalState.editingId ? "Edit" : "New") + " plan line";
    titleWrap.appendChild(el("p", "vcl-bud-editor__subtitle", escapeHtml(subtitle)));
    head.appendChild(titleWrap);
    var closeBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "✕");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cancel and return to plan");
    closeBtn.addEventListener("click", closeModal);
    head.appendChild(closeBtn);
    wrap.appendChild(head);

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
    // metaRow is appended INSIDE the station card below (above the station heading), not here.

    // Station stepper (A · B · C). Clicking a *reached* dot swaps the body card's content via a
    // targeted refresh (no full container rerender -- nothing about the draft changed). Unreached
    // dots are disabled until forward-navigation opens them (GW-style gating). The dot shows a ✓
    // once the station is complete (and isn't the active one).
    var card = el("div", "vcl-bud-body");
    var stepper = el("div", "vcl-bud-stations");
    var stationButtons = {};
    function paintStepper() {
      STATIONS.forEach(function (s) {
        var btn = stationButtons[s.key];
        var active = modalState.station === s.key;
        var done = modalState.reached[s.key] && stationComplete(s.key, sub) && !active;
        btn.disabled = !modalState.reached[s.key];
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
        if (!modalState.reached[s.key]) return; // gated: can't jump ahead of the wizard
        modalState.station = s.key;
        refreshEditor();
        scrollToTop();
      });
      stationButtons[s.key] = btn;
      stepper.appendChild(btn);
    });
    paintStepper();
    wrap.appendChild(stepper);

    // Body card: the Product / Quarter / Probability meta fields sit at the TOP of the white station
    // card (above the station heading), then a divider. They live OUTSIDE the per-station body host
    // so station navigation (refreshEditor repaints only bodyInner) never wipes them or drops the
    // Product input's focus mid-typing.
    card.appendChild(metaRow);
    card.appendChild(el("div", "vcl-bud-meta-divider"));
    var bodyInner = el("div", "vcl-bud-body__inner");
    card.appendChild(bodyInner);
    stationBody(bodyInner);
    wrap.appendChild(card);

    // Bottom navigation (GW-style): Back on the left; Next on A/B, and the final Add/Save line on
    // C. Repainted in place by refreshEditor -> paintNav so the Next/finish enablement tracks the
    // station's completion live as the user fills it in.
    var nav = el("div", "vcl-bud-nav");
    function paintNav() {
      nav.innerHTML = "";
      var idx = STATION_ORDER.indexOf(modalState.station);
      var back = el("button", "vcl-bud-btn", "← Back");
      back.type = "button";
      back.disabled = idx === 0;
      back.addEventListener("click", function () { advanceStation(-1); });
      nav.appendChild(back);
      if (idx === STATION_ORDER.length - 1) {
        var finish = el("button", "vcl-bud-btn vcl-bud-btn--primary", modalState.editingId ? "Save line" : "+ Add line");
        finish.type = "button";
        finish.disabled = !(stationComplete("A", sub) && stationComplete("B", sub));
        finish.addEventListener("click", applyModal);
        nav.appendChild(finish);
      } else {
        var next = el("button", "vcl-bud-btn vcl-bud-btn--primary", "Next →");
        next.type = "button";
        next.disabled = !stationComplete(modalState.station, sub);
        next.addEventListener("click", function () { advanceStation(1); });
        nav.appendChild(next);
      }
    }
    paintNav();
    wrap.appendChild(nav);

    // Live preview strip
    var strip = el("div", "vcl-bud-live-result");
    wrap.appendChild(strip);
    renderPreviewStrip(strip);

    // De-emphasised summary line
    var summaryP = el("p", "vcl-bud-modal__summary", escapeHtml(summaryLine(d)));
    wrap.appendChild(summaryP);

    // Capture the live host references for refreshEditor()'s targeted (non-full-rerender) updates.
    // Reset on every renderEditor() so they always point at the current DOM nodes.
    modalState.paintStepper = paintStepper;
    modalState.paintNav = paintNav;
    modalState.bodyHost = bodyInner;
    modalState.previewHost = strip;
    modalState.summaryHost = summaryP;

    return wrap;
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
    if (state.expandedId === id) state.expandedId = null;
    saveState();
    rerender();
  }
  function clearPlan() {
    state.lines = [];
    state.resultsById = {};
    state.expandedId = null;
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
        line.product || "", MODE_LABEL[mode] || mode, variationsText(sub), proceduresText(sub),
        line.quarter || "", line.probability, r.complete ? Math.round(r.fee * 100) / 100 : 0,
        r.complete ? Math.round(r.hours.min) : 0, r.complete ? Math.round(r.hours.max) : 0, r.complete ? Math.round(r.hours.expected) : 0,
      ]);
    });
    var wsLines = XLSX.utils.aoa_to_sheet(linesRows);
    XLSX.utils.book_append_sheet(wb, wsLines, "Plan lines");

    var rollupRows = [
      ["Variation fees (EUR)", rollup.totals.fee],
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

  // Only one line's detail is open at a time: opening a different line closes the previous one.
  function toggleExpand(id) {
    state.expandedId = (state.expandedId === id) ? null : id;
    rerender();
  }
  function onTableClick(evt) {
    // An action button (duplicate / edit / delete) takes precedence and never toggles the row.
    var btn = evt.target.closest("button[data-act]");
    if (btn) {
      var trB = btn.closest("tr[data-line-id]");
      var id = trB && trB.dataset.lineId;
      if (btn.dataset.act === "duplicate" && id) duplicateLine(id);
      if (btn.dataset.act === "delete" && id) deleteLine(id);
      if (btn.dataset.act === "edit" && id) openModalFor(id);
      return;
    }
    // Anywhere else on a line row toggles that line's detail (the whole row is the target, not just
    // the chevron). The detail row itself carries no data-line-id, so clicks inside it are ignored.
    var tr = evt.target.closest("tr.vcl-bud-line-row[data-line-id]");
    if (tr && tr.dataset.lineId) toggleExpand(tr.dataset.lineId);
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
    // Hand the Summary's selected variations over as ONE new plan line (all variations as a single
    // Grouping, mirroring the Guided Workflow hand-off). We open the takeover editor on a fresh
    // draft seeded at Station A so the user still completes the procedures/countries the pricing
    // needs -- render() (called right after by the caller via VCL_APP.goTo) paints it. Cancelling
    // discards the draft, so nothing half-priced is left in the plan.
    prefill: function (payload) {
      var vars = (payload && payload.variations) || [];
      var draft = BUD.newLine("line-" + Date.now() + "-" + Math.floor(Math.random() * 1000));
      draft.submission.variations = vars.map(function (v) {
        return { code: v.code || null, variantId: (v.variantId != null ? v.variantId : null), type: v.type || null };
      });
      modalState = {
        editingId: null,
        draft: draft,
        station: "A",
        reached: { A: true, B: false, C: false },
        query: "",
        searchResults: [],
      };
      if (container) rerender();
    },
  };
})();
