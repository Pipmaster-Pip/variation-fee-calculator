// Worksharing / Super-Grouping flow for the Fee Calculator. A self-contained four-station wizard
// (Procedures · Strengths · Variations · Fees) that reuses the SHARED Variations+Procedures editor
// (vcl-proc-editor.js, prefix "vclws" -> gold theme) for Procedures/Strengths and prices Fees through
// the SAME engine the whole toolbox uses (VCL_SUBMISSION.computeSubmissionFees ->
// window.VCLCALC.computeFees). No new fee logic lives here. The classic single/grouping calculator
// (vcl-calc-app.js) is untouched; this is the parallel flow the "Worksharing / Super-Grouping"
// toggle button mounts. See docs/superpowers/specs/2026-10-15-vfc-worksharing-supergrouping-design.md.
(function (root) {
  "use strict";

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
    if (v === null || v === undefined || v === "") return "–";
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  }
  function isBlankVariation(v) { return !v.type && !v.code && !(v.query || "").trim(); }

  // Excel export for the Fees station. Self-contained (does not reuse the classic calculator's
  // exportExcel, which is bound to its appState/res shape): one sheet, a short metadata block, then
  // the per-procedure rows and the grand total. Uses the globally loaded SheetJS when present.
  function exportWsExcel(rows, grandTotal, counts) {
    if (typeof XLSX === "undefined") {
      window.alert("Excel export library not loaded. Please check your internet connection and try again.");
      return;
    }
    var data = [];
    data.push(["Variation Fee Calculator — Worksharing / Super-Grouping"]);
    data.push(["© Dr. Tom Deutschle"]);
    data.push(["www.pharmazulassung.de"]);
    data.push([]);
    data.push(["Calculation date:", new Date()]);
    data.push(["Variations filed - Type IA:", counts.IA]);
    data.push(["Variations filed - Type IB:", counts.IB]);
    data.push(["Variations filed - Type II:", counts.II]);
    data.push([]);
    data.push(["Procedure", "Country", "Code", "Role", "Strengths", "Variations", "Total (EUR)"]);
    rows.forEach(function (r) { data.push([r.proc, r.name, r.cc, r.role, r.strengths, r.variations, r.total]); });
    data.push([]);
    data.push(["Total (EUR):", "", "", "", "", "", grandTotal]);
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
    ws["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Worksharing Fees");
    XLSX.writeFile(wb, "worksharing-fees.xlsx");
  }

  // Same engines bundle the Guided Workflow and Budget inject -- the shared Excel-formula engine plus
  // the orchestration helpers. Keeps all three tools on one source of fee truth.
  function engines() {
    return {
      SUB: root.VCL_SUBMISSION,
      computeFees: root.VCLCALC && root.VCLCALC.computeFees,
      adminFeeFor: root.VCLCALC && root.VCLCALC.adminFeeFor,
      processFeeFor: root.VCLCALC && root.VCLCALC.processFeeFor,
      processFeeFlatFor: root.VCLCALC && root.VCLCALC.processFeeFlatFor,
      countries: (root.VCLCALC && root.VCLCALC.countries) ? root.VCLCALC.countries() : [],
      feeRows: (root.VCLCALC_DATA && root.VCLCALC_DATA.FEE_ROWS) || [],
      itWsFees: (root.VCLCALC && root.VCLCALC.effectiveItWsFees) ? root.VCLCALC.effectiveItWsFees() : ((root.VCLCALC_DATA && root.VCLCALC_DATA.IT_WS_FEES) || null),
      workload: root.VCL_WORKLOAD_HOURS,
      workloadData: root.VCL_WORKLOAD_HD,
      sgLogic: root.VCL_SG_LOGIC,
    };
  }

  // Station order (user redesign 2026-10-16): Procedures -> Strengths -> Variations -> Fees.
  // The key letters stay bound to their submission sub-objects (A=variations, B=procedures,
  // C=strengths, D=fees) so the gating code is unchanged; only the sequence and labels move.
  var STATIONS = [
    { key: "B", label: "Procedures" },
    { key: "C", label: "Strengths" },
    { key: "A", label: "Variations" },
    { key: "D", label: "Fees" },
  ];
  var STATION_ORDER = ["B", "C", "A", "D"];

  function freshState() {
    return {
      station: "B",
      currencyMode: "eur",       // Fees station EUR / local-currency toggle
      reached: { B: true, C: false, A: false, D: false },
      submission: {
        mode: null,
        variations: [{ code: null, variantId: null, type: null, query: "" }],
        procedures: [{ kind: "national", nat: null, rms: null, cms: [] }],
        lead: null,
        strengths: { default: 1, overrides: {} },
        // The engine reads specials.line / specials.ws (keyed "cc|role") and specials.lead; it
        // indexes them directly, so the sub-objects must exist even when empty (an {} here crashes
        // wsSpecialFor with "cannot read 'AT|CMS' of undefined" as soon as a CMS is priced).
        specials: { line: {}, ws: {}, lead: null },
        raTasks: {},
      },
    };
  }

  var container = null;      // the host element this flow renders into
  var onExit = null;         // optional callback the shell wires to the "Classic Calculator" toggle
  var state = freshState();
  var procEditor = null;     // shared Variations+Procedures editor (prefix "vclws")

  function getProcEditor() {
    if (!procEditor && root.VCL_PROC_EDITOR) {
      procEditor = root.VCL_PROC_EDITOR.create({
        prefix: "vclws",
        getSub: function () { return state.submission; },
        engines: engines,
        onChange: rerender,       // chips/selects -> full repaint (no focus-sensitive input in play)
        onFullRerender: rerender, // variation picks/steppers -> full repaint
        autoMode: true,           // derive mode from variations, hide submission-type chips, show strengths
        leadFirst: true,          // WS redesign: lead (RMS) select at the top of the Procedures station
        boxFirstProcedure: true,  // procedure 1 in the same boxed card as the additional ones
        cmsSelectAll: true,       // Select all / Reset toggle after the CMS grid
      });
    }
    return procEditor;
  }

  var SUB = function () { return root.VCL_SUBMISSION; };

  // ---- station gating (mirrors the shared editor's rules, minus the Product/RA-tasks stations) ----
  function stationComplete(key, sub) {
    var S = root.VCL_SUBMISSION;
    if (key === "A") {
      // Every variation carries a type; a wholly-blank trailing row is the open search form, not a
      // variation (dropped on pricing), so it does not block completion.
      return sub.variations.length > 0 && sub.variations.every(function (v, i) { return !!v.type || (i >= 1 && isBlankVariation(v)); });
    }
    if (key === "B") {
      // A worksharing / super-grouping shares a change across at least TWO procedures/authorisations.
      // A single procedure (even one MRP/DCP with many CMS) is not WS/SG -- that is the classic
      // calculator -- so Next stays disabled until a second procedure is added.
      if (sub.procedures.length < 2) return false;
      var procsOk = sub.procedures.every(function (p) {
        return p.kind === "cp" || (p.kind === "national" && p.nat) || (p.kind === "mrpdcp" && p.rms);
      });
      var leadOk = !!sub.lead; // leadPricingActive is always true here (mode auto-set)
      return procsOk && leadOk;
    }
    return true; // C (Strengths) and D (Fees) are always reachable once B is complete
  }

  function advanceStation(dir) {
    var i = STATION_ORDER.indexOf(state.station);
    var j = i + dir;
    if (j < 0 || j >= STATION_ORDER.length) return;
    if (dir > 0 && !stationComplete(state.station, state.submission)) return;
    var key = STATION_ORDER[j];
    if (dir > 0) state.reached[key] = true;
    state.station = key;
    rerender();
    scrollToTop();
  }

  function scrollToTop() {
    if (root.VCL_APP && root.VCL_APP.scrollToContentTop) { root.VCL_APP.scrollToContentTop(); return; }
    if (container && container.scrollIntoView) container.scrollIntoView({ block: "start" });
  }

  // ---- Station C: Fees -- priced through computeSubmissionFees, shown in the calculator's style ----
  function fmtLocal(v, ccy) {
    try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return (Math.round(v * 100) / 100) + " " + ccy; }
  }
  function roleLabel(r) { return r === "national" ? "National" : r === "RMS" ? "RMS" : r === "CMS" ? "CMS" : r === "EMA" ? "EMA (CP)" : (r || "—"); }
  function ccShort(cc) { return String(cc).split(/[^A-Za-z]/)[0].toUpperCase(); }

  function kindLabel(p) { return p.kind === "mrpdcp" ? "MRP / DCP" : (p.kind === "cp" ? "CP" : "National"); }
  function procCcList(p) {
    var out = [];
    if (p.kind === "national") { if (p.nat) out.push(p.nat); }
    else if (p.kind === "mrpdcp") { if (p.rms) out.push(p.rms); (p.cms || []).forEach(function (c) { out.push(c); }); }
    else if (p.kind === "cp") { var e = root.VCL_SUBMISSION.emaCc(engines()); if (e) out.push(e); }
    return out;
  }
  function varSummary(sub) {
    var c = root.VCL_SUBMISSION.feeCounts(sub);
    return ["IA", "IB", "II"].filter(function (t) { return c[t] > 0; }).map(function (t) { return c[t] + " × " + t; }).join(", ");
  }

  // Station D: Fees -- grouped BY PROCEDURE in the calculator's recognisable .vres layout. An
  // Overview table (per procedure: its countries with role, strengths, variations, total) and a
  // Details section (per procedure: a card per country with its fee components). Priced via the
  // shared engine (computeSubmissionFees .details); a pricing edge case shows a message.
  function renderFees(host) {
    var sub = state.submission;
    var SUB = root.VCL_SUBMISSION;
    var mode = state.currencyMode || "eur";
    var res;
    try { res = SUB.computeSubmissionFees(sub, engines()); }
    catch (e) {
      if (window.console && console.error) console.error("WS/SG fee computation failed:", e);
      host.appendChild(el("div", "vclws-body__title", modeLabel(sub) + " Fee"));
      host.appendChild(el("p", "vclws-hint vclws-hint--req", "The fee could not be computed for this combination — please review the procedures, or go back a step."));
      return;
    }
    var details = (res && res.details) || [];
    var nameByCc = {};
    engines().countries.forEach(function (c) { nameByCc[c.cc] = c.name; });
    var modeLbl = modeLabel(sub);

    host.appendChild(el("div", "vclws-body__title", escapeHtml(modeLbl) + " Fee"));
    host.appendChild(el("div", "vclws-body__sub", "Official authority fees for this " + escapeHtml(modeLbl.toLowerCase()) + ", grouped by procedure."));

    if (!details.length) { host.appendChild(el("p", "vclws-hint", "Complete the variations and procedures to see the fee.")); return; }

    var anyForeign = details.some(function (d) { return d.currency; });
    function money(d, v) { return (mode === "local" && d.currency && d.fxRate != null) ? fmtLocal(v * d.fxRate, d.currency) : fmtEUR(v); }
    function compMoney(d, c) { if (mode === "local" && c.currency && c.local != null) return fmtLocal(c.local, c.currency); return money(d, c.eur); }

    // Group the (deduped) per-country details by the procedure each country first appears in.
    var detByCc = {}; details.forEach(function (d) { detByCc[d.cc] = d; });
    var assigned = {}; var groups = [];
    sub.procedures.forEach(function (p, i) {
      var ccs = procCcList(p).filter(function (cc) { if (assigned[cc] || !detByCc[cc]) return false; assigned[cc] = 1; return true; });
      if (ccs.length) groups.push({ i: i, p: p, ccs: ccs });
    });
    var leftover = details.filter(function (d) { return !assigned[d.cc]; });
    if (leftover.length) groups.push({ i: -1, p: null, ccs: leftover.map(function (d) { return d.cc; }) });

    var varSum = varSummary(sub);
    var nVar = SUB.feeCountsTotal(SUB.feeCounts(sub));
    function grpLabel(g) { return g.i < 0 ? "Lead / other" : ("Procedure " + (g.i + 1) + " · " + kindLabel(g.p)); }

    // Flat rows for the Excel export, in the same procedure order as the overview.
    var exportRows = [];
    groups.forEach(function (g) {
      g.ccs.forEach(function (cc) {
        var d = detByCc[cc];
        exportRows.push({ proc: grpLabel(g), name: nameByCc[cc] || cc, cc: cc, role: roleLabel(d.role),
          strengths: SUB.strengthsFor(sub, cc), variations: varSum, total: d.total });
      });
    });

    var toggle = anyForeign
      ? '<div class="vres-curtoggle" role="group" aria-label="Currency"><button type="button" class="vres-ct' + (mode === "eur" ? " on" : "") + '" data-cmode="eur">EUR</button><button type="button" class="vres-ct' + (mode === "local" ? " on" : "") + '" data-cmode="local">Local currency</button></div>'
      : "";
    // Print + Excel, same look as the classic calculator's result step (btn-export, SVG icons).
    var PRINT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    var EXCEL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
    var headtools = '<div class="vres-headtools">'
      + '<button type="button" class="btn-export" data-ws-print>' + PRINT_SVG + 'Print</button>'
      + '<button type="button" class="btn-export" data-ws-excel>' + EXCEL_SVG + 'Export Excel</button>'
      + toggle + '</div>';

    // Per-type breakdown per country, via the classic calculator's own engine (VCLCALC.countryBreakdown),
    // so the detail cards and the overview's Mechanic column read exactly like the Fee Calculator.
    function bdFor(d) {
      var E = engines();
      var isLead = SUB.leadPricingActive(sub) && d.cc === sub.lead;
      var role = d.role;
      var sp = {
        IA: isLead ? SUB.leadSpecial(sub, E, "IA") : SUB.wsSpecialFor(sub, d.cc, role, E, "IA"),
        IB: isLead ? SUB.leadSpecial(sub, E, "IB") : SUB.wsSpecialFor(sub, d.cc, role, E, "IB"),
        II: isLead ? SUB.leadSpecial(sub, E, "II") : SUB.wsSpecialFor(sub, d.cc, role, E, "II"),
      };
      var cfg = { role: role, strengths: SUB.strengthsFor(sub, d.cc), specialByType: sp };
      try { return (root.VCLCALC && root.VCLCALC.countryBreakdown) ? root.VCLCALC.countryBreakdown(d.cc, cfg, SUB.feeCounts(sub)) : null; }
      catch (e) { return null; }
    }
    var bdByCc = {}; details.forEach(function (d) { bdByCc[d.cc] = bdFor(d); });

    function mechChipHtml(bd) {
      if (!bd || bd.mechanic === "none") return '<span class="vres-chip vres-chip--none">&ndash;</span>';
      if (bd.mechanic === "cap") return '<span class="vres-chip vres-chip--cap">Cap</span>';
      return '<span class="vres-chip">' + (SUB.sgActive(sub) ? "Super-Grouping Fee" : "Grouping Fee") + "</span>";
    }
    // The lead authority is flagged as "Lead RMS" (etc.) in the Role column so it is not mistaken for
    // a plain RMS/CMS of a procedure.
    function roleLabelFor(cc, role) {
      var base = roleLabel(role);
      return (SUB.leadPricingActive(sub) && cc === sub.lead) ? "Lead " + base : base;
    }
    function perAddCell(d, v, str) {
      if (v == null) return "&ndash;";
      var addMult = (str || 1) - 1;
      return (addMult > 1 && v > 0.005) ? money(d, v) + ' <span class="vres-mult">&times; ' + addMult + "</span>" : money(d, v);
    }

    var defStr = Math.max(1, parseInt(sub.strengths.default, 10) || 1);
    function ovRow(d) {
      return '<tr data-ovrow="' + escapeHtml(d.cc) + '" tabindex="0"><td><span class="vres-ovname"><span class="badge vres-ovcode">' + escapeHtml(ccShort(d.cc)) + "</span>" + escapeHtml(nameByCc[d.cc] || d.cc) + "</span></td>"
        + "<td>" + escapeHtml(roleLabelFor(d.cc, d.role)) + "</td>"
        + "<td>" + SUB.strengthsFor(sub, d.cc) + "</td>"
        + "<td>" + escapeHtml(varSum) + "</td>"
        + "<td>" + mechChipHtml(bdByCc[d.cc]) + "</td>"
        + '<td class="vres-ovmoney">' + money(d, d.total) + "</td></tr>";
    }
    // MRP/DCP procedures are summarised to ONE row in the overview (the RMS named + the CMS count +
    // the procedure's total), instead of listing every CMS; the exact per-country strengths and fees
    // are in the Details section below. The strengths cell shows the submission default, flagged.
    function collapsedMrpRow(g) {
      var rms = g.p.rms;
      var total = g.ccs.reduce(function (a, cc) { return a + (detByCc[cc] ? detByCc[cc].total : 0); }, 0);
      var cmsCount = g.ccs.filter(function (cc) { return cc !== rms; }).length;
      var isLead = rms === sub.lead;
      // Country cell: the pill, then "RMS <name> + N CMS" on one line (the RMS role word moves here);
      // the Role column names the procedure kind (MRP / DCP), which reads clearer than a lone "RMS".
      var nameLine = (isLead ? "Lead RMS " : "RMS ") + escapeHtml(nameByCc[rms] || rms) + (cmsCount > 0 ? " + " + cmsCount + " CMS" : "");
      return '<tr data-ovrow="' + escapeHtml(rms) + '" tabindex="0"><td><span class="vres-ovname"><span class="badge vres-ovcode">' + escapeHtml(ccShort(rms)) + "</span>" + nameLine + "</span></td>"
        + "<td>MRP / DCP</td>"
        + "<td>" + defStr + ' <span class="vclws-ovstar">*</span></td>'
        + "<td>" + escapeHtml(varSum) + "</td>"
        + "<td>&ndash;</td>"
        + '<td class="vres-ovmoney">' + fmtEUR(total) + "</td></tr>";
    }
    var anyCollapsed = false;
    var ovBody = groups.map(function (g) {
      var header = '<tr class="vclws-ovproc"><td colspan="6">' + escapeHtml(grpLabel(g)) + "</td></tr>";
      if (g.p && g.p.kind === "mrpdcp" && g.p.rms) { anyCollapsed = true; return header + collapsedMrpRow(g); }
      return header + g.ccs.map(function (cc) { return ovRow(detByCc[cc]); }).join("");
    }).join("");
    var nProc = groups.length;
    var overview = '<div class="vclws-res-head"><h3 class="vclws-res-h">Overview - fees for procedures</h3>' + headtools + "</div>"
      + '<div class="vres-ovwrap"><table class="vres-ov vclws-ov"><thead><tr><th>Country</th><th>Role</th><th>Strengths</th><th>Variations</th><th>Mechanic</th><th>Total</th></tr></thead><tbody>'
      + ovBody + '</tbody><tfoot><tr><td colspan="5">Total — ' + nProc + " " + (nProc === 1 ? "procedure" : "procedures") + "</td><td>" + fmtEUR(res.total) + "</td></tr></tfoot></table></div>"
      + (anyCollapsed ? '<p class="vclws-ovnote"><span class="vclws-ovstar">*</span> Default strength — individual CMS may have different strengths; see the details below.</p>' : "");

    function card(d) {
      var bd = bdByCc[d.cc];
      var caption = (mode === "local" && d.currency && d.fxRate != null) ? "" : (d.currency ? '<span class="vres-eq">EUR equivalent</span>' : "");
      var str = SUB.strengthsFor(sub, d.cc);
      var meta = escapeHtml(roleLabelFor(d.cc, d.role)) + " · " + str + " strength" + (str === 1 ? "" : "s") + " · " + nVar + " variation" + (nVar === 1 ? "" : "s");
      var head = '<div class="vres-cty" data-ctycard="' + escapeHtml(d.cc) + '"><div class="vres-top"><div><div class="vres-name">' + escapeHtml(nameByCc[d.cc] || d.cc) + ' <span class="badge">' + escapeHtml(d.cc) + "</span></div>"
        + '<div class="vres-meta">' + meta + "</div></div>"
        + '<div class="vres-total">' + caption + (bd && bd.mechanic !== "none" ? mechChipHtml(bd) : "") + '<span class="vres-amt">' + money(d, d.total) + "</span></div></div>";
      // No per-type breakdown available -> fall back to the component table.
      if (!bd || !bd.types || !bd.types.length) {
        var comps = (d.components || []).map(function (c) { return "<tr><td>" + escapeHtml(c.label) + '</td><td class="vres-num">' + compMoney(d, c) + "</td></tr>"; }).join("");
        return head + '<table class="vres-tbl"><thead><tr><th>Fee component</th><th>Amount</th></tr></thead><tbody>' + comps + "</tbody>"
          + '<tfoot><tr><td>Country subtotal</td><td class="vres-num">' + money(d, d.total) + "</td></tr></tfoot></table></div>";
      }
      var rowsHtml = bd.types.map(function (ty) {
        var scText = ty.special ? escapeHtml(ty.special) : (ty.variants ? "standard" : "&ndash;");
        var scClass = ty.special ? "vres-sc" : "vres-sc vres-sc--std";
        var inclNote = (ty.incl && bd.mechanic !== "grouping") ? ' <span class="vres-subnote">&middot; no extra fee</span>' : "";
        return '<tr class="vres-trow"><td><span class="vres-var"><span class="vres-caret vres-caret--none"></span>' + typeBadgeHtml(ty.type) + '<span class="vres-cnt">' + ty.count + "&times;</span> Type " + ty.type + inclNote + "</span></td>"
          + '<td class="' + scClass + '">' + scText + "</td>"
          + '<td class="vres-num">' + money(d, ty.base) + "</td>"
          + '<td class="vres-num">' + perAddCell(d, ty.perAdd, str) + "</td>"
          + '<td class="vres-num">' + money(d, ty.line) + "</td></tr>";
      }).join("");
      // Once-per-application fees + adjustments (admin, AIFA, process, and the lead's flat process
      // fee folded into its lead-fee component) sit below the per-type rows and fold into the subtotal.
      var variationSum = bd.types.reduce(function (a, ty) { return a + ty.line; }, 0);
      var extraComps = (d.components || []).filter(function (c) { return /Administrative|AIFA|Process/i.test(c.label); });
      var knownExtra = extraComps.reduce(function (a, c) { return a + (c.eur || 0); }, 0);
      // A genuine flat add-on (e.g. Finland's one-off worksharing process fee, folded into the lead
      // component) shows as its own row. For a grouping/cap country the per-type lines are 0 by
      // design and the whole fee is the subtotal (with the note below), so NO reconciliation row is
      // added there -- otherwise the grouping fee would be mislabelled as a process fee.
      var leadFlat = (d.total || 0) - variationSum - knownExtra;
      var feeArr = extraComps.slice();
      if (leadFlat > 0.005 && bd.mechanic === "none") feeArr.push({ label: (SUB.sgActive(sub) ? "Super-Grouping" : "Worksharing") + " process fee (once per application)", eur: leadFlat });
      var feeRowsHtml = feeArr.map(function (c) { return '<tr class="vres-feerow"><td colspan="4">' + escapeHtml(c.label) + '</td><td class="vres-num">' + compMoney(d, c) + "</td></tr>"; }).join("");
      var note = bd.mechanic === "grouping" ? ' <span class="vres-fnote vres-fnote--grp">&middot; all variations covered by one ' + (SUB.sgActive(sub) ? "super-grouping" : "grouping") + ' fee</span>'
        : (bd.mechanic === "cap" ? ' <span class="vres-fnote vres-fnote--cap">&middot; Cap fee applies</span>' : "");
      return head + '<table class="vres-tbl' + ((bd.mechanic === "cap" || bd.mechanic === "grouping") ? " vres-tbl--indicative" : "") + '"><thead><tr><th>Variation</th><th>Special case</th><th>Base fee</th><th>Per add. strength</th><th>Line total</th></tr></thead>'
        + "<tbody>" + rowsHtml + feeRowsHtml + "</tbody>"
        + '<tfoot><tr><td colspan="4">Country subtotal' + note + "</td>" + '<td class="vres-num">' + money(d, d.total) + "</td></tr></tfoot></table></div>";
    }
    var detailsHtml = '<div class="vclws-res-head vclws-res-head--details"><h3 class="vclws-res-h">Details - fees for procedures</h3></div>'
      + groups.map(function (g) {
          return '<div class="vclws-res-prochead">' + escapeHtml(grpLabel(g)) + "</div>" + g.ccs.map(function (cc) { return card(detByCc[cc]); }).join("");
        }).join("");

    var wrap = el("div", "vclws-res");
    wrap.innerHTML = overview + detailsHtml
      + '<div class="vres-grand"><span class="vres-grand-l">Total' + (anyForeign ? " (EUR)" : "") + '</span><span class="vres-grand-r">' + fmtEUR(res.total) + "</span></div>";
    host.appendChild(wrap);

    wrap.querySelectorAll("[data-cmode]").forEach(function (b) { b.addEventListener("click", function () { state.currencyMode = b.getAttribute("data-cmode"); rerender(); }); });
    wrap.querySelectorAll("[data-ws-print]").forEach(function (b) { b.addEventListener("click", function () { window.print(); }); });
    wrap.querySelectorAll("[data-ws-excel]").forEach(function (b) { b.addEventListener("click", function () { exportWsExcel(exportRows, res.total, SUB.feeCounts(sub)); }); });
    // An overview row jumps to that country's detail card below -- scrolled into view and briefly
    // outlined (mirrors the classic calculator's data-ovrow / data-ctycard behaviour).
    wrap.querySelectorAll("[data-ovrow]").forEach(function (row) {
      function jump() {
        var card = wrap.querySelector('[data-ctycard="' + row.getAttribute("data-ovrow").replace(/"/g, '\\"') + '"]');
        if (!card) return;
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("vclws-flash");
        setTimeout(function () { card.classList.remove("vclws-flash"); }, 1400);
      }
      row.addEventListener("click", jump);
      row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(); } });
    });
    host.appendChild(el("p", "vclws-hint", "Grouping cap, worksharing/super-grouping lead pricing, admin and process fees are applied automatically by the shared fee engine."));
  }

  var MODE_LABEL = { worksharing: "Worksharing", superGrouping: "Super-Grouping", annualUpdate: "Annual Update", grouping: "Grouping", single: "Single" };
  function modeLabel(sub) { return MODE_LABEL[root.VCL_SUBMISSION.displayMode(sub)] || "Submission"; }

  // ---- Station: Variations (VFC-style) -- Type IA/IB/II count steppers + Special cases, mirroring
  // the classic calculator's variations step (vcl-calc-app.js renderStepVariations) but writing the
  // Submission draft. No classification-code search (per the 2026-10-16 redesign). The steppers map
  // to code-less variation entries so VCL_SUBMISSION.feeCounts sees the right tally; the Special
  // cases picker writes sub.specials.ws / sub.specials.lead (the first WS UI to do so). ----
  var VAR_TYPES = ["IA", "IB", "II"];
  function typeBadgeHtml(t) {
    var cls = t === "IA" ? "ia" : t === "IB" ? "ib" : "ii";
    return '<span class="vclws-type-badge vclws-type-badge--' + cls + '">' + t + "</span>";
  }
  function typeCountOf(t) {
    return state.submission.variations.filter(function (v) { return v.type === t && !v.code; }).length;
  }
  // Rebuild the variations list to hold `n` code-less entries of type `t`, keeping any coded
  // variations and the other types untouched. feeCounts is order-independent, so a flat list is fine.
  function setTypeCount(t, n) {
    if (n < 0) n = 0;
    var kept = state.submission.variations.filter(function (v) { return v.code || (v.type && v.type !== t); });
    for (var i = 0; i < n; i++) kept.push({ code: null, variantId: null, type: t, query: "" });
    if (!kept.length) kept.push({ code: null, variantId: null, type: null, query: "" });
    state.submission.variations = kept;
  }
  function varStepper(t) {
    var st = el("div", "vclws-num-stepper");
    var dec = el("button", null, "−"); dec.type = "button"; dec.disabled = typeCountOf(t) === 0;
    var inp = el("input"); inp.type = "text"; inp.setAttribute("inputmode", "numeric"); inp.value = String(typeCountOf(t));
    var inc = el("button", null, "+"); inc.type = "button";
    function commit(v) { if (isNaN(v) || v < 0) v = 0; setTypeCount(t, v); rerender(); }
    dec.addEventListener("click", function () { commit(typeCountOf(t) - 1); });
    inc.addEventListener("click", function () { commit(typeCountOf(t) + 1); });
    inp.addEventListener("change", function () { commit(parseInt(inp.value, 10)); });
    st.appendChild(dec); st.appendChild(inp); st.appendChild(inc);
    return st;
  }

  function activeTypesOf(sub) {
    var c = root.VCL_SUBMISSION.feeCounts(sub);
    return VAR_TYPES.filter(function (t) { return c[t] > 0; });
  }
  // Candidate countries for the Special cases panel. Each is a country+role carrying its PER-TYPE
  // fee-category choices (like the classic calculator): a type row appears only where there is a
  // real choice (>= 2 variants, or a variant plus a standard row). Keyed to the exact per-type
  // option/storage rules the engine prices with, so picker and price can never disagree.
  function wsSpecialCandidates(sub) {
    var S = root.VCL_SUBMISSION, E = engines(), out = [], seen = {};
    var types = activeTypesOf(sub);
    if (!types.length) return out;
    function rowsFor(cc, role, isLead) {
      return types.map(function (t) {
        var opts = isLead ? S.leadOptionsForType(sub, cc, role, t, E) : S.wsOptionsForType(cc, role, t, E);
        var hasStd = S.hasStandardRowType(cc, role, t, E);
        if (!(opts.length >= 2 || (opts.length >= 1 && hasStd))) return null;
        var current = isLead ? S.leadSpecial(sub, E, t) : S.wsSpecialFor(sub, cc, role, E, t);
        return { type: t, options: opts, hasStandard: hasStd, current: current };
      }).filter(Boolean);
    }
    S.allPricedProcedures(sub).forEach(function (p) {
      S.procPricedCountries(sub, p, E).forEach(function (x) {
        var key = S.wsSpecialKey(x.cc, x.role);
        if (seen[key]) return; seen[key] = 1;
        var rows = rowsFor(x.cc, x.role, false);
        if (rows.length) out.push({ cc: x.cc, role: x.role, isLead: false, key: key, rows: rows });
      });
    });
    if (S.leadPricingActive(sub) && sub.lead) {
      var lrole = S.leadPricingRole(sub, E);
      var lrows = rowsFor(sub.lead, lrole, true);
      if (lrows.length) out.push({ cc: sub.lead, role: lrole, isLead: true, key: S.wsSpecialKey(sub.lead, lrole), rows: lrows });
    }
    return out;
  }
  // Store a per-type pick as a { IA, IB, II } object on specials.ws[key] / specials.lead.
  function setWsSpecial(sub, cand, type, value) {
    if (cand.isLead) {
      if (!sub.specials.lead || typeof sub.specials.lead !== "object") sub.specials.lead = {};
      sub.specials.lead[type] = value;
    } else {
      var cur = sub.specials.ws[cand.key];
      if (!cur || typeof cur !== "object") { cur = {}; sub.specials.ws[cand.key] = cur; }
      cur[type] = value;
    }
  }
  function renderSpecialCases(host) {
    var sub = state.submission, S = root.VCL_SUBMISSION;
    var cands = wsSpecialCandidates(sub);
    if (!cands.length) return;
    var nameByCc = {}; engines().countries.forEach(function (c) { nameByCc[c.cc] = c.name; });
    var counts = S.feeCounts(sub);
    var panel = el("div", "vclws-sp");
    panel.appendChild(el("div", "vclws-body__title vclws-sp__title", "Special cases"));
    panel.appendChild(el("div", "vclws-body__sub", 'Some countries distinguish between several variants of the same type (e.g. "simple" vs "complex"). Where that applies, pick the variant per type below — countries without that distinction automatically use their standard fee.'));
    cands.forEach(function (cand) {
      var card = el("div", "vclws-sp-card");
      card.appendChild(el("div", "vclws-sp-card__head", escapeHtml(nameByCc[cand.cc] || cand.cc) + ' <span class="vclws-badge">' + escapeHtml(cand.cc) + "</span>" + (cand.isLead ? ' <span class="vclws-sp-lead">lead</span>' : "")));
      var tbl = el("table", "vclws-sp-tbl");
      tbl.innerHTML = "<thead><tr><th>Type</th><th>Applies to</th><th>Variant</th></tr></thead>";
      var tb = el("tbody");
      cand.rows.forEach(function (row) {
        var n = counts[row.type] || 0;
        var tr = el("tr");
        tr.appendChild(el("td", null, typeBadgeHtml(row.type)));
        tr.appendChild(el("td", "vclws-sp-scope", n + " variation" + (n === 1 ? "" : "s")));
        var tdSel = el("td");
        var sel = el("select", "vclws-select");
        if (row.hasStandard) {
          var o0 = el("option", null, "standard"); o0.value = "";
          if (!row.current) o0.selected = true;
          sel.appendChild(o0);
        }
        row.options.forEach(function (o) {
          var opt = el("option", null, escapeHtml(o)); opt.value = o;
          if (o === row.current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener("change", function () { setWsSpecial(sub, cand, row.type, sel.value); rerender(); });
        tdSel.appendChild(sel);
        tr.appendChild(tdSel);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      card.appendChild(tbl);
      panel.appendChild(card);
    });
    host.appendChild(panel);
  }
  function renderVariationsVFC(host) {
    host.appendChild(el("div", "vclws-body__title", "Which variations are being filed?"));
    host.appendChild(el("div", "vclws-body__sub", "Set how many variations of each type are part of this submission. This applies the same way to every procedure."));
    var grid = el("div", "vclws-typegrid");
    VAR_TYPES.forEach(function (t) {
      var card = el("div", "vclws-typecard" + (typeCountOf(t) === 0 ? " is-zero" : ""));
      card.appendChild(el("div", "vclws-typecard__t", "Type " + t + " " + typeBadgeHtml(t)));
      card.appendChild(varStepper(t));
      grid.appendChild(card);
    });
    host.appendChild(grid);
    renderSpecialCases(host);
  }

  // ---- wizard chrome ----
  function renderBody(host) {
    if (state.station === "A") renderVariationsVFC(host);
    else if (state.station === "B") getProcEditor().renderProcedures(host);
    else if (state.station === "C") getProcEditor().renderStrengths(host);
    else renderFees(host);
  }

  function rerender() {
    if (!container) return;
    // Keep gating honest: clear any mode that the current variation mix no longer allows.
    if (getProcEditor()) procEditor.normalizeModeEnablement(state.submission);

    container.innerHTML = "";
    var app = el("div", "vclws-app");

    // Station rail (A · B · C). A reached dot is clickable; it shows ✓ once complete and not active.
    var rail = el("div", "vclws-stations");
    STATIONS.forEach(function (s) {
      var active = state.station === s.key;
      var done = state.reached[s.key] && stationComplete(s.key, state.submission) && !active;
      var btn = el("button", "vclws-station" + (active ? " is-active" : "") + (done ? " is-done" : ""));
      btn.type = "button";
      btn.disabled = !state.reached[s.key];
      btn.appendChild(el("div", "vclws-station__dot", done ? '<span aria-hidden="true">✓</span>' : s.key));
      btn.appendChild(el("div", "vclws-station__label", escapeHtml(s.label)));
      btn.addEventListener("click", function () {
        if (!state.reached[s.key]) return;
        state.station = s.key;
        rerender();
        scrollToTop();
      });
      rail.appendChild(btn);
    });
    app.appendChild(rail);

    // Body card for the active station.
    var card = el("div", "vclws-body");
    var inner = el("div", "vclws-body__inner");
    renderBody(inner);
    card.appendChild(inner);
    app.appendChild(card);

    // Bottom navigation: Back (and Next on A/B; "New calculation" on C).
    var nav = el("div", "vclws-nav");
    var idx = STATION_ORDER.indexOf(state.station);
    var back = el("button", "vclws-btn", "← Back");
    back.type = "button";
    back.disabled = idx === 0;
    back.addEventListener("click", function () { advanceStation(-1); });
    nav.appendChild(back);

    if (idx === STATION_ORDER.length - 1) {
      var restart = el("button", "vclws-btn vclws-btn--primary", "New calculation");
      restart.type = "button";
      restart.addEventListener("click", function () { reset(); });
      nav.appendChild(restart);
    } else {
      var next = el("button", "vclws-btn vclws-btn--primary", "Next →");
      next.type = "button";
      next.disabled = !stationComplete(state.station, state.submission);
      next.addEventListener("click", function () { advanceStation(1); });
      nav.appendChild(next);
    }
    app.appendChild(nav);

    container.appendChild(app);
  }

  function reset() {
    state = freshState();
    if (procEditor) procEditor.resetSearch();
    rerender();
    scrollToTop();
  }

  // Public API. render(host, opts?) mounts the flow; opts.onExit is called by nothing here (the
  // "Classic Calculator" toggle lives in the shell), but is kept so the shell can hand one in.
  function render(host, opts) {
    container = host;
    onExit = (opts && opts.onExit) || null;
    rerender();
  }

  root.VCL_WS = { render: render, reset: reset };
})(typeof window !== "undefined" ? window : this);
