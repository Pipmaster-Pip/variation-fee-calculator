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

  var api = {
    feeBucket: feeBucket, feeCounts: feeCounts, feeCountsTotal: feeCountsTotal, highestType: highestType,
    primaryType: primaryType, groupingBuckets: groupingBuckets, worksharingKinds: worksharingKinds,
    sgProcKinds: sgProcKinds, allPricedProcedures: allPricedProcedures, allVariationsAreIA: allVariationsAreIA,
    wsActive: wsActive, auActive: auActive, sgActive: sgActive, leadPricingActive: leadPricingActive,
    multiProcedureMode: multiProcedureMode, annualUpdateActive: annualUpdateActive, displayMode: displayMode,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_SUBMISSION = api;
})(typeof window !== "undefined" ? window : this);
