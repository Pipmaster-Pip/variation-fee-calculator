// Pure Budget Planning helpers: no DOM, no window state read directly (engines are passed in).
// Dual-mode: attaches to window.VCL_BUDGET_ENGINE in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser. Mirrors the split already
// used for vcl-workload-hours.js — see docs/superpowers/specs/2026-08-05-budget-submission-model-design.md.
(function (root) {
  "use strict";

  var STORAGE_KEY = "vcl_budget_plan_v2";

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

  // Plan lines default to next year (the usual budgeting horizon: in 2026 you plan 2027), but the
  // year is now a per-line choice so the current year can be covered too (see the editor's Year field).
  function defaultPlanYear() {
    return new Date().getFullYear() + 1;
  }

  function newLine(id) {
    return { id: id, product: "", year: defaultPlanYear(), quarter: null, probability: 100, submission: emptySubmission() };
  }

  // engines = { SUB, computeFees, countries, feeRows, workload, workloadData, sgLogic } —
  // dependency-injected so this module never touches `window` itself (keeps it Node-testable).
  // Single source of truth: fees/hours are computed ONLY by delegating to VCL_SUBMISSION
  // (engines.SUB) — no reimplemented pricing/hours logic here.
  function computeLineResult(line, engines) {
    engines = engines || {};
    var sub = (line && line.submission) || {};
    var out = { fee: 0, feeByCountry: [], hours: { min: 0, max: 0, expected: 0 }, hoursDetail: null, complete: false };
    if (!engines.SUB || !engines.computeFees) return out;
    var feeRes = engines.SUB.computeSubmissionFees(sub, engines); // {total, byCountry}
    out.complete = feeRes.total !== null;
    if (!out.complete) return out;
    out.fee = feeRes.total || 0;
    out.feeByCountry = feeRes.byCountry || [];
    var h = engines.SUB.computeSubmissionHours(sub, engines);
    if (h) {
      out.hours = { min: h.min, max: h.max, expected: h.expected };
      // Itemised breakdown (grouped RA / CMC / Compilation, matching the GW method box) for the
      // expandable per-line detail in the table.
      out.hoursDetail = { items: h.items, sections: h.sections };
    }
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

  function defaultPlan() { return { version: 2, hoursPerHead: 1500, lines: [] }; }

  // v1 lines carried RA-task flags in `modules` (booleans only) plus top-level `piDocs`/
  // `activeSubstance`; the v2 Submission moves all of that under `submission.raTasks`.
  function migrateRaTasks(raw) {
    var m = (raw && raw.modules) || {};
    return {
      cmc: !!m.cmc, compilation: !!m.compilation, pi: !!m.pi,
      piDocs: (raw && raw.piDocs && typeof raw.piDocs === "object") ? raw.piDocs : {},
      activeSubstance: (raw && raw.activeSubstance) || null,
    };
  }

  function normalizeProcedure(p) {
    p = (p && typeof p === "object") ? p : {};
    var out = {
      kind: typeof p.kind === "string" ? p.kind : "national",
      nat: p.nat !== undefined ? p.nat : null, rms: p.rms !== undefined ? p.rms : null,
      cms: Array.isArray(p.cms) ? p.cms : [],
    };
    if (p.ema !== undefined) out.ema = p.ema;
    return out;
  }

  // Normalizes a raw `submission` payload (either an already-v2 submission, or a synthetic one
  // built by normalizeLine() from legacy v1 top-level fields) into a valid Submission shape.
  // Malformed input (wrong types, non-objects) never throws -- it recovers to safe defaults.
  function normalizeSubmission(raw) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var variations = Array.isArray(raw.variations)
      ? raw.variations.filter(function (v) { return v && typeof v === "object"; })
          .map(function (v) { return { code: v.code || null, variantId: v.variantId != null ? v.variantId : null, type: (typeof v.type === "string") ? v.type : null }; })
      : [];
    var procedures = Array.isArray(raw.procedures) && raw.procedures.length
      ? raw.procedures.map(normalizeProcedure)
      : [normalizeProcedure(null)];
    return {
      mode: (raw.mode === "worksharing" || raw.mode === "superGrouping" || raw.mode === "annualUpdate") ? raw.mode : null,
      variations: variations, procedures: procedures,
      lead: (typeof raw.lead === "string") ? raw.lead : null,
      raTasks: (raw.raTasks && typeof raw.raTasks === "object")
        ? { cmc: !!raw.raTasks.cmc, compilation: !!raw.raTasks.compilation, pi: !!raw.raTasks.pi,
            piDocs: (raw.raTasks.piDocs && typeof raw.raTasks.piDocs === "object") ? raw.raTasks.piDocs : {},
            activeSubstance: raw.raTasks.activeSubstance || null }
        : { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
      strengths: { default: 1, overrides: {} },
      specials: { line: {}, ws: {}, lead: null },
    };
  }

  // Accepts BOTH an already-v2 line (has `.submission`) and a legacy v1 line (top-level
  // `variationCode`/`type`/`procedure`/`modules`/`piDocs`/`activeSubstance`), and always returns
  // a valid v2 PlanLine. Never throws, even on malformed input -- falls back to a safe empty
  // Single-mode submission.
  function normalizeLine(raw, fallbackId) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var id = (typeof raw.id === "string" && raw.id) || fallbackId ||
      ("line-recovered-" + Date.now() + "-" + Math.floor(Math.random() * 100000));
    var submission;
    if (raw.submission && typeof raw.submission === "object") {
      submission = normalizeSubmission(raw.submission); // already-v2 line
    } else {
      // legacy v1 line: one variation + one procedure
      submission = normalizeSubmission({
        mode: null,
        variations: raw.variationCode || raw.type ? [{ code: raw.variationCode || null, variantId: null, type: (typeof raw.type === "string") ? raw.type : null }] : [],
        procedures: raw.procedure ? [raw.procedure] : null,
        raTasks: migrateRaTasks(raw),
      });
    }
    return {
      id: id,
      product: typeof raw.product === "string" ? raw.product : "",
      year: (typeof raw.year === "number" && raw.year > 0) ? raw.year : defaultPlanYear(),
      quarter: (typeof raw.quarter === "string" || raw.quarter === null) ? raw.quarter : null,
      probability: typeof raw.probability === "number" ? raw.probability : 100,
      submission: submission,
    };
  }

  function loadPlan(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) {
        // one-time migration: read the old v1 key if present
        var oldRaw = storage && storage.getItem("vcl_budget_plan_v1");
        if (!oldRaw) return defaultPlan();
        var oldParsed = JSON.parse(oldRaw);
        if (!oldParsed || !Array.isArray(oldParsed.lines)) return defaultPlan();
        return { version: 2, hoursPerHead: oldParsed.hoursPerHead || 1500,
          lines: oldParsed.lines.map(function (l, i) { return normalizeLine(l, "line-migrated-" + i); }) };
      }
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.lines)) return defaultPlan();
      parsed.version = 2;
      parsed.lines = parsed.lines.map(function (l, i) { return normalizeLine(l, "line-recovered-" + i); });
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
