// Node characterization test for the extracted timeline engine (vcl-timeline.js).
// Run from the project root: node test/test-timeline.js
// Locks computeSchedule's output so the verbatim move from vcl-workload.js cannot drift.
"use strict";
global.window = {};
var T = require("../variation-fee-calculator/assets/js/vcl-timeline.js");

var failures = 0;
function eq(label, got, want) {
  if (got !== want) { failures++; console.error("FAIL " + label + ": got " + got + ", want " + want); }
}

// 1) Type II 60-day, national, full clock stop -> fully specified case.
var s = T.schedule({ type: "II", iiSub: "60", procedure: "national", cmsCount: 0, shared: false, clockStopFraction: 1 });
eq("II60.prepDays", s.prepDays, 14);
eq("II60.validationDays", s.validationDays, 14);
eq("II60.a1", s.a1, 59);
eq("II60.a2", s.a2, 31);
eq("II60.stop", s.stop, 120);
eq("II60.showA2", s.showA2, true);
eq("II60.dEop", s.dEop, 238);
eq("II60.subToEop", s.subToEop, 224);
eq("II60.totalDays", s.totalDays, 245);

// 2) Type IAIN, national -> no A2, no clock stop.
var a = T.schedule({ type: "IAIN", procedure: "national", clockStopFraction: 1 });
eq("IAIN.prepDays", a.prepDays, 7);
eq("IAIN.showA2", a.showA2, false);
eq("IAIN.stop", a.stop, 0);
eq("IAIN.totalDays", a.totalDays, 58);

// 3) Unknown type (bare IA) -> null (Annual Update window, no individual clock).
eq("IA.null", T.schedule({ type: "IA", procedure: "national" }), null);

// 4) Validation branch by procedure/size/shared.
eq("mrpdcp.large", T.schedule({ type: "IB", procedure: "mrpdcp", cmsCount: 11 }).validationDays, 28);
eq("mrpdcp.small", T.schedule({ type: "IB", procedure: "mrpdcp", cmsCount: 5 }).validationDays, 21);
eq("cp.val", T.schedule({ type: "IB", procedure: "cp" }).validationDays, 7);
eq("shared.val", T.schedule({ type: "IB", procedure: "national", shared: true }).validationDays, 28);

// 5) clockStopFraction scales the stop (IB range 0..30).
eq("frac0", T.schedule({ type: "IB", procedure: "national", clockStopFraction: 0 }).stop, 0);
eq("frac05", T.schedule({ type: "IB", procedure: "national", clockStopFraction: 0.5 }).stop, 15);

if (failures) { console.error(failures + " assertion(s) failed"); process.exit(1); }
console.log("test-timeline.js: all assertions passed");
