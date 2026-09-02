// Node unit tests for the annual-fee overlay (vcl-annual-overrides.js).
// Run from the project root:  node test/test-annual-overrides.js
"use strict";
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-annual-data.js");
var OV = require("../variation-fee-calculator/assets/js/vcl-annual-overrides.js");
var D = global.window.VCL_ANNUAL_DATA;

var failures = 0;
function ok(cond, msg) {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (!cond) failures++;
}
function byCc(cc) {
  return D.COUNTRIES.filter(function (c) { return c.cc === cc; })[0];
}
function tariff(cc, id) {
  return (byCc(cc).tariffs || []).filter(function (t) { return t.id === id; })[0];
}

console.log("Annual overlay tests\n");

// --- shipped snapshot
var shipped = OV.shipped();
ok(shipped.AT && shipped.AT.rms.base === 3965, "snapshot keeps the shipped AT RMS base");
ok(shipped.IT.all.addStrength === null, "snapshot keeps a null addStrength as null");

// --- a plain override
global.window.VCLCALC_OVERRIDES = { annual: { AT: { rms: { base: 4100 } } } };
var n = OV.apply();
ok(tariff("AT", "rms").base === 4100, "AT RMS base takes the override");
ok(tariff("AT", "rms").addStrength === 3965, "AT RMS addStrength stays shipped");
ok(n === 1, "apply() reports one applied value");

// --- idempotent: applying twice changes nothing further
OV.apply();
ok(tariff("AT", "rms").base === 4100, "second apply leaves the value where it was");

// --- removing the override restores the shipped amount
global.window.VCLCALC_OVERRIDES = { annual: {} };
OV.apply();
ok(tariff("AT", "rms").base === 3965, "AT RMS base returns to the shipped amount");

// --- no overrides at all is not an error
delete global.window.VCLCALC_OVERRIDES;
OV.apply();
ok(tariff("AT", "rms").base === 3965, "missing VCLCALC_OVERRIDES leaves the data alone");

// --- addStrength is refused where the shipped tariff does not scale
global.window.VCLCALC_OVERRIDES = { annual: { IT: { all: { base: 2000, addStrength: 500 } } } };
OV.apply();
ok(tariff("IT", "all").base === 2000, "IT base takes the override");
ok(tariff("IT", "all").addStrength === null, "IT addStrength stays null (structure is fixed)");

// --- garbage is ignored, not applied
global.window.VCLCALC_OVERRIDES = {
  annual: { AT: { rms: { base: "viel" } }, XX: { nope: { base: 1 } }, SE: { ghost: { base: 1 } } }
};
OV.apply();
ok(tariff("AT", "rms").base === 3965, "a non-numeric amount is ignored");
ok(tariff("SE", "all").base === 60000, "an unknown tariff id changes nothing");

// --- negative amounts are ignored
global.window.VCLCALC_OVERRIDES = { annual: { AT: { rms: { base: -5 } } } };
OV.apply();
ok(tariff("AT", "rms").base === 3965, "a negative amount is ignored");

console.log("\n" + (failures ? failures + " FAILURES" : "0 failures"));
process.exit(failures ? 1 : 0);
