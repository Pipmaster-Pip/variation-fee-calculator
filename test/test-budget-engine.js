// Node unit test for the budget engine (vcl-budget-engine.js). Run from the project root:
// node test/test-budget-engine.js
// Phase 2 Task 1: a plan line now carries a full Submission and computeLineResult delegates
// fees/hours to the REAL vcl-submission.js module (VCL_SUBMISSION) — no reimplemented pricing
// logic here. Loads the real additive-workload + sg-logic engines (already covered by their own
// tests) plus a deterministic STUB for VCLCALC.computeFees (vcl-calc-app.js is DOM-coupled at
// load time and cannot run under Node — see
// docs/superpowers/specs/2026-08-05-budget-submission-model-design.md).
// Lives outside the plugin folder (dev-only, never shipped); paths reach into the plugin's assets.
"use strict";

global.window = {};
require("../variation-fee-calculator/assets/js/vcl-workload-hours-data.js");
var WLH = require("../variation-fee-calculator/assets/js/vcl-workload-hours.js");
var HD = global.window.VCL_WORKLOAD_HD;
var SG = require("../variation-fee-calculator/assets/js/vcl-sg-logic.js");
var SUB = require("../variation-fee-calculator/assets/js/vcl-submission.js");
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

// --- 1. emptySubmission() / newLine() shape.
eq(BUD.emptySubmission(), {
  mode: null,
  variations: [],
  procedures: [{ kind: "national", nat: null, rms: null, cms: [] }],
  lead: null,
  raTasks: { cmc: false, compilation: false, pi: false, piDocs: {}, activeSubstance: null },
  strengths: { default: 1, overrides: {} },
  specials: { line: {}, ws: {}, lead: null },
}, "emptySubmission: default shape");
var l = BUD.newLine("x1");
eq(l.id, "x1", "newLine sets id");
eq(l.product, "", "newLine defaults product to empty string");
eq(l.quarter, null, "newLine starts with no quarter");
eq(l.probability, 100, "newLine defaults probability to 100");
eq(l.submission, BUD.emptySubmission(), "newLine seeds submission with emptySubmission()");

// --- 2. computeLineResult(): delegates fees/hours to the REAL vcl-submission.js module (single
//        source of truth — no reimplemented pricing/hours logic in vcl-budget-engine.js).
function stubFees(input) {
  var per = input.countries.map(function (c) { return { cc: c.cc, role: c.role, total: 100 }; });
  return { countries: per, grandTotal: per.reduce(function (s, c) { return s + c.total; }, 0) };
}
var eng = { SUB: SUB, computeFees: stubFees, countries: [{ cc: "EU", roles: ["EMA"] }], feeRows: [], workload: WLH, workloadData: HD, sgLogic: SG };
var line = BUD.newLine("l1");
line.submission.variations = [{ type: "II" }];
line.submission.procedures = [{ kind: "national", nat: "FR", cms: [] }];
var r = BUD.computeLineResult(line, eng);
eq(r.complete, true, "computeLineResult: complete single national");
eq(r.fee, 100, "computeLineResult: fee delegated to computeSubmissionFees");
eq(r.feeByCountry, [{ cc: "FR", total: 100 }], "computeLineResult: feeByCountry delegated to computeSubmissionFees");
eq(BUD.computeLineResult(BUD.newLine("l2"), eng).complete, false, "computeLineResult: empty submission is incomplete");
eq(BUD.computeLineResult(BUD.newLine("l2"), eng).fee, 0, "computeLineResult: incomplete line fee = 0");
eq(BUD.computeLineResult(BUD.newLine("l2"), eng).hours, { min: 0, max: 0, expected: 0 }, "computeLineResult: incomplete line hours = 0");

// computeLineResult must never throw when the engines aren't wired (e.g. SUB/computeFees missing).
// NOTE: a `line` with NO `.submission` at all (or a bare `{}` submission) is not covered here: the
// brief's exact delegation code defaults `sub` to `{}` in that case and passes it straight into
// engines.SUB.computeSubmissionFees(), which dereferences `sub.variations[0]` unconditionally and
// throws for a shape that isn't a real Submission. Every line built via newLine()/emptySubmission()
// always has a full submission (variations: []), so this doesn't occur in normal use; flagged as a
// concern in the task report rather than patched beyond the brief's verbatim Step-3 code.
eq(BUD.computeLineResult(line, {}).complete, false, "computeLineResult: missing engines -> safe incomplete, no throw");

