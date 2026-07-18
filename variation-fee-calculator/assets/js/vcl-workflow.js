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
    activeSubstance: null, // 'biologic' | 'chemical'
    // Station B
    procedure: newProcedure(),        // the primary procedure ("procedure 1")
    submission: { grouping: false, worksharing: false },
    grouping: [],                      // additional variations: [{ code, variantId, type }]
    worksharing: [],                   // additional procedures: [newProcedure(), ...]
    // Station C
    submissionDate: "",
    iiSub: "60",                       // Type II sub-procedure: 30 | 60 | 90 (days)
    clockStopFraction: 1,              // 0..1 across the clock-stop min..max
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

  // Flatten a procedure to the (cc, role) pairs the fee engine consumes.
  function procCountries(p) {
    if (!p) return [];
    if (p.kind === "national") return p.nat ? [{ cc: p.nat, role: "national" }] : [];
    if (p.kind === "cp") { const e = countryData().ema; return e ? [{ cc: e, role: "EMA" }] : []; }
    if (p.kind === "mrpdcp") {
      const out = [];
      if (p.rms) out.push({ cc: p.rms, role: "RMS" });
      p.cms.forEach((cc) => out.push({ cc: cc, role: "CMS" }));
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
    const base = pickedVariant();
    if (base) { const b = feeBucket(base.type); if (b) c[b]++; }
    if (state.submission.grouping) state.grouping.forEach((g) => { if (g.type) { const b = feeBucket(g.type); if (b) c[b]++; } });
    return c;
  }
  function feeCountsTotal(c) { return c.IA + c.IB + c.II; }
  function allProcedures() {
    const list = [state.procedure];
    if (state.submission.worksharing) state.worksharing.forEach((p) => list.push(p));
    return list;
  }
  function fmtEUR(v) {
    if (v === null || v === undefined) return "–";
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  }
  // Fees for one procedure, via the shared engine (window.VCLCALC.computeFees).
  function procFees(p, counts) {
    if (!window.VCLCALC || !window.VCLCALC.computeFees) return null;
    const cc = procCountries(p);
    if (!cc.length || feeCountsTotal(counts) === 0) return { countries: [], grandTotal: 0 };
    return window.VCLCALC.computeFees({ countries: cc, counts: counts });
  }
  function grandTotalFees() {
    const counts = feeCounts();
    if (feeCountsTotal(counts) === 0) return null;
    let total = 0;
    let any = false;
    allProcedures().forEach((p) => { const r = procFees(p, counts); if (r) { total += r.grandTotal; if (procCountries(p).length) any = true; } });
    return any ? total : null;
  }

  // ---- timeline + RA effort (reuse the workload tool's shared helpers) ----
  function primaryType() { const v = pickedVariant(); return v ? v.type : null; }
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

  // ---- station gating ----
  function stationIndex(key) { return STATIONS.findIndex((s) => s.key === key); }
  function stationComplete(key) {
    if (key === "A") return !!pickedVariant() && !!state.activeSubstance;
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
    state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; state.activeSubstance = null;
    state.procedure = newProcedure(); state.submission = { grouping: false, worksharing: false };
    state.grouping = []; state.worksharing = [];
    state.submissionDate = ""; state.iiSub = "60"; state.clockStopFraction = 1;
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
    body.appendChild(el("div", "vcl-wf-body__sub", "Which variation, and which active substance?"));

    const entry = pickedEntry();
    const variant = pickedVariant();

    if (!entry) { buildSearch(body); return; }

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

    // Active substance
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

  function buildSearch(body) {
    const label = el("div", "vcl-wf-flabel", "Classification");
    body.appendChild(label);
    const box = el("div", "vcl-wf-search");
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "Search by code or title…"; input.value = state.query;
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

    // Submission type -- grouping and worksharing may be combined.
    body.appendChild(flabel("Submission type", 18));
    const opts = el("div", "vcl-wf-opts");
    [{ key: "grouping", label: "Grouping" }, { key: "worksharing", label: "Worksharing" }].forEach((o) => {
      const chip = el("button", "vcl-wf-opt" + (state.submission[o.key] ? " is-on" : ""), escapeHtml(o.label));
      chip.type = "button";
      chip.addEventListener("click", () => { state.submission[o.key] = !state.submission[o.key]; rerender(); });
      opts.appendChild(chip);
    });
    body.appendChild(opts);
    body.appendChild(el("p", "vcl-wf-hint", "Tick both if the change is grouped and shared across several procedures. Leave both off for a single variation in one procedure."));

    if (state.submission.grouping) buildGroupingList(body);
    if (state.submission.worksharing) buildWorksharingList(body);
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
    head.appendChild(el("span", null, "Additional variations (grouping)"));
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
    if (g.type && g.code) {
      const e = findEntry(g.code);
      row.innerHTML = `<span class="vcl-wf-brow__main"><span class="vcl-wf-picked__code">${escapeHtml(g.code)}</span> ${escapeHtml(e ? e.title : "")} <span class="${typeBadgeClass(g.type)}">${escapeHtml(g.type)}</span></span>`;
    } else {
      const main = el("div", "vcl-wf-brow__main");
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "vcl-wf-brow__input"; inp.placeholder = "Search code or title…"; inp.value = g.query || "";
      inp.addEventListener("input", () => { g.query = inp.value; renderMatches(); });
      main.appendChild(inp);
      const matches = el("div", "vcl-wf-brow__matches");
      main.appendChild(matches);
      row.appendChild(main);
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
      renderMatches();
    }
    // Variant/type chooser when the picked code has several variants.
    if (g.code && !g.type) {
      const e = findEntry(g.code);
      const chooser = el("div", "vcl-wf-brow__variants");
      chooser.innerHTML = `<span class="vcl-wf-hint" style="margin:0 6px 0 0;">${escapeHtml(e ? e.code : "")} — pick the type:</span>`;
      (e && e.variants ? e.variants : []).forEach((v) => {
        const b = el("button", "vcl-wf-opt vcl-wf-opt--sm", `${escapeHtml(variantLabel(v) || v.type)} <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`);
        b.type = "button";
        b.addEventListener("click", () => { g.variantId = v.id; g.type = v.type; rerender(); });
        chooser.appendChild(b);
      });
      row.appendChild(chooser);
    }
    const rm = el("button", "vcl-wf-rm", "✕");
    rm.type = "button"; rm.setAttribute("aria-label", "Remove");
    rm.addEventListener("click", () => { state.grouping.splice(idx, 1); rerender(); });
    row.appendChild(rm);
    return row;
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

    // Clock-stop slider (where the procedure can pause for questions).
    if (sch.stopMax > 0) {
      const sl = el("div", "vcl-wf-slider");
      sl.appendChild(el("label", null, "Clock-stop: <strong>" + sch.stop + " d</strong> <span class=\"vcl-wf-hint\" style=\"display:inline;\">(range " + sch.stopMin + "–" + sch.stopMax + " d)</span>"));
      const range = document.createElement("input"); range.type = "range"; range.min = String(sch.stopMin); range.max = String(sch.stopMax); range.step = "1"; range.value = String(sch.stop);
      range.addEventListener("input", () => {
        const v = parseInt(range.value, 10); const rg = sch.stopMax - sch.stopMin;
        state.clockStopFraction = rg > 0 ? (v - sch.stopMin) / rg : 0; rerender();
      });
      sl.appendChild(range);
      body.appendChild(sl);
    }

    buildTimelineView(body, sch);
  }

  function buildTimelineView(body, sch) {
    const total = Math.max(sch.dClose, 1);
    const pct = (d) => (d / total) * 100;
    const sd = state.submissionDate;
    const dateAt = (dayOffset) => sd ? fmtDate(addDays(sd, dayOffset - sch.dSub)) : null;

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

    const procs = allProcedures();
    let grand = 0;
    let anyCountries = false;

    procs.forEach((p, i) => {
      const card = el("div", "vcl-wf-fee-proc");
      const head = el("div", "vcl-wf-fee-proc__head");
      head.appendChild(el("span", null, "Procedure " + (i + 1) + " — " + escapeHtml(procLabel(p))));
      const r = procFees(p, counts);
      const ccPairs = procCountries(p);
      if (!ccPairs.length) {
        head.appendChild(el("span", "vcl-wf-fee-proc__sum", "no countries yet"));
        card.appendChild(head);
        body.appendChild(card);
        return;
      }
      anyCountries = true;
      head.appendChild(el("span", "vcl-wf-fee-proc__sum", fmtEUR(r.grandTotal)));
      card.appendChild(head);
      grand += r.grandTotal;

      const cd = countryData();
      r.countries.forEach((cr) => {
        const line = el("div", "vcl-wf-fee-line");
        const name = (cd.nameOf[cr.cc] || cr.cc);
        const roleShort = { RMS: "RMS", CMS: "CMS", national: "national", EMA: "EMA" }[cr.role] || cr.role;
        line.innerHTML = `<span class="vcl-wf-fee-line__c">${escapeHtml(name)} <span class="vcl-wf-fee-line__cc">${escapeHtml(cr.cc)}</span> <span class="vcl-wf-fee-line__role">${escapeHtml(roleShort)}</span></span>`
          + `<span class="vcl-wf-fee-line__amt">${cr.hasData ? fmtEUR(cr.total) : "no fee data"}</span>`;
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

  // Closing recap of the whole path -- the "you are here, and this is the plan" card.
  function buildSummaryCard(body, grand, anyCountries) {
    const entry = pickedEntry();
    const variant = pickedVariant();
    const card = el("div", "vcl-wf-sum");
    card.appendChild(el("div", "vcl-wf-sum__title", "Summary"));

    function line(label, valueHtml) {
      const r = el("div", "vcl-wf-sum__row");
      r.innerHTML = `<span class="vcl-wf-sum__l">${escapeHtml(label)}</span><span class="vcl-wf-sum__v">${valueHtml}</span>`;
      card.appendChild(r);
    }

    if (variant) {
      line("Variation", `${escapeHtml(entry.code)} — ${escapeHtml(entry.title)} <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>`);
    }
    if (state.activeSubstance) line("Active substance", state.activeSubstance === "biologic" ? "Biologic" : "Chemically-synthesized API");

    const subBits = [];
    if (state.submission.grouping) subBits.push((groupingResolvedCount() + 1) + " variations grouped");
    if (state.submission.worksharing) subBits.push((state.worksharing.length + 1) + " procedures shared");
    line("Submission", escapeHtml(subBits.length ? subBits.join(" · ") : "Single variation, one procedure"));

    const procNames = allProcedures().map((p) => escapeHtml(procLabel(p))).join(" · ");
    line("Procedure(s)", procNames);

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
    if (ra !== null) line("RA effort", `~ ${escapeHtml(fmtNum(ra))} h`);
    if (anyCountries) line("Total fees", `<strong>${escapeHtml(fmtEUR(grand))}</strong>`);
    body.appendChild(card);
  }

  function groupingResolvedCount() { return state.grouping.filter((g) => g.type).length; }

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
    }
    if (state.activeSubstance) {
      chips.appendChild(el("span", "vcl-wf-chip", state.activeSubstance === "biologic" ? "Biologic" : "Chemical API"));
    }
    if (procComplete(state.procedure)) {
      chips.appendChild(el("span", "vcl-wf-chip", escapeHtml(procLabel(state.procedure))));
    }
    if (state.submission.worksharing && state.worksharing.length) {
      chips.appendChild(el("span", "vcl-wf-chip", (state.worksharing.length + 1) + " procedures"));
    }
    if (state.submission.grouping && state.grouping.length) {
      const resolved = state.grouping.filter((g) => g.type).length;
      chips.appendChild(el("span", "vcl-wf-chip", (resolved + 1) + " variations"));
    }
    if (!chips.children.length) chips.appendChild(el("span", "vcl-wf-hint", "Your choices will appear here as you go."));
    live.appendChild(chips);

    const row = el("div", "vcl-wf-live__row");
    const ra = raEffort();
    row.appendChild(el("div", "vcl-wf-live__stat", '<div class="v">' + (ra !== null ? escapeHtml(fmtNum(ra)) + " h" : "—") + '</div><div class="l">RA effort</div>'));

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

  function rerender() {
    if (!container) return;
    container.innerHTML = "";
    const root = el("div", "vcl-wf");
    root.appendChild(el("h3", null, "Guided Workflow"));
    root.appendChild(el("p", "vcl-wf__intro",
      "A guided path through one variation — from classification through procedure and timeline to the fees. The live preview below updates as you go."));
    root.appendChild(buildStations());
    root.appendChild(buildBody());
    root.appendChild(buildLive());
    container.appendChild(root);
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

  window.VCL_WORKFLOW = {
    render(col) {
      container = col;
      rerender();
    },
  };
})();
