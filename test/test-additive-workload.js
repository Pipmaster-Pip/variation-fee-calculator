// Node unit test for the additive workload engine (vcl-workload-hours.js +
// vcl-workload-hours-data.js). Run from the project root: node test/test-additive-workload.js
// Hand-checked assertions against RA-CMC-hours.xlsx so a bad data/engine change fails loudly.
// Lives outside the plugin folder (dev-only, never shipped); paths reach into the plugin's assets.
"use strict";

// Load the generated data (attaches window.VCL_WORKLOAD_HD) and the engine.
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-workload-hours-data.js");
var WLH = require("../variation-fee-calculator/assets/js/vcl-workload-hours.js");
var HD = global.window.VCL_WORKLOAD_HD;

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

console.log("Additive workload engine tests\n");

// --- 1. RA core, IA national: the six process rows sum to 7–14 h (matches documented value).
var p = WLH.computeAdditiveWorkload(HD, { type: "IA", procedure: "national", modules: {} });
eq({ min: p.raCore.min, max: p.raCore.max }, { min: 7, max: 14 }, "RA core IA national = 7–14 h");
var s = WLH.composeSections(p);
eq(s.total, { min: 7, max: 14 }, "Total IA national (RA only) = 7–14 h");
eq(s.cmc, { min: 0, max: 0 }, "CMC section zero when gate off");

// --- 2. Type bucketing: IAIN collapses to IA, 'IB (unforeseen)' to IB (same as IA/IB).
var iain = WLH.computeAdditiveWorkload(HD, { type: "IAIN", procedure: "national", modules: {} });
eq(iain.raCore, p.raCore, "IAIN buckets to IA (same RA core)");

// --- 3. MRP/DCP CMS scaling: each CMS adds the 'for each CMS' row (0.5–1 h). 3 CMS = +1.5–3.
var mrp0 = WLH.computeAdditiveWorkload(HD, { type: "IA", procedure: "mrpdcp", cmsCount: 0, modules: {} });
var mrp3 = WLH.computeAdditiveWorkload(HD, { type: "IA", procedure: "mrpdcp", cmsCount: 3, modules: {} });
approx(mrp3.raCore.min - mrp0.raCore.min, 1.5, "3 CMS adds +1.5 h to RA core min");
approx(mrp3.raCore.max - mrp0.raCore.max, 3.0, "3 CMS adds +3.0 h to RA core max");

// --- 4. CMC active-substance selection: biological dossier prep (4–8) > chemical (2–4) for IA,
//        and substance-neutral rows are always included so chemical/biological both exceed zero.
var cmcChem = WLH.computeAdditiveWorkload(HD,
  { type: "IA", procedure: "national", activeSubstance: "chemical", modules: { cmc: true } });
var cmcBio = WLH.computeAdditiveWorkload(HD,
  { type: "IA", procedure: "national", activeSubstance: "biological", modules: { cmc: true } });
var biggerBio = cmcBio.cmcCore.min > cmcChem.cmcCore.min && cmcBio.cmcCore.max > cmcChem.cmcCore.max;
eq(biggerBio, true, "IA CMC biological > chemical (dossier prep 4–8 vs 1–2)");
eq(cmcChem.cmcCore.min > 0, true, "CMC chemical includes substance-neutral rows (> 0)");

// --- 5. CMC counts into the grand total only when its gate is on.
var withCmc = WLH.composeSections(cmcChem);
eq(withCmc.total.min, s.total.min + withCmc.cmc.min,
  "Grand total includes CMC section when gate on");
eq(withCmc.cmc.min > 0, true, "CMC section non-zero when gate on");

// --- 6. Submission modifier (grouping) adds RA hours per added variation.
//        IB national grouping: each add. Type IA and Type IB = 0.5–1 h.
var grpNone = WLH.computeAdditiveWorkload(HD,
  { type: "IB", procedure: "national", modules: {},
    submission: { grouping: { on: true, counts: {} } } });
var grp2IA = WLH.computeAdditiveWorkload(HD,
  { type: "IB", procedure: "national", modules: {},
    submission: { grouping: { on: true, counts: { "Type IA": 2 } } } });
approx(grp2IA.submissionRa.min - grpNone.submissionRa.min, 1.0, "grouping +2 Type IA adds +1.0 h min");
approx(grp2IA.submissionRa.max - grpNone.submissionRa.max, 2.0, "grouping +2 Type IA adds +2.0 h max");