// hours side: cross-check against calling the workload engine directly via computeSubmissionHours
// with the same submission, so this test tracks the delegation, not engine internals (those are
// already covered by test-additive-workload.js / test-submission.js).
var directHours = SUB.computeSubmissionHours(line.submission, eng);
eq(r.hours, { min: directHours.min, max: directHours.max, expected: directHours.expected },
  "computeLineResult: hours match a direct SUB.computeSubmissionHours call with the same submission");

// --- 3. computeRollup(): sums totals, groups by market (per-country fee, not an even split) and
//        by product. Product A = single national FR (100). Product B = MRP/DCP RMS DE + CMS FR
//        (100 + 100 = 200, stub is flat per-country).
var lineA = BUD.newLine("lA");
lineA.product = "Product A";
lineA.submission.variations = [{ type: "IA" }];
lineA.submission.procedures = [{ kind: "national", nat: "DE", cms: [] }];
var rA = BUD.computeLineResult(lineA, eng);

var lineB = BUD.newLine("lB");
lineB.product = "Product B";
lineB.submission.variations = [{ type: "II" }];
lineB.submission.procedures = [{ kind: "mrpdcp", rms: "DE", cms: ["FR"] }];
var rB = BUD.computeLineResult(lineB, eng);

var rollup = BUD.computeRollup([lineA, lineB], { lA: rA, lB: rB });
eq(rollup.totals.fee, 300, "computeRollup: total fee sums lines");
eq(rollup.byMarket, [
  { key: "DE", value: 200 }, { key: "FR", value: 100 },
], "computeRollup: by-market sums per-country fees across lines, sorted desc");
eq(rollup.byProduct, [
  { key: "Product B", value: 200 }, { key: "Product A", value: 100 },
], "computeRollup: by-product sums line fees, sorted desc");

// --- 4. computeFte(): straightforward division, guarded against a zero/missing denominator.
approx(BUD.computeFte(1500, 1500), 1, "computeFte: 1500h at 1500h/head = 1 FTE");
approx(BUD.computeFte(750, 1500), 0.5, "computeFte: half");
eq(BUD.computeFte(100, 0), 0, "computeFte: zero hoursPerHead guarded, returns 0");
eq(BUD.computeFte(100, null), 0, "computeFte: missing hoursPerHead guarded, returns 0");

// --- 5. searchEntries(): case-insensitive match on code/title/keywords, capped, empty query = [].
var fixtureEntries = [
  { code: "E.1", title: "Change in the (invented) name of the finished product", keywords: ["invented name", "trade name"] },
  { code: "Q.I.a.1", title: "Change in the manufacture of the active substance", keywords: ["manufacturing process"] },
];
eq(BUD.searchEntries(fixtureEntries, ""), [], "searchEntries: empty query = no results");
eq(BUD.searchEntries(fixtureEntries, "e.1").length, 1, "searchEntries: matches by code, case-insensitive");
eq(BUD.searchEntries(fixtureEntries, "active substance").length, 1, "searchEntries: matches by title");
eq(BUD.searchEntries(fixtureEntries, "trade name").length, 1, "searchEntries: matches by keyword");
eq(BUD.searchEntries(fixtureEntries, "zzz"), [], "searchEntries: no match = []");

// --- 6. loadPlan()/savePlan(): fake storage, plus a throwing storage to prove the fallback.
// NOTE: normalizeLine()'s line-migration path (and the loadPlan/savePlan round-trip through it) is
// NOT covered here — normalizeLine() still assumes the pre-Phase-2 newLine() shape (top-level
// `procedure`/`type`/etc.) that this task's newLine() rewrite removed, and it is fully rewritten
// for the v1(legacy)->v2(Submission) migration in Phase-2 Task 2 (see
// docs/superpowers/plans/2026-08-06-budget-submission-phase2.md), which adds its own migration +
// malformed-fallback tests. Only the storage-plumbing paths that don't call normalizeLine are
// covered here (empty storage, save/load of an empty plan, throwing storage, unparsable JSON).
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
var emptyPlan = { version: 1, hoursPerHead: 1600, lines: [] };
eq(BUD.savePlan(store, emptyPlan), true, "savePlan: succeeds against working storage");
eq(BUD.loadPlan(store), emptyPlan, "loadPlan: round-trips an empty plan (no lines -> normalizeLine not invoked)");
eq(BUD.loadPlan(throwingStorage()), BUD.defaultPlan(), "loadPlan: falls back to defaultPlan() when storage throws");
eq(BUD.savePlan(throwingStorage(), emptyPlan), false, "savePlan: returns false when storage throws");
eq(BUD.loadPlan({ getItem: function () { return "not json"; } }), BUD.defaultPlan(),
  "loadPlan: falls back to defaultPlan() on unparsable JSON");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
