// Node unit test for vcl-submission.js. Run from the project root: node test/test-submission.js
// Loads the REAL workload + sg-logic engines (already covered by their own tests) so the adapters
// are checked against the real math; fees are checked with a deterministic stub computeFees (as in
// test-budget-engine.js, since vcl-calc-app.js is DOM-coupled and cannot run under Node).
"use strict";
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-workload-hours-data.js");
var WLH = require("../variation-fee-calculator/assets/js/vcl-workload-hours.js");
var HD = global.window.VCL_WORKLOAD_HD;
var SG = require("../variation-fee-calculator/assets/js/vcl-sg-logic.js");
var SUB = require("../variation-fee-calculator/assets/js/vcl-submission.js");

var failures = 0;
function eq(a, b, msg) {
  var ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? "  PASS " : "  FAIL ") + msg + (ok ? "" : " — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)));
  if (!ok) failures++;
}
var engines = { sgLogic: SG, workload: WLH, workloadData: HD };

// helper: build a submission
function mk(o) {
  return Object.assign({ mode: null, variations: [], procedures: [], lead: null,
    raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
    strengths: { default: 1, overrides: {} }, specials: { line: {}, ws: {}, lead: null } }, o);
}

console.log("Submission — derivation layer\n");
var g = mk({ variations: [{ type: "IB" }, { type: "II" }, { type: "IAIN" }] });
eq(SUB.feeCounts(g), { IA: 1, IB: 1, II: 1 }, "feeCounts counts base + grouped, IAIN→IA");
eq(SUB.groupingBuckets(g), { IA: 1, IB: 0, II: 1 }, "groupingBuckets counts only the grouped (non-base)");
eq(SUB.primaryType(g), "II", "primaryType = highest across all variations");
eq(SUB.highestType(g), "II", "highestType = highest bucket");
eq(SUB.displayMode(g), "grouping", "displayMode = grouping when >1 variation, no strategy");
eq(SUB.displayMode(mk({ variations: [{ type: "II" }] })), "single", "displayMode = single for one variation");
eq(SUB.displayMode(mk({ mode: "worksharing", variations: [{ type: "II" }, { type: "IB" }] })), "worksharing", "displayMode = strategy when set");
var ws = mk({ mode: "worksharing", procedures: [{ kind: "national" }, { kind: "national" }, { kind: "mrpdcp" }] });
eq(SUB.worksharingKinds(ws), { national: 1, mrpdcp: 1 }, "worksharingKinds counts additional procedures by kind");
eq(SUB.multiProcedureMode(ws), true, "multiProcedureMode true for worksharing");
var sg = mk({ mode: "superGrouping", procedures: [{ kind: "cp" }, { kind: "cp" }, { kind: "cp" }] });
eq(SUB.sgProcKinds(sg), { national: 0, mrpdcp: 0, cp: 2 }, "sgProcKinds counts additional CPs");
// Delegates to the real VCL_SG_LOGIC engine, which uses exact "=== 'IA'" matching (raw variant
// types like "IAIN" intentionally do NOT count here — whether they should is a separate domain
// question, out of scope for this behaviour-preserving extraction).
eq(SUB.allVariationsAreIA(mk({ variations: [{ type: "IA" }, { type: "IA" }] }), engines), true, "allVariationsAreIA true when every variation is exactly IA");
eq(SUB.allVariationsAreIA(mk({ variations: [{ type: "IA" }, { type: "IAIN" }] }), engines), false, "allVariationsAreIA false for IAIN (engine is exact-match, not prefix)");
eq(SUB.allVariationsAreIA(g, engines), false, "allVariationsAreIA false when a II is present");

console.log("\nSubmission — fee-special sub-layer");
// Minimal FEE_ROWS-shaped fixture: DE Type II has a "simple" and a "…- worksharing" row (no plain
// standard), FR national has only a standard row.
var feeRowsFixture = [
  { cc: "DE - BfArM", role: "national", type: "II", label: "simple" },
  { cc: "DE - BfArM", role: "national", type: "II", label: "complex - worksharing" },
  { cc: "FR", role: "national", type: "II", label: null },
];
var feEng = { feeRows: feeRowsFixture, countries: [{ cc: "EU", roles: ["EMA"] }, { cc: "FR", roles: ["national","RMS","CMS"] }, { cc: "DE - BfArM", roles: ["national","RMS","CMS"] }] };
var s0 = mk({ specials: { line: {}, ws: {}, lead: null } });
eq(SUB.strengthsFor(mk({ strengths: { default: 3, overrides: { FR: 5 } } }), "FR"), 5, "strengthsFor honours per-cc override");
eq(SUB.strengthsFor(mk({ strengths: { default: 3, overrides: {} } }), "FR"), 3, "strengthsFor falls back to default");
eq(SUB.procCountries(mk({ strengths: { default: 1, overrides: {} } }), { kind: "mrpdcp", rms: "FR", cms: ["DE - BfArM"] }),
  [{ cc: "FR", role: "RMS", strengths: 1 }, { cc: "DE - BfArM", role: "CMS", strengths: 1 }], "procCountries flattens MRP/DCP to RMS+CMS");
eq(SUB.wsPricingRole("RMS"), "CMS", "wsPricingRole: a non-lead RMS prices as CMS in worksharing");

console.log("\nSubmission — computeSubmissionFees");
function stubFees(input) {
  var per = input.countries.map(function (c) { return { cc: c.cc, role: c.role, total: 100 + (c.role === "RMS" ? 50 : 0) + (c.role === "EMA" ? 200 : 0) }; });
  return { countries: per, grandTotal: per.reduce(function (s, c) { return s + c.total; }, 0) };
}
var feeEng = { computeFees: stubFees, feeRows: [], countries: [{ cc: "EU", roles: ["EMA"] }] };
// single national submission
var sSingle = mk({ variations: [{ type: "IA" }], procedures: [{ kind: "national", nat: "FR", cms: [] }] });
eq(SUB.computeSubmissionFees(sSingle, feeEng), { total: 100, byCountry: [{ cc: "FR", total: 100 }] }, "fees: single national");
// worksharing: lead DE excluded from its procedure, priced once as lead
var sWs = mk({ mode: "worksharing", lead: "DE - BfArM",
  variations: [{ type: "II" }],
  procedures: [{ kind: "national", nat: "DE - BfArM", cms: [] }, { kind: "national", nat: "FR", cms: [] }] });
var wsFees = SUB.computeSubmissionFees(sWs, feeEng);
eq(wsFees.total, 200, "fees: worksharing = lead DE (100) + FR (100), DE not double-charged");
// byCountry exercises the lead-exclusion path independently of total: FR from its procedure,
// DE once as the lead (its own procedure prices to nothing since the lead is filtered out).
eq(wsFees.byCountry, [{ cc: "FR", total: 100 }, { cc: "DE - BfArM", total: 100 }], "fees: byCountry has FR (100) + lead DE (100) once each, no double DE");
// incomplete (no country) prices to null
eq(SUB.computeSubmissionFees(mk({ variations: [{ type: "IA" }], procedures: [{ kind: "national", nat: null, cms: [] }] }), feeEng).total, null, "fees: incomplete → null");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