// --- 7. Compilation gate: off = 0; on adds the compilation/submission rows.
var noComp = WLH.computeAdditiveWorkload(HD, { type: "IA", procedure: "national", modules: {} });
var withComp = WLH.computeAdditiveWorkload(HD, { type: "IA", procedure: "national", modules: { compilation: true } });
eq(noComp.compilation, { min: 0, max: 0 }, "Compilation zero when gate off");
eq(withComp.compilation.min > 0 && withComp.compilation.max > 0, true, "Compilation non-zero when gate on");

// --- 8. Product information: only ticked documents count; more docs = more hours; none = zero.
var piNone = WLH.computeAdditiveWorkload(HD,
  { type: "II", procedure: "national", modules: { pi: true }, piDocs: {} });
var piSmpc = WLH.computeAdditiveWorkload(HD,
  { type: "II", procedure: "national", modules: { pi: true }, piDocs: { smpc: true } });
var piSmpcLeaflet = WLH.computeAdditiveWorkload(HD,
  { type: "II", procedure: "national", modules: { pi: true }, piDocs: { smpc: true, leaflet: true } });
eq(piNone.pi, { min: 0, max: 0 }, "PI on but no document ticked = 0 h");
eq(piSmpc.pi.min > 0, true, "PI SmPC-only > 0");
eq(piSmpcLeaflet.pi.min > piSmpc.pi.min && piSmpcLeaflet.pi.max > piSmpc.pi.max,
  true, "PI SmPC+leaflet > SmPC-only");

// --- 9. Itemisation: sections carry per-activity lines that sum to their subtotal; PI is one
//        aggregated line naming the ticked documents; CMC lines are individual.
var full = WLH.computeAdditiveWorkload(HD, {
  type: "II", procedure: "national", activeSubstance: "chemical",
  modules: { pi: true, cmc: true, compilation: true }, piDocs: { smpc: true, leaflet: true },
});
var secF = WLH.composeSections(full);
function sumItems(items, key) { return items.reduce(function (a, it) { return a + it[key]; }, 0); }
eq(sumItems(full.items.ra, "min"), secF.ra.min, "RA item lines sum to RA subtotal (min)");
eq(sumItems(full.items.ra, "max"), secF.ra.max, "RA item lines sum to RA subtotal (max)");
eq(sumItems(full.items.cmc, "min"), secF.cmc.min, "CMC item lines sum to CMC subtotal (min)");
eq(sumItems(full.items.compilation, "max"), secF.compilation.max, "Compilation item lines sum to subtotal (max)");
var piLine = full.items.ra.filter(function (it) { return it.label.indexOf("Product information") === 0; })[0];
eq(!!piLine && piLine.label === "Product information (SmPC, Leaflet)", true, "PI is one aggregated line naming ticked docs");
eq(full.items.cmc.length >= 2, true, "CMC lines are itemised individually");

// --- 10. PERT expected value: right-skewed, below the midpoint.
approx(Math.round(WLH.pertExpected(34, 65)), 46, "PERT E(34,65) rounds to 46");
eq(WLH.pertExpected(34, 65) < (34 + 65) / 2, true, "PERT E is below the midpoint (right-skew)");
eq(WLH.pertExpected(10, 10), 10, "PERT E of a point value is that value");

// --- 11. Submission modifiers are itemised individually (not one "Grouped / shared" line).
var grpCase = WLH.computeAdditiveWorkload(HD, {
  type: "IB", procedure: "national", modules: {},
  submission: { grouping: { on: true, counts: { "Type IA": 2 } } },
});
var grpLine = grpCase.items.ra.filter(function (it) { return it.label.indexOf("Grouping ·") === 0; })[0];
eq(!!grpLine, true, "Grouping shows as its own itemised line");
eq(grpLine && grpLine.label, "Grouping · 2 further variations", "Grouping line names the count");

// --- 12. The per-CMS core line reads "for N CMS".
var cmsCase = WLH.computeAdditiveWorkload(HD, { type: "IA", procedure: "mrpdcp", cmsCount: 5, modules: {} });
var cmsLine = cmsCase.items.ra.filter(function (it) { return it.label.indexOf("for 5 CMS") !== -1; })[0];
eq(!!cmsLine, true, "Per-CMS core line reads 'for 5 CMS'");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
