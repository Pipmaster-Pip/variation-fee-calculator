// Node unit test for the budget engine (vcl-budget-engine.js). Run from the project root:
// node test/test-budget-engine.js
// Loads the REAL additive-workload engine (already covered by test-additive-workload.js) to
// verify the adapter wires into it correctly, and a deterministic STUB for VCLCALC.computeFees
// (vcl-calc-app.js is DOM-coupled at load time and cannot run under Node — see
// docs/superpowers/specs/2026-08-05-budget-planning-design.md).
// Lives outside the plugin folder (dev-only, never shipped); paths reach into the plugin's assets.
"use strict";

global.window = {};
require("../variation-fee-calculator/assets/js/vcl-workload-hours-data.js");
var WLH = require("../variation-fee-calculator/assets/js/vcl-workload-hours.js");
var HD = global.window.VCL_WORKLOAD_HD;
var BUD = require("../variation-fee-calculator/assets/js/vcl-budget-engine.js");

var failures = 0;
function eq(actual, expected, msg) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS " : "  FAIL ") + msg +
    (ok ? "" : " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  if (!ok) failures++;
}
function approx(a, b, msg) {
  var ok = Math.abs(a - b) < 1e-9;
  console.log((ok ? "  PASS " : "  FAIL ") + msg + (ok ? "" : " — expected " + b + ", got " + a));
  if (!ok) failures++;
}

console.log("Budget engine tests\n");

// --- 1. newLine() shape.
var l = BUD.newLine("x1");
eq(l.id, "x1", "newLine sets id");
eq(l.procedure, { kind: "national", nat: null, rms: null, cms: [] }, "newLine default procedure");
eq(l.type, null, "newLine starts with no type");
eq(l.probability, 100, "newLine defaults probability to 100");

// --- 2. lineCountries(): national / mrpdcp / cp.
eq(BUD.lineCountries({ procedure: { kind: "national", nat: null } }), [], "national w/o country = []");
eq(BUD.lineCountries({ procedure: { kind: "national", nat: "DE" } }),
  [{ cc: "DE", role: "national", strengths: 1 }], "national DE");
eq(BUD.lineCountries({ procedure: { kind: "mrpdcp", rms: "DE", cms: ["FR", "ES"] } }), [
  { cc: "DE", role: "RMS", strengths: 1 },
  { cc: "FR", role: "CMS", strengths: 1 },
  { cc: "ES", role: "CMS", strengths: 1 },
], "mrpdcp RMS+CMS");
eq(BUD.lineCountries({ procedure: { kind: "cp", ema: "EU" } }),
  [{ cc: "EU", role: "EMA", strengths: 1 }], "cp uses EMA cc");

// --- 3. lineHoursSel(): maps a line onto the engine's sel shape.
var sel = BUD.lineHoursSel({
  type: "IB", procedure: { kind: "mrpdcp", rms: "DE", cms: ["FR", "ES"] },
  activeSubstance: "chemical", piDocs: { smpc: true }, modules: { cmc: true },
  submission: { grouping: { on: false } },
});
eq(sel.type, "IB", "sel.type");
eq(sel.procedure, "mrpdcp", "sel.procedure");
eq(sel.cmsCount, 2, "sel.cmsCount counts CMS array");
eq(sel.activeSubstance, "chemical", "sel.activeSubstance");
eq(sel.modules, { cmc: true }, "sel.modules");

// --- 4. computeLineResult(): hours side wired to the REAL engine — cross-check against calling
//        WLH directly with the same sel, so this test tracks the adapter, not engine internals
//        (those are already covered by test-additive-workload.js).
function stubComputeFees(input) {
  var perCountry = input.countries.map(function (c) {
    return { cc: c.cc, role: c.role, total: 100 + (c.role === "RMS" ? 50 : 0) };
  });
  return { countries: perCountry, grandTotal: perCountry.reduce(function (s, c) { return s + c.total; }, 0) };
}
var line1 = { id: "l1", product: "Product A", type: "IA",
  procedure: { kind: "national", nat: "DE" }, modules: {}, submission: {} };
var engines = { computeFees: stubComputeFees, workload: WLH, workloadData: HD };
var r1 = BUD.computeLineResult(line1, engines);
eq(r1.fee, 100, "computeLineResult: stub fee for one national country");
eq(r1.feeByCountry, [{ cc: "DE", total: 100 }], "computeLineResult: per-country fee breakdown");
eq(r1.complete, true, "computeLineResult: complete when type+countries set");
var directParts = WLH.computeAdditiveWorkload(HD, BUD.lineHoursSel(line1));
var directSections = WLH.composeSections(directParts);
var directExpected = WLH.pertExpected(directSections.total.min, directSections.total.max);
eq(r1.hours, { min: directSections.total.min, max: directSections.total.max, expected: directExpected },
  "computeLineResult: hours match a direct WLH call with the same sel");

// --- 5. computeLineResult(): incomplete line (no country) is safe, not a crash.
var incomplete = { id: "l2", type: null, procedure: { kind: "national", nat: null }, modules: {}, submission: {} };
var r2 = BUD.computeLineResult(incomplete, engines);
eq(r2.fee, 0, "computeLineResult: incomplete line fee = 0");
eq(r2.complete, false, "computeLineResult: incomplete line flagged");
eq(r2.hours, { min: 0, max: 0, expected: 0 }, "computeLineResult: incomplete line hours = 0");

// --- 6. computeRollup(): sums totals, groups by market (per-country fee, not an even split) and
//        by product.
var line2 = { id: "l2b", product: "Product B", type: "II",
  procedure: { kind: "mrpdcp", rms: "DE", cms: ["FR"] }, modules: {}, submission: {} };
