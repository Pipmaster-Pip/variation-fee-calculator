// Guided Workflow -- the Variation Toolbox's 8th tool. A station-by-station path that
// carries the user through one variation across all of the other tools: Identify the
// classification & substance -> describe the Procedure (with grouping/worksharing list
// builders) -> pick the submission Date & see the Timeline -> read the Fees per procedure.
//
// Self-contained like the Workload tool: vcl-app.js only wires the nav button and calls
// window.VCL_WORKFLOW.render(col) once; everything below manages its own state and rerender.
// Reuses the shared classification data (window.VCL_DATA) and, in later phases, the fee engine
// (window.VCLCALC) and the workload factor tables.
(function () {
  "use strict";

  const DATA = window.VCL_DATA || {};
  const ENTRIES = DATA.ENTRIES || [];

  const STATIONS = [
    { key: "A", label: "Identify" },
    { key: "B", label: "Procedure" },
    { key: "C", label: "Date & Timeline" },
    { key: "D", label: "Fees" },
  ];

  const STATION_META = {
    B: { title: "Procedure", sub: "How is it submitted?", note: "Procedure (at country level), submission type and the two list builders (grouping · worksharing) go here." },
    C: { title: "Date & Timeline", sub: "When, and how does the clock run?", note: "The desired initial-submission date and the timeline go here." },
    D: { title: "Fees", sub: "What does it cost, per procedure?", note: "Fees per procedure (at country level) and the export go here." },
  };

  const state = {
    station: "A",
    // The furthest station the user has reached -- gates which dots are clickable.
    reached: { A: true, B: false, C: false, D: false },
    // Station A
    pickedCode: null,
    pickedVariantId: undefined,
    query: "",
    typeOnly: null,        // 'IA' | 'IB' | 'II' when the user skips the classification and just picks a type
    activeSubstance: null, // 'biologic' | 'chemical'
    // Station B
    procedure: newProcedure(),        // the primary procedure ("procedure 1")
    submission: { grouping: false, worksharing: false },
    grouping: [],                      // additional variations: [{ code, variantId, type }]
    worksharing: [],                   // additional procedures: [newProcedure(), ...]
    worksharingLead: null,             // cc of the authority leading the worksharing (auto = EMA when a CP is involved)
    // Station C
    submissionDate: "",
    iiSub: "60",                       // Type II sub-procedure: 30 | 60 | 90 (days)
    clockStopFraction: 1,              // 0..1 across the clock-stop min..max
    // Strengths (Station D): a global default, with per-country overrides only where it matters.
    strengthsDefault: 1,
    strengthsOverrides: {},            // cc -> number of strengths (shown for strength-sensitive countries)
    // Summary (Station D): reveal the grouped variations' codes & descriptions on demand.
    summaryShowVariations: false,
    // Worksharing pricing (Station D): the lead's one-off Type-II special-case pick, and the
    // per-line picks for every participating authority (keyed "cc|role").
    worksharingLeadSpecial: null,
    wsSpecials: {},
  };

  let container = null;

  // ---- procedure model (fee-engine ready: each procedure -> [{cc, role}]) ----
  function newProcedure() { return { kind: "national", nat: null, rms: null, cms: [] }; }

  // Country universe from the fee engine, cached and split by supported role.
  let COUNTRIES = null;
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

  // Number of strengths registered for a country: the global default unless overridden.
  function strengthsFor(cc) {
    const o = state.strengthsOverrides[cc];
    const n = (o != null) ? o : state.strengthsDefault;
    return Math.max(1, parseInt(n, 10) || 1);
  }

  // Flatten a procedure to the (cc, role, strengths) triples the fee engine consumes.
  function procCountries(p) {
    if (!p) return [];
    if (p.kind === "national") return p.nat ? [{ cc: p.nat, role: "national", strengths: strengthsFor(p.nat) }] : [];
    if (p.kind === "cp") { const e = countryData().ema; return e ? [{ cc: e, role: "EMA", strengths: strengthsFor(e) }] : []; }
    if (p.kind === "mrpdcp") {
      const out = [];
      if (p.rms) out.push({ cc: p.rms, role: "RMS", strengths: strengthsFor(p.rms) });
      p.cms.forEach((cc) => out.push({ cc: cc, role: "CMS", strengths: strengthsFor(cc) }));
      return out;
    }
    return [];
  }
  function procComplete(p) {
    if (!p) return false;
    if (p.kind === "national") return !!p.nat;
    if (p.kind === "cp") return true;
    if (p.kind === "mrpdcp") return !!p.rms; // at least the RMS
    return false;
  }
  function procLabel(p) {
    if (!p) return "";
    if (p.kind === "national") return "National" + (p.nat ? " · " + p.nat : "");
    if (p.kind === "cp") return "CP · EMA";
    if (p.kind === "mrpdcp") return "MRP/DCP · " + (p.rms || "?") + (p.cms.length ? " +" + p.cms.length + " CMS" : "");
    return "";
  }

  // ---- fees ----
  // The fee engine buckets by IA/IB/II; IAIN counts as IA, "IB (unforeseen)" as IB.
  function feeBucket(type) {
    if (!type) return null;
    if (type.indexOf("II") === 0) return "II";
    if (type.indexOf("IB") === 0) return "IB";
    if (type.indexOf("IA") === 0) return "IA";
    return null;
  }
  // Every procedure carries the same variation content: the base variation plus any grouped ones.
  function feeCounts() {
    const c = { IA: 0, IB: 0, II: 0 };
    const bt = currentType();
    if (bt) { const b = feeBucket(bt); if (b) c[b]++; }
    if (state.submission.grouping) state.grouping.forEach((g) => { if (g.type) { const b = feeBucket(g.type); if (b) c[b]++; } });
    return c;
  }
  function feeCountsTotal(c) { return c.IA + c.IB + c.II; }
  function allProcedures() {
    const list = [state.procedure];
    if (state.submission.worksharing) state.worksharing.forEach((p) => list.push(p));
    return list;
  }
  // A Centralised procedure (CP/EMA) taking part in a worksharing automatically leads it.
  function worksharingHasCP() { return allProcedures().some((p) => p.kind === "cp"); }

  // ---- worksharing pricing ----
  // Worksharing is priced through the Type-II "… - worksharing" special-case rows the fee
  // data already carries; the engine (VCLCALC.computeFees) takes `special` per country, so
  // nothing below touches the engine. Pricing switches to worksharing once the user has
  // turned Worksharing on AND picked the lead authority in Station B.
  function wsActive() { return state.submission.worksharing && !!state.worksharingLead; }
  function feeRows() { return (window.VCLCALC_DATA && window.VCLCALC_DATA.FEE_ROWS) || []; }
  // Type-II special-case labels published for a country+role ("complex - worksharing",
  // "simple", ...). A literal "standard" label just duplicates the default option, so it is
  // dropped from the list (resolveRow falls back to that row anyway when nothing is chosen).
  function specialOptionsFor(cc, role) {
    const seen = {}; const out = [];
    feeRows().forEach((r) => {
      if (r.cc !== cc || r.role !== role || r.type !== "II") return;
      const s = r.special;
      if (!s || /^standard$/i.test(s) || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }
  // ⚠️ OPEN QUESTION (role mapping): does the RMS of an MRP/DCP inside a worksharing pay its
  // RMS fee, or the worksharing-CMS fee when it is not the lead? Tendency: "WS-CMS", to be
  // confirmed against real data. Until then RMS stays RMS -- flip the constant to "CMS" and
  // every lookup below (dropdown options and pricing) follows from this single spot.
  const WS_RMS_PRICES_AS = "RMS";
  function wsPricingRole(role) { return role === "RMS" ? WS_RMS_PRICES_AS : role; }
  function wsSpecialKey(cc, role) { return cc + "|" + role; }
  function wsSpecialFor(cc, role) { return state.wsSpecials[wsSpecialKey(cc, role)] || null; }
  // The role the lead is priced under: the EMA as EMA; otherwise RMS where the authority
  // publishes RMS rows, falling back to national, then CMS.
  function leadPricingRole() {
    const cc = state.worksharingLead;
    if (!cc) return null;
    if (cc === countryData().ema) return "EMA";
    const has = (role) => feeRows().some((r) => r.cc === cc && r.role === role);
    return has("RMS") ? "RMS" : (has("national") ? "national" : "CMS");
  }
  // The lead's one-off fee: a single engine country-result, or null while it can't be priced.
  function leadFees(counts) {
    if (!wsActive() || !window.VCLCALC || !window.VCLCALC.computeFees) return null;
    if (feeCountsTotal(counts) === 0) return null;
    const cc = state.worksharingLead;
    const r = window.VCLCALC.computeFees({
      countries: [{ cc: cc, role: leadPricingRole(), strengths: strengthsFor(cc), special: { IA: null, IB: null, II: state.worksharingLeadSpecial } }],
      counts: counts,
    });
    return (r.countries && r.countries[0]) || null;
  }
  function fmtEUR(v) {
    if (v === null || v === undefined) return "–";
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  }
  // Flatten a procedure for PRICING: in a worksharing the lead authority is excluded here
  // (it is priced exactly once, in Station D's lead box) and every remaining line carries
  // its chosen Type-II special case.
  function procPricedCountries(p) {
    const list = procCountries(p);
    if (!wsActive()) return list;
    return list.filter((x) => x.cc !== state.worksharingLead).map((x) => {
      const role = wsPricingRole(x.role);
      return { cc: x.cc, role: role, strengths: x.strengths, special: { IA: null, IB: null, II: wsSpecialFor(x.cc, role) } };
    });
  }
  // Fees for one procedure, via the shared engine (window.VCLCALC.computeFees).
  function procFees(p, counts) {
    if (!window.VCLCALC || !window.VCLCALC.computeFees) return null;
    if (!procCountries(p).length || feeCountsTotal(counts) === 0) return { countries: [], grandTotal: 0 };
    return window.VCLCALC.computeFees({ countries: procPricedCountries(p), counts: counts });
  }
  function grandTotalFees() {
    const counts = feeCounts();
    if (feeCountsTotal(counts) === 0) return null;
    let total = 0;
    let any = false;
    allProcedures().forEach((p) => { const r = procFees(p, counts); if (r) { total += r.grandTotal; if (procCountries(p).length) any = true; } });
    if (wsActive()) { const lf = leadFees(counts); if (lf) { total += lf.total || 0; any = true; } }
    return any ? total : null;
  }

  // Unique selected countries across all procedures (keyed by cc, strengths is per product/cc).
  function selectedCcs() {
    const seen = {}; const out = [];
    // In a worksharing the lead is a fee-payer of its own (even when it sits in none of the
    // procedures), so it must show up here too -- e.g. for the strengths list.
    if (wsActive()) { seen[state.worksharingLead] = 1; out.push({ cc: state.worksharingLead, role: leadPricingRole() }); }
    allProcedures().forEach((p) => procCountries(p).forEach((x) => { if (!seen[x.cc]) { seen[x.cc] = 1; out.push({ cc: x.cc, role: x.role }); } }));
    return out;
  }
  // Does the fee for this country actually change with the number of strengths? (Many don't.)
  function strengthsMatters(cc, role) {
    const counts = feeCounts();
    if (feeCountsTotal(counts) === 0 || !window.VCLCALC || !window.VCLCALC.computeFees) return false;
    const a = window.VCLCALC.computeFees({ countries: [{ cc: cc, role: role, strengths: 1 }], counts: counts });
    const b = window.VCLCALC.computeFees({ countries: [{ cc: cc, role: role, strengths: 2 }], counts: counts });
    return Math.abs((a.grandTotal || 0) - (b.grandTotal || 0)) > 0.01;
  }
  function strengthsSensitiveList() { return selectedCcs().filter((x) => strengthsMatters(x.cc, x.role)); }

  // ---- timeline + RA effort (reuse the workload tool's shared helpers) ----
  // A group runs as its HIGHEST type -- a Type II anywhere makes it a Type II grouping, which
  // drives the procedure, timeline, II sub-procedure and RA effort. (Fees stay per-variation via
  // feeCounts, so each variation is still charged at its own type.)
  function typeRankOf(type) { const b = feeBucket(type); return b === "II" ? 3 : b === "IB" ? 2 : b === "IA" ? 1 : 0; }
  function primaryType() {
    let best = currentType();
    if (state.submission.grouping) {
      state.grouping.forEach((g) => { if (g.type && typeRankOf(g.type) > typeRankOf(best)) best = g.type; });
    }
    return best;
  }
  function groupingBuckets() {
    const c = { IA: 0, IB: 0, II: 0 };
    if (state.submission.grouping) state.grouping.forEach((g) => { if (g.type) { const b = feeBucket(g.type); if (b) c[b]++; } });
    return c;
  }
  function worksharingKinds() {
    const k = { national: 0, mrpdcp: 0 };
    if (state.submission.worksharing) state.worksharing.forEach((p) => { if (p.kind === "national") k.national++; else if (p.kind === "mrpdcp") k.mrpdcp++; });
    return k;
  }
  function raEffort() {
    const t = primaryType();
    if (!t || !window.VCL_WORKLOAD || !window.VCL_WORKLOAD.raHours) return null;
    return window.VCL_WORKLOAD.raHours({
      type: t, substance: state.activeSubstance, procedure: state.procedure.kind,
      cmsCount: state.procedure.kind === "mrpdcp" ? state.procedure.cms.length : 0,
      grouping: state.submission.grouping, worksharing: state.submission.worksharing,
      groupingCounts: groupingBuckets(), worksharingProcs: worksharingKinds(),
    });
  }
  function workflowSchedule() {
    const t = primaryType();
    if (!t || !window.VCL_WORKLOAD || !window.VCL_WORKLOAD.schedule) return null;
    return window.VCL_WORKLOAD.schedule({
      type: t, iiSub: state.iiSub, procedure: state.procedure.kind,
      cmsCount: state.procedure.kind === "mrpdcp" ? state.procedure.cms.length : 0,
      shared: state.submission.grouping || state.submission.worksharing,
      clockStopFraction: state.clockStopFraction,
    });
  }
  function addDays(dateStr, n) { const d = new Date(dateStr); if (isNaN(d.getTime())) return null; d.setDate(d.getDate() + n); return d; }
  function fmtDate(d) { return d ? (String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear()) : "—"; }

  // ---- shared data helpers (mirror the ones in vcl-workload.js) ----
  function findEntry(code) { return ENTRIES.find((e) => e.code === code) || null; }
  function findVariant(entry, variantId) {
    if (!entry || !entry.variants || !entry.variants.length) return null;
    if (entry.variants.length === 1) return entry.variants[0];
    return entry.variants.find((v) => v.id === variantId) || null;
  }
  function variantLabel(v) { return v && v.label ? v.label : ""; }
  function typeBadgeClass(type) {
    if (!type) return "badge";
    if (type.indexOf("IA") === 0) return "badge type-ia";
    if (type.indexOf("IB") === 0) return "badge type-ib";
    if (type.indexOf("II") === 0) return "badge type-ii";
    return "badge";
  }
  function pickedEntry() { return state.pickedCode ? findEntry(state.pickedCode) : null; }
  function pickedVariant() { const e = pickedEntry(); return e ? findVariant(e, state.pickedVariantId) : null; }
  // The variation type in play -- from the picked classification variant, or a type picked
  // directly without a classification (state.typeOnly).
  function currentType() { if (state.typeOnly) return state.typeOnly; const v = pickedVariant(); return v ? v.type : null; }
  function hasVariation() { return !!currentType(); }

  // ---- station gating ----
  function stationIndex(key) { return STATIONS.findIndex((s) => s.key === key); }
  function stationComplete(key) {
    if (key === "A") return hasVariation() && !!state.activeSubstance;
    if (key === "B") return procComplete(state.procedure);
    return true; // C/D are placeholders for now
  }
  function goto(key) { if (state.reached[key]) { state.station = key; rerender(); } }
  function advance(dir) {
    const i = stationIndex(state.station);
    const j = Math.max(0, Math.min(STATIONS.length - 1, i + dir));
    const key = STATIONS[j].key;
    state.reached[key] = true;
    state.station = key;
    rerender();
  }
  function resetAll() {
    state.station = "A";
    state.reached = { A: true, B: false, C: false, D: false };
    state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; state.typeOnly = null; state.activeSubstance = null;
    state.procedure = newProcedure(); state.submission = { grouping: false, worksharing: false };
    state.grouping = []; state.worksharing = []; state.worksharingLead = null;
    state.worksharingLeadSpecial = null; state.wsSpecials = {};
    state.submissionDate = ""; state.iiSub = "60"; state.clockStopFraction = 1;
    state.strengthsDefault = 1; state.strengthsOverrides = {};
    state.summaryShowVariations = false;
    rerender();
  }

  // ------------------------------------------------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildStations() {
    const wrap = el("div", "vcl-wf-stations");
    const activeIdx = stationIndex(state.station);
    STATIONS.forEach((s, i) => {
      const done = i < activeIdx && state.reached[s.key];
      const active = s.key === state.station;
      const btn = el("button", "vcl-wf-station" + (active ? " is-active" : "") + (done ? " is-done" : ""));
      btn.type = "button";
      btn.disabled = !state.reached[s.key];
      const dot = el("div", "vcl-wf-station__dot", done ? '<span aria-hidden="true">✓</span>' : s.key);
      const label = el("div", "vcl-wf-station__label", escapeHtml(s.label));
      btn.appendChild(dot); btn.appendChild(label);
      btn.addEventListener("click", () => goto(s.key));
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // ---- Station A: Identify (classification + active substance) ----
  function buildStationA(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Identify"));
    body.appendChild(el("div", "vcl-wf-body__sub", "Which active substance, and which variation(s)?"));

    // 1) Active substance -- first, independent of the variation choice.
    buildSubstance(body);

    // 2) The (base) variation.
    if (state.typeOnly) {
      buildTypeOnlyHeader(body);
    } else {
      const entry = pickedEntry();
      const variant = pickedVariant();
      if (!entry) { buildSearch(body); buildTypeQuickPick(body); return; }
      if (!variant) {
        buildPickedHeader(body, entry, null);
        const chooser = el("div", "vcl-wf-variants");
        entry.variants.forEach((v) => {
          const row = el("div", "vcl-wf-variant");
          row.innerHTML = `<span class="vcl-wf-variant__label">${escapeHtml(variantLabel(v) || entry.title)}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`;
          row.addEventListener("click", () => { state.pickedVariantId = v.id; rerender(); });
          chooser.appendChild(row);
        });
        body.appendChild(chooser);
        return;
      }
      buildPickedHeader(body, entry, variant);
    }

    // 3) Further variations -- listed here too; more than one is treated as a
    // grouping automatically (no separate toggle -- that lives nowhere now).
    buildGroupingList(body);
  }

  function buildSubstance(body) {
    const asHead = el("div", "vcl-wf-flabel", "Active substance");
    asHead.style.marginTop = "16px";
    body.appendChild(asHead);
    const opts = el("div", "vcl-wf-opts");
    [{ key: "biologic", label: "Biologic" }, { key: "chemical", label: "Chemically-synthesized API" }].forEach((o) => {
      const chip = el("button", "vcl-wf-opt" + (state.activeSubstance === o.key ? " is-on" : ""), escapeHtml(o.label));
      chip.type = "button";
      chip.addEventListener("click", () => { state.activeSubstance = o.key; rerender(); });
      opts.appendChild(chip);
    });
    body.appendChild(opts);
  }

  // Direct type pick when there is no classification code to choose.
  function buildTypeQuickPick(body) {
    const wrap = el("div", "vcl-wf-quicktype");
    wrap.appendChild(el("div", "vcl-wf-quicktype__label", "No classification code? Set the type directly:"));
    const opts = el("div", "vcl-wf-opts");
    ["IA", "IB", "II"].forEach((t) => {
      const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm", `Type ${t} <span class="${typeBadgeClass(t)}">${t}</span>`);
      chip.type = "button";
      chip.addEventListener("click", () => { state.typeOnly = t; state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
      opts.appendChild(chip);
    });
    wrap.appendChild(opts);
    body.appendChild(wrap);
  }

  function buildTypeOnlyHeader(body) {
    const picked = el("div", "vcl-wf-picked");
    picked.innerHTML = `<span>Variation type <span class="${typeBadgeClass(state.typeOnly)}">${escapeHtml(state.typeOnly)}</span> <span class="vcl-wf-sum__muted">&mdash; no classification code</span></span>`;
    const change = el("button", "vcl-wf-change", "Change");
    change.type = "button";
    change.addEventListener("click", () => { state.typeOnly = null; rerender(); });
    picked.appendChild(change);
    body.appendChild(picked);
  }

  function buildSearch(body) {
    const label = el("div", "vcl-wf-flabel", "Classification");
    body.appendChild(label);
    const box = el("div", "vcl-wf-search");
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ..."; input.value = state.query;
    input.addEventListener("input", () => { state.query = input.value; renderResults(); });
    box.appendChild(input);
    body.appendChild(box);

    const results = el("div", "vcl-wf-results");
    results.id = "vcl-wf-results";
    body.appendChild(results);
    renderResults();

    function renderResults() {
      const host = document.getElementById("vcl-wf-results");
      if (!host) return;
      host.innerHTML = "";
      const q = state.query.trim().toLowerCase();
      if (!q) { host.appendChild(el("p", "vcl-wf-hint", "Start typing a code (e.g. B.II.a) or a keyword.")); return; }
      const matches = ENTRIES.filter((e) => e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1);
      if (!matches.length) { host.appendChild(el("p", "vcl-wf-hint", "No matching classification codes.")); return; }
      matches.slice(0, 25).forEach((e) => {
        const row = el("button", "vcl-wf-result");
        row.type = "button";
        row.innerHTML = `<span class="vcl-wf-result__code">${escapeHtml(e.code)}</span> <span class="vcl-wf-result__title">${escapeHtml(e.title)}</span>`;
        row.addEventListener("click", () => {
          state.pickedCode = e.code;
          const only = e.variants && e.variants.length === 1 ? e.variants[0] : null;
          state.pickedVariantId = only ? only.id : undefined;
          rerender();
        });
        host.appendChild(row);
      });
      if (matches.length > 25) host.appendChild(el("p", "vcl-wf-hint", (matches.length - 25) + " more — refine your search."));
    }
  }

  function buildPickedHeader(body, entry, variant) {
    const picked = el("div", "vcl-wf-picked");
    const badge = variant ? ` <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>` : "";
    picked.innerHTML = `<span><span class="vcl-wf-picked__code">${escapeHtml(entry.code)}</span> &mdash; ${escapeHtml(entry.title)}${badge}</span>`;
    const change = el("button", "vcl-wf-change", "Change");
    change.type = "button";
    change.addEventListener("click", () => { state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
    picked.appendChild(change);
    body.appendChild(picked);
  }

  // ---- Station B: Procedure (country level) + submission type + list builders ----
  function buildStationB(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Procedure"));
    body.appendChild(el("div", "vcl-wf-body__sub", "How is it submitted, and where? Fees are per country, so the countries are set here."));

    body.appendChild(flabel("Procedure", 0));
    procEditor(body, state.procedure, {});

    // Submission type -- grouping is automatic (set in Identify by listing more than
    // one variation); only worksharing is chosen here.
    body.appendChild(flabel("Submission type", 18));
    const opts = el("div", "vcl-wf-opts");
    const wsChip = el("button", "vcl-wf-opt" + (state.submission.worksharing ? " is-on" : ""), "Worksharing");
    wsChip.type = "button";
    wsChip.addEventListener("click", () => { state.submission.worksharing = !state.submission.worksharing; rerender(); });
    opts.appendChild(wsChip);
    body.appendChild(opts);
    body.appendChild(el("p", "vcl-wf-hint", "Turn on when the change is shared across several procedures or authorisations. Grouping is applied automatically when you list more than one variation in Identify."));

    if (state.submission.worksharing) { buildWorksharingLead(body); buildWorksharingList(body); }
  }

  // Reusable procedure editor: kind (National/MRP-DCP/CP) + country-level selection.
  function procEditor(host, p, o) {
    const kinds = [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }];
    const row = el("div", "vcl-wf-opts");
    kinds.forEach((it) => {
      const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm" + (p.kind === it.k ? " is-on" : ""), escapeHtml(it.l));
      chip.type = "button";
      chip.addEventListener("click", () => { p.kind = it.k; rerender(); });
      row.appendChild(chip);
    });
    host.appendChild(row);

    const cd = countryData();
    if (p.kind === "national") {
      host.appendChild(countrySelect("Country", cd.national, p.nat, (cc) => { p.nat = cc; rerender(); }));
    } else if (p.kind === "mrpdcp") {
      host.appendChild(countrySelect("RMS (Reference Member State)", cd.rms, p.rms, (cc) => {
        p.rms = cc; p.cms = p.cms.filter((x) => x !== cc); rerender();
      }));
      const cmsLabel = flabel("CMS (Concerned Member States)", 10); host.appendChild(cmsLabel);
      const grid = el("div", "vcl-wf-cgrid");
      cd.cms.forEach((cc) => {
        const isRms = p.rms === cc;
        const on = p.cms.indexOf(cc) !== -1;
        const chip = el("button", "vcl-wf-cc" + (on ? " is-on" : "") + (isRms ? " is-disabled" : ""), escapeHtml(cc));
        chip.type = "button"; chip.disabled = isRms; chip.title = cd.nameOf[cc] || cc;
        chip.addEventListener("click", () => {
          if (on) p.cms = p.cms.filter((x) => x !== cc); else p.cms.push(cc);
          rerender();
        });
        grid.appendChild(chip);
      });
      host.appendChild(grid);
      host.appendChild(el("p", "vcl-wf-hint", "Each selected CMS is charged its own national fee. The RMS cannot also be a CMS."));
    } else if (p.kind === "cp") {
      host.appendChild(el("p", "vcl-wf-hint", "Centralised procedure — one authority (EMA), no country selection."));
    }
  }

  function countrySelect(labelText, ccList, current, onPick) {
    const wrap = el("div", "vcl-wf-field");
    wrap.appendChild(flabel(labelText, 10));
    const sel = document.createElement("select"); sel.className = "vcl-wf-select";
    const opt0 = document.createElement("option"); opt0.value = ""; opt0.textContent = "— select —"; sel.appendChild(opt0);
    const cd = countryData();
    ccList.forEach((cc) => {
      const o = document.createElement("option"); o.value = cc; o.textContent = (cd.nameOf[cc] || cc) + " (" + cc + ")";
      if (current === cc) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => onPick(sel.value || null));
    wrap.appendChild(sel);
    return wrap;
  }

  // Grouping list: additional variations sharing the same procedure(s)/countries.
  function buildGroupingList(host) {
    const panel = el("div", "vcl-wf-builder");
    const head = el("div", "vcl-wf-builder__head");
    head.appendChild(el("span", null, "Additional variations"));
    head.appendChild(el("span", "vcl-wf-count", String(state.grouping.length)));
    panel.appendChild(head);

    state.grouping.forEach((g, idx) => panel.appendChild(buildGroupingRow(g, idx)));

    const add = el("button", "vcl-wf-add", "＋ Add variation");
    add.type = "button";
    add.addEventListener("click", () => { state.grouping.push({ code: null, variantId: undefined, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
    host.appendChild(panel);
  }

  function buildGroupingRow(g, idx) {
    const row = el("div", "vcl-wf-brow");
    if (g.type) {
      // Resolved -- either a classification code or a bare type.
      if (g.code) {
        const e = findEntry(g.code);
        row.innerHTML = `<span class="vcl-wf-brow__main"><span class="vcl-wf-picked__code">${escapeHtml(g.code)}</span> ${escapeHtml(e ? e.title : "")} <span class="${typeBadgeClass(g.type)}">${escapeHtml(g.type)}</span></span>`;
      } else {
        row.innerHTML = `<span class="vcl-wf-brow__main">Type <span class="${typeBadgeClass(g.type)}">${escapeHtml(g.type)}</span> <span class="vcl-wf-sum__muted">&mdash; no classification code</span></span>`;
      }
    } else if (g.code) {
      // Code picked, but it has several variants -- pick the type.
      const e = findEntry(g.code);
      const main = el("div", "vcl-wf-brow__main");
      main.innerHTML = `<span><span class="vcl-wf-picked__code">${escapeHtml(g.code)}</span> ${escapeHtml(e ? e.title : "")}</span>`;
      // Full-width variant rows (label left, badge right) rather than mixed-width chips, so the
      // options line up cleanly down the whole width.
      const chooser = el("div", "vcl-wf-brow__pick");
      chooser.appendChild(el("div", "vcl-wf-hint", "pick the type:"));
      (e && e.variants ? e.variants : []).forEach((v) => {
        const opt = el("div", "vcl-wf-variant");
        opt.innerHTML = `<span class="vcl-wf-variant__label">${escapeHtml(variantLabel(v) || v.type)}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`;
        opt.addEventListener("click", () => { g.variantId = v.id; g.type = v.type; rerender(); });
        chooser.appendChild(opt);
      });
      main.appendChild(chooser);
      row.appendChild(main);
    } else {
      // Search by code/title, or set the type directly (no classification).
      const main = el("div", "vcl-wf-brow__main");
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "vcl-wf-brow__input"; inp.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ..."; inp.value = g.query || "";
      inp.addEventListener("input", () => { g.query = inp.value; renderMatches(); });
      main.appendChild(inp);
      const matches = el("div", "vcl-wf-brow__matches");
      main.appendChild(matches);
      const quick = el("div", "vcl-wf-brow__variants");
      quick.innerHTML = '<span class="vcl-wf-hint" style="margin:6px 6px 0 0;">or set the type directly:</span>';
      ["IA", "IB", "II"].forEach((t) => {
        const b = el("button", "vcl-wf-opt vcl-wf-opt--sm", `Type ${t} <span class="${typeBadgeClass(t)}">${t}</span>`);
        b.type = "button";
        b.addEventListener("click", () => { g.type = t; g.code = null; g.variantId = undefined; rerender(); });
        quick.appendChild(b);
      });
      main.appendChild(quick);
      row.appendChild(main);
      renderMatches();
      function renderMatches() {
        matches.innerHTML = "";
        const q = (g.query || "").trim().toLowerCase();
        if (!q) return;
        const hits = ENTRIES.filter((e) => e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1).slice(0, 6);
        hits.forEach((e) => {
          const m = el("button", "vcl-wf-brow__match");
          m.type = "button";
          m.innerHTML = `<span class="vcl-wf-result__code">${escapeHtml(e.code)}</span> ${escapeHtml(e.title)}`;
          m.addEventListener("click", () => {
            g.code = e.code;
            const only = e.variants && e.variants.length === 1 ? e.variants[0] : null;
            if (only) { g.variantId = only.id; g.type = only.type; } else { g.variantId = undefined; g.type = null; }
            rerender();
          });
          matches.appendChild(m);
        });
      }
    }
    const rm = el("button", "vcl-wf-rm", "✕");
    rm.type = "button"; rm.setAttribute("aria-label", "Remove");
    rm.addEventListener("click", () => { state.grouping.splice(idx, 1); rerender(); });
    row.appendChild(rm);
    return row;
  }

  // Worksharing lead (Station B): one authority leads the whole worksharing. Free choice of any
  // authority (including the EMA); locks to the EMA automatically when a CP is part of it. The fee
  // category is chosen later, in Station D (Fees).
  function buildWorksharingLead(host) {
    const cd = countryData();
    const hasCP = worksharingHasCP();
    const wrap = el("div", "vcl-wf-field");
    wrap.appendChild(flabel("Worksharing RMS (lead)", 12));
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
    sel.addEventListener("change", () => { state.worksharingLead = sel.value || null; rerender(); });
    wrap.appendChild(sel);
    wrap.appendChild(el("p", "vcl-wf-hint", hasCP
      ? "Automatically the EMA, because a Centralised procedure (CP) is part of the worksharing."
      : "Any authority can lead the worksharing — including the EMA. The fee category is set later, in Fees."));
    host.appendChild(wrap);
  }

  // Worksharing list: additional procedures (procedure 1 is the primary one above).
  function buildWorksharingList(host) {
    const panel = el("div", "vcl-wf-builder");
    const head = el("div", "vcl-wf-builder__head");
    head.appendChild(el("span", null, "Additional procedures (worksharing)"));
    head.appendChild(el("span", "vcl-wf-count", String(state.worksharing.length)));
    panel.appendChild(head);
    panel.appendChild(el("p", "vcl-wf-hint", "The primary procedure above counts as procedure 1. Add every further procedure the change is shared into — each with its own countries."));

    state.worksharing.forEach((p, idx) => {
      const card = el("div", "vcl-wf-pcard");
      const chead = el("div", "vcl-wf-pcard__head");
      chead.appendChild(el("span", null, "Procedure " + (idx + 2)));
      const rm = el("button", "vcl-wf-rm", "✕");
      rm.type = "button"; rm.setAttribute("aria-label", "Remove procedure");
      rm.addEventListener("click", () => { state.worksharing.splice(idx, 1); rerender(); });
      chead.appendChild(rm);
      card.appendChild(chead);
      procEditor(card, p, { removable: true });
      panel.appendChild(card);
    });

    const add = el("button", "vcl-wf-add", "＋ Add procedure");
    add.type = "button";
    add.addEventListener("click", () => { state.worksharing.push(newProcedure()); rerender(); });
    panel.appendChild(add);
    host.appendChild(panel);
  }

  function flabel(text, marginTop) {
    const d = el("div", "vcl-wf-flabel", escapeHtml(text));
    if (marginTop) d.style.marginTop = marginTop + "px";
    return d;
  }

  // ---- Station C: Date & Timeline ----
  function buildStationC(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Date & Timeline"));
    body.appendChild(el("div", "vcl-wf-body__sub", "When do you plan to submit, and how does the assessment clock run?"));

    // Desired submission date.
    body.appendChild(flabel("Desired initial submission date", 0));
    const dwrap = el("div", "vcl-wf-field");
    const date = document.createElement("input"); date.type = "date"; date.className = "vcl-wf-select"; date.value = state.submissionDate;
    date.addEventListener("change", () => { state.submissionDate = date.value; rerender(); });
    dwrap.appendChild(date); body.appendChild(dwrap);

    const t = primaryType();
    // Type II sub-procedure.
    if (t === "II") {
      body.appendChild(flabel("Type II procedure", 14));
      const opts = el("div", "vcl-wf-opts");
      ["30", "60", "90"].forEach((d) => {
        const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm" + (state.iiSub === d ? " is-on" : ""), d + "-day");
        chip.type = "button";
        chip.addEventListener("click", () => { state.iiSub = d; rerender(); });
        opts.appendChild(chip);
      });
      body.appendChild(opts);
    }

    const sch = workflowSchedule();
    if (!sch) {
      body.appendChild(el("div", "vcl-wf-placeholder", "A Type IA is not submitted individually — it runs on the Annual Update window (first implementation date +9 to +12 months), not on a submission–assessment–closure clock."));
      return;
    }

    // Timeline lives in its own host so the clock-stop slider can repaint just this part
    // (and the live preview) without rebuilding the slider under the cursor -- which is what
    // made the old version stutter.
    const tlHost = el("div", "vcl-wf-tlhost");

    if (sch.stopMax > 0) {
      const sl = el("div", "vcl-wf-slider");
      const lab = document.createElement("label");
      lab.innerHTML = "Clock-stop: <strong class=\"csv\">" + sch.stop + " d</strong> <span class=\"vcl-wf-hint\" style=\"display:inline;\">(range " + sch.stopMin + "–" + sch.stopMax + " d)</span>";
      sl.appendChild(lab);
      const range = document.createElement("input"); range.type = "range"; range.min = String(sch.stopMin); range.max = String(sch.stopMax); range.step = "1"; range.value = String(sch.stop);
      let raf = 0;
      range.addEventListener("input", () => {
        const v = parseInt(range.value, 10); const rg = sch.stopMax - sch.stopMin;
        state.clockStopFraction = rg > 0 ? (v - sch.stopMin) / rg : 0;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const s2 = workflowSchedule();
          const cs = lab.querySelector(".csv"); if (cs) cs.textContent = s2.stop + " d";
          tlHost.innerHTML = ""; buildTimelineView(tlHost, s2);
          repaintLive();
        });
      });
      sl.appendChild(range);
      body.appendChild(sl);
    }

    body.appendChild(tlHost);
    buildTimelineView(tlHost, sch);
  }

  function buildTimelineView(body, sch) {
    const total = Math.max(sch.dClose, 1);
    const pct = (d) => (d / total) * 100;
    const sd = state.submissionDate;
    const dateAt = (dayOffset) => sd ? fmtDate(addDays(sd, dayOffset - sch.dSub)) : null;

    const isII = primaryType() === "II";
    const hasStop = sch.stop > 0;
    // Guideline day-number of the outcome (excludes the clock-stop, exactly like the Workload
    // tool's nominalEop): II with questions runs to a1+a2 (e.g. day 90), II without ends at the
    // FVAR (a1+1, e.g. day 60), IB ends at its decision day (a1).
    const nominalEop = isII ? (sch.showA2 ? sch.a1 + sch.a2 : sch.a1 + 1) : sch.a1;

    // ---- Milestone markers pointing down at the bar: Submission -> Day 0 -> (RSI) -> EOP.
    // The close Submission/Day-0 pair is staggered vertically (lift) so the labels never collide.
    const marks = el("div", "vcl-wf-tl-marks");
    function mark(pos, main, sub, lift) {
      const m = el("div", "vcl-wf-tl-mark");
      m.style.left = pct(pos) + "%";
      m.innerHTML = (sub ? '<span class="s">' + escapeHtml(sub) + "</span>" : "")
        + '<span class="t">' + escapeHtml(main) + "</span>"
        + '<span class="conn" style="height:' + (lift ? 18 : 2) + 'px;"></span>'
        + '<span class="a" aria-hidden="true">&#9660;</span>';
      marks.appendChild(m);
    }
    // Short labels only -- the long glosses live in the legend below, so nothing collides.
    mark(sch.dSub, "Submission", "", true);
    mark(sch.dDay0, "Day 0", "", false);
    if (hasStop) mark(sch.dA1End, "Day " + sch.a1, "RSI", true);
    mark(sch.dEop, "Day " + nominalEop, "EOP", false);
    body.appendChild(marks);

    // Mini bar.
    const bar = el("div", "vcl-wf-tl");
    function seg(cls, start, len) { if (len <= 0) return; const s = el("div", "vcl-wf-tl-seg " + cls); s.style.left = pct(start) + "%"; s.style.width = pct(len) + "%"; bar.appendChild(s); }
    seg("prep", 0, sch.dSub);
    seg("val", sch.dSub, sch.validationDays);
    seg("assess", sch.dDay0, sch.a1);
    if (sch.stop > 0) seg("stop", sch.dA1End, sch.stop);
    if (sch.showA2) seg("assess", sch.dStopEnd, sch.a2);
    seg("closure", sch.dEop, sch.closureDays);
    body.appendChild(bar);

    // Duration arrows under the bar (like the Timetables view): the key spans from Submission
    // through Day 0 to the EOP, each labelled with its length in calendar days. Same 0..dClose
    // scale as the bar above, so every arrow sits directly under its segment.
    const durRow = el("div", "vcl-wf-tl-durrow");
    function durArrow(fromDay, toDay, label) {
      if (toDay - fromDay <= 0) return;
      const d = el("div", "vcl-wf-tl-dur");
      d.style.left = pct(fromDay) + "%";
      d.style.width = (pct(toDay) - pct(fromDay)) + "%";
      d.innerHTML = "<span>" + escapeHtml(label) + "</span>";
      durRow.appendChild(d);
    }
    durArrow(sch.dSub, sch.dDay0, sch.validationDays + " d");   // Submission -> Day 0 (validation)
    durArrow(sch.dDay0, sch.dA1End, sch.a1 + " d");             // assessment (to RSI / clock-stop)
    if (sch.stop > 0) durArrow(sch.dA1End, sch.dStopEnd, sch.stop + " d"); // clock-stop
    if (sch.showA2) durArrow(sch.dStopEnd, sch.dEop, sch.a2 + " d");       // assessment 2 -> EOP
    body.appendChild(durRow);

    // Phase labels under the arrows -- names the assessment phases the arrows measure.
    const phases = el("div", "vcl-wf-tl-phases");
    function phase(start, len, label) {
      if (len <= 0) return;
      const p = el("div", "vcl-wf-tl-phase");
      p.style.left = pct(start) + "%";
      p.style.width = pct(len) + "%";
      p.innerHTML = "<span>" + escapeHtml(label) + "</span>";
      phases.appendChild(p);
    }
    phase(sch.dSub, sch.validationDays, "Validation");
    phase(sch.dDay0, sch.a1, sch.showA2 ? "Assessment 1" : "Assessment");
    if (hasStop) phase(sch.dA1End, sch.stop, "Clock-stop");
    if (sch.showA2) phase(sch.dStopEnd, sch.a2, "Assessment 2");
    body.appendChild(phases);

    // Small legend: the two RA-owned segments that book-end the clock (shown as colour swatches
    // keyed to the bar), plus a gloss for the marker abbreviations.
    const legend = el("div", "vcl-wf-tl-legend");
    legend.innerHTML =
      '<span class="k"><i class="sw prep"></i>Preparation (RA)</span>'
      + '<span class="k"><i class="sw closure"></i>Closure by RA</span>'
      + '<span class="note">Day 0 = start of assessment · EOP = end of procedure'
      + (hasStop ? " · RSI = authority's questions (clock-stop)" : "") + "</span>";
    body.appendChild(legend);

    // Milestones.
    const rows = [
      { l: "Preparation start", d: 0 },
      { l: "Submission", d: sch.dSub, strong: true },
      { l: "Start of assessment (Day 0)", d: sch.dDay0 },
      { l: "End of Procedure (EOP)", d: sch.dEop, strong: true },
      { l: "Closure by RA", d: sch.dClose },
    ];
    const list = el("div", "vcl-wf-tl-list");
    rows.forEach((r) => {
      const line = el("div", "vcl-wf-tl-row" + (r.strong ? " is-strong" : ""));
      const dateStr = dateAt(r.d);
      line.innerHTML = `<span class="vcl-wf-tl-row__l">${escapeHtml(r.l)}</span>`
        + `<span class="vcl-wf-tl-row__d">${dateStr ? escapeHtml(dateStr) : "day " + (r.d - sch.dSub >= 0 ? "+" : "") + (r.d - sch.dSub)}</span>`;
      list.appendChild(line);
    });
    body.appendChild(list);

    const dur = el("p", "vcl-wf-hint", "Submission → EOP: <strong>" + sch.subToEop + " calendar days</strong> (~" + Math.round(sch.subToEop / 30.4 * 10) / 10 + " months). Preparation → closure: " + sch.totalDays + " days."
      + (hasStop ? " The day-numbers above (EOP = day " + nominalEop + ") follow the guideline clock and exclude the clock-stop." : "")
      + (sd ? "" : " Enter a date above to see calendar dates."));
    body.appendChild(dur);
  }

  // ---- Station D: Fees, per procedure, at country level ----
  function buildStationD(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Fees"));
    body.appendChild(el("div", "vcl-wf-body__sub", "The official fee for each procedure, country by country."));

    const counts = feeCounts();
    if (feeCountsTotal(counts) === 0) {
      body.appendChild(el("div", "vcl-wf-placeholder", "Pick a classification in step A first — then the fees appear here."));
      return;
    }

    // What is being priced (IA/IB/II tally).
    const tally = ["IA", "IB", "II"].filter((t) => counts[t] > 0).map((t) => counts[t] + " × Type " + t).join(" · ");
    body.appendChild(el("p", "vcl-wf-hint", "Priced for: " + tally + " in every procedure."));

    buildStrengths(body);

    const ws = wsActive();
    const lead = leadFees(counts); // null unless the worksharing lead can be priced
    const procs = allProcedures();
    let grand = 0;
    let anyCountries = false;

    // Worksharing: the lead's one-off fee sits in its own box, above the procedures.
    if (state.submission.worksharing) {
      buildWorksharingLeadBox(body, lead);
      if (lead) { grand += lead.total || 0; anyCountries = true; }
    }

    const cd = countryData();
    procs.forEach((p, i) => {
      const card = el("div", "vcl-wf-fee-proc");
      const head = el("div", "vcl-wf-fee-proc__head");
      head.appendChild(el("span", null, "Procedure " + (i + 1) + " — " + escapeHtml(procLabel(p))));
      const ccAll = procCountries(p);
      if (!ccAll.length) {
        head.appendChild(el("span", "vcl-wf-fee-proc__sum", "no countries yet"));
        card.appendChild(head);
        body.appendChild(card);
        return;
      }
      anyCountries = true;
      const r = procFees(p, counts); // in a worksharing the lead is already excluded here
      head.appendChild(el("span", "vcl-wf-fee-proc__sum", fmtEUR(r.grandTotal)));
      card.appendChild(head);
      grand += r.grandTotal;

      // The engine results run in ccAll order minus (in a worksharing) the lead, which gets
      // a zero line instead -- walk both lists in lockstep.
      let k = 0;
      ccAll.forEach((x) => {
        const isLeadLine = ws && x.cc === state.worksharingLead;
        const cr = isLeadLine ? null : r.countries[k++];
        const line = el("div", "vcl-wf-fee-line");
        const name = (cd.nameOf[x.cc] || x.cc);
        const roleShort = { RMS: "RMS", CMS: "CMS", national: "national", EMA: "EMA" }[x.role] || x.role;
        const strengthsNote = (!ws && x.strengths > 1) ? ` <span class="vcl-wf-fee-line__role">×${x.strengths} strengths</span>` : "";
        line.appendChild(el("span", "vcl-wf-fee-line__c",
          `${escapeHtml(name)} <span class="vcl-wf-fee-line__cc">${escapeHtml(x.cc)}</span> <span class="vcl-wf-fee-line__role">${escapeHtml(roleShort)}</span>${strengthsNote}`));
        if (isLeadLine) {
          // Double-counting guard: the lead is priced once, in the lead box above.
          line.appendChild(el("span", "vcl-wf-fee-line__r",
            `<span class="vcl-wf-fee-line__note">priced as worksharing lead above</span><span class="vcl-wf-fee-line__amt">${fmtEUR(0)}</span>`));
        } else if (ws) {
          const right = el("span", "vcl-wf-fee-line__r");
          const prole = wsPricingRole(x.role);
          const opts = specialOptionsFor(x.cc, prole);
          if (opts.length) {
            right.appendChild(specialSelect(opts, wsSpecialFor(x.cc, prole), (v) => {
              if (v) state.wsSpecials[wsSpecialKey(x.cc, prole)] = v;
              else delete state.wsSpecials[wsSpecialKey(x.cc, prole)];
              rerender();
            }));
          }
          right.appendChild(el("span", "vcl-wf-fee-line__str", x.strengths + (x.strengths === 1 ? " strength" : " strengths")));
          right.appendChild(el("span", "vcl-wf-fee-line__amt", cr.hasData ? fmtEUR(cr.total) : "no fee data"));
          line.appendChild(right);
        } else {
          line.appendChild(el("span", "vcl-wf-fee-line__amt", cr.hasData ? fmtEUR(cr.total) : "no fee data"));
        }
        card.appendChild(line);
      });
      body.appendChild(card);
    });

    if (anyCountries) {
      const gt = el("div", "vcl-wf-fee-grand");
      gt.innerHTML = `<span>Total across ${procs.length} procedure${procs.length > 1 ? "s" : ""}</span><span>${fmtEUR(grand)}</span>`;
      body.appendChild(gt);
      body.appendChild(el("p", "vcl-wf-hint", "Fees are per country and per procedure; grouped variations share a procedure, worksharing repeats the change across procedures. Live rates apply where a country charges in local currency."));
    }

    buildSummaryCard(body, grand, anyCountries);
  }

  // The worksharing lead's one-off fee (Station D): the lead authority is charged exactly
  // once, here, with its own special-case pick -- and shown as a zero line wherever it also
  // appears inside a procedure below.
  function buildWorksharingLeadBox(host, lead) {
    const box = el("div", "vcl-wf-ws-lead");
    box.appendChild(el("div", "vcl-wf-ws-lead__head", "Worksharing RMS (lead)"));
    if (!state.worksharingLead) {
      box.appendChild(el("p", "vcl-wf-hint", "Pick the lead authority in step B (Procedure) — its one-off worksharing fee will appear here."));
      host.appendChild(box);
      return;
    }
    const cd = countryData();
    const cc = state.worksharingLead;
    const line = el("div", "vcl-wf-fee-line");
    line.appendChild(el("span", "vcl-wf-fee-line__c",
      `${escapeHtml(cd.nameOf[cc] || cc)} <span class="vcl-wf-fee-line__cc">${escapeHtml(cc)}</span> <span class="vcl-wf-fee-line__role">worksharing lead${worksharingHasCP() ? " · auto (CP)" : ""}</span>`));
    const right = el("span", "vcl-wf-fee-line__r");
    const opts = specialOptionsFor(cc, leadPricingRole());
    if (opts.length) {
      right.appendChild(specialSelect(opts, state.worksharingLeadSpecial, (v) => { state.worksharingLeadSpecial = v; rerender(); }));
    }
    const n = strengthsFor(cc);
    right.appendChild(el("span", "vcl-wf-fee-line__str", n + (n === 1 ? " strength" : " strengths")));
    right.appendChild(el("span", "vcl-wf-fee-line__amt", (lead && lead.hasData) ? fmtEUR(lead.total) : "no fee data"));
    line.appendChild(right);
    box.appendChild(line);
    box.appendChild(el("p", "vcl-wf-hint", "The lead is charged once, here — its worksharing fee category where published, otherwise the standard one. In its own procedure below it is not charged again."));
    host.appendChild(box);
  }

  // Small dropdown over the published Type-II special-case labels ("Standard" = no special).
  function specialSelect(options, current, onChange) {
    const sel = document.createElement("select");
    sel.className = "vcl-wf-fee-sel";
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "Standard";
    sel.appendChild(o0);
    options.forEach((s) => {
      const o = document.createElement("option");
      o.value = s; o.textContent = s;
      if (current === s) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => onChange(sel.value || null));
    return sel;
  }

  // Every variation in play (base + resolved grouping) -- for the summary's Variation(s) row.
  function summaryVariations() {
    const out = [];
    const e = pickedEntry(); const v = pickedVariant();
    if (v) out.push({ code: e.code, title: e.title, type: v.type });
    else if (state.typeOnly) out.push({ code: null, title: null, type: state.typeOnly });
    if (state.submission.grouping) {
      state.grouping.forEach((g) => {
        if (!g.type) return; // still unresolved -- not a real variation yet
        const ge = g.code ? findEntry(g.code) : null;
        out.push({ code: g.code || null, title: ge ? ge.title : null, type: g.type });
      });
    }
    return out;
  }

  // One procedure spelled out for the summary: "National: DE", "RMS: DE · CMS: BG, FR", or "CP".
  function procDetail(p) {
    if (!p) return "—";
    if (p.kind === "national") return "National: " + (p.nat || "?");
    if (p.kind === "cp") return "CP";
    if (p.kind === "mrpdcp") {
      let s = "RMS: " + (p.rms || "?");
      if (p.cms && p.cms.length) s += " · CMS: " + p.cms.join(", ");
      return s;
    }
    return "";
  }

  // Closing recap of the whole path -- the "you are here, and this is the plan" card.
  function buildSummaryCard(body, grand, anyCountries) {
    const card = el("div", "vcl-wf-sum");
    card.appendChild(el("div", "vcl-wf-sum__title", "Summary"));

    function line(label, valueHtml) {
      const r = el("div", "vcl-wf-sum__row");
      r.innerHTML = `<span class="vcl-wf-sum__l">${escapeHtml(label)}</span><span class="vcl-wf-sum__v">${valueHtml}</span>`;
      card.appendChild(r);
      return r;
    }

    // 1) Active substance -- first.
    if (state.activeSubstance) line("Active substance", state.activeSubstance === "biologic" ? "Biologic" : "Chemically-synthesized API");

    // 2) Variation (single) / Variations (grouped). The old separate Grouping row is folded in here.
    const vars = summaryVariations();
    if (vars.length <= 1) {
      const v = vars[0];
      if (v && v.code) line("Variation", `${escapeHtml(v.code)} — ${escapeHtml(v.title || "")} <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`);
      else if (v) line("Variation", `Type <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span> <span class="vcl-wf-sum__muted">(no classification code)</span>`);
    } else {
      const counts = { IA: 0, IB: 0, II: 0 };
      vars.forEach((v) => { const b = feeBucket(v.type); if (b) counts[b]++; });
      const bits = ["IA", "IB", "II"].filter((t) => counts[t] > 0).map((t) => counts[t] + " × " + t);
      const row = line("Variations",
        `<span class="vcl-wf-sum__tag">Grouping</span> ${vars.length} variations <span class="vcl-wf-sum__muted">(${escapeHtml(bits.join(" · "))})</span>`
        + ` <button type="button" class="vcl-wf-sum__toggle" data-sum-toggle>${state.summaryShowVariations ? "Hide" : "Show"} codes &amp; descriptions</button>`);
      const tg = row.querySelector("[data-sum-toggle]");
      if (tg) tg.addEventListener("click", () => { state.summaryShowVariations = !state.summaryShowVariations; rerender(); });
      if (state.summaryShowVariations) {
        // One line per variation (IA -> IB -> II, no sub-headers): code + badge + muted
        // one-line description.
        const vlist = el("div", "vcl-wf-sum__vlist");
        const sorted = vars.slice().sort((a, b) => typeRankOf(a.type) - typeRankOf(b.type));
        sorted.forEach((v) => {
          const it = el("div", "vcl-wf-sum__vitem1");
          const desc = v.title ? escapeHtml(v.title) : "no classification code";
          it.innerHTML = `<span class="vcl-wf-sum__vcode">${escapeHtml(v.code || "Type " + v.type)}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span> <span class="vcl-wf-sum__vdesc">— ${desc}</span>`;
          vlist.appendChild(it);
        });
        card.appendChild(vlist);
      }
    }

    // 3) Procedure (single) / Procedures (worksharing). The old separate Worksharing row is folded in.
    const procs = allProcedures();
    if (procs.length <= 1) {
      line("Procedure", escapeHtml(procDetail(procs[0])));
    } else {
      // [Proposal B, shown live] Worksharing header (with the lead) + each procedure on its own line.
      const cd = countryData();
      const leadBit = state.worksharingLead
        ? ` led by <strong>${escapeHtml(cd.nameOf[state.worksharingLead] || state.worksharingLead)}</strong> <span class="vcl-wf-sum__muted">·</span>`
        : "";
      line("Procedures", `<span class="vcl-wf-sum__tag">Worksharing</span>${leadBit} ${procs.length} procedures`);
      const plist = el("div", "vcl-wf-sum__plist");
      procs.forEach((p, i) => {
        const it = el("div", "vcl-wf-sum__pitem");
        it.innerHTML = `<span class="vcl-wf-sum__pn">${i + 1}</span> ${escapeHtml(procDetail(p))}`;
        plist.appendChild(it);
      });
      card.appendChild(plist);
    }

    // 4) Timeline / RA effort / fees.
    const sch = workflowSchedule();
    if (sch) {
      const sd = state.submissionDate;
      if (sd) {
        line("Timeline", `${escapeHtml(fmtDate(addDays(sd, 0)))} &rarr; EOP ${escapeHtml(fmtDate(addDays(sd, sch.subToEop)))} <span class="vcl-wf-sum__muted">(${sch.subToEop} days)</span>`);
      } else {
        line("Timeline", `Submission &rarr; EOP <strong>${sch.subToEop} days</strong> <span class="vcl-wf-sum__muted">— add a date in step C</span>`);
      }
    }

    const ra = raEffort();
    if (ra !== null) line("RA workload", `~ ${escapeHtml(fmtNum(ra))} h`);
    if (anyCountries) line("Total fees", `<strong>${escapeHtml(fmtEUR(grand))}</strong>`);
    body.appendChild(card);
  }


  // Strengths (Proposal 3): one default for all countries, with per-country overrides shown
  // only for countries whose fee actually changes with the number of strengths.
  function buildStrengths(host) {
    const wrap = el("div", "vcl-wf-strength");
    const row = el("div", "vcl-wf-strength__row");
    row.appendChild(el("span", "vcl-wf-strength__l", "Strengths (default for all countries)"));
    const def = numInput(state.strengthsDefault, (v) => { state.strengthsDefault = v; });
    row.appendChild(def);
    wrap.appendChild(row);

    const sens = strengthsSensitiveList();
    if (!sens.length) {
      wrap.appendChild(el("p", "vcl-wf-hint", "None of the selected countries charge per strength — this default is all that is needed."));
      host.appendChild(wrap);
      return;
    }

    // Show the strength-sensitive countries straight away: users can't be expected to know which
    // markets charge per strength, so we list them here (rather than hiding them behind a toggle)
    // each with its own input, pre-filled from the default. Changing one makes it a per-country
    // value; the rest keep following the default.
    const cd = countryData();
    wrap.appendChild(el("p", "vcl-wf-hint", "These countries charge per strength — set a different number for any that differ from the default:"));
    const list = el("div", "vcl-wf-strength__list");
    sens.forEach((x) => {
      const r = el("div", "vcl-wf-strength__row");
      r.appendChild(el("span", "vcl-wf-strength__l", `${escapeHtml(cd.nameOf[x.cc] || x.cc)} <span class="vcl-wf-fee-line__cc">${escapeHtml(x.cc)}</span>`));
      const cur = strengthsFor(x.cc);
      const inp = numInput(cur, (v) => { state.strengthsOverrides[x.cc] = v; });
      r.appendChild(inp);
      list.appendChild(r);
    });
    wrap.appendChild(list);
    host.appendChild(wrap);
  }
  function numInput(value, onInput) {
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "1"; inp.className = "vcl-wf-num"; inp.value = String(value);
    inp.addEventListener("input", () => { onInput(Math.max(1, parseInt(inp.value, 10) || 1)); });
    inp.addEventListener("change", () => rerender());
    return inp;
  }

  // ---- placeholder stations ----
  function buildPlaceholder(body, key) {
    const meta = STATION_META[key];
    body.appendChild(el("div", "vcl-wf-body__title", escapeHtml(meta.title)));
    body.appendChild(el("div", "vcl-wf-body__sub", escapeHtml(meta.sub)));
    body.appendChild(el("div", "vcl-wf-placeholder", escapeHtml(meta.note)));
  }

  function buildBody() {
    const body = el("div", "vcl-wf-body");
    if (state.station === "A") buildStationA(body);
    else if (state.station === "B") buildStationB(body);
    else if (state.station === "C") buildStationC(body);
    else if (state.station === "D") buildStationD(body);
    else buildPlaceholder(body, state.station);

    const nav = el("div", "vcl-wf-nav");
    const back = el("button", "vcl-wf-btn", "← Back");
    back.type = "button";
    back.disabled = stationIndex(state.station) === 0;
    back.addEventListener("click", () => advance(-1));
    const isLast = stationIndex(state.station) === STATIONS.length - 1;
    if (isLast) {
      const over = el("button", "vcl-wf-btn", "↺ Start over");
      over.type = "button";
      over.addEventListener("click", resetAll);
      nav.appendChild(back); nav.appendChild(over);
    } else {
      const next = el("button", "vcl-wf-btn vcl-wf-btn--primary", "Next →");
      next.type = "button";
      next.disabled = !stationComplete(state.station);
      next.addEventListener("click", () => advance(1));
      nav.appendChild(back); nav.appendChild(next);
    }
    body.appendChild(nav);
    return body;
  }

  // ---- Live preview (docked at the bottom) ----
  function buildLive() {
    const live = el("div", "vcl-wf-live");
    live.appendChild(el("div", "vcl-wf-live__head",
      '<span aria-hidden="true">◉</span> Live preview <span class="hint">updates as you go</span>'));

    // Running summary of decisions made so far.
    const chips = el("div", "vcl-wf-live__chips");
    const variant = pickedVariant();
    if (variant) {
      const e = pickedEntry();
      chips.appendChild(el("span", "vcl-wf-chip", `${escapeHtml(e.code)} <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>`));
    } else if (state.typeOnly) {
      chips.appendChild(el("span", "vcl-wf-chip", `<span class="${typeBadgeClass(state.typeOnly)}">${escapeHtml(state.typeOnly)}</span>`));
    }
    // Grouping: a type tally of the ADDITIONAL variations, right next to the base variation's
    // chip (replaces the old bare "N variations" count).
    if (state.submission.grouping) {
      const gb = groupingBuckets();
      const bits = ["IA", "IB", "II"].filter((t) => gb[t] > 0).map((t) => gb[t] + " × " + t);
      if (bits.length) chips.appendChild(el("span", "vcl-wf-chip", "Grouping " + bits.join(" · ")));
    }
    if (state.activeSubstance) {
      chips.appendChild(el("span", "vcl-wf-chip", state.activeSubstance === "biologic" ? "Biologic" : "Chemical API"));
    }
    // Procedure: in a worksharing, "Worksharing" + the lead replace the procedure chip (and
    // the old "N procedures" count); otherwise the primary procedure shows as before.
    if (state.submission.worksharing) {
      chips.appendChild(el("span", "vcl-wf-chip", "Worksharing"));
      if (state.worksharingLead) chips.appendChild(el("span", "vcl-wf-chip", "WS-Lead-RMS: " + escapeHtml(state.worksharingLead)));
    } else if (procComplete(state.procedure)) {
      chips.appendChild(el("span", "vcl-wf-chip", escapeHtml(procLabel(state.procedure))));
    }
    if (!chips.children.length) chips.appendChild(el("span", "vcl-wf-hint", "Your choices will appear here as you go."));
    live.appendChild(chips);

    const row = el("div", "vcl-wf-live__row");
    const ra = raEffort();
    row.appendChild(el("div", "vcl-wf-live__stat", '<div class="v">' + (ra !== null ? escapeHtml(fmtNum(ra)) + " h" : "—") + '</div><div class="l">RA workload</div>'));

    const sch = workflowSchedule();
    let midHtml = '<div class="l" style="font-size:10px;color:var(--muted);margin-bottom:4px;">Timeline</div>';
    if (sch) {
      const total = Math.max(sch.dClose, 1);
      const p = (d) => (d / total) * 100;
      midHtml += '<div class="vcl-wf-tl vcl-wf-tl--mini">'
        + seg2("prep", 0, sch.dSub, p) + seg2("val", sch.dSub, sch.validationDays, p)
        + seg2("assess", sch.dDay0, sch.a1, p) + (sch.stop > 0 ? seg2("stop", sch.dA1End, sch.stop, p) : "")
        + (sch.showA2 ? seg2("assess", sch.dStopEnd, sch.a2, p) : "") + seg2("closure", sch.dEop, sch.closureDays, p)
        + '</div>'
        + '<div style="font-size:10px;color:var(--muted);margin-top:3px;">Sub → EOP ≈ ' + sch.subToEop + ' d</div>';
    } else {
      midHtml += '<div style="font-size:11px;color:var(--ink-faint);">set the procedure and date first</div>';
    }
    row.appendChild(el("div", "vcl-wf-live__mid", midHtml));

    const fee = grandTotalFees();
    row.appendChild(el("div", "vcl-wf-live__stat", '<div class="v">' + (fee !== null ? escapeHtml(fmtEUR(fee)) : "—") + '</div><div class="l">Fee (total)</div>'));
    live.appendChild(row);
    return live;
  }

  let liveHost = null;

  function rerender() {
    if (!container) return;
    // Grouping is automatic: it is "on" whenever more than the base variation is
    // listed in Identify. Derived here so every downstream reader (fees, timeline,
    // RA workload, summary, live preview) stays correct without a manual toggle.
    state.submission.grouping = state.grouping.some((g) => g.type);
    // Worksharing lead: a Centralised procedure (EMA) auto-leads the worksharing (the field locks).
    if (state.submission.worksharing && worksharingHasCP()) state.worksharingLead = countryData().ema;
    container.innerHTML = "";
    const root = el("div", "vcl-wf");
    const head = el("div", "vcl-wf-head");
    // Reference / "Last updated" note mirrors the Fee Calculator's (this tool carries the same
    // official fees), using the same admin-editable VCL_CONFIG keys with the calculator's
    // fee-data date as the fallback -- see fillCalcHead() in vcl-app.js.
    const calcUpdated = (window.VCLCALC_META && window.VCLCALC_META.lastUpdated) || "see fee schedules";
    head.innerHTML = "<h3>Guided Workflow</h3>"
      + "<p><strong>Best for planning one variation end to end</strong> &mdash; or a grouped set &mdash; from classification through procedure and timeline to the fees. The live preview below updates as you go.</p>"
      + '<p class="ref-line">Reference: ' + cfgReferenceText("calculator", "Official fee schedules of the respective authorities (EU-27, EMA, CH, IS, NO, UK, RS).") + "</p>"
      + '<p class="ref-updated">Last updated in Variation Toolbox: ' + cfgLastUpdated("calculator", calcUpdated) + "</p>";
    root.appendChild(head);
    root.appendChild(buildStations());
    root.appendChild(buildBody());
    const live = buildLive();
    liveHost = live;
    root.appendChild(live);
    container.appendChild(root);
  }

  // Repaint just the live-preview card (used by the clock-stop slider so it stays smooth).
  function repaintLive() {
    if (!liveHost || !liveHost.parentNode) return;
    const fresh = buildLive();
    liveHost.parentNode.replaceChild(fresh, liveHost);
    liveHost = fresh;
  }

  // Admin-editable "Last updated"/"Reference" values, same lookup as vcl-app.js's helpers --
  // this IIFE can't reach those, so it reads window.VCL_CONFIG directly, with a fallback.
  function cfgLastUpdated(key, fallback) {
    return (window.VCL_CONFIG && window.VCL_CONFIG.lastUpdated && window.VCL_CONFIG.lastUpdated[key]) || fallback;
  }
  function cfgReferenceText(key, fallback) {
    return (window.VCL_CONFIG && window.VCL_CONFIG.referenceText && window.VCL_CONFIG.referenceText[key]) || fallback;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtNum(n) {
    if (n == null) return "—";
    const r = Math.round(n * 100) / 100;
    return (Math.abs(r - Math.round(r)) < 0.005) ? String(Math.round(r)) : String(r);
  }
  // Mini-bar segment as an HTML string (for the live-preview timeline sketch).
  function seg2(cls, start, len, p) {
    if (len <= 0) return "";
    return '<div class="vcl-wf-tl-seg ' + cls + '" style="left:' + p(start) + '%;width:' + p(len) + '%;"></div>';
  }

  // Hand-off from the Reference Guide's Summary: seed Station A with the first variation and,
  // when there is more than one, tick Grouping and drop the rest into the grouping list (each
  // carrying its classification code). The user can still add more variations. A single variation
  // leaves Grouping off. vcl-app.js calls this right before switching to the workflow view.
  function prefillFromVariations(vars) {
    resetAll();
    if (!vars || !vars.length) return;
    // The base shown in Identify is the HIGHEST-type variation, since that one drives the group's
    // flow (a Type II grouping runs as a Type II). The rest go into the grouping list.
    const sorted = vars.slice().sort((a, b) => typeRankOf(b.type) - typeRankOf(a.type));
    const first = sorted[0];
    state.pickedCode = first.code || null;
    state.pickedVariantId = first.variantId;
    const rest = sorted.slice(1);
    if (rest.length) {
      state.submission.grouping = true;
      state.grouping = rest.map((v) => ({ code: v.code || null, variantId: v.variantId, type: v.type || null, query: "" }));
    }
    rerender();
  }

  window.VCL_WORKFLOW = {
    render(col) {
      container = col;
      rerender();
    },
    prefill(payload) {
      prefillFromVariations((payload && payload.variations) || []);
    },
  };
})();
