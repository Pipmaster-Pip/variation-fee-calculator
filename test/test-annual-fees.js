// Node unit tests for the annual-fee engine functions (vcl-budget-engine.js).
// Run from the project root:  node test/test-annual-fees.js
"use strict";
global.window = {};
var BUD = require("../variation-fee-calculator/assets/js/vcl-budget-engine.js");

var failures = 0;
function eq(actual, expected, msg) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS " : "  FAIL ") + msg +
    (ok ? "" : " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  if (!ok) failures++;
}
function approx(a, b, msg) {
  var ok = Math.abs(a - b) < 1e-6;
  console.log((ok ? "  PASS " : "  FAIL ") + msg + (ok ? "" : " — expected " + b + ", got " + a));
  if (!ok) failures++;
}

console.log("Annual-fee engine tests\n");

// --- registrationKey / seeding
eq(BUD.registrationKey("Aspirin Plus C", "national", "DE"), "aspirin plus c|national|de", "national key");
var natSub = { procedures: [{ kind: "national", nat: "DE", rms: null, cms: [] }], strengths: { default: 2 } };
var seededA = BUD.seedAnnualRowsFromSubmission(natSub, "Aspirin Plus C");
var seededB = BUD.seedAnnualRowsFromSubmission(natSub, "Aspirin Plus C");
eq(seededA.length, 1, "national submission seeds one row");
eq(seededA[0].key, seededB[0].key, "two national DE submissions share a key (dedup)");
eq(seededA[0].strengths, 2, "seed carries the strengths figure");

var mrpSub = { procedures: [{ kind: "mrpdcp", nat: null, rms: "DE", cms: ["NL", "CZ"] }], strengths: { default: 1 } };
var mrpRows = BUD.seedAnnualRowsFromSubmission(mrpSub, "Aspirin Plus C");
eq(mrpRows.length, 1, "mrpdcp seeds one registration row");
eq(mrpRows[0].procedure.countries, ["DE", "NL", "CZ"], "mrpdcp row lists rms first, then cms");
var natKey = BUD.registrationKey("Aspirin Plus C", "national", "DE");
eq(mrpRows[0].key !== natKey, true, "mrpdcp RMS-DE key differs from national DE key");

// --- computeAnnualRow
require("../variation-fee-calculator/assets/js/vcl-annual-data.js");
var CC = global.window.VCL_ANNUAL_DATA.COUNTRIES;
var FX = { CZK: 25, SEK: 11.25, GBP: 0.8, DKK: 7.45, HUF: 390, ISK: 150, PLN: 4.3 };

function row(over) {
  var base = { key: "k", origin: "auto", product: "P", strengths: 1,
    procedure: { kind: "national", rms: null, countries: ["AT"] },
    tariffPicks: {}, coverage: { mode: "full", fromQuarter: null } };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

approx(BUD.prorationFactor({ mode: "full" }), 1, "proration full = 1");
approx(BUD.prorationFactor({ mode: "partial", fromQuarter: "Q3" }), 0.5, "proration Q3 = 0.5");

// AT national, 2 strengths: 1709 + 1*1709 = 3418 EUR
approx(BUD.computeAnnualRow(row({ strengths: 2, procedure: { kind: "national", rms: null, countries: ["AT"] } }), CC, FX).total,
  3418, "AT national 2 strengths = 3418 EUR");

// mrpdcp RMS AT + CMS AT-role: use role split. RMS AT (3965) + CMS NL (1830), 1 strength
approx(BUD.computeAnnualRow(row({ procedure: { kind: "mrpdcp", rms: "AT", countries: ["AT", "NL"] } }), CC, FX).total,
  3965 + 1830, "mrpdcp RMS AT + CMS NL, 1 strength");

// SE, 2 strengths: 60000 + 30000 = 90000 SEK / 11.25 = 8000 EUR
approx(BUD.computeAnnualRow(row({ strengths: 2, procedure: { kind: "national", rms: null, countries: ["SE"] } }), CC, FX).total,
  8000, "SE 2 strengths = 8000 EUR via FX");

// IT, 3 strengths, addStrength null => 1879 (no scaling)
approx(BUD.computeAnnualRow(row({ strengths: 3, procedure: { kind: "national", rms: null, countries: ["IT"] } }), CC, FX).total,
  1879, "IT does not scale by strengths");

// UK reduced pick, 1 strength: 1450 GBP / 0.8 = 1812.5 EUR
approx(BUD.computeAnnualRow(row({ procedure: { kind: "national", rms: null, countries: ["UK"] }, tariffPicks: { UK: "reduced" } }), CC, FX).total,
  1812.5, "UK reduced pick converted via GBP");

// DE => no annual fee
var deRes = BUD.computeAnnualRow(row({ procedure: { kind: "national", rms: null, countries: ["DE"] } }), CC, FX);
approx(deRes.total, 0, "DE contributes 0");
eq(deRes.byCountry[0].status, "no-annual", "DE flagged no-annual");

// BE => turnover-based, uncomputable
var beRes = BUD.computeAnnualRow(row({ procedure: { kind: "national", rms: null, countries: ["BE"] } }), CC, FX);
eq(beRes.byCountry[0].status, "turnover", "BE flagged turnover");

// EU multi-tariff without a pick => needs-pick, uses default (art10 60300)
var euRes = BUD.computeAnnualRow(row({ procedure: { kind: "cp", rms: null, countries: ["EU"] } }), CC, FX);
eq(euRes.needsPick.indexOf("EU") !== -1, true, "EU without pick flags needs-pick");
approx(euRes.total, 60300, "EU falls back to the default tariff");

// AT national 2 strengths prorated Q3 = 3418 * 0.5 = 1709
approx(BUD.computeAnnualRow(row({ strengths: 2, procedure: { kind: "national", rms: null, countries: ["AT"] }, coverage: { mode: "partial", fromQuarter: "Q3" } }), CC, FX).total,
  1709, "AT prorated Q3 halves the fee");

// --- rollup + migration
var lines = [
  row({ product: "Aspirin", procedure: { kind: "national", rms: null, countries: ["AT"] }, strengths: 1 }),
  row({ product: "Aspirin", procedure: { kind: "national", rms: null, countries: ["NL"] }, strengths: 1 }),
];
var rollup = BUD.computeAnnualRollup(lines, CC, FX);
approx(rollup.totalEur, 1709 + 1830, "rollup sums AT national + NL national");
eq(rollup.byMarket[0].key, "NL", "byMarket sorted desc, NL first (1830 > 1709)");

// migration: a v2 plan (no annualLines) gains an empty array
var store = (function () { var m = {}; return { getItem: function (k){return m[k]||null;}, setItem: function (k,v){m[k]=v;} }; })();
store.setItem("vcl_budget_plan_v2", JSON.stringify({ version: 2, hoursPerHead: 1500, lines: [] }));
var loaded = BUD.loadPlan(store);
eq(Array.isArray(loaded.annualLines), true, "loadPlan adds annualLines to a v2 plan");
eq(loaded.annualLines.length, 0, "migrated annualLines is empty");

console.log("\n" + (failures ? failures + " FAILED" : "All passed"));
process.exit(failures ? 1 : 0);