var r3 = BUD.computeLineResult(line2, engines); // DE=150 (RMS), FR=100 -> fee 250
var rollup = BUD.computeRollup([line1, line2], { l1: r1, l2b: r3 });
eq(rollup.totals.fee, 350, "computeRollup: total fee sums lines");
eq(rollup.byMarket, [
  { key: "DE", value: 250 }, { key: "FR", value: 100 },
], "computeRollup: by-market sums per-country fees across lines, sorted desc");
eq(rollup.byProduct, [
  { key: "Product B", value: 250 }, { key: "Product A", value: 100 },
], "computeRollup: by-product sums line fees, sorted desc");

// --- 7. computeFte(): straightforward division, guarded against a zero/missing denominator.
approx(BUD.computeFte(1500, 1500), 1, "computeFte: 1500h at 1500h/head = 1 FTE");
approx(BUD.computeFte(750, 1500), 0.5, "computeFte: half");
eq(BUD.computeFte(100, 0), 0, "computeFte: zero hoursPerHead guarded, returns 0");
eq(BUD.computeFte(100, null), 0, "computeFte: missing hoursPerHead guarded, returns 0");

// --- 8. searchEntries(): case-insensitive match on code/title/keywords, capped, empty query = [].
var fixtureEntries = [
  { code: "E.1", title: "Change in the (invented) name of the finished product", keywords: ["invented name", "trade name"] },
  { code: "Q.I.a.1", title: "Change in the manufacture of the active substance", keywords: ["manufacturing process"] },
];
eq(BUD.searchEntries(fixtureEntries, ""), [], "searchEntries: empty query = no results");
eq(BUD.searchEntries(fixtureEntries, "e.1").length, 1, "searchEntries: matches by code, case-insensitive");
eq(BUD.searchEntries(fixtureEntries, "active substance").length, 1, "searchEntries: matches by title");
eq(BUD.searchEntries(fixtureEntries, "trade name").length, 1, "searchEntries: matches by keyword");
eq(BUD.searchEntries(fixtureEntries, "zzz"), [], "searchEntries: no match = []");

// --- 9. loadPlan()/savePlan(): fake storage, plus a throwing storage to prove the fallback.
function fakeStorage() {
  var data = {};
  return { getItem: function (k) { return data[k] || null; }, setItem: function (k, v) { data[k] = v; } };
}
function throwingStorage() {
  return {
    getItem: function () { throw new Error("blocked"); },
    setItem: function () { throw new Error("blocked"); },
  };
}
var store = fakeStorage();
eq(BUD.loadPlan(store), BUD.defaultPlan(), "loadPlan: empty storage returns defaultPlan()");
var plan = { version: 1, hoursPerHead: 1600, lines: [line1] };
eq(BUD.savePlan(store, plan), true, "savePlan: succeeds against working storage");
// loadPlan() now runs every line through normalizeLine(), so the round-trip is compared against
// the normalized shape (line1 is a valid but partial line -- missing variationCode/piDocs/quarter/
// etc -- normalizeLine backfills those from newLine() while preserving id/product/type/procedure).
var normalizedPlan = { version: 1, hoursPerHead: 1600, lines: [BUD.normalizeLine(line1)] };
eq(BUD.loadPlan(store), normalizedPlan, "loadPlan: round-trips what savePlan wrote (lines normalized)");
eq(BUD.loadPlan(throwingStorage()), BUD.defaultPlan(), "loadPlan: falls back to defaultPlan() when storage throws");
eq(BUD.savePlan(throwingStorage(), plan), false, "savePlan: returns false when storage throws");
eq(BUD.loadPlan({ getItem: function () { return "not json"; } }), BUD.defaultPlan(),
  "loadPlan: falls back to defaultPlan() on unparsable JSON");

// --- 10. normalizeLine(): a malformed persisted line (missing `procedure`, or `procedure`
//         present but missing `kind`) recovers to a safe, processable shape instead of crashing
//         downstream code that dereferences line.procedure.kind (final-review finding 3).
var malformed1 = { id: "bad1" }; // procedure missing entirely
var norm1 = BUD.normalizeLine(malformed1);
eq(typeof norm1.procedure.kind, "string", "normalizeLine: missing procedure gets a valid kind");
eq(BUD.lineCountries(norm1), [], "normalizeLine: lineCountries() doesn't throw on the recovered line");
var rNorm1 = BUD.computeLineResult(norm1, engines);
eq(rNorm1.complete, false, "normalizeLine: recovered line is safely 'incomplete', not a crash");

var malformed2 = { id: "bad2", procedure: { nat: "DE" } }; // procedure present, missing kind
var norm2 = BUD.normalizeLine(malformed2);
eq(typeof norm2.procedure.kind, "string", "normalizeLine: procedure without kind gets a valid kind");
BUD.computeLineResult(norm2, engines); // must not throw

var badStore = fakeStorage();
badStore.setItem(BUD.STORAGE_KEY, JSON.stringify({
  version: 1, hoursPerHead: 1500,
  lines: [malformed1, { id: "ok", procedure: { kind: "national", nat: "FR" }, type: "IB" }],
}));
var recovered = BUD.loadPlan(badStore);
eq(recovered.lines.length, 2, "loadPlan: keeps every line from a malformed plan (none dropped)");
eq(typeof recovered.lines[0].procedure.kind, "string", "loadPlan: normalizes the malformed line's procedure.kind");
recovered.lines.forEach(function (l) { BUD.computeLineResult(l, engines); }); // must not throw

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
