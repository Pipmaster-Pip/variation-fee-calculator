// Node unit test for the budget Excel-import logic (vcl-budget-import.js). Run from project root:
//   node test/test-budget-import.js
// The module is pure (no DOM, no XLSX): it works on an array-of-arrays (what XLSX.utils
// .sheet_to_json(ws,{header:1}) yields) and takes its country universe as an injected option,
// so the fee engine / VCLCALC are not needed here. Fixtures mirror test-budget.xlsx.
// See docs/superpowers/specs/2026-10-09-budget-excel-import-design.md.
"use strict";

var IMP = require("../variation-fee-calculator/assets/js/vcl-budget-import.js");

var failures = 0;
function eq(actual, expected, msg) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS " : "  FAIL ") + msg +
    (ok ? "" : " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  if (!ok) failures++;
}
function ok(cond, msg) {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (!cond) failures++;
}

var VALID = ["DE", "IT", "FR", "LT", "LV", "ES", "NO", "IS", "SE", "FI", "AT",
  "BG", "PT", "PL", "RO", "HR", "DK", "EU"];
var OPTS = { validCountries: VALID, defaultYear: 2027 };

// Canonical header row matching test-budget.xlsx.
var HEADERS = ["Product", "Procedure No. ", "Strengths", "Countries", "Procedure",
  "Type IA", "Type IB", "Type II", "Planned Submission Date", "Quarter"];

// The 8 data rows of test-budget.xlsx.
var DATA = [
  ["Bimatoprost/Timolol 50 mg Augentropfen", "DE/H/1234/001-004", 4, "DE, IT, FR, LT, LV, ES, NO, IS, SE", "Worksharing (RMS=DE)", 3, 1, 4, 2027, "Q1"],
  ["Bimatoprost/Timolol 50 mg Augentropfen", "national", 4, "FI", "Worksharing (RMS=DE)", 3, 1, 4, 2027, "Q1"],
  ["Bimatoprost/Timolol 50 mg Augentropfen", "national", 4, "AT", "Worksharing (RMS=DE)", 3, 1, 4, 2027, "Q1"],
  ["Bimatoprost/Timolol 50 mg Augentropfen", "DE/H/1234/001-004", 4, "DE, IT, FR, LT, LV, ES, NO, IS, SE", "n.a.", null, 1, null, 2027, "Q3"],
  ["Natriumvalproat 100 - 400 mg tablets", "PT/H/1234/001-004", 4, "BG, PT, PL, RO, HR", "n.a.", 2, 2, 2, 2027, "Q3"],
  ["Aspirin Plus C", "national", 1, "DK", "n.a.", 5, null, null, 2027, "Q1"],
  ["Diclofenac 25 mg Filtabletten", "CP", 1, "EU", "n.a.", null, null, 2, 2027, "Q4"],
  ["Diclofenac 25 mg Filtabletten", "CP", 1, "EU", "n.a.", 1, 3, null, 2027, "Q1"],
];
var FULL = [HEADERS].concat(DATA);

console.log("Budget import tests\n");

// --- 1. Column detection on the canonical header row.
var det = IMP.detectColumns(FULL, OPTS);
eq(det.headerRowIndex, 0, "detect: header row is row 0");
eq(det.map.product, 0, "detect: Product -> col 0");
eq(det.map.procNo, 1, "detect: Procedure No. -> col 1 (trailing space tolerated)");
eq(det.map.countries, 3, "detect: Countries -> col 3");
eq(det.map.procedure, 4, "detect: Procedure -> col 4");
eq(det.map.typeIA, 5, "detect: Type IA -> col 5");
eq(det.map.typeII, 7, "detect: Type II -> col 7");
eq(det.map.quarter, 9, "detect: Quarter -> col 9");
eq(det.unmatchedRequired, [], "detect: nothing required is missing");

