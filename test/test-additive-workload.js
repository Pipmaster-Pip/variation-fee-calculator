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

// --- Hour adjustments: the user's own delta on top of the benchmark. --------------------------
// Baseline case: Type IB, MRP/DCP with 3 CMS, chemical API, all three optional modules on.
function withAdjust(hourAdjust) {
  return WLH.computeAdditiveWorkload(HD, {
    type: "IB", procedure: "mrpdcp", cmsCount: 3, activeSubstance: "chemical",
    piDocs: { smpc: true },
    modules: { pi: true, cmc: true, compilation: true },
    hourAdjust: hourAdjust,
  });
}
var adjBase = withAdjust(null);
var adjBaseSec = WLH.composeSections(adjBase);

eq(adjBase.adjust, { core: 0, cmc: 0, pi: 0, compilation: 0 }, "adjust: no input -> all zero");
approx(adjBase.blocks.core.min, adjBase.raCore.min + adjBase.submissionRa.min,
  "blocks.core.min = raCore + submissionRa");
approx(adjBase.blocks.cmc.max, adjBase.cmcCore.max + adjBase.submissionCmc.max,
  "blocks.cmc.max = cmcCore + submissionCmc");

// +6 h on CMC shifts min AND max by 6, and lands in the CMC section and the total.
var adjCmc = withAdjust({ cmc: 6 });
var adjCmcSec = WLH.composeSections(adjCmc);
approx(adjCmc.adjust.cmc, 6, "adjust: +6 h on CMC is applied as +6");
approx(adjCmc.blocks.cmc.min - adjBase.blocks.cmc.min, 6, "adjust: +6 h shifts the CMC block min");
approx(adjCmc.blocks.cmc.max - adjBase.blocks.cmc.max, 6, "adjust: +6 h shifts the CMC block max");
approx(adjCmcSec.cmc.min - adjBaseSec.cmc.min, 6, "adjust: +6 h shifts the CMC section min");
approx(adjCmcSec.total.max - adjBaseSec.total.max, 6, "adjust: +6 h shifts the grand total max");

// A negative delta is clamped so the block's min never goes below 0; min and max shift by the
// SAME clamped amount, so the band keeps its width.
var hugeNeg = withAdjust({ core: -1000 });
approx(hugeNeg.adjust.core, -adjBase.blocks.core.min, "adjust: negative delta clamps at -min");
approx(hugeNeg.blocks.core.min, 0, "adjust: clamped negative leaves the block min at 0");
approx(hugeNeg.blocks.core.max - hugeNeg.blocks.core.min,
  adjBase.blocks.core.max - adjBase.blocks.core.min, "adjust: clamping keeps the band width");

// A switched-off block ignores its stored adjustment entirely.
var offAdj = WLH.computeAdditiveWorkload(HD, {
  type: "IB", procedure: "national", modules: { pi: false, cmc: false, compilation: false },
  hourAdjust: { cmc: 12, pi: 5, compilation: 3 },
});
eq({ cmc: offAdj.adjust.cmc, pi: offAdj.adjust.pi, compilation: offAdj.adjust.compilation },
  { cmc: 0, pi: 0, compilation: 0 }, "adjust: gates off -> stored adjustments contribute nothing");

// Each non-zero adjustment shows as its own itemised line, tagged own:true.
var ownRa = adjCmc.items.cmc.filter(function (i) { return i.own; });
eq(ownRa.length, 1, "adjust: CMC delta adds exactly one own:true item line");
eq({ label: ownRa[0].label, min: ownRa[0].min, max: ownRa[0].max },
  { label: "Own adjustment", min: 6, max: 6 }, "adjust: CMC item line is labelled and carries the delta");
var adjBoth = withAdjust({ core: 3, pi: -2 });
var raOwn = adjBoth.items.ra.filter(function (i) { return i.own; }).map(function (i) { return i.label; });
eq(raOwn, ["Own adjustment · RA preparation", "Own adjustment · Product information"],
  "adjust: the two RA-section deltas are labelled apart");
eq(adjBase.items.ra.filter(function (i) { return i.own; }).length, 0,
  "adjust: zero delta adds no item line");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All tests passed."));
process.exit(failures ? 1 : 0);
