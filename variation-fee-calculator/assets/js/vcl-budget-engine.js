// Pure Budget Planning helpers: no DOM, no window state read directly (engines are passed in).
// Dual-mode: attaches to window.VCL_BUDGET_ENGINE in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser. Mirrors the split already
// used for vcl-workload-hours.js — see docs/superpowers/specs/2026-08-05-budget-planning-design.md.
(function (root) {
  "use strict";

  var STORAGE_KEY = "vcl_budget_plan_v1";

  // A default Submission (see docs/superpowers/specs/2026-08-05-budget-submission-model-design.md
  // and vcl-submission.js's header) — the shape VCL_SUBMISSION reads. `specials` MUST use the real
  // { line, ws, lead } shape (not `{}`): computeSubmissionFees dereferences sub.specials.line/.ws/.lead.
  function emptySubmission() {
    return {
      mode: null,
      variations: [],
      procedures: [{ kind: "national", nat: null, rms: null, cms: [] }],
      lead: null,
      raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
      strengths: { default: 1, overrides: {} },
      specials: { line: {}, ws: {}, lead: null },
    };
  }

  function newLine(id) {
    return { id: id, product: "", quarter: null, probability: 100, submission: emptySubmission() };
  }

  // engines = { SUB, computeFees, countries, feeRows, workload, workloadData, sgLogic } —
  // dependency-injected so this module never touches `window` itself (keeps it Node-testable).
  // Single source of truth: fees/hours are computed ONLY by delegating to VCL_SUBMISSION
  // (engines.SUB) — no reimplemented pricing/hours logic here.
  function computeLineResult(line, engines) {
    engines = engines || {};
    var sub = (line && line.submission) || {};
    var out = { fee: 0, feeByCountry: [], hours: { min: 0, max: 0, expected: 0 }, complete: false };
    if (!engines.SUB || !engines.computeFees) return out;
    var feeRes = engines.SUB.computeSubmissionFees(sub, engines); // {total, byCountry}
    out.complete = feeRes.total !== null;
    if (!out.complete) return out;
    out.fee = feeRes.total || 0;
    out.feeByCountry = feeRes.byCountry || [];
    var h = engines.SUB.computeSubmissionHours(sub, engines);
    if (h) out.hours = { min: h.min, max: h.max, expected: h.expected };
    return out;
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
    emptySubmission: emptySubmission,
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