// --- 2. Tolerant detection: German synonyms, reordered, header not in row 1.
var DE_SHEET = [
  ["Mein Budget 2027", null, null],
  [],
  ["Produkt", "Verfahren", "Länder", "Typ IA", "Typ IB", "Typ II", "Jahr", "Quartal"],
  ["Aspirin Plus C", "n.a.", "DK", 5, null, null, 2027, "Q1"],
];
var det2 = IMP.detectColumns(DE_SHEET, OPTS);
eq(det2.headerRowIndex, 2, "detect(DE): finds header row at index 2");
eq(det2.map.product, 0, "detect(DE): Produkt -> col 0");
eq(det2.map.countries, 2, "detect(DE): Länder -> col 2");
eq(det2.map.typeIB, 4, "detect(DE): Typ IB -> col 4");
ok(det2.map.procNo == null, "detect(DE): no Procedure No. column (optional) -> unmapped");
eq(det2.unmatchedRequired, [], "detect(DE): required fields all present");

// --- 3. Missing a required column -> reported for the Stufe-2 mapping fallback.
var BAD = [
  ["Name", "Proc", "Type IA"],
  ["X", "n.a.", 1],
];
var det3 = IMP.detectColumns(BAD, OPTS);
ok(det3.unmatchedRequired.indexOf("countries") !== -1, "detect(bad): 'countries' flagged as unmatched required");

// --- 4. parseRows: procedure kind / rms / countries / counts / mode derivation.
var parsed = IMP.parseRows(FULL, det, OPTS);
eq(parsed.rawLines.length, 8, "parse: one raw line per data row");

var r0 = parsed.rawLines[0];
eq(r0.procKind, "mrpdcp", "parse row0: DE/H/... -> mrpdcp");
eq(r0.rms, "DE", "parse row0: RMS from procedure-number prefix");
eq(r0.cms, ["IT", "FR", "LT", "LV", "ES", "NO", "IS", "SE"], "parse row0: CMS = countries minus RMS");
eq(r0.mode, "worksharing", "parse row0: Worksharing label -> worksharing mode");
eq(r0.wsLabel, "Worksharing (RMS=DE)", "parse row0: worksharing label captured");
eq(r0.counts, { IA: 3, IB: 1, II: 4 }, "parse row0: type counts");
eq(r0.year, 2027, "parse row0: year");
eq(r0.quarter, "Q1", "parse row0: quarter");
ok(r0.complete, "parse row0: complete (valid RMS + types)");

var r1 = parsed.rawLines[1];
eq(r1.procKind, "national", "parse row1: 'national' -> national");
eq(r1.nat, "FI", "parse row1: national anchor country");
eq(r1.mode, "worksharing", "parse row1: still worksharing (shared label)");

var r5 = parsed.rawLines[5];
eq(r5.procKind, "national", "parse row5: Aspirin national");
eq(r5.nat, "DK", "parse row5: anchor DK");
eq(r5.mode, "single", "parse row5: n.a. -> single");
eq(r5.counts, { IA: 5, IB: 0, II: 0 }, "parse row5: blank counts -> 0");

var r6 = parsed.rawLines[6];
eq(r6.procKind, "cp", "parse row6: CP -> cp");
eq(r6.nat, null, "parse row6: cp has no national anchor");
ok(r6.complete, "parse row6: cp complete without country validation");

// --- 5. Invalid country + no types -> incomplete with warnings (still imported).
var BADROW = [HEADERS, ["Foo", "national", 1, "XX", "n.a.", null, null, null, 2027, "Q2"]];
var pBad = IMP.parseRows(BADROW, IMP.detectColumns(BADROW, OPTS), OPTS);
var rb = pBad.rawLines[0];
ok(!rb.complete, "parse(bad): unknown country + no types -> incomplete");
ok(rb.warnings.length >= 1, "parse(bad): carries at least one warning");

// --- 6. Grouping: rows 1-3 collapse to one worksharing line, 5 singles stay.
var grouped = IMP.groupLines(parsed.rawLines);
eq(grouped.lines.length, 6, "group: 8 rows -> 6 lines (1 WS group + 5 singles)");

