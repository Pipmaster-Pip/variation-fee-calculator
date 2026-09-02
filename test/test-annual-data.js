// Node unit test for the annual-fee reference data (vcl-annual-data.js).
// Run from the project root:  node test/test-annual-data.js
"use strict";
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-annual-data.js");
var D = global.window.VCL_ANNUAL_DATA;

var failures = 0;
function ok(cond, msg) {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (!cond) failures++;
}
function byCc(cc) {
  return (D.COUNTRIES || []).filter(function (c) { return c.cc === cc; })[0];
}

console.log("Annual data tests\n");

ok(typeof D.updated === "string" && D.updated.length === 10, "carries an updated date");
// NOTE: the brief's draft assertion checked ">=40 country entries", but the design spec's
// "Annual Fees" sheet enumerates exactly 33 distinct countries (EU-27 + CH/IS/NO/UK/RS + the EU
// centralised entry) across 48 total sheet rows once role/legal-basis tariff variants are counted
// (verified: 37 tariff-variant rows + 3 turnover-based + 8 no-annual-fee placeholder countries =
// 48). A COUNTRIES array nested one-entry-per-country (per the documented interface) cannot reach
// 40 without fabricating countries absent from the source. Threshold corrected to reflect the true,
// fully-cross-checked total. See task-1-report.md for detail.
ok(Array.isArray(D.COUNTRIES) && D.COUNTRIES.length >= 30, "has >=30 country entries");
ok(Array.isArray(D.COUNTRIES) && D.COUNTRIES.length === 33, "has exactly 33 country entries (EU-27 + CH/IS/NO/UK/RS + EU)");

var at = byCc("AT");
ok(at && at.hasAnnual === true, "AT has annual fee");
ok(at && at.tariffs.length === 3, "AT has 3 role tariffs (RMS/CMS/national)");
ok(at && at.tariffs.filter(function (t){return t.role==="RMS";})[0].base === 3965, "AT RMS base 3965 EUR");

var se = byCc("SE");
ok(se && se.tariffs[0].base === 60000 && se.tariffs[0].addStrength === 30000 && se.tariffs[0].ccy === "SEK",
   "SE base 60000 / addStrength 30000 SEK (differ)");

var it = byCc("IT");
ok(it && it.tariffs[0].addStrength === null, "IT does not scale by strength (addStrength null)");

var eu = byCc("EU");
ok(eu && eu.tariffs.length === 3, "EU has 3 legal-basis tariffs");
ok(eu && (eu.tariffs.filter(function (t){return t.id==="art_10_4_biosimilar";})[0] || {}).base === 118100, "EU biosimilar 118100 EUR");

var de = byCc("DE");
ok(de && de.hasAnnual === false, "DE has no annual fee");

var be = byCc("BE");
ok(be && be.turnoverBased === true, "BE is turnover-based (uncomputable)");

var uk = byCc("UK");
ok(uk && (uk.tariffs.filter(function (t){return t.id==="pom_reduced";})[0] || {}).ccy === "GBP", "UK tariffs in GBP");

// FALLBACK_FX: covers every non-EUR currency the annual dataset uses (STATIC_FX_RATES in
// vcl-calc-data.js only covers a few of these -- see the annual-fees blocker fix).
var fx = D.FALLBACK_FX || {};
["CZK", "DKK", "HUF", "ISK", "PLN", "SEK", "GBP"].forEach(function (ccy) {
  ok(typeof fx[ccy] === "number" && fx[ccy] > 0, "FALLBACK_FX has a numeric rate for " + ccy);
});

console.log("\n" + (failures ? failures + " FAILED" : "All passed"));
process.exit(failures ? 1 : 0);
