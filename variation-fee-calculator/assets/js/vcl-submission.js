// Pure fee/hours orchestration for a canonical Submission object. No DOM, no direct window reads
// (engines/data are injected). Dual-mode: window.VCL_SUBMISSION in the browser + module.exports in
// Node. Mirrors vcl-workload-hours.js. The Guided Workflow (vcl-workflow.js) and the Budget tool
// (vcl-budget.js, Phase 2) both build a Submission and call these functions, so the two tools can
// never disagree. See docs/superpowers/specs/2026-08-05-budget-submission-model-design.md.
(function (root) {
  "use strict";

  // ---- derivation layer (pure, no engines except sgLogic) ----
  function feeBucket(type) {
    if (!type) return null;
    if (type.indexOf("II") === 0) return "II";
    if (type.indexOf("IB") === 0) return "IB";
    if (type.indexOf("IA") === 0) return "IA";
    return null;
  }
  function baseType(sub) { return (sub.variations[0] && sub.variations[0].type) || null; }
  function feeCounts(sub) {
    var c = { IA: 0, IB: 0, II: 0 };
    var bt = baseType(sub);
    if (bt) { var b = feeBucket(bt); if (b) c[b]++; }
    sub.variations.slice(1).forEach(function (g) { if (g.type) { var b2 = feeBucket(g.type); if (b2) c[b2]++; } });
    return c;
  }
  function feeCountsTotal(c) { return c.IA + c.IB + c.II; }
  function highestType(sub) {
    var c = feeCounts(sub);
    if (c.II) return "II"; if (c.IB) return "IB"; if (c.IA) return "IA"; return null;
  }
  function typeRankOf(type) { var b = feeBucket(type); return b === "II" ? 3 : b === "IB" ? 2 : b === "IA" ? 1 : 0; }
  function primaryType(sub) {
    var best = baseType(sub);
    sub.variations.slice(1).forEach(function (g) { if (g.type && typeRankOf(g.type) > typeRankOf(best)) best = g.type; });
    return best;
  }
  function groupingBuckets(sub) {
    var c = { IA: 0, IB: 0, II: 0 };
    sub.variations.slice(1).forEach(function (g) { if (g.type) { var b = feeBucket(g.type); if (b) c[b]++; } });
    return c;
  }
  function wsActive(sub) { return sub.mode === "worksharing"; }
  function auActive(sub) { return sub.mode === "annualUpdate"; }
  function sgActive(sub) { return sub.mode === "superGrouping"; }
  function leadPricingActive(sub) { return wsActive(sub) || sgActive(sub); }
  function multiProcedureMode(sub) { return wsActive(sub) || sgActive(sub); }
  function annualUpdateActive(sub) { return auActive(sub) || sgActive(sub); }
  function worksharingKinds(sub) {
    var k = { national: 0, mrpdcp: 0 };
    if (multiProcedureMode(sub)) sub.procedures.slice(1).forEach(function (p) { if (p.kind === "national") k.national++; else if (p.kind === "mrpdcp") k.mrpdcp++; });
    return k;
  }
  function sgProcKinds(sub) {
    var k = { national: 0, mrpdcp: 0, cp: 0 };
    if (sgActive(sub)) sub.procedures.slice(1).forEach(function (p) { if (k[p.kind] !== undefined) k[p.kind]++; });
    return k;
  }
  function allPricedProcedures(sub) {
    return [sub.procedures[0]].concat(multiProcedureMode(sub) ? sub.procedures.slice(1) : []);
  }
  function allVariationsAreIA(sub, engines) {
    return engines.sgLogic.computeAllVariationsAreIA(baseType(sub), sub.variations.slice(1).map(function (v) { return v.type; }));
  }
  function displayMode(sub) {
    if (sub.mode) return sub.mode;
    return sub.variations.length > 1 ? "grouping" : "single";
  }

  // ---- fee-special resolution sub-layer (reads engines.feeRows / engines.countries) ----
  function emaCc(engines) { return (engines.countries.find(function (c) { return c.roles.indexOf("EMA") !== -1; }) || {}).cc || null; }
  // Number of strengths registered for a country: the global default unless overridden.
  function strengthsFor(sub, cc) {
    var o = sub.strengths.overrides[cc];
    var n = (o != null) ? o : sub.strengths.default;
    return Math.max(1, parseInt(n, 10) || 1);
  }
  // Flatten a procedure to the (cc, role, strengths) triples the fee engine consumes.
  function procCountries(sub, p, engines) {
    if (!p) return [];
    if (p.kind === "national") return p.nat ? [{ cc: p.nat, role: "national", strengths: strengthsFor(sub, p.nat) }] : [];
    if (p.kind === "cp") { var e = emaCc(engines); return e ? [{ cc: e, role: "EMA", strengths: strengthsFor(sub, e) }] : []; }
    if (p.kind === "mrpdcp") {
      var out = [];
      if (p.rms) out.push({ cc: p.rms, role: "RMS", strengths: strengthsFor(sub, p.rms) });
      p.cms.forEach(function (cc) { out.push({ cc: cc, role: "CMS", strengths: strengthsFor(sub, cc) }); });
      return out;
    }
    return [];
  }
  // The variation types actually being priced (from the IA/IB/II tally): reuses the derivation
  // layer's feeCounts(sub) in place of the source's closure-only feeCounts(); not part of the
  // brief's listed interface but required for specialOptionsFor/hasStandardRow to be faithful
  // (the source functions depend on it), so it stays an internal (non-exported) helper.
  function activeTypes(sub) {
    var c = feeCounts(sub);
    return ["IA", "IB", "II"].filter(function (t) { return c[t] > 0; });
  }
  // Special-case labels published for a country+role across the active types.
  function specialOptionsFor(sub, cc, role, engines) {
    var types = activeTypes(sub);
    var seen = {}; var out = [];
    engines.feeRows.forEach(function (r) {
      if (r.cc !== cc || r.role !== role || types.indexOf(r.type) === -1) return;
      var s = r.special;
      if (!s || /^standard$/i.test(s) || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }
  // Does this country+role publish a plain standard row for any active type?
  function hasStandardRow(sub, cc, role, engines) {
    var types = activeTypes(sub);
    return engines.feeRows.some(function (r) {
      return r.cc === cc && r.role === role && types.indexOf(r.type) !== -1
        && (!r.special || /^standard$/i.test(r.special));
    });
  }
  // A non-lead RMS of an MRP/DCP inside a Worksharing or Super-Grouping pays its
  // worksharing-CMS fee, not its standalone RMS fee.
  var WS_RMS_PRICES_AS = "CMS";
  function wsPricingRole(role) { return role === "RMS" ? WS_RMS_PRICES_AS : role; }
  function wsSpecialKey(cc, role) { return cc + "|" + role; }
  function isWorksharingSpecial(s) { return /worksharing/i.test(s || ""); }
  // Options offered in a worksharing pricing context: where an authority publishes
  // "… - worksharing" variants, ONLY those are offered; otherwise the normal special cases.
  function wsOptionsFor(sub, cc, role, engines) {
    var all = specialOptionsFor(sub, cc, role, engines);
    var ws = all.filter(isWorksharingSpecial);
    return ws.length ? ws : all;
  }
  // The effective pick for a line: the stored choice if it is still on offer; otherwise the
  // first option wherever "no pick" is not a real alternative.
  function defaultSpecial(sub, cc, role, opts, engines) {
    if (!opts.length) return null;
    if (isWorksharingSpecial(opts[0]) || !hasStandardRow(sub, cc, role, engines)) return opts[0];
    return null;
  }
  function wsSpecialFor(sub, cc, role, engines) {
    var opts = wsOptionsFor(sub, cc, role, engines);
    var stored = sub.specials.ws[wsSpecialKey(cc, role)];
    if (stored && opts.indexOf(stored) !== -1) return stored;
    return defaultSpecial(sub, cc, role, opts, engines);
  }
  // Non-worksharing fee-category options: the published labels minus the "… - worksharing" variants.
  function nonWsOptionsFor(sub, cc, role, engines) {
    return specialOptionsFor(sub, cc, role, engines).filter(function (s) { return !isWorksharingSpecial(s); });
  }
  // The effective pick for a single (non-worksharing) line.
  function specialFor(sub, cc, role, engines) {
    var opts = nonWsOptionsFor(sub, cc, role, engines);
    var stored = sub.specials.line[wsSpecialKey(cc, role)];
    if (stored && opts.indexOf(stored) !== -1) return stored;
    return defaultSpecial(sub, cc, role, opts, engines);
  }
  // Same rule for the lead's own pick.
  function leadSpecial(sub, engines) {
    if (!sub.lead) return null;
    var opts = wsOptionsFor(sub, sub.lead, leadPricingRole(sub, engines), engines);
    var stored = sub.specials.lead;
    if (stored && opts.indexOf(stored) !== -1) return stored;
    return defaultSpecial(sub, sub.lead, leadPricingRole(sub, engines), opts, engines);
  }
  // The role the lead is priced under: the EMA as EMA; otherwise RMS where the authority
  // publishes RMS rows, falling back to national, then CMS.
  function leadPricingRole(sub, engines) {
    var cc = sub.lead;
    if (!cc) return null;
    if (cc === emaCc(engines)) return "EMA";
    var has = function (role) { return engines.feeRows.some(function (r) { return r.cc === cc && r.role === role; }); };
    return has("RMS") ? "RMS" : (has("national") ? "national" : "CMS");
  }
  // Flatten a procedure for PRICING: in a worksharing the lead authority is excluded here
  // (it is priced exactly once, as the lead) and every remaining line carries its chosen fee
  // category, applied to every type (resolveRow falls back to standard per type wherever the
  // label is not published).
  function procPricedCountries(sub, p, engines) {
    var list = procCountries(sub, p, engines);
    if (!leadPricingActive(sub)) return list.map(function (x) {
      var s = specialFor(sub, x.cc, x.role, engines);
      return s ? { cc: x.cc, role: x.role, strengths: x.strengths, special: { IA: s, IB: s, II: s } } : x;
    });
    return list.filter(function (x) { return x.cc !== sub.lead; }).map(function (x) {
      var role = wsPricingRole(x.role);
      var s = wsSpecialFor(sub, x.cc, role, engines);
      return { cc: x.cc, role: role, strengths: x.strengths, special: { IA: s, IB: s, II: s } };
    });
  }
  // Fees for one procedure, via the shared engine (engines.computeFees).
  function procFees(sub, p, counts, engines) {
    if (!engines.computeFees) return null;
    if (!procCountries(sub, p, engines).length || feeCountsTotal(counts) === 0) return { countries: [], grandTotal: 0 };
    return engines.computeFees({ countries: procPricedCountries(sub, p, engines), counts: counts });
  }
  // The lead's one-off fee: a single engine country-result, or null while it can't be priced.
  function leadFees(sub, counts, engines) {
    if (!leadPricingActive(sub) || !sub.lead || !engines.computeFees) return null;
    if (feeCountsTotal(counts) === 0) return null;
    var s = leadSpecial(sub, engines);
    var r = engines.computeFees({
      countries: [{ cc: sub.lead, role: leadPricingRole(sub, engines), strengths: strengthsFor(sub, sub.lead), special: { IA: s, IB: s, II: s } }],
      counts: counts,
    });
    return (r.countries && r.countries[0]) || null;
  }
  // Assemble per-procedure + lead pricing into one grand total (parity with vcl-workflow.js's
  // grandTotalFees) plus a NEW by-country breakdown for the Budget tool.
  function computeSubmissionFees(sub, engines) {
    var counts = feeCounts(sub);
    if (feeCountsTotal(counts) === 0) return { total: null, byCountry: [] };
    var byCc = {}; var total = 0; var any = false;
    allPricedProcedures(sub).forEach(function (p) {
      var r = procFees(sub, p, counts, engines);
      if (!r) return;
      total += r.grandTotal || 0;
      if (procCountries(sub, p, engines).length) any = true;
      (r.countries || []).forEach(function (c) { byCc[c.cc] = (byCc[c.cc] || 0) + (c.total || 0); });
    });
    if (leadPricingActive(sub)) {
      var lf = leadFees(sub, counts, engines);
      if (lf) { total += lf.total || 0; byCc[lf.cc] = (byCc[lf.cc] || 0) + (lf.total || 0); any = true; }
    }
    var byCountry = Object.keys(byCc).map(function (cc) { return { cc: cc, total: byCc[cc] }; });
    return { total: any ? total : null, byCountry: byCountry };
  }

  var api = {
    feeBucket: feeBucket, feeCounts: feeCounts, feeCountsTotal: feeCountsTotal, highestType: highestType,
    primaryType: primaryType, groupingBuckets: groupingBuckets, worksharingKinds: worksharingKinds,
    sgProcKinds: sgProcKinds, allPricedProcedures: allPricedProcedures, allVariationsAreIA: allVariationsAreIA,
    wsActive: wsActive, auActive: auActive, sgActive: sgActive, leadPricingActive: leadPricingActive,
    multiProcedureMode: multiProcedureMode, annualUpdateActive: annualUpdateActive, displayMode: displayMode,
    emaCc: emaCc, strengthsFor: strengthsFor, procCountries: procCountries,
    specialOptionsFor: specialOptionsFor, hasStandardRow: hasStandardRow,
    wsPricingRole: wsPricingRole, wsSpecialKey: wsSpecialKey, isWorksharingSpecial: isWorksharingSpecial,
    wsOptionsFor: wsOptionsFor, defaultSpecial: defaultSpecial, wsSpecialFor: wsSpecialFor,
    nonWsOptionsFor: nonWsOptionsFor, specialFor: specialFor, leadSpecial: leadSpecial,
    leadPricingRole: leadPricingRole, procPricedCountries: procPricedCountries, procFees: procFees,
    leadFees: leadFees, computeSubmissionFees: computeSubmissionFees,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_SUBMISSION = api;
})(typeof window !== "undefined" ? window : this);
