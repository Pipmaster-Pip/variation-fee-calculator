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
  // The user's own per-block hour adjustments (Station "RA tasks" steppers), validated: exactly the
  // four known keys, whole hours, negatives allowed. Anything else recovers to 0 rather than
  // throwing — a hand-edited or older localStorage plan must still load.
  var HOUR_ADJUST_KEYS = ["core", "cmc", "pi", "compilation"];
  function normalizeHourAdjust(raw) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var out = {};
    HOUR_ADJUST_KEYS.forEach(function (k) {
      var v = raw[k];
      out[k] = (typeof v === "number" && isFinite(v)) ? Math.round(v) : 0;
    });
    return out;
  }

  function emptySubmission() {
    return {
      mode: null,
      variations: [],
      procedures: [{ kind: "national", nat: null, rms: null, cms: [] }],
      lead: null,
      raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null,
                 hourAdjust: normalizeHourAdjust(null) },
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

  function defaultPlan() { return { version: 3, hoursPerHead: 1500, lines: [], annualLines: [] }; }

  // v1 lines carried RA-task flags in `modules` (booleans only) plus top-level `piDocs`/
  // `activeSubstance`; the v2 Submission moves all of that under `submission.raTasks`.
  function migrateRaTasks(raw) {
    var m = (raw && raw.modules) || {};
    return {
      cmc: !!m.cmc, compilation: !!m.compilation, pi: !!m.pi,
      piDocs: (raw && raw.piDocs && typeof raw.piDocs === "object") ? raw.piDocs : {},
      activeSubstance: (raw && raw.activeSubstance) || null,
      hourAdjust: normalizeHourAdjust(raw && raw.hourAdjust),
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

  // Number-of-strengths, validated: a positive-integer default (>=1) plus an optional per-country
  // overrides map. Preserves a stored value across save/reload instead of always resetting to 1.
  function normalizeStrengths(raw) {
    var def = (raw && typeof raw.default === "number" && raw.default >= 1) ? Math.floor(raw.default) : 1;
    var overrides = (raw && raw.overrides && typeof raw.overrides === "object") ? raw.overrides : {};
    return { default: def, overrides: overrides };
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
            activeSubstance: raw.raTasks.activeSubstance || null,
            hourAdjust: normalizeHourAdjust(raw.raTasks.hourAdjust) }
        : { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null,
            hourAdjust: normalizeHourAdjust(null) },
      strengths: normalizeStrengths(raw.strengths),
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

  // Funnels every successful loadPlan() return through the v2->v3 migration: stamps version 3
  // and normalizes annualLines (defaulting to [] when absent/malformed).
  function withAnnual(plan, rawAnnual) {
    plan.version = 3;
    var arr = Array.isArray(rawAnnual) ? rawAnnual : [];
    plan.annualLines = arr.map(function (a, i) { return normalizeAnnualLine(a, "annual-recovered-" + i); });
    return plan;
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
        return withAnnual({ version: 3, hoursPerHead: oldParsed.hoursPerHead || 1500,
          lines: oldParsed.lines.map(function (l, i) { return normalizeLine(l, "line-migrated-" + i); }) }, []);
      }
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.lines)) return defaultPlan();
      parsed.lines = parsed.lines.map(function (l, i) { return normalizeLine(l, "line-recovered-" + i); });
      parsed = withAnnual(parsed, parsed.annualLines);
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

  function slug(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  // Dedup identity of an annual-fee row. anchor = country (national) | RMS (mrpdcp) | "" (cp).
  function registrationKey(product, kind, anchor) {
    return slug(product) + "|" + slug(kind) + "|" + slug(anchor);
  }

  // One annual row per marketing-authorisation registration inside a submission.
  function seedAnnualRowsFromSubmission(submission, product) {
    var sub = (submission && typeof submission === "object") ? submission : {};
    var procs = Array.isArray(sub.procedures) ? sub.procedures : [];
    var strengths = (sub.strengths && sub.strengths.default >= 1) ? Math.floor(sub.strengths.default) : 1;
    var rows = [];
    procs.forEach(function (p) {
      p = p || {};
      if (p.kind === "national") {
        if (!p.nat) return;
        rows.push(makeSeed(product, "national", p.nat, p.nat, [p.nat], strengths));
      } else if (p.kind === "mrpdcp") {
        if (!p.rms) return;
        var countries = [p.rms].concat(Array.isArray(p.cms) ? p.cms : []);
        rows.push(makeSeed(product, "mrpdcp", p.rms, p.rms, countries, strengths));
      } else if (p.kind === "cp") {
        rows.push(makeSeed(product, "cp", "", null, [], strengths));
      }
    });
    return rows;
  }

  function makeSeed(product, kind, anchor, rms, countries, strengths) {
    return {
      key: registrationKey(product, kind, anchor),
      origin: "auto",
      product: product || "",
      procedure: { kind: kind, rms: rms, countries: countries },
      strengths: strengths,
      tariffPicks: {},
      coverage: { mode: "full", fromQuarter: null },
    };
  }

  // Accepts a raw persisted annual row (or malformed input) and always returns a valid one.
  // Never throws -- recovers to a safe empty national row with origin:"manual".
  function normalizeAnnualLine(raw, fallbackId) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var proc = (raw.procedure && typeof raw.procedure === "object") ? raw.procedure : {};
    var kind = (proc.kind === "mrpdcp" || proc.kind === "cp") ? proc.kind : "national";
    var countries = Array.isArray(proc.countries) ? proc.countries.filter(function (c) { return typeof c === "string"; }) : [];
    var product = typeof raw.product === "string" ? raw.product : "";
    var anchor = kind === "national" ? (countries[0] || "") : (kind === "mrpdcp" ? (proc.rms || "") : "");
    return {
      id: (typeof raw.id === "string" && raw.id) || fallbackId || ("annual-" + Date.now() + "-" + Math.floor(Math.random() * 1e5)),
      key: typeof raw.key === "string" && raw.key ? raw.key : registrationKey(product, kind, anchor),
      origin: raw.origin === "auto" ? "auto" : "manual",
      product: product,
      procedure: { kind: kind, rms: proc.rms || null, countries: countries },
      strengths: (typeof raw.strengths === "number" && raw.strengths >= 1) ? Math.floor(raw.strengths) : 1,
      tariffPicks: (raw.tariffPicks && typeof raw.tariffPicks === "object") ? raw.tariffPicks : {},
      coverage: (raw.coverage && raw.coverage.mode === "partial")
        ? { mode: "partial", fromQuarter: raw.coverage.fromQuarter || null }
        : { mode: "full", fromQuarter: null },
      // Budget year this recurring cost is planned into -- persisted so the Excel export can carry a
      // Year column (older rows saved before this field default to next year on load).
      year: (typeof raw.year === "number" && raw.year >= 2000) ? raw.year : (new Date().getFullYear() + 1),
    };
  }

  function prorationFactor(coverage) {
    coverage = coverage || {};
    if (coverage.mode !== "partial") return 1;
    var n = parseInt(String(coverage.fromQuarter || "").replace(/[^0-9]/g, ""), 10);
    if (!(n >= 1 && n <= 4)) return 1;
    return (5 - n) / 4;
  }

  function findAnnualCountry(countries, cc) {
    var list = countries || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].cc === cc) return list[i];
    return null;
  }

  // Picks the tariff for one country: explicit pick > role match > sole tariff > default/first (needs-pick).
  function pickTariff(entry, role, pickedId) {
    var ts = entry.tariffs || [];
    var byId = null, byRole = null, def = null, i;
    for (i = 0; i < ts.length; i++) {
      if (pickedId && ts[i].id === pickedId) byId = ts[i];
      if (role && ts[i].role === role) byRole = ts[i];
      if (ts[i].isDefault) def = ts[i];
    }
    // A "choice" market offers multiple tariffs the role does NOT resolve on its own -- the user must
    // (or may) choose, and that stays true even after a pick is made (so the <select> never vanishes).
    var choice = ts.length > 1 && !byRole;
    if (byId) return { tariff: byId, needsPick: false, choice: choice };
    if (byRole) return { tariff: byRole, needsPick: false, choice: false };
    if (ts.length === 1) return { tariff: ts[0], needsPick: false, choice: false };
    return { tariff: def || ts[0] || null, needsPick: ts.length > 1, choice: choice };
  }

  function computeAnnualRow(row, countries, fxByCurrency) {
    row = row || {};
    var proc = row.procedure || {};
    var strengths = (row.strengths >= 1) ? Math.floor(row.strengths) : 1;
    var factor = prorationFactor(row.coverage);
    var fx = fxByCurrency || {};
    var ccs = proc.kind === "cp" ? ["EU"] : (Array.isArray(proc.countries) ? proc.countries : []);
    var out = { total: 0, byCountry: [], computable: true, needsPick: [] };
    ccs.forEach(function (cc) {
      var entry = findAnnualCountry(countries, cc);
      if (!entry || entry.hasAnnual === false) {
        out.byCountry.push({ cc: cc, role: null, tariffId: null, amountLocal: 0, ccy: "EUR", amountEur: 0, status: "no-annual", choice: false });
        return;
      }
      if (entry.turnoverBased) {
        out.computable = false;
        out.byCountry.push({ cc: cc, role: null, tariffId: null, amountLocal: 0, ccy: entry.tariffs[0] ? entry.tariffs[0].ccy : "EUR", amountEur: 0, status: "turnover", choice: false });
        return;
      }
      var role = null;
      if (proc.kind === "mrpdcp") role = (cc === proc.rms) ? "RMS" : "CMS";
      else if (proc.kind === "national") role = "national";
      var picked = pickTariff(entry, role, (row.tariffPicks || {})[cc]);
      var t = picked.tariff;
      if (!t) { out.byCountry.push({ cc: cc, role: role, tariffId: null, amountLocal: 0, ccy: "EUR", amountEur: 0, status: "no-annual", choice: false }); return; }
      var addUnit = (typeof t.addStrength === "number") ? t.addStrength : 0;
      var local = (t.base + Math.max(0, strengths - 1) * addUnit) * factor;
      var rate = t.ccy === "EUR" ? 1 : (fx[t.ccy] || null);
      if (t.ccy !== "EUR" && !rate) {
        // No FX rate resolvable for this tariff's currency: surface it as a visible "no-rate"
        // status (local amount + ccy still populated) instead of silently pricing to EUR 0, and
        // flag the whole row uncomputable so callers don't treat the total as complete.
        out.computable = false;
        out.byCountry.push({ cc: cc, role: role, tariffId: t.id, amountLocal: local, ccy: t.ccy, amountEur: 0, status: "no-rate", choice: picked.choice });
        return;
      }
      var eur = rate ? local / rate : 0;
      if (picked.needsPick && out.needsPick.indexOf(cc) === -1) out.needsPick.push(cc);
      out.byCountry.push({ cc: cc, role: role, tariffId: t.id, amountLocal: local, ccy: t.ccy, amountEur: eur,
        status: picked.needsPick ? "needs-pick" : "ok", choice: picked.choice });
      out.total += eur;
    });
    return out;
  }

  // Aggregates a set of persisted annual rows into total/byMarket/byProduct, reusing
  // computeAnnualRow for the per-row fee split and sortDesc for the desc-sorted breakdowns.
  function computeAnnualRollup(annualLines, countries, fxByCurrency) {
    var totalEur = 0, byMarket = {}, byProduct = {};
    (annualLines || []).forEach(function (row) {
      var res = computeAnnualRow(row, countries, fxByCurrency);
      totalEur += res.total;
      var product = row.product || "(unnamed product)";
      byProduct[product] = (byProduct[product] || 0) + res.total;
      res.byCountry.forEach(function (c) { byMarket[c.cc] = (byMarket[c.cc] || 0) + c.amountEur; });
    });
    return { totalEur: totalEur, byMarket: sortDesc(byMarket), byProduct: sortDesc(byProduct) };
  }

  var api = {
    newLine: newLine,
    emptySubmission: emptySubmission,
    normalizeSubmission: normalizeSubmission,
    computeLineResult: computeLineResult,
    computeRollup: computeRollup,
    computeFte: computeFte,
    searchEntries: searchEntries,
    defaultPlan: defaultPlan,
    normalizeLine: normalizeLine,
    loadPlan: loadPlan,
    savePlan: savePlan,
    registrationKey: registrationKey,
    seedAnnualRowsFromSubmission: seedAnnualRowsFromSubmission,
    prorationFactor: prorationFactor,
    findAnnualCountry: findAnnualCountry,
    computeAnnualRow: computeAnnualRow,
    normalizeAnnualLine: normalizeAnnualLine,
    computeAnnualRollup: computeAnnualRollup,
    STORAGE_KEY: STORAGE_KEY,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_BUDGET_ENGINE = api;
})(typeof window !== "undefined" ? window : this);
