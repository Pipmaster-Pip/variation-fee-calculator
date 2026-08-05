// Pure Budget Planning helpers: no DOM, no window state read directly (engines are passed in).
// Dual-mode: attaches to window.VCL_BUDGET_ENGINE in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser. Mirrors the split already
// used for vcl-workload-hours.js — see docs/superpowers/specs/2026-08-05-budget-planning-design.md.
(function (root) {
  "use strict";

  var STORAGE_KEY = "vcl_budget_plan_v1";

  function newLine(id) {
    return {
      id: id,
      product: "",
      variationCode: null,
      variationLabel: "",
      type: null,
      procedure: { kind: "national", nat: null, rms: null, cms: [] },
      activeSubstance: null,
      piDocs: {},
      modules: { pi: false, cmc: false, compilation: false },
      submission: {},
      quarter: null,
      probability: 100,
    };
  }

  // -> [{cc, role, strengths}], the shape VCLCALC.computeFees expects. Mirrors
  // vcl-workflow.js:124-135 (procCountries), fixed at strengths=1 (no per-line strength UI in
  // the MVP — see spec).
  function lineCountries(line) {
    var p = (line && line.procedure) || {};
    if (p.kind === "national") return p.nat ? [{ cc: p.nat, role: "national", strengths: 1 }] : [];
    if (p.kind === "cp") return p.ema ? [{ cc: p.ema, role: "EMA", strengths: 1 }] : [];
    if (p.kind === "mrpdcp") {
      var out = [];
      if (p.rms) out.push({ cc: p.rms, role: "RMS", strengths: 1 });
      (p.cms || []).forEach(function (cc) { out.push({ cc: cc, role: "CMS", strengths: 1 }); });
      return out;
    }
    return [];
  }

  // -> the sel shape VCL_WORKLOAD_HOURS.computeAdditiveWorkload expects. Mirrors
  // vcl-workflow.js:462-482 (raEffort), simplified: worksharing/grouping/AU/SG counts are not
  // exposed at line level in the MVP (each plan line is one standalone variation).
  function lineHoursSel(line) {
    var p = (line && line.procedure) || {};
    return {
      type: line.type,
      procedure: p.kind || "national",
      cmsCount: p.kind === "mrpdcp" ? (p.cms || []).length : 0,
      activeSubstance: line.activeSubstance || null,
      piDocs: line.piDocs || {},
      modules: line.modules || { pi: false, cmc: false, compilation: false },
      submission: line.submission || {},
    };
  }

  // engines = { computeFees, workload, workloadData } — dependency-injected so this module never
  // touches `window` itself (keeps it Node-testable). In the browser, Task 2 wires
  // computeFees: window.VCLCALC.computeFees, workload: window.VCL_WORKLOAD_HOURS,
  // workloadData: window.VCL_WORKLOAD_HD.
  function computeLineResult(line, engines) {
    engines = engines || {};
    var countries = lineCountries(line);
    var complete = !!(countries.length && line.type);

    var fee = 0, feeByCountry = [];
    if (complete && engines.computeFees && engines.workload) {
      var counts = { IA: 0, IB: 0, II: 0 };
      var bucket = engines.workload.typeBucket(line.type);
      if (bucket) counts[bucket] = 1;
      var feesResult = engines.computeFees({ countries: countries, counts: counts });
      fee = feesResult.grandTotal || 0;
      feeByCountry = (feesResult.countries || []).map(function (c) {
        return { cc: c.cc, total: c.total || 0 };
      });
    }

    var hours = { min: 0, max: 0, expected: 0 };
    if (complete && engines.workload && engines.workload.computeAdditiveWorkload && engines.workloadData) {
      var parts = engines.workload.computeAdditiveWorkload(engines.workloadData, lineHoursSel(line));
      var sections = engines.workload.composeSections(parts);
      hours = {
        min: sections.total.min,
        max: sections.total.max,
        expected: engines.workload.pertExpected(sections.total.min, sections.total.max),
      };
    }

    return { fee: fee, feeByCountry: feeByCountry, hours: hours, complete: complete };
  }

  function sortDesc(map) {
    return Object.keys(map)
      .map(function (k) { return { key: k, value: map[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // resultsById: { [line.id]: computeLineResult(...) }, precomputed by the caller (Task 4) so
  // this stays pure and doesn't need the engines itself.
  function computeRollup(lines, resultsById) {
    var totals = { fee: 0, hoursMin: 0, hoursMax: 0, hoursExpected: 0 };
    var byMarket = {}, byProduct = {};
    (lines || []).forEach(function (line) {
      var r = resultsById[line.id];
      if (!r) return;
      totals.fee += r.fee;
      totals.hoursMin += r.hours.min;
      totals.hoursMax += r.hours.max;
      totals.hoursExpected += r.hours.expected;
      var product = line.product || "(unnamed product)";
      byProduct[product] = (byProduct[product] || 0) + r.fee;
      r.feeByCountry.forEach(function (c) {
        byMarket[c.cc] = (byMarket[c.cc] || 0) + c.total;
      });
    });
    return { totals: totals, byMarket: sortDesc(byMarket), byProduct: sortDesc(byProduct) };
  }

  function computeFte(totalHours, hoursPerHead) {
    if (!hoursPerHead || hoursPerHead <= 0) return 0;
    return totalHours / hoursPerHead;
  }

  // entries: window.VCL_DATA.ENTRIES shape ({code, title, keywords[]}). Capped to 20 so the
  // dropdown in Task 5 stays short.
  function searchEntries(entries, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    return (entries || []).filter(function (e) {
      if ((e.code || "").toLowerCase().indexOf(q) !== -1) return true;
      if ((e.title || "").toLowerCase().indexOf(q) !== -1) return true;
      return (e.keywords || []).some(function (k) { return k.toLowerCase().indexOf(q) !== -1; });
    }).slice(0, 20);
  }

  function defaultPlan() { return { version: 1, hoursPerHead: 1500, lines: [] }; }

  // Fills in every top-level field newLine() would set, from whatever a persisted line already
  // has -- so a malformed/partial line (e.g. missing `procedure`, or `procedure` without `kind`)
  // never causes vcl-budget.js to dereference undefined later (line.procedure.kind, etc). Shallow
  // merge only: nested procedure/piDocs/modules/submission shapes are type-checked at the
  // top level, not deep-validated field by field (see spec's "malformed persisted plan" note).
  function normalizeLine(raw, fallbackId) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var id = (typeof raw.id === "string" && raw.id) || fallbackId ||
      ("line-recovered-" + Date.now() + "-" + Math.floor(Math.random() * 100000));
    var base = newLine(id);
    var rawProc = (raw.procedure && typeof raw.procedure === "object") ? raw.procedure : {};
    var procedure = {
      kind: (typeof rawProc.kind === "string") ? rawProc.kind : base.procedure.kind,
      nat: rawProc.nat !== undefined ? rawProc.nat : base.procedure.nat,
      rms: rawProc.rms !== undefined ? rawProc.rms : base.procedure.rms,
      cms: Array.isArray(rawProc.cms) ? rawProc.cms : base.procedure.cms,
    };
    if (rawProc.ema !== undefined) procedure.ema = rawProc.ema;
    return {
      id: id,
      product: typeof raw.product === "string" ? raw.product : base.product,
      variationCode: (typeof raw.variationCode === "string" || raw.variationCode === null) ? raw.variationCode : base.variationCode,
      variationLabel: typeof raw.variationLabel === "string" ? raw.variationLabel : base.variationLabel,
      type: (typeof raw.type === "string" || raw.type === null) ? raw.type : base.type,
      procedure: procedure,
      activeSubstance: raw.activeSubstance !== undefined ? raw.activeSubstance : base.activeSubstance,
      piDocs: (raw.piDocs && typeof raw.piDocs === "object") ? raw.piDocs : base.piDocs,
      modules: (raw.modules && typeof raw.modules === "object") ? raw.modules : base.modules,
      submission: (raw.submission && typeof raw.submission === "object") ? raw.submission : base.submission,
      quarter: (typeof raw.quarter === "string" || raw.quarter === null) ? raw.quarter : base.quarter,
      probability: typeof raw.probability === "number" ? raw.probability : base.probability,
    };
  }

  function loadPlan(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return defaultPlan();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.lines)) return defaultPlan();
      parsed.lines = parsed.lines.map(function (line, i) {
        return normalizeLine(line, "line-recovered-" + i);
      });
      return parsed;
    } catch (e) {
      return defaultPlan();
    }
  }

  function savePlan(storage, plan) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(plan));
      return true;
    } catch (e) {
      return false;
    }
  }

  var api = {
    newLine: newLine,
    lineCountries: lineCountries,
    lineHoursSel: lineHoursSel,
    computeLineResult: computeLineResult,
    computeRollup: computeRollup,
    computeFte: computeFte,
    searchEntries: searchEntries,
    defaultPlan: defaultPlan,
    normalizeLine: normalizeLine,
    loadPlan: loadPlan,
    savePlan: savePlan,
    STORAGE_KEY: STORAGE_KEY,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_BUDGET_ENGINE = api;
})(typeof window !== "undefined" ? window : this);