var ws = grouped.lines[0];
eq(ws.submission.mode, "worksharing", "group: first line is worksharing");
eq(ws.submission.procedures.length, 3, "group: WS line carries 3 procedures");
eq(ws.submission.procedures[0].kind, "mrpdcp", "group: mrpdcp procedure leads (procedures[0])");
eq(ws.submission.procedures[0].rms, "DE", "group: lead RMS = DE");
var wsVarTypes = ws.submission.variations.map(function (v) { return v.type; });
eq(wsVarTypes, ["IA", "IA", "IA", "IB", "II", "II", "II", "II"], "group: 3xIA+1xIB+4xII expanded, all uncoded");
ok(ws.submission.variations.every(function (v) { return v.code === null; }), "group: variations are uncoded (code null)");

// --- 7. Singles keep single mode; CP line has a cp procedure.
var cpLine = grouped.lines.filter(function (l) {
  return l.submission.procedures[0].kind === "cp";
})[0];
ok(cpLine, "group: a CP single line exists");
eq(cpLine.submission.mode, null, "group: CP line is single mode (null)");

// --- 8. Two Diclofenac CP rows (same product, not grouped) surface a merge hint.
ok(grouped.groupWarnings.some(function (w) { return /Diclofenac/.test(w.product || w.message || ""); }),
  "group: same-product singles surface a merge hint");

// --- 9. Inconsistent type counts inside a worksharing label -> warning, first row wins.
var INCONS = [HEADERS,
  ["P", "DE/H/9/1", 1, "DE, FR", "Worksharing (RMS=DE)", 2, 0, 0, 2027, "Q1"],
  ["P", "national", 1, "IT", "Worksharing (RMS=DE)", 9, 0, 0, 2027, "Q1"]];
var gi = IMP.groupLines(IMP.parseRows(INCONS, IMP.detectColumns(INCONS, OPTS), OPTS).rawLines);
eq(gi.lines.length, 1, "group(inconsistent): still one WS line");
eq(gi.lines[0].submission.variations.length, 2, "group(inconsistent): first row's counts win (2 variations)");
ok(gi.groupWarnings.some(function (w) { return /count/i.test(w.message || ""); }),
  "group(inconsistent): inconsistency warning raised");

// --- 9b. Composite internal country codes ("DE - BfArM"): Excel "DE" must resolve to the full cc
//         the fee engine prices with, not stay "DE" (which would price at zero).
var COMPOSITE = ["DE - BfArM", "IT", "FR", "FI", "AT"];
var COMP_SHEET = [HEADERS,
  ["P", "DE/H/9/1", 1, "DE, IT, FR", "Worksharing (RMS=DE)", 1, 0, 0, 2027, "Q1"],
  ["P", "national", 1, "FI", "Worksharing (RMS=DE)", 1, 0, 0, 2027, "Q1"]];
var compOpts = { validCountries: COMPOSITE, defaultYear: 2027 };
var pc = IMP.parseRows(COMP_SHEET, IMP.detectColumns(COMP_SHEET, compOpts), compOpts);
eq(pc.rawLines[0].rms, "DE - BfArM", "composite: RMS 'DE' resolves to 'DE - BfArM'");
eq(pc.rawLines[0].cms, ["IT", "FR"], "composite: CMS resolve, RMS removed");
ok(pc.rawLines[0].complete, "composite: line complete (no unknown-country warning)");

// --- 10. Template + example fixtures are well-formed arrays-of-arrays with the canonical headers.
var tpl = IMP.buildTemplateAoa();
ok(Array.isArray(tpl) && Array.isArray(tpl[0]), "template: array-of-arrays");
eq(tpl[0][0], "Product", "template: first header is Product");
ok(tpl.length >= 2, "template: has at least one example row");
ok(Array.isArray(IMP.EXAMPLE_ROWS) && IMP.EXAMPLE_ROWS.length >= 2, "example: non-empty array-of-arrays");

console.log("\n" + (failures ? failures + " FAILURE(S)" : "All passed") + "\n");
process.exit(failures ? 1 : 0);
