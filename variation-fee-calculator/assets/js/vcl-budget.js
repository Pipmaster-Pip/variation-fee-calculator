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
    // Annual table's origin markers: link = auto (seeded from a variation line), pin = manual
    // (added via "+ Add product"). Same inline-SVG treatment as the row-action icons above, for the
    // same reason -- the 🔗/📌 glyphs they stand in for in prose fall back to tofu on some systems.
    link: SVG + '<path d="M9 17H7a5 5 0 0 1 0-10h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    pin: SVG + '<path d="M20.5 10c0 7-8.5 12-8.5 12s-8.5-5-8.5-12a8.5 8.5 0 0 1 17 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  };

  var plan = BUD.loadPlan(window.localStorage);
  // expandedId: id of the single currently-open detail row (only one line may be open at a time).
  // annualLines: the second "Plan lines" table (annual maintenance fees) -- persisted alongside the
  // variation lines but priced by a wholly separate pure function (computeAnnualRow), so it gets no
  // resultsById cache: each render just calls the (cheap, pure) engine fresh per row.
  var state = { lines: plan.lines, annualLines: plan.annualLines || [], hoursPerHead: plan.hoursPerHead, resultsById: {}, storageOk: true, expandedId: null, sortKey: "quarter", sortDir: "desc", breakdownMode: "combined" };
  var container = null;
  var modalState = null; // null when closed, else { editingId, draft, station, query, searchResults }
  // Annual "Add product" editor (Task 7) -- a second, independent takeover, mutually exclusive with
  // modalState (only one editor is ever open at a time). null when closed, else
  // { editingId, draft, station:"A"|"B", reached:{A,B}, collision:<id>|null }.
  var annualEditor = null;

  // Editor overlay: a single persistent layer (created lazily, parented to the tool's own .vcl-app
  // so its .vcl-app-scoped styles apply and it survives the container.innerHTML wipe on every
  // rerender). overlayShown tracks whether it's currently on screen, so the soft entrance plays only
  // on open -- not on the in-place rebuilds that happen while a line is being edited.
  var overlayHost = null;
  var overlayShown = false;

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

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
      station: "A", // stations editor always opens on Station A (Product)
      // GW-style forward gating: a new line is a wizard (only A reached until each station is
      // completed); an existing line is fully reached so the user can jump A/B/C/D freely.
      reached: id ? { A: true, B: true, C: true, D: true } : { A: true, B: false, C: false, D: false },
      query: "",
      searchResults: [],
    };
    rerender();
  }
  function closeModal() { modalState = null; rerender(); scrollToTop(); }
  // After navigating to a new station (or back to the results) the viewport is still scrolled down at
  // the Next/finish button; bring the top of the tool back into view so the user starts at the top.
  function scrollToTop() {
    // While the overlay is open, "top" means the top of the overlay's own scroll area (the card),
    // not the page behind it.
    if (overlayShown && overlayHost) { overlayHost.scrollTop = 0; return; }
    // Share the toolbox's canonical scroll (offsets the site's fixed nav) when embedded; fall
    // back to the container in the standalone dev harness.
    if (window.VCL_APP && window.VCL_APP.scrollToTop) { window.VCL_APP.scrollToTop(); return; }
    if (container && container.scrollIntoView) container.scrollIntoView({ block: "start" });
  }

  // ---- Editor overlay controller -------------------------------------------------------------
  // The plan-line editor (renderEditor) and the annual "Add product" editor (renderAnnualEditor)
  // are shown inside a shared fixed overlay above the dimmed dashboard. syncOverlay() is called at
  // the tail of every rerender(): it fills the overlay when an editor is open and fades it out when
  // not. A refresh while editing (a search pick, a year change) rebuilds the card in place WITHOUT
  // replaying the entrance -- only the first open animates.
  function ensureOverlayHost() {
    if (overlayHost) return overlayHost;
    var root = (container && container.closest) ? container.closest(".vcl-app") : null;
    overlayHost = el("div", "vcl-bud-overlay");
    overlayHost.setAttribute("aria-hidden", "true");
    // Backdrop click (outside the card) requests a guarded close.
    overlayHost.addEventListener("click", function (e) {
      if (e.target === overlayHost) requestOverlayClose();
    });
    // Escape: dismiss a discard prompt first if one is up, else request a guarded close.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !overlayShown) return;
      var box = overlayHost.querySelector(".vcl-bud-confirm");
      if (box) { if (box.parentNode) box.parentNode.removeChild(box); return; }
      requestOverlayClose();
    });
    (root || document.body).appendChild(overlayHost);
    return overlayHost;
  }

  function syncOverlay() {
    var node = modalState ? renderEditor() : annualEditor ? renderAnnualEditor() : null;
    if (!node) { hideOverlay(); return; }

    var host = ensureOverlayHost();
    var firstOpen = !overlayShown;
    host.innerHTML = "";
    var card = el("div", "vcl-bud-editorcard");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.appendChild(node);
    host.appendChild(card);
    host.setAttribute("aria-hidden", "false");

    if (firstOpen && !prefersReducedMotion()) {
      overlayShown = true;
      // Insert closed, then flip to is-open next frame so the entrance transition runs.
      requestAnimationFrame(function () { host.classList.add("is-open"); });
    } else {
      // Already on screen (an in-place refresh) OR reduced-motion: show at rest, no replay.
      overlayShown = true;
      card.classList.add("is-static");
      host.classList.add("is-open");
    }
  }

  function hideOverlay() {
    if (!overlayHost) return;
    if (!overlayShown) { overlayHost.innerHTML = ""; return; }
    overlayShown = false;
    overlayHost.classList.remove("is-open");
    overlayHost.setAttribute("aria-hidden", "true");
    if (prefersReducedMotion()) { overlayHost.innerHTML = ""; return; }
    // Keep the (now stale) card in place for the fade-out, then clear -- unless it was reopened
    // within the transition window (overlayShown flipped back to true).
    window.setTimeout(function () { if (!overlayShown && overlayHost) overlayHost.innerHTML = ""; }, 300);
  }

  // Does the open editor hold work worth guarding against an accidental dismissal?
  function editorIsDirty() {
    if (modalState) {
      var d = modalState.draft;
      if (!modalState.editingId) {
        var sub = d.submission;
        return !!((d.product && d.product.trim()) || (sub.variations && sub.variations.length));
      }
      var saved = state.lines.find(function (l) { return l.id === modalState.editingId; });
      return saved ? JSON.stringify(saved) !== JSON.stringify(d) : true;
    }
    if (annualEditor) {
      var ad = annualEditor.draft;
      if (!annualEditor.editingId) return !!(ad.product && ad.product.trim());
      var savedA = (state.annualLines || []).find(function (r) { return r.id === annualEditor.editingId; });
      return savedA ? JSON.stringify(savedA) !== JSON.stringify(ad) : true;
    }
    return false;
  }

  // Actually close whichever editor is open (discarding its draft copy).
  function doOverlayClose() {
    if (modalState) closeModal();
    else if (annualEditor) closeAnnualEditor();
  }

  // Guarded close: with unsaved work, ask before discarding; otherwise close straight away.
  function requestOverlayClose() {
    if (overlayHost && overlayHost.querySelector(".vcl-bud-confirm")) return; // prompt already up
    if (!editorIsDirty()) { doOverlayClose(); return; }
    showDiscardConfirm();
  }

  function showDiscardConfirm() {
    var host = ensureOverlayHost();
    var box = el("div", "vcl-bud-confirm");
    var inner = el("div", "vcl-bud-confirm__box");
    inner.appendChild(el("p", "vcl-bud-confirm__msg",
      "Discard your changes? Anything you entered here will be lost."));
    var acts = el("div", "vcl-bud-confirm__actions");
    var keep = el("button", "vcl-bud-btn", "Keep editing"); keep.type = "button";
    keep.addEventListener("click", function () { if (box.parentNode) box.parentNode.removeChild(box); });
    var disc = el("button", "vcl-bud-btn vcl-bud-btn--danger", "Discard"); disc.type = "button";
    disc.addEventListener("click", function () { if (box.parentNode) box.parentNode.removeChild(box); doOverlayClose(); });
    acts.appendChild(keep); acts.appendChild(disc);
    inner.appendChild(acts);
    box.appendChild(inner);
    host.appendChild(box);
    disc.focus();
  }
  function applyModal() {
    // Final guard: never persist a strategy that is no longer allowed for the current variations.
    normalizeModeEnablement(modalState.draft.submission);
    var idx = state.lines.findIndex(function (l) { return l.id === modalState.draft.id; });
    if (idx === -1) state.lines.push(modalState.draft);
    else state.lines[idx] = modalState.draft;
    if (idx === -1 && window.VCL_USAGE) window.VCL_USAGE.track("budget", "finish");
    recomputeLine(modalState.draft);
    seedAnnualForLine(modalState.draft);
    modalState = null;
    saveState();
    rerender();
    scrollToTop();
  }

  // After a variation line is saved, ensure each of its registrations exists once in the annual
  // table. Never duplicates (keyed by registrationKey); auto rows can later be edited/removed.
  function seedAnnualForLine(line) {
    if (!line || !line.product) return;
    var existing = {};
    state.annualLines.forEach(function (a) { existing[a.key] = true; });
    var seeds = BUD.seedAnnualRowsFromSubmission(line.submission, line.product);
    seeds.forEach(function (s) {
      if (!existing[s.key]) {
        s.id = "annual-" + Date.now() + "-" + Math.floor(Math.random() * 1e5);
        state.annualLines.push(s);
        existing[s.key] = true;
      }
    });
  }

  function saveState() {
    var ok = BUD.savePlan(window.localStorage, { version: 3, hoursPerHead: state.hoursPerHead, lines: state.lines, annualLines: state.annualLines });
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

  // Reference / "Last updated" note for the budget headers -- Budget Planning prices the same
  // official fees as the Fee Calculator, so it mirrors the calculator's admin-editable VCL_CONFIG
  // keys with the fee-data date as the fallback (same pattern as the Guided Workflow head).
  function appendCalcRefLines(host, opts) {
    var cfg = window.VCL_CONFIG || {};
    var ref = (cfg.referenceText && cfg.referenceText.calculator) || "Official fee schedules of the respective authorities (EU-27, EMA, CH, IS, NO, UK, RS).";
    host.appendChild(el("p", "ref-line", "Reference: " + escapeHtml(ref)));
    // The overlay editors pass { skipUpdated:true } -- the "Last updated" date belongs on the
    // dashboard, not inside every editor header (keeps the overlay header compact).
    if (opts && opts.skipUpdated) return;
    var upd = (cfg.lastUpdated && cfg.lastUpdated.calculator) || (window.VCLCALC_META && window.VCLCALC_META.lastUpdated) || "see fee schedules";
    host.appendChild(el("p", "ref-updated", "Last updated in Variation Toolbox: " + escapeHtml(upd)));
  }

  // Year choices for a plan line: the current year plus the next two (budgeting usually targets next
  // year, but the current year must be coverable too).
  function budgetYearOptions() {
    var y = new Date().getFullYear();
    return [y, y + 1, y + 2];
  }

  // Dashboard heading year label: the distinct years actually present across the plan lines. A
  // contiguous run collapses to "min–max" (e.g. "2026–2028"); gaps are listed ("2026, 2028"); an
  // empty plan falls back to next year (the default budgeting horizon).
  function planYearLabel() {
    var years = [];
    (state.lines || []).forEach(function (l) {
      if (typeof l.year === "number" && years.indexOf(l.year) === -1) years.push(l.year);
    });
    if (years.length === 0) return String(new Date().getFullYear() + 1);
    years.sort(function (a, b) { return a - b; });
    if (years.length === 1) return String(years[0]);
    var contiguous = years[years.length - 1] - years[0] === years.length - 1;
    return contiguous ? years[0] + "–" + years[years.length - 1] : years.join(", ");
  }

  // Selectable quarters for a given plan year. For the current year only the remaining quarters
  // (from the one we're in) are offered -- you can't plan a submission into a quarter already gone.
  function quartersForYear(year) {
    var now = new Date();
    var start = (year <= now.getFullYear()) ? (Math.floor(now.getMonth() / 3) + 1) : 1;
    var out = [];
    for (var q = start; q <= 4; q++) out.push("Q" + q);
    return out;
  }
  function fmtEUR(v) {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
  }
  // Plain "12,345 CCY" formatting for the annual fee cell's local-currency line (no currency
  // symbol -- fmtEUR already owns the €-prefixed number, this is the muted secondary amount).
  function fmtLocalAmount(v, ccy) {
    return new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(v || 0) + " " + ccy;
  }

  // 1 EUR = X local units, keyed by ISO currency -- the shape computeAnnualRow's fxByCurrency param
  // expects. Reuses the calculator's static FX table (vcl-calc-app.js's own STATIC_FX_RATES fallback
  // is keyed by *country* code, same as here) and, when the calculator already did a same-day live
  // fetch in this browser, its cached live rates (keyed by *currency*, Frankfurter's shape) take
  // precedence -- mirrors vcl-calc-app.js's own getEffectiveRate (live first, static fallback). EUR
  // is implied (factor 1, never entered). STATIC_FX_RATES only covers a handful of currencies (HUF
  // among them), so any annual currency still missing after that (CZK/DKK/ISK/PLN/SEK/GBP typically)
  // is filled from vcl-annual-data.js's own FALLBACK_FX -- live/static always take precedence, the
  // fallback only plugs gaps so an annual row never silently prices to EUR 0 for want of a rate.
  function fxByCurrency() {
    var out = {};
    var D = window.VCLCALC_DATA || {};
    var ccToCcy = D.CC_TO_CURRENCY || {};
    var staticFx = D.STATIC_FX_RATES || {};
    var live = {};
    try {
      var cached = window.localStorage && window.localStorage.getItem("vclcalc_fx_rates");
      if (cached) {
        var parsed = JSON.parse(cached);
        var today = new Date().toISOString().slice(0, 10);
        if (parsed && parsed.date === today && parsed.rates) live = parsed.rates;
      }
    } catch (e) { /* no localStorage, or a malformed cache entry -- the static table still covers it */ }
    Object.keys(ccToCcy).forEach(function (cc) {
      var ccy = ccToCcy[cc];
      if (!ccy || ccy === "EUR" || out[ccy]) return;
      if (live[ccy]) out[ccy] = live[ccy];
      else if (staticFx[cc]) out[ccy] = staticFx[cc];
    });
    var fallbackFx = (window.VCL_ANNUAL_DATA && window.VCL_ANNUAL_DATA.FALLBACK_FX) || {};
    Object.keys(fallbackFx).forEach(function (ccy) {
      if (!out[ccy]) out[ccy] = fallbackFx[ccy];
    });
    return out;
  }

  // The annual reference-data module (COUNTRIES) is optional at parse time (mirrors ENTRIES/DATA
  // above) so this file never throws if it loads before vcl-annual-data.js for any reason.
  function annualCountries() {
    return (window.VCL_ANNUAL_DATA && window.VCL_ANNUAL_DATA.COUNTRIES) || [];
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

  // Sums two sortDesc-shaped breakdown arrays ([{key,value}]) by key and re-sorts desc -- used to
  // fold the annual rollup's byMarket/byProduct into the variation rollup's own, so the dashboard
  // panels show combined agency spend rather than two separate totals.
  function mergeBreakdown(a, b) {
    var map = {};
    (a || []).forEach(function (r) { map[r.key] = (map[r.key] || 0) + r.value; });
    (b || []).forEach(function (r) { map[r.key] = (map[r.key] || 0) + r.value; });
    return Object.keys(map)
      .map(function (k) { return { key: k, value: map[k] }; })
      .sort(function (x, y) { return y.value - x.value; });
  }

  function renderRollupTiles(rollup, annualRollup) {
    var wrap = el("div", "vcl-bud-rollup");

    // Agency fees card (Proposal 2): one-off variation fees + recurring annual maintenance fees,
    // stacked as three rows with a divider before the combined "Total this year".
    var agencyTile = el("div", "vcl-bud-tile vcl-bud-agency");
    agencyTile.appendChild(el("p", "vcl-bud-tile__label", "Agency fees · " + escapeHtml(planYearLabel())));
    var totalThisYear = rollup.totals.fee + annualRollup.totalEur;
    var rowsHtml =
      '<div class="vcl-bud-agency__row"><span>Variations</span><span class="vcl-bud-agency__val">' +
      escapeHtml(fmtEUR(rollup.totals.fee)) + "</span></div>" +
      '<div class="vcl-bud-agency__row"><span>Annual fee</span><span class="vcl-bud-agency__val">' +
      escapeHtml(fmtEUR(annualRollup.totalEur)) + "</span></div>" +
      '<div class="vcl-bud-agency__divider"></div>' +
      '<div class="vcl-bud-agency__row vcl-bud-agency__row--total"><span>Total this year</span><span class="vcl-bud-agency__val">' +
      escapeHtml(fmtEUR(totalThisYear)) + "</span></div>";
    agencyTile.appendChild(el("div", "vcl-bud-agency__rows", rowsHtml));
    wrap.appendChild(agencyTile);

    var hoursTile = el("div", "vcl-bud-tile");
    // Same "· year" suffix as the fees tile: all three tiles report the same plan year, and
    // saying so on only one of them left the other two looking like portfolio-wide constants.
    hoursTile.appendChild(el("p", "vcl-bud-tile__label", "Annual RA hours · " + escapeHtml(planYearLabel())));
    hoursTile.appendChild(el("p", "vcl-bud-tile__value", Math.round(rollup.totals.hoursExpected) + " h"));
    hoursTile.appendChild(el("p", "vcl-bud-tile__sub",
      "Range " + Math.round(rollup.totals.hoursMin) + " – " + Math.round(rollup.totals.hoursMax) + " h (min–max)"));
    wrap.appendChild(hoursTile);

    var fte = BUD.computeFte(rollup.totals.hoursExpected, state.hoursPerHead);
    var fteTile = el("div", "vcl-bud-tile vcl-bud-tile--fte");
    fteTile.appendChild(el("p", "vcl-bud-tile__label", "FTE required · " + escapeHtml(planYearLabel())));
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

  function renderBreakdownPanel(title, rows, total, mode, color) {
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
      if (color) fill.style.background = color; // per-mode bar colour (Variations / Annual / Combined)
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
  function hBand(mm) { if (!mm) return "—"; var lo = hNum(mm.min), hi = hNum(mm.max); return lo === hi ? lo + " h" : lo + " – " + hi + " h"; }

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
      var qual = annualMarketQualifier(c);
      var lbl = '<span class="vcl-bud-cc">' + escapeHtml(c.cc) + "</span>" +
        (qual ? ' <span class="vcl-bud-annual__track">' + escapeHtml(qual) + "</span>" : "");
      itm.appendChild(el("span", null, lbl));
      var priced = (c.status === "ok" || c.status === "needs-pick");
      itm.appendChild(el("span", "vcl-bud-detail__h", priced ? escapeHtml(fmtEUR(c.amountEur)) : "—"));
      left.appendChild(itm);
      if (c.ccy && c.ccy !== "EUR" && (c.status === "ok" || c.status === "needs-pick" || c.status === "no-rate")) {
        var sub = el("div", "vcl-bud-detail__sub");
        sub.appendChild(el("span", null, "in local currency"));
        sub.appendChild(el("span", null, escapeHtml(c.cc + " " + fmtLocalAmount(c.amountLocal, c.ccy))));
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

  function renderTable(rollup) {
    var wrap = el("div");
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, "Plan lines — Variations"));
    wrap.appendChild(head);

    var tableWrap = el("div", "vcl-bud-table-wrap");
    var table = el("table", "vcl-bud-table");
    // Column widths: Product gets more room (long names were overrunning Mode), Procedures is
    // narrower now that each procedure sits on its own compact line, and Variations gets a touch
    // more for the single-row aggregated badges. <col> hints; auto table-layout still lets cells grow.
    function sortArrow(key){
      if (state.sortKey !== key) return "";
      return '<span class="vcl-bud-sortarrow" aria-hidden="true">' + (state.sortDir === "desc" ? "▾" : "▴") + "</span>";
    }
    table.innerHTML =
      '<colgroup><col style="width:14%"><col style="width:12%"><col style="width:17%">' +
      '<col style="width:17%"><col style="width:6%"><col style="width:9%">' +
      '<col style="width:12%"><col style="width:13%"></colgroup>' +
      "<thead><tr>" +
      '<th class="vcl-bud-sortable" role="button" tabindex="0" data-sort="product">Product' + sortArrow("product") + '</th>' +
      '<th class="vcl-bud-sortable" role="button" tabindex="0" data-sort="mode">Mode' + sortArrow("mode") + '</th>' +
      '<th>Variations</th><th>Procedures</th>' +
      '<th class="vcl-bud-sortable" role="button" tabindex="0" data-sort="quarter">Quarter' + sortArrow("quarter") + '</th>' +
      '<th class="vcl-bud-sortable" role="button" tabindex="0" data-sort="fee" style="text-align:right">Fee' + sortArrow("fee") + '</th>' +
      '<th class="vcl-bud-sortable" role="button" tabindex="0" data-sort="hours" style="text-align:right">Hours (PERT)' + sortArrow("hours") + '</th>' +
      '<th></th></tr></thead>';
    var tbody = el("tbody");
    function sortValue(line, key) {
      switch (key) {
        case "product":
          return String(line.product || "").toLowerCase();
        case "mode":
          return SUB.displayMode(line.submission) || "";
        case "quarter":
          return (line.year || 0) * 10 + (line.quarter ? parseInt(line.quarter.slice(1), 10) || 0 : 0);
        case "fee":
          var r = state.resultsById[line.id];
          return (r && r.complete) ? r.fee : -Infinity;
        case "hours":
          var r = state.resultsById[line.id];
          return (r && r.complete) ? r.hours.expected : -Infinity;
        default:
          return "";
      }
    }
    var indexMap = {};
    state.lines.forEach(function (l, i) { indexMap[l.id] = i; });
    var sortedLines = state.lines.slice();
    sortedLines.sort(function (a, b) {
      var aVal = sortValue(a, state.sortKey);
      var bVal = sortValue(b, state.sortKey);
      var cmp;
      if (typeof aVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = aVal - bVal;
      }
      if (cmp !== 0) cmp = cmp * (state.sortDir === "desc" ? -1 : 1);
      if (cmp === 0) cmp = indexMap[a.id] - indexMap[b.id];
      return cmp;
    });
    sortedLines.forEach(function (line) {
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
          Math.round(r.hours.min) + " – " + Math.round(r.hours.max) + " h)</div></td>"
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
        "<td>" + escapeHtml(line.quarter ? line.quarter + " " + line.year : (line.year ? String(line.year) : "—")) + "</td>" +
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
      '<td class="vcl-bud-num">' + Math.round(rollup.totals.hoursExpected) +
        ' h<div class="vcl-bud-hours-band">(' + Math.round(rollup.totals.hoursMin) + " – " +
        Math.round(rollup.totals.hoursMax) + " h)</div></td>" +
      "<td></td>";
    tfoot.appendChild(totalTr);
    table.appendChild(tfoot);

    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
    return wrap;
  }

  // ---- Annual maintenance-fees table (second "Plan lines" section) ----

  function annualTrackLabel(kind) {
    if (kind === "mrpdcp") return "MRP/DCP";
    if (kind === "cp") return "CP";
    return "national";
  }

  function annualOriginCell(row) {
    var isAuto = row.origin === "auto";
    var cls = "vcl-bud-annual__origin " + (isAuto ? "vcl-bud-annual__origin--auto" : "vcl-bud-annual__origin--manual");
    var label = isAuto ? "Auto (seeded from a variation line)" : "Manual (added via + Add product)";
    return '<span class="' + cls + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' +
      (isAuto ? ICON.link : ICON.pin) + "</span>";
  }

  function annualProductCell(row) {
    var kind = row.procedure && row.procedure.kind;
    return '<span class="vcl-bud-expcell">' + escapeHtml(row.product || "—") +
      ' <span class="vcl-bud-annual__track">· ' + escapeHtml(annualTrackLabel(kind)) + "</span></span>";
  }

  // Markets cell: the registration's procedure rendered in the same plain-text style as the Variations
  // table's Procedures column ("1 × nat. (DE)" / "RMS IT (+ 7 CMS)" / "1 × CP"). The full per-country
  // breakdown lives in the expandable detail row, so the collapsed cell stays compact.
  function annualMarketsCell(row) {
    var proc = (row && row.procedure) || {};
    var line;
    if (proc.kind === "national") {
      var natCc = (proc.countries && proc.countries[0]) ? ccShort(proc.countries[0]) : "?";
      line = "1 × nat. (" + escapeHtml(natCc) + ")";
    } else if (proc.kind === "cp") {
      line = "1 × CP";
    } else if (proc.kind === "mrpdcp") {
      var rms = proc.rms ? ccShort(proc.rms) : "?";
      var n = (proc.countries || []).filter(function (c) { return c !== proc.rms; }).length;
      line = "RMS " + escapeHtml(rms) + " (+ " + n + " CMS)";
    } else {
      return '<span class="vcl-bud-annual__track">—</span>';
    }
    return '<span class="vcl-bud-proc-cell"><span class="vcl-bud-proc-line">' + line + "</span></span>";
  }

  // Muted role/tariff/status qualifier shown next to a market in the EXPANDED annual detail
  // ("RMS", "CMS", "POM – standard", "turnover-based", ...). Returns "" when there's nothing to add
  // (e.g. a plain national/CP market). needs-pick markets show the resolved tariff's own label; plain
  // role-resolved MRP/DCP markets show their role.
  function annualMarketQualifier(c) {
    if (c.status === "turnover") return "turnover-based";
    if (c.status === "no-annual") return "no fee";
    if (c.status === "no-rate") return "rate unavailable";
    if (c.choice) {
      // A genuine tariff choice -- show the picked tariff's own label (survives after the user picks).
      var entry = BUD.findAnnualCountry(annualCountries(), c.cc);
      var picked = entry && entry.tariffs && entry.tariffs.filter(function (t) { return t.id === c.tariffId; })[0];
      return picked && picked.label ? picked.label : "";
    }
    return (c.role === "RMS" || c.role === "CMS") ? c.role : "";
  }

  // Special cases cell: ONLY markets that need a genuine user choice (status "needs-pick") get a
  // control here -- an editable <select> (keeps the data-line-id/data-cc contract for onAnnualChange),
  // with the country in plain text like the Procedures column. Role / turnover / tariff context for
  // every other market is shown in the expandable detail row instead (annualMarketQualifier), next to
  // each country. A row with no genuine choice shows an em dash.
  function annualTariffCell(row, res) {
    var list = res.byCountry || [];
    var countries = annualCountries();
    var lines = [];
    list.forEach(function (c) {
      if (!c.choice) return; // only markets the role doesn't resolve keep an editable <select>
      var entry = BUD.findAnnualCountry(countries, c.cc);
      if (!entry || !entry.tariffs || entry.tariffs.length <= 1) return;
      var opts = entry.tariffs.map(function (t) {
        return '<option value="' + escapeHtml(t.id) + '"' + (t.id === c.tariffId ? " selected" : "") + ">" +
          escapeHtml(t.label) + "</option>";
      }).join("");
      var sel = '<select class="vcl-bud-select vcl-bud-select--tariff" data-line-id="' + escapeHtml(row.id) +
        '" data-cc="' + escapeHtml(c.cc) + '">' + opts + "</select>";
      lines.push(
        '<div class="vcl-bud-annual__scpick"><span class="vcl-bud-annual__scpick-cc">' +
        escapeHtml(ccShort(c.cc)) + "</span>" + sel + "</div>"
      );
    });
    if (!lines.length) return '<span class="vcl-bud-annual__track">—</span>';
    // Its own class on top of the shared one: this list has to span the full cell width so every
    // select ends on the same right edge (.vcl-bud-proc-cell alone shrinks to its content).
    return '<span class="vcl-bud-proc-cell vcl-bud-annual__scpicks">' + lines.join("") + "</span>";
  }

  function renderAnnualTable() {
    var wrap = el("div", "vcl-bud-annual");
    var head = el("div", "vcl-bud-table-head");
    head.appendChild(el("h3", null, 'Plan lines — Annual maintenance fees <span class="vcl-bud-year">for ' + escapeHtml(planYearLabel()) + "</span>"));
    var addWrap = el("div", "vcl-bud-annual__addwrap");
    var addBtn = el("button", "vcl-bud-btn", "+ Add product");
    addBtn.type = "button";
    addBtn.dataset.act = "add-annual";
    addWrap.appendChild(addBtn);
    addWrap.appendChild(el("p", "vcl-bud-annual__addhint",
      "Add a product for which no variation is planned in " + escapeHtml(planYearLabel())));
    head.appendChild(addWrap);
    wrap.appendChild(head);

    var countries = annualCountries();
    var fx = fxByCurrency();

    var tableWrap = el("div", "vcl-bud-table-wrap vcl-bud-table-wrap--annual");
    var table = el("table", "vcl-bud-table");
    table.innerHTML =
      '<colgroup><col style="width:5%"><col style="width:20%"><col style="width:13%">' +
      '<col style="width:11%"><col style="width:28%"><col style="width:14%"><col style="width:9%"></colgroup>' +
      "<thead><tr>" +
      // "Str." spelled out, and the column centred with room on both sides: the top navigation
      // freed the width, and the abbreviation was only ever there because the header collided
      // with "Special cases" next to it.
      '<th></th><th>Product</th><th>Markets</th><th class="vcl-bud-annual__str">Strengths</th>' +
      '<th>Special cases</th><th style="text-align:right">Annual fee</th><th></th>' +
      "</tr></thead>";

    var tbody = el("tbody");
    var totalEur = 0;
    (state.annualLines || []).forEach(function (row) {
      var res = BUD.computeAnnualRow(row, countries, fx);
      totalEur += res.total;
      var feeHtml = escapeHtml(fmtEUR(res.total));
      var expanded = state.expandedId === row.id;
      var tr = el("tr", "vcl-bud-annual-row" + (expanded ? " is-expanded" : ""));
      tr.innerHTML =
        "<td>" + annualOriginCell(row) + "</td>" +
        "<td>" + annualProductCell(row) + "</td>" +
        "<td>" + annualMarketsCell(row) + "</td>" +
        '<td class="vcl-bud-annual__str">' + (row.strengths || 1) + "</td>" +
        "<td>" + annualTariffCell(row, res) + "</td>" +
        '<td class="vcl-bud-num">' + feeHtml + "</td>" +
        '<td class="vcl-bud-row-actions">' +
        '<button type="button" class="vcl-bud-icon-btn" data-act="edit" aria-label="Edit" title="Edit">' + ICON.edit + "</button>" +
        '<button type="button" class="vcl-bud-icon-btn vcl-bud-icon-btn--danger" data-act="delete" aria-label="Delete" title="Delete">' + ICON.del + "</button>" +
        "</td>";
      tr.dataset.lineId = row.id;
      tbody.appendChild(tr);
      if (expanded) tbody.appendChild(renderAnnualDetailRow(row, res));
    });
    table.appendChild(tbody);

    var tfoot = el("tfoot");
    var totalTr = el("tr");
    totalTr.innerHTML =
      '<td colspan="5">Total annual (recurring / yr)</td>' +
      '<td class="vcl-bud-num">' + escapeHtml(fmtEUR(totalEur)) + "</td>" +
      "<td></td>";
    tfoot.appendChild(totalTr);
    table.appendChild(tfoot);

    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    // Origin legend -- explains the 🔗/📌 icon rendered per row above.
    var legend = el("div", "vcl-bud-annual__legend");
    legend.innerHTML =
      '<span class="vcl-bud-annual__legend-item"><span class="vcl-bud-annual__origin vcl-bud-annual__origin--auto">' +
      ICON.link + "</span>auto — seeded from a variation line</span>" +
      '<span class="vcl-bud-annual__legend-item"><span class="vcl-bud-annual__origin vcl-bud-annual__origin--manual">' +
      ICON.pin + "</span>manual — added via + Add product</span>";
    wrap.appendChild(legend);

    return wrap;
  }

  function rerender() {
    if (!container) return;

    container.innerHTML = "";
    if (!state.storageOk) {
      container.appendChild(el("div", "vcl-bud-warn", "Your plan isn't being saved in this browser."));
    }

    // The dashboard is ALWAYS rendered underneath; the plan-line / annual editor now enters as a
    // soft overlay above the dimmed dashboard (syncOverlay, at the end of this function) rather than
    // replacing it -- so the user keeps their bearings, guide-modal style.

    var rollup = BUD.computeRollup(state.lines, state.resultsById);
    var annualRollup = BUD.computeAnnualRollup(state.annualLines, annualCountries(), fxByCurrency());
    var header = el("div", "vcl-bud-header");
    var left = el("div", "vcl-bud-header__intro");
    // The heading names the year(s) the plan actually covers, derived from the lines' own Year field
    // (empty plan falls back to next year, the usual budgeting horizon).
    left.appendChild(el("h2", null, 'Budget Planning <span class="vcl-bud-year">for ' + escapeHtml(planYearLabel()) + "</span>"));
    left.appendChild(el("p", null, "Portfolio-wide annual plan: fees &amp; RA effort across all products and markets."));
    appendCalcRefLines(left);
    header.appendChild(left);
    var actions = el("div", "vcl-bud-header__actions");
    actions.innerHTML =
      '<button type="button" class="vcl-bud-btn" data-act="clear-plan">Clear plan</button>' +
      '<button type="button" class="vcl-bud-btn" data-act="export">⭳ Export to Excel</button>' +
      '<button type="button" class="vcl-bud-btn vcl-bud-btn--primary" data-act="new-line">+ Add variation line</button>';
    header.appendChild(actions);
    container.appendChild(header);

    container.appendChild(renderRollupTiles(rollup, annualRollup));

    // Combined agency-spend view: variation fees + annual maintenance fees, merged by key and
    // re-sorted desc, so By-market/By-product read as one total rather than two disjoint totals.
    var combinedMarket = mergeBreakdown(rollup.byMarket, annualRollup.byMarket);
    var combinedProduct = mergeBreakdown(rollup.byProduct, annualRollup.byProduct);
    var combinedTotal = rollup.totals.fee + annualRollup.totalEur;
    var bdMode = state.breakdownMode || "combined";
    var srcMarket = bdMode === "var" ? rollup.byMarket : bdMode === "ann" ? annualRollup.byMarket : combinedMarket;
    var srcProduct = bdMode === "var" ? rollup.byProduct : bdMode === "ann" ? annualRollup.byProduct : combinedProduct;
    var srcTotal = bdMode === "var" ? rollup.totals.fee : bdMode === "ann" ? annualRollup.totalEur : combinedTotal;

    var bdSection = el("div", "vcl-bud-breakdown-section");
    var bdHead = el("div", "vcl-bud-breakdown-head");
    // "Agency spend breakdown" title removed -- the segment toggle now sits left-aligned on its own.
    // Active segment carries a subtle tint in its own mode's bar colour (Combined plum / Variations
    // budget-red / Annual petrol), so the toggle echoes the chart it drives.
    var segTint = { combined: "rgba(107,85,102,0.14)", "var": "var(--budget-bg)", ann: "rgba(75,138,156,0.16)" };
    var segText = { combined: "#6B5566", "var": "var(--budget)", ann: "#37697A" };
    var segHtml = [["combined", "Combined"], ["var", "Variations"], ["ann", "Annual"]].map(function (m) {
      var on = bdMode === m[0];
      var style = on ? ' style="background:' + segTint[m[0]] + ";color:" + segText[m[0]] + ';font-weight:600"' : "";
      return '<button type="button" class="vcl-bud-seg-btn' + (on ? " is-on" : "") + '"' + style +
        ' data-act="bd-mode" data-mode="' + m[0] + '">' + m[1] + "</button>";
    }).join("");
    bdHead.appendChild(el("div", "vcl-bud-seg", segHtml));
    bdSection.appendChild(bdHead);

    var bdLabelMap = { combined: "Combined", "var": "Variations", ann: "Annual fees" };
    var bdColorMap = { combined: "#6B5566", "var": "var(--budget)", ann: "#4B8A9C" };
    var bdLabel = bdLabelMap[bdMode] || "Combined";
    var bdColor = bdColorMap[bdMode] || "var(--budget)";
    var breakdown = el("div", "vcl-bud-breakdown");
    breakdown.appendChild(renderBreakdownPanel("By market — " + bdLabel, srcMarket, srcTotal, bdMode, bdColor));
    breakdown.appendChild(renderBreakdownPanel("By product — " + bdLabel, srcProduct, srcTotal, bdMode, bdColor));
    bdSection.appendChild(breakdown);
    container.appendChild(bdSection);

    container.appendChild(renderTable(rollup));
    container.appendChild(renderAnnualTable());

    // Editor overlay on top (or fade it out if no editor is open).
    syncOverlay();
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

  // The four stations of the editor. A (Product: product identity + number of strengths + year/
  // quarter/probability) leads, then B (Variations), C (Procedures), D (RA tasks).
  var STATIONS = [
    { key: "A", label: "Product" },
    { key: "B", label: "Variations" },
    { key: "C", label: "Procedures" },
    { key: "D", label: "RA tasks" },
  ];

  var STATION_ORDER = ["A", "B", "C", "D"];

  // Completion gate per station (GW-style): drives the stepper checkmark, the "Next" enablement,
  // and the final "Add/Save line" enablement. A is complete once the product carries a name; B once
  // every variation carries a type (needed to price); C once every *visible* procedure has its
  // authority/country resolved (and, in a WS/SG lead scenario, a lead is chosen); D is always
  // satisfiable (core RA prep is always included, the optional modules are opt-in).
  function stationComplete(key, sub) {
    if (key === "A") { var p = modalState && modalState.draft && modalState.draft.product; return !!(p && p.trim()); }
    if (key === "B") return sub.variations.length > 0 && sub.variations.every(function (v) { return !!v.type; });
    if (key === "C") {
      var procs = SUB.multiProcedureMode(sub) ? sub.procedures : [sub.procedures[0]];
      var procsOk = procs.every(function (p) {
        return p.kind === "cp" || (p.kind === "national" && p.nat) || (p.kind === "mrpdcp" && p.rms);
      });
      var leadOk = !SUB.leadPricingActive(sub) || !!sub.lead;
      // Type-IA-only submissions must choose a bundling mode before the line is complete.
      var modeOk = !SUB.allVariationsAreIA(sub, engines()) || !!sub.mode;
      return procsOk && leadOk && modeOk;
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
      " · " + (sub.lead || "—") + " · " + (d.quarter ? d.quarter + " " + d.year : (d.year || "—"));
  }

  // Dispatches on modalState.station and (re)builds only the body card's contents -- used both
  // for the initial render and by refreshEditor(), which repaints the stepper + body + preview in
  // place rather than tearing down the whole modal.
  // Key -> body mapping. NOTE: the render functions keep their original names from when the wizard
  // was A/B/C; the letters shifted by one when Station A (Product) was prepended, so:
  //   A -> renderStationProduct (product identity + strengths)
  //   B -> renderStationA        (Variations)
  //   C -> renderStationB        (Procedures)
  //   D -> renderStationC        (RA tasks)
  function stationBody(host) {
    host.innerHTML = "";
    if (modalState.station === "A") renderStationProduct(host);
    else if (modalState.station === "B") renderStationA(host);
    else if (modalState.station === "C") renderStationB(host);
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

  // ---- Station A: Product -- product identity + number of strengths, then year/quarter/probability. ----
  // The number of strengths feeds the variation fee now (strength-sensitive countries) and is the
  // basis for the future annual fee. Product name and the strengths input never trigger a body
  // rebuild on keystroke (only paintStepper/paintNav for live gating), so focus/caret is safe; the
  // selects and the strengths `change` commit rerender() to refresh the fee preview + summary.
  function renderStationProduct(host) {
    var d = modalState.draft;
    var sub = d.submission;
    host.appendChild(el("div", "vcl-bud-body__title", "Product"));

    if (modalState.prefillNote) {
      host.appendChild(el("div", "vcl-bud-prefill-note",
        "<strong>Taken over from your summary:</strong> " + escapeHtml(modalState.prefillNote)
        + ", added as one new plan line. Complete the product and procedure details below."));
    }

    // Product name -- gates Station A completion (Next / stepper checkmark).
    var productField = el("div", "vcl-bud-field");
    productField.appendChild(el("label", "vcl-bud-field-label", "Product"));
    var productInput = el("input", "vcl-bud-input" + (d.product ? "" : " vcl-bud-input--empty"));
    productInput.type = "text"; productInput.value = d.product;
    productInput.addEventListener("input", function () {
      d.product = productInput.value;
      productInput.classList.toggle("vcl-bud-input--empty", !productInput.value);
      // Update gating in place (Next enablement + stepper ✓) WITHOUT rebuilding the body, which
      // would drop the input's focus/caret mid-typing.
      if (modalState.paintStepper) modalState.paintStepper();
      if (modalState.paintNav) modalState.paintNav();
    });
    productField.appendChild(productInput);
    host.appendChild(productField);

    // Number of strengths -- validated positive integer; commit on `change` (blur / spinner), not
    // per keystroke, so the fee recompute never fires mid-typing.
    if (!sub.strengths) sub.strengths = { default: 1, overrides: {} };
    var strengthField = el("div", "vcl-bud-field vcl-bud-field--narrow");
    strengthField.appendChild(el("label", "vcl-bud-field-label", "Number of strengths"));
    var strengthInput = el("input", "vcl-bud-input");
    strengthInput.type = "number"; strengthInput.min = "1"; strengthInput.step = "1";
    strengthInput.value = String(sub.strengths.default || 1);
    strengthInput.addEventListener("change", function () {
      var n = parseInt(strengthInput.value, 10);
      if (isNaN(n) || n < 1) n = 1;
      sub.strengths.default = n;
      strengthInput.value = String(n);
      rerender(); // strengths feed the fee -> refresh preview + summary
    });
    strengthField.appendChild(strengthInput);
    host.appendChild(strengthField);

    // MRP/DCP caveat: in MRP/DCP a single strengths figure is priced across all CMS, regardless of
    // the per-CMS approved strengths -- so the plan total may be slightly off.
    var note = el("p", "vcl-bud-strength-note");
    note.innerHTML = '<span aria-hidden="true">⚠</span> In MRP/DCP procedures, only this single strengths figure is applied — regardless of the strengths approved in the individual CMS. This may slightly skew the total.';
    host.appendChild(note);

    // Year / Quarter / Probability row.
    var metaRow = el("div", "vcl-bud-meta-row vcl-bud-meta-row--triple");

    if (!d.year) d.year = new Date().getFullYear() + 1;
    var yCol = el("div", "vcl-bud-field");
    yCol.appendChild(el("label", "vcl-bud-field-label", "Year"));
    var ySelect = el("select", "vcl-bud-select");
    budgetYearOptions().forEach(function (y) {
      var opt = el("option", null, String(y)); opt.value = String(y);
      if (d.year === y) opt.selected = true;
      ySelect.appendChild(opt);
    });
    ySelect.addEventListener("change", function () {
      d.year = parseInt(ySelect.value, 10);
      if (!d.quarter || quartersForYear(d.year).indexOf(d.quarter) === -1) d.quarter = quartersForYear(d.year)[0] || null;
      rerender();
    });
    yCol.appendChild(ySelect);
    metaRow.appendChild(yCol);

    var qCol = el("div", "vcl-bud-field");
    qCol.appendChild(el("label", "vcl-bud-field-label", "Quarter"));
    var qSelect = el("select", "vcl-bud-select");
    if (!d.quarter || quartersForYear(d.year).indexOf(d.quarter) === -1) d.quarter = quartersForYear(d.year)[0] || null;
    quartersForYear(d.year).forEach(function (q) {
      var opt = el("option", null, q); opt.value = q;
      if (d.quarter === q) opt.selected = true;
      qSelect.appendChild(opt);
    });
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

    host.appendChild(metaRow);
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
    // Block piling up empty rows: no new variation until the additional ones carry a type.
    add.disabled = sub.variations.slice(1).some(function (v) { return !v.type; });
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
    // --country caps the width to the Guided Workflow's select measure (380px) so the country
    // picker doesn't stretch across the full station card.
    var sel = el("select", "vcl-bud-select vcl-bud-select--country");
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
    if (allIA && !sub.mode) {
      host.appendChild(el("p", "vcl-bud-hint vcl-bud-hint--req", "Select Super-Grouping or Annual Update to continue — a Type IA is never submitted on its own."));
    }
    // With no submission type set, show the DERIVED state (Single / Grouping) as a plain label.
    // Suppressed while a mode is required (all-IA): the required hint above already governs.
    if (!sub.mode && !allIA) {
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
        ? Math.round(preview.hours.expected) + ' h <span class="band">' + Math.round(preview.hours.min) + " – " + Math.round(preview.hours.max) + " h</span>"
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

    // Header names the editor directly ("New/Edit Variation Plan Line") -- no separate kicker line
    // and no repeat of the dashboard's "Budget Planning" identity/reference, since the overlay
    // already reads as part of the Budget tool. Just the title and a ✕ back to the dashboard
    // (discarding the draft copy).
    var head = el("div", "vcl-bud-editor__head");
    var titleWrap = el("div");
    titleWrap.appendChild(el("h2", null, (modalState.editingId ? "Edit" : "New") + " Variation Plan Line"));
    head.appendChild(titleWrap);
    var closeBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "✕");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cancel and return to plan");
    closeBtn.addEventListener("click", requestOverlayClose);
    head.appendChild(closeBtn);
    wrap.appendChild(head);

    // Product identity (name / strengths / year / quarter / probability) now lives IN Station A
    // (renderStationProduct), not in a persistent meta row -- so stations B–D read as focused steps.

    // Station stepper (A · B · C · D). Clicking a *reached* dot swaps the body card's content via a
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

    // Body card holds only the per-station body host now; the product meta fields moved into
    // Station A (renderStationProduct) so each station's card shows just that station's content.
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
        finish.disabled = !(stationComplete("A", sub) && stationComplete("B", sub) && stationComplete("C", sub));
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

    // (The old live fee/hours preview strip + one-line summary that sat under a dashed rule were
    // removed -- that running total is visible in the dashboard once the line is saved; inside the
    // editor it only added noise. refreshEditor() guards on previewHost/summaryHost, so leaving them
    // unset is safe.)

    // Capture the live host references for refreshEditor()'s targeted (non-full-rerender) updates.
    // Reset on every renderEditor() so they always point at the current DOM nodes.
    modalState.paintStepper = paintStepper;
    modalState.paintNav = paintNav;
    modalState.bodyHost = bodyInner;
    modalState.previewHost = null;
    modalState.summaryHost = null;

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
    if (!(state.lines.length || (state.annualLines && state.annualLines.length))) return;
    if (!window.confirm("Clear the whole plan? This removes all variation lines and annual fees. This can't be undone.")) return;
    state.lines = [];
    state.annualLines = [];
    state.resultsById = {};
    state.expandedId = null;
    saveState();
    rerender();
  }

  // Plain-text "Special case / tariff" note for the Annual maintenance fees export sheet -- mirrors
  // annualTariffCell's on-screen logic (per-country tariff pick, or a no-fee/turnover-based note)
  // but as one flat string, since a spreadsheet cell can't hold the <select>/chip markup.
  // Per-market special-case note for the (now per-market) Excel annual sheet: the resolved tariff's
  // label for a multi-tariff market, "turnover-based" / "no fee" / "rate unavailable" for the special
  // statuses, or "auto" for a single-default market.
  function annualCountryNote(c) {
    if (c.status === "no-annual") return "no fee";
    if (c.status === "turnover") return "turnover-based";
    if (c.status === "no-rate") return "rate unavailable";
    var entry = BUD.findAnnualCountry(annualCountries(), c.cc);
    var t = entry && entry.tariffs ? entry.tariffs.filter(function (x) { return x.id === c.tariffId; })[0] : null;
    return (entry && entry.tariffs && entry.tariffs.length > 1) ? (t ? t.label : "auto") : "auto";
  }
  function annualCoverageText(row) {
    var cov = row.coverage || {};
    return cov.mode === "partial" ? ("From " + (cov.fromQuarter || "?")) : "Full year";
  }

  function exportExcel() {
    if (typeof XLSX === "undefined") {
      alert("Excel export library not loaded. Please check your internet connection and try again.");
      return;
    }
    var rollup = BUD.computeRollup(state.lines, state.resultsById);
    var countries = annualCountries();
    var fx = fxByCurrency();
    var annualRollup = BUD.computeAnnualRollup(state.annualLines, countries, fx);

    var wb = XLSX.utils.book_new();

    // "Fee (EUR)" is renamed to make clear it is the one-off variation fee, distinct from the
    // recurring annual maintenance fees on the second sheet.
    var linesRows = [["Product", "Mode", "Variations", "Procedures", "Year", "Quarter", "Probability", "Variation Fee (EUR)", "Hours (min)", "Hours (max)", "Hours (expected)"]];
    state.lines.forEach(function (line) {
      var r = state.resultsById[line.id];
      var sub = line.submission;
      var mode = SUB.displayMode(sub);
      // Incomplete lines (countries not fully specified) still show Mode/Variations/Procedures --
      // only the priced columns collapse to 0, mirroring the on-screen table's "Countries
      // incomplete" cell (r.complete === false).
      linesRows.push([
        line.product || "", MODE_LABEL[mode] || mode, variationsText(sub), proceduresText(sub),
        line.year || "", line.quarter || "", line.probability, r.complete ? Math.round(r.fee * 100) / 100 : 0,
        r.complete ? Math.round(r.hours.min) : 0, r.complete ? Math.round(r.hours.max) : 0, r.complete ? Math.round(r.hours.expected) : 0,
      ]);
    });
    var wsLines = XLSX.utils.aoa_to_sheet(linesRows);
    XLSX.utils.book_append_sheet(wb, wsLines, "Variations");

    // Annual maintenance fees sheet: ONE ROW PER MARKET (each CMS and the RMS of an MRP/DCP gets its
    // own row with its own fee), so the sheet is flat and pivot-ready. Priced via computeAnnualRow
    // (same engine call the on-screen annual table uses).
    var annualRows = [["Product", "Procedure", "Market", "Role", "Strengths", "Special case", "Annual fee (EUR)", "Year", "Coverage"]];
    (state.annualLines || []).forEach(function (row) {
      var res = BUD.computeAnnualRow(row, countries, fx);
      var proc = row.procedure || {};
      var procLabel = annualTrackLabel(proc.kind);
      var cov = annualCoverageText(row);
      var yr = row.year || "";
      var list = res.byCountry || [];
      if (!list.length) {
        annualRows.push([row.product || "", procLabel, "", "", row.strengths || 1, "—", 0, yr, cov]);
        return;
      }
      list.forEach(function (c) {
        var priced = (c.status === "ok" || c.status === "needs-pick");
        annualRows.push([
          row.product || "", procLabel, c.cc, c.role || "", row.strengths || 1,
          annualCountryNote(c), priced ? Math.round(c.amountEur * 100) / 100 : 0, yr, cov,
        ]);
      });
    });
    var wsAnnual = XLSX.utils.aoa_to_sheet(annualRows);
    XLSX.utils.book_append_sheet(wb, wsAnnual, "Annual maintenance fees");

    var r2 = function (n) { return Math.round((n || 0) * 100) / 100; };
    var rollupRows = [
      ["Variation fees (EUR)", r2(rollup.totals.fee)],
      ["Annual fees (EUR/yr)", r2(annualRollup.totalEur)],
      ["Total agency spend this year (EUR)", r2(rollup.totals.fee + annualRollup.totalEur)],
      ["Annual RA hours (expected)", Math.round(rollup.totals.hoursExpected)],
      ["Annual RA hours (min)", Math.round(rollup.totals.hoursMin)],
      ["Annual RA hours (max)", Math.round(rollup.totals.hoursMax)],
      ["FTE required", BUD.computeFte(rollup.totals.hoursExpected, state.hoursPerHead).toFixed(2)],
      ["Hours per head per year", state.hoursPerHead],
      [], ["By market (combined agency spend, EUR)", "Fee (EUR)"],
    ].concat(mergeBreakdown(rollup.byMarket, annualRollup.byMarket).map(function (r) { return [r.key, r2(r.value)]; }))
     .concat([[], ["By product (combined agency spend, EUR)", "Fee (EUR)"]])
     .concat(mergeBreakdown(rollup.byProduct, annualRollup.byProduct).map(function (r) { return [r.key, r2(r.value)]; }));
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
    // Sort by header click
    var sortTh = evt.target.closest("th[data-sort]");
    if (sortTh) {
      var key = sortTh.dataset.sort;
      if (state.sortKey === key) { state.sortDir = (state.sortDir === "desc") ? "asc" : "desc"; }
      else { state.sortKey = key; state.sortDir = (key === "product" || key === "mode") ? "asc" : "desc"; }
      rerender();
      return;
    }
    // An action button (duplicate / edit / delete) takes precedence and never toggles the row.
    // The annual table's rows use the SAME data-act values ("edit"/"delete") on a differently-classed
    // <tr> (vcl-bud-annual-row, not vcl-bud-line-row) -- route by that class so an annual row's id
    // (an annualLines id) is never handed to the plan-line functions below, and vice versa.
    var btn = evt.target.closest("button[data-act]");
    if (btn) {
      var trB = btn.closest("tr[data-line-id]");
      var id = trB && trB.dataset.lineId;
      if (trB && trB.classList.contains("vcl-bud-annual-row")) {
        if (btn.dataset.act === "edit" && id) openAnnualEditorFor(id);
        if (btn.dataset.act === "delete" && id) deleteAnnualLine(id);
        return;
      }
      if (btn.dataset.act === "duplicate" && id) duplicateLine(id);
      if (btn.dataset.act === "delete" && id) deleteLine(id);
      if (btn.dataset.act === "edit" && id) openModalFor(id);
      return;
    }
    // Anywhere else on a line row toggles that line's detail (the whole row is the target, not just
    // the chevron). The detail row itself carries no data-line-id, so clicks inside it are ignored.
    // A click on the tariff <select> inside an annual row must not toggle the row.
    if (evt.target.closest("select")) return;
    var annTr = evt.target.closest("tr.vcl-bud-annual-row[data-line-id]");
    if (annTr && annTr.dataset.lineId) { toggleExpand(annTr.dataset.lineId); return; }
    var tr = evt.target.closest("tr.vcl-bud-line-row[data-line-id]");
    if (tr && tr.dataset.lineId) toggleExpand(tr.dataset.lineId);
  }
  function onHeaderClick(evt) {
    var btn = evt.target.closest("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "new-line") openModalFor(null);
    if (btn.dataset.act === "export") exportExcel(); // Task 6
    if (btn.dataset.act === "clear-plan") clearPlan();
    // "+ Add product" (annual table): opens the two-station manual editor (Task 7) on a fresh draft.
    if (btn.dataset.act === "add-annual") openAnnualEditorFor(null);
    if (btn.dataset.act === "bd-mode") { state.breakdownMode = btn.dataset.mode; rerender(); return; }
  }

  // Special case / tariff <select> inside the annual table (annualTariffCell): writes the pick
  // straight into the row's own tariffPicks and re-prices, same as any other in-place edit here.
  function onAnnualChange(evt) {
    var sel = evt.target.closest && evt.target.closest("select[data-line-id][data-cc]");
    if (!sel) return;
    var row = (state.annualLines || []).find(function (r) { return r.id === sel.dataset.lineId; });
    if (!row) return;
    row.tariffPicks = row.tariffPicks || {};
    row.tariffPicks[sel.dataset.cc] = sel.value;
    saveState();
    rerender();
  }

  // ---- Annual "Add product" editor (Task 7) -- a second, independent takeover for the annual-fees
  // table, mirroring the plan-line editor's station/stepper/takeover look-and-feel (same
  // .vcl-bud-editor/.vcl-bud-stations/.vcl-bud-body/.vcl-bud-nav classes) but with only two stations:
  // A (Product) and B (Registration). Reused both for "+ Add product" (fresh draft) and for editing
  // an existing annual row (auto or manual) via its row's edit icon. ----

  var ANNUAL_STATIONS = [{ key: "A", label: "Product" }, { key: "B", label: "Registration" }];
  var ANNUAL_STATION_ORDER = ["A", "B"];

  function defaultAnnualDraft() {
    return {
      origin: "manual",
      product: "",
      procedure: { kind: "national", rms: null, countries: [] },
      strengths: 1,
      tariffPicks: {},
      coverage: { mode: "full", fromQuarter: null },
      // Not part of the persisted annual-row shape (normalizeAnnualLine doesn't carry it across a
      // reload) -- purely UI context for which budget year this product is being planned into,
      // mirroring the plan-line editor's own Year field.
      year: new Date().getFullYear() + 1,
    };
  }

  function openAnnualEditorFor(id) {
    var existing = id && (state.annualLines || []).find(function (r) { return r.id === id; });
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : defaultAnnualDraft();
    if (!draft.year) draft.year = new Date().getFullYear() + 1;
    annualEditor = {
      editingId: id || null,
      draft: draft,
      station: "A",
      // A brand-new product is a two-step wizard (only A reached until it's complete); an existing
      // row is fully reached so the user can jump A/B freely, same gating rule as the line editor.
      reached: id ? { A: true, B: true } : { A: true, B: false },
      collision: null,
    };
    rerender();
    scrollToTop(); // opening the takeover editor (Add product / edit) jumps to the top of the page
  }
  function closeAnnualEditor() { annualEditor = null; rerender(); scrollToTop(); }

  function annualStationComplete(key, draft) {
    if (key === "A") return !!(draft.product && draft.product.trim());
    if (key === "B") {
      // A valid anchor market is required before Save -- otherwise a national/mrpdcp registration
      // with no country/RMS picked would save as a "ghost" €0 row (product|national| etc).
      var proc = draft.procedure || {};
      if (proc.kind === "national") return !!(proc.countries && proc.countries.length >= 1);
      if (proc.kind === "mrpdcp") return !!proc.rms; // CMS list may stay empty, RMS is the anchor
      if (proc.kind === "cp") return true; // priced as EU -- countries is intentionally empty
      return false;
    }
    return true;
  }

  function advanceAnnualStation(dir) {
    var i = ANNUAL_STATION_ORDER.indexOf(annualEditor.station);
    var j = i + dir;
    if (j < 0 || j >= ANNUAL_STATION_ORDER.length) return;
    if (dir > 0 && !annualStationComplete(annualEditor.station, annualEditor.draft)) return;
    var key = ANNUAL_STATION_ORDER[j];
    if (dir > 0) annualEditor.reached[key] = true;
    annualEditor.station = key;
    refreshAnnualEditor();
    scrollToTop();
  }

  // Targeted refresh (mirrors refreshEditor): repaints the stepper, the nav, the current station's
  // body, and the live preview strip in place -- no full container rerender.
  function refreshAnnualEditor() {
    if (!annualEditor) return;
    if (annualEditor.paintStepper) annualEditor.paintStepper();
    if (annualEditor.paintNav) annualEditor.paintNav();
    if (annualEditor.bodyHost) annualStationBody(annualEditor.bodyHost);
    if (annualEditor.previewHost) renderAnnualPreviewStrip(annualEditor.previewHost);
  }

  function annualStationBody(host) {
    host.innerHTML = "";
    if (annualEditor.collision) { renderAnnualCollision(host); return; }
    if (annualEditor.station === "A") renderAnnualStationA(host);
    else renderAnnualStationB(host);
  }

  // ---- Station A: Product -- name, number of strengths (+ the MRP/DCP skew caveat), budget year,
  // and this budget's coverage (full year, or prorated from a given quarter). ----
  function renderAnnualStationA(host) {
    var d = annualEditor.draft;
    host.appendChild(el("div", "vcl-bud-body__title", "Product"));

    // Product name -- gates Station B (Next / stepper checkmark). Keystrokes only repaint the
    // stepper/nav in place (never the body), so the input's focus/caret is never dropped.
    var productField = el("div", "vcl-bud-field");
    productField.appendChild(el("label", "vcl-bud-field-label", "Product"));
    var productInput = el("input", "vcl-bud-input" + (d.product ? "" : " vcl-bud-input--empty"));
    productInput.type = "text"; productInput.value = d.product;
    productInput.addEventListener("input", function () {
      d.product = productInput.value;
      productInput.classList.toggle("vcl-bud-input--empty", !productInput.value);
      if (annualEditor.paintStepper) annualEditor.paintStepper();
      if (annualEditor.paintNav) annualEditor.paintNav();
    });
    productField.appendChild(productInput);
    host.appendChild(productField);

    // Number of strengths -- validated positive integer, committed on change (blur/spinner), not
    // per keystroke, mirroring the plan-line editor's own strengths field.
    var strengthField = el("div", "vcl-bud-field vcl-bud-field--narrow");
    strengthField.appendChild(el("label", "vcl-bud-field-label", "Number of strengths"));
    var strengthInput = el("input", "vcl-bud-input");
    strengthInput.type = "number"; strengthInput.min = "1"; strengthInput.step = "1";
    strengthInput.value = String(d.strengths || 1);
    strengthInput.addEventListener("change", function () {
      var n = parseInt(strengthInput.value, 10);
      if (isNaN(n) || n < 1) n = 1;
      d.strengths = n;
      strengthInput.value = String(n);
      refreshAnnualEditor(); // strengths feed the fee -> refresh the live preview
    });
    strengthField.appendChild(strengthInput);
    host.appendChild(strengthField);

    // MRP/DCP skew caveat -- verbatim copy per spec, same visual treatment as the line editor's own
    // strengths note (.vcl-bud-strength-note, already styled -- no new CSS needed for this note).
    var note = el("p", "vcl-bud-strength-note");
    note.innerHTML = '<span aria-hidden="true">⚠</span> In MRP/DCP registrations, this single strengths figure is applied to every market — regardless of the strengths approved per CMS. May slightly skew the total.';
    host.appendChild(note);

    // Budget year / Coverage this budget row.
    var metaRow = el("div", "vcl-bud-meta-row vcl-bud-meta-row--pair");

    var yCol = el("div", "vcl-bud-field");
    yCol.appendChild(el("label", "vcl-bud-field-label", "Budget year"));
    var ySelect = el("select", "vcl-bud-select");
    budgetYearOptions().forEach(function (y) {
      var opt = el("option", null, String(y)); opt.value = String(y);
      if (d.year === y) opt.selected = true;
      ySelect.appendChild(opt);
    });
    ySelect.addEventListener("change", function () { d.year = parseInt(ySelect.value, 10); refreshAnnualEditor(); });
    yCol.appendChild(ySelect);
    metaRow.appendChild(yCol);

    var cCol = el("div", "vcl-bud-field");
    cCol.appendChild(el("label", "vcl-bud-field-label", "Coverage this budget"));
    var cSelect = el("select", "vcl-bud-select");
    var fullOpt = el("option", null, "Full year"); fullOpt.value = "full";
    if (d.coverage.mode !== "partial") fullOpt.selected = true;
    cSelect.appendChild(fullOpt);
    for (var q = 1; q <= 4; q++) {
      var qOpt = el("option", null, "Rest of year · from Q" + q); qOpt.value = "Q" + q;
      if (d.coverage.mode === "partial" && d.coverage.fromQuarter === "Q" + q) qOpt.selected = true;
      cSelect.appendChild(qOpt);
    }
    cSelect.addEventListener("change", function () {
      d.coverage = (cSelect.value === "full") ? { mode: "full", fromQuarter: null } : { mode: "partial", fromQuarter: cSelect.value };
      refreshAnnualEditor();
    });
    cCol.appendChild(cSelect);
    metaRow.appendChild(cCol);
    host.appendChild(metaRow);

    // Live proration line, using the same engine function the fee itself is computed with.
    var factor = BUD.prorationFactor(d.coverage);
    var months = (d.coverage.mode === "partial")
      ? (5 - parseInt(String(d.coverage.fromQuarter || "").replace(/[^0-9]/g, ""), 10)) * 3
      : 12;
    var pct = Math.round(factor * 100);
    host.appendChild(el("p", "vcl-bud-proration-note", "Prorated: " + months + " of 12 months → " + pct + "% of the full annual fee counts"));
  }

  // ---- Station B: Registration -- procedure kind + markets, mirroring the line editor's own
  // procedure body (Station B/C) but writing into the annual row's { kind, rms, countries } shape
  // instead of a Submission procedure. ----

  // CMS multi-select for the annual editor's MRP/DCP procedure -- identical chip grid to cmsChips(p)
  // (Station B of the line editor) but operating on procedure.countries directly, since an annual
  // row's procedure has no separate cms array (the RMS sits at countries[0], CMS fill the rest).
  function annualCmsChips(proc) {
    var wrap = el("div", "vcl-bud-field");
    wrap.appendChild(el("label", "vcl-bud-field-label", "CMS (Concerned Member States)"));
    var grid = el("div", "vcl-bud-cgrid");
    countriesByRole("CMS").forEach(function (c) {
      if (c.cc === proc.rms) return; // the RMS cannot also be a CMS
      var on = proc.countries.indexOf(c.cc) !== -1;
      var m = /^([A-Za-z]{2})\s*[-–]\s*(.+)$/.exec(c.cc);
      var label = m ? escapeHtml(m[1]) + '<span class="vcl-bud-cc__sfx">' + escapeHtml(m[2]) + "</span>" : escapeHtml(c.cc);
      var chip = el("button", "vcl-bud-cc-chip-btn" + (on ? " is-on" : ""), label);
      chip.type = "button";
      chip.title = c.name || c.cc;
      chip.addEventListener("click", function () {
        if (on) proc.countries = proc.countries.filter(function (x) { return x !== c.cc; });
        else if (proc.countries.indexOf(c.cc) === -1) proc.countries.push(c.cc);
        refreshAnnualEditor();
      });
      grid.appendChild(chip);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // Per-country tariff picks (only for a market whose annual-fee entry actually offers more than one
  // tariff variant) -- writes straight into draft.tariffPicks, same field the persisted table's own
  // annualTariffCell <select> writes (onAnnualChange).
  function renderAnnualTariffPicks(host, draft, res) {
    var countries = annualCountries();
    var any = false;
    (res.byCountry || []).forEach(function (c) {
      if (c.status === "no-annual" || c.status === "turnover") return;
      var entry = BUD.findAnnualCountry(countries, c.cc);
      if (!entry || !entry.tariffs || entry.tariffs.length <= 1) return;
      any = true;
      var row = el("div", "vcl-bud-field vcl-bud-field--narrow");
      row.appendChild(el("label", "vcl-bud-field-label", c.cc));
      var sel = el("select", "vcl-bud-select");
      entry.tariffs.forEach(function (t) {
        var opt = el("option", null, escapeHtml(t.label)); opt.value = t.id;
        if (t.id === c.tariffId) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () {
        draft.tariffPicks = draft.tariffPicks || {};
        draft.tariffPicks[c.cc] = sel.value;
        refreshAnnualEditor();
      });
      row.appendChild(sel);
      host.appendChild(row);
    });
    return any;
  }

  function renderAnnualStationB(host) {
    var d = annualEditor.draft;
    var proc = d.procedure;
    host.appendChild(el("div", "vcl-bud-body__title", "Registration"));
    host.appendChild(el("div", "vcl-bud-body__sub", "Which procedure, and which markets, does this registration cover?"));

    // Procedure kind chips -- switching kind resets the markets (a country picked as an MRP/DCP RMS
    // means nothing once the kind is National), same as the line editor's own procKindChips.
    var kindRow = el("div", "vcl-bud-chips");
    [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }].forEach(function (it) {
      var chip = el("button", "vcl-bud-chip" + (proc.kind === it.k ? " is-on" : ""), escapeHtml(it.l));
      chip.type = "button";
      chip.addEventListener("click", function () {
        if (proc.kind === it.k) return;
        proc.kind = it.k;
        proc.rms = null;
        proc.countries = [];
        d.tariffPicks = {};
        refreshAnnualEditor();
      });
      kindRow.appendChild(chip);
    });
    host.appendChild(kindRow);

    host.appendChild(el("div", "vcl-bud-section-label", "Markets"));
    if (proc.kind === "national") {
      host.appendChild(countrySelectField("Country", countriesByRole("national"), proc.countries[0] || null, function (cc) {
        proc.countries = cc ? [cc] : [];
        refreshAnnualEditor();
      }));
    } else if (proc.kind === "mrpdcp") {
      host.appendChild(countrySelectField("RMS (Reference Member State)", countriesByRole("RMS"), proc.rms, function (cc) {
        var cms = proc.countries.slice(1).filter(function (x) { return x !== cc; });
        proc.rms = cc;
        proc.countries = cc ? [cc].concat(cms) : cms;
        refreshAnnualEditor();
      }));
      host.appendChild(annualCmsChips(proc));
      host.appendChild(el("p", "vcl-bud-hint", "Each selected CMS is charged its own annual fee. The RMS cannot also be a CMS."));
    } else if (proc.kind === "cp") {
      var euRow = el("div", "vcl-bud-chips");
      euRow.appendChild(el("span", "vcl-bud-cc-chip vcl-bud-cc-chip--rms", "EU"));
      host.appendChild(euRow);
      host.appendChild(el("p", "vcl-bud-hint", "CP · priced as EU — one centralised annual fee, no country selection."));
    }

    var res = BUD.computeAnnualRow(d, annualCountries(), fxByCurrency());
    var tariffHost = el("div");
    var hasTariffPicks = renderAnnualTariffPicks(tariffHost, d, res);
    if (hasTariffPicks) {
      host.appendChild(el("div", "vcl-bud-section-label", "Special case / tariff"));
      host.appendChild(tariffHost);
    }
  }

  function renderAnnualCollision(host) {
    var existing = (state.annualLines || []).find(function (r) { return r.id === annualEditor.collision; });
    var box = el("div", "vcl-bud-collision");
    box.appendChild(el("p", "vcl-bud-collision__msg",
      "A product with this exact registration already exists" +
      (existing ? ' — <strong>' + escapeHtml(existing.product) + "</strong>" : "") +
      ". Open that row instead of adding a duplicate?"));
    var actions = el("div", "vcl-bud-collision__actions");
    var openBtn = el("button", "vcl-bud-btn vcl-bud-btn--primary", "Open existing product");
    openBtn.type = "button";
    openBtn.addEventListener("click", function () { openAnnualEditorFor(annualEditor.collision); });
    var backBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost", "Keep editing this one");
    backBtn.type = "button";
    backBtn.addEventListener("click", function () { annualEditor.collision = null; refreshAnnualEditor(); });
    actions.appendChild(openBtn);
    actions.appendChild(backBtn);
    box.appendChild(actions);
    host.appendChild(box);
  }

  // Live Fee / Coverage preview strip, mirroring renderPreviewStrip -- recomputed from the draft via
  // the single shared engine function (BUD.computeAnnualRow), no pricing logic duplicated here.
  function renderAnnualPreviewStrip(host) {
    host.innerHTML = "";
    var d = annualEditor.draft;
    var res = BUD.computeAnnualRow(d, annualCountries(), fxByCurrency());
    var feeItem = el("div");
    feeItem.innerHTML = '<div class="lbl">Annual fee</div><div class="val">' + escapeHtml(fmtEUR(res.total)) +
      (res.computable ? "" : ' <span class="vcl-bud-annual__track">+ turnover-based</span>') + "</div>";
    host.appendChild(feeItem);
    var covItem = el("div");
    covItem.innerHTML = '<div class="lbl">Coverage</div><div class="val">' + Math.round(BUD.prorationFactor(d.coverage) * 100) + "%</div>";
    host.appendChild(covItem);
    host.appendChild(el("p", "vcl-bud-live-result__note", "Prorated for partial-year coverage; special-case tariffs applied automatically."));
  }

  function renderAnnualEditor() {
    var d = annualEditor.draft;
    var wrap = el("div", "vcl-bud-editor");

    var head = el("div", "vcl-bud-editor__head");
    var titleWrap = el("div");
    var editorYear = d.year || (new Date().getFullYear() + 1);
    titleWrap.appendChild(el("h2", null, 'Budget Planning <span class="vcl-bud-year">for ' + editorYear + "</span>"));
    appendCalcRefLines(titleWrap, { skipUpdated: true });
    head.appendChild(titleWrap);
    var closeBtn = el("button", "vcl-bud-btn vcl-bud-btn--ghost vcl-bud-btn--small", "✕");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cancel and return to plan");
    closeBtn.addEventListener("click", requestOverlayClose);
    head.appendChild(closeBtn);
    wrap.appendChild(head);

    wrap.appendChild(el("p", "vcl-bud-editor__kicker", (annualEditor.editingId ? "Edit" : "New") + " product"));

    var card = el("div", "vcl-bud-body");
    var stepper = el("div", "vcl-bud-stations");
    var stationButtons = {};
    function paintStepper() {
      ANNUAL_STATIONS.forEach(function (s) {
        var btn = stationButtons[s.key];
        var active = annualEditor.station === s.key;
        var done = annualEditor.reached[s.key] && annualStationComplete(s.key, d) && !active;
        btn.disabled = !annualEditor.reached[s.key];
        btn.className = "vcl-bud-station" + (active ? " is-active" : "") + (done ? " is-done" : "");
        btn.firstChild.innerHTML = done ? '<span aria-hidden="true">✓</span>' : s.key;
      });
    }
    ANNUAL_STATIONS.forEach(function (s) {
      var btn = el("button", "vcl-bud-station");
      btn.type = "button";
      btn.appendChild(el("div", "vcl-bud-station__dot", s.key));
      btn.appendChild(el("div", "vcl-bud-station__label", escapeHtml(s.label)));
      btn.addEventListener("click", function () {
        if (!annualEditor.reached[s.key]) return;
        annualEditor.station = s.key;
        refreshAnnualEditor();
        scrollToTop();
      });
      stationButtons[s.key] = btn;
      stepper.appendChild(btn);
    });
    paintStepper();
    wrap.appendChild(stepper);

    var bodyInner = el("div", "vcl-bud-body__inner");
    card.appendChild(bodyInner);
    annualStationBody(bodyInner);
    wrap.appendChild(card);

    var nav = el("div", "vcl-bud-nav");
    function paintNav() {
      nav.innerHTML = "";
      var idx = ANNUAL_STATION_ORDER.indexOf(annualEditor.station);
      if (idx === 0) {
        var toPlan = el("button", "vcl-bud-btn", "← Back to plan");
        toPlan.type = "button";
        toPlan.addEventListener("click", requestOverlayClose);
        nav.appendChild(toPlan);
      } else {
        var back = el("button", "vcl-bud-btn", "← Back");
        back.type = "button";
        back.addEventListener("click", function () { advanceAnnualStation(-1); });
        nav.appendChild(back);
      }
      if (idx === ANNUAL_STATION_ORDER.length - 1) {
        var save = el("button", "vcl-bud-btn vcl-bud-btn--primary", "Save product");
        save.type = "button";
        save.disabled = !annualStationComplete("A", d) || !annualStationComplete("B", d);
        save.addEventListener("click", saveAnnualProduct);
        nav.appendChild(save);
      } else {
        var next = el("button", "vcl-bud-btn vcl-bud-btn--primary", "Next →");
        next.type = "button";
        next.disabled = !annualStationComplete(annualEditor.station, d);
        next.addEventListener("click", function () { advanceAnnualStation(1); });
        nav.appendChild(next);
      }
    }
    paintNav();
    wrap.appendChild(nav);

    // (Live fee/coverage preview strip removed -- see the note in renderEditor. The annual fee shows
    // in the dashboard's annual table once saved.)

    annualEditor.paintStepper = paintStepper;
    annualEditor.paintNav = paintNav;
    annualEditor.bodyHost = bodyInner;
    annualEditor.previewHost = null;

    return wrap;
  }

  // Save with collision check (Step 5): the registration key is recomputed fresh from the current
  // product/kind/anchor right before saving (never trusted from a stale draft.key) -- anchor is the
  // single national country, the MRP/DCP RMS, or "" for CP. A match against any OTHER row (not the
  // one currently being edited) blocks the save and shows the in-editor collision prompt instead.
  function saveAnnualProduct() {
    var d = annualEditor.draft;
    var kind = d.procedure.kind;
    var anchor = kind === "national" ? (d.procedure.countries[0] || "")
      : kind === "mrpdcp" ? (d.procedure.rms || "")
      : "";
    d.key = BUD.registrationKey(d.product, kind, anchor);
    var colliding = (state.annualLines || []).find(function (r) { return r.key === d.key && r.id !== annualEditor.editingId; });
    if (colliding) {
      annualEditor.collision = colliding.id;
      refreshAnnualEditor();
      return;
    }
    if (annualEditor.editingId) {
      var idx = state.annualLines.findIndex(function (r) { return r.id === annualEditor.editingId; });
      if (idx !== -1) state.annualLines[idx] = d;
    } else {
      d.id = "annual-" + Date.now() + "-" + Math.floor(Math.random() * 1e5);
      state.annualLines.push(d);
    }
    annualEditor = null;
    saveState();
    rerender();
    scrollToTop();
  }

  function deleteAnnualLine(id) {
    state.annualLines = (state.annualLines || []).filter(function (r) { return r.id !== id; });
    saveState();
    rerender();
  }

  window.VCL_BUDGET = {
    render: function (col) {
      container = col;
      container.removeEventListener("click", onTableClick);
      container.addEventListener("click", onTableClick);
      container.removeEventListener("click", onHeaderClick);
      container.addEventListener("click", onHeaderClick);
      container.removeEventListener("change", onAnnualChange);
      container.addEventListener("change", onAnnualChange);
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
      // Compact type tally for the hand-off banner, e.g. "3 × Type IB" or "2 × Type IB · 1 × Type II".
      var order = ["IA", "IAIN", "IB", "IB (default)", "II"];
      var counts = {};
      vars.forEach(function (v) { var t = v.type || "?"; counts[t] = (counts[t] || 0) + 1; });
      var tally = Object.keys(counts)
        .sort(function (a, b) { return ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99); })
        .map(function (t) { return counts[t] + " × Type " + t; })
        .join(" · ");
      modalState = {
        editingId: null,
        draft: draft,
        station: "A",
        reached: { A: true, B: false, C: false, D: false },
        query: "",
        searchResults: [],
        prefillNote: vars.length ? tally : null,
      };
      if (container) rerender();
    },
  };
})();
