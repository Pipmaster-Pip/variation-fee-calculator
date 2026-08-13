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

console.log("\n" + (failures ? failures + " FAILED" : "All passed"));
process.exit(failures ? 1 : 0);
