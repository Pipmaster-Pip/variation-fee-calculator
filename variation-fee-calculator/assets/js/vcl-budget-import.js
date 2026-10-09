// Pure Budget Planning Excel-import logic: no DOM, no XLSX dependency. Operates on an
// array-of-arrays (what XLSX.utils.sheet_to_json(ws, { header: 1 }) yields) and takes its
// country universe as an injected option (VCLCALC.countries() in the browser), so it stays
// unit-testable under Node. Dual-mode: attaches to window.VCL_BUDGET_IMPORT in the browser and
// exports via module.exports in Node. See docs/superpowers/specs/2026-10-09-budget-excel-import-design.md.
(function (root) {
  "use strict";

  // ---- column detection (Stufe 1 tolerant matching) --------------------------------------

  // Field -> list of accepted header spellings (normalized: lowercased, non-alphanumerics
  // collapsed to single spaces, trimmed). Order within a list does not matter.
  var SYNONYMS = {
    product: ["product", "produkt", "arzneimittel", "medicinal product", "name", "praeparat", "präparat"],
    procNo: ["procedure no", "procedure number", "verfahrensnummer", "proc no", "procedure num", "verfahrens nr"],
    strengths: ["strengths", "staerken", "stärken", "strength", "anzahl staerken"],
    countries: ["countries", "laender", "länder", "markets", "maerkte", "märkte", "country", "land"],
    procedure: ["procedure", "verfahren", "mode", "modus", "submission type"],
    typeIA: ["type ia", "typ ia", "ia", "type i a"],
    typeIB: ["type ib", "typ ib", "ib", "type i b"],
    typeII: ["type ii", "typ ii", "ii", "type 2"],
    date: ["planned submission date", "year", "jahr", "submission year", "planned date", "date", "budget year"],
    quarter: ["quarter", "quartal", "q"],
  };

  // Fields a usable line needs. Procedure-number, strengths, date and quarter are optional and
  // default when absent.
  var REQUIRED = ["product", "procedure", "countries"];
  var TYPE_FIELDS = ["typeIA", "typeIB", "typeII"];

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Which field (if any) a given header cell spells. Longest-synonym-wins keeps "type ii" from
  // being swallowed by the bare "ii" synonym when both could match.
  function fieldForHeader(cell) {
    var n = norm(cell);
    if (!n) return null;
    var best = null, bestLen = -1;
    Object.keys(SYNONYMS).forEach(function (field) {
      SYNONYMS[field].forEach(function (syn) {
        var ns = norm(syn);
        if (n === ns && ns.length > bestLen) { best = field; bestLen = ns.length; }
      });
    });
    return best;
  }

  // Scans the first few rows for the one that spells the most known headers, so a sheet with a
  // title/blank rows above the real header still maps. Returns { map, headerRowIndex,
  // unmatchedRequired, ignored }.
  function detectColumns(aoa, opts) {
    aoa = Array.isArray(aoa) ? aoa : [];
    var scan = Math.min(aoa.length, 8);
    var bestRow = 0, bestScore = -1, bestMap = {};
    for (var r = 0; r < scan; r++) {
      var row = Array.isArray(aoa[r]) ? aoa[r] : [];
      var map = {}, score = 0;
      for (var c = 0; c < row.length; c++) {
        var field = fieldForHeader(row[c]);
        if (field && map[field] == null) { map[field] = c; score++; }
      }
      if (score > bestScore) { bestScore = score; bestRow = r; bestMap = map; }
    }
    var headerRow = Array.isArray(aoa[bestRow]) ? aoa[bestRow] : [];
    var ignored = [];
    for (var i = 0; i < headerRow.length; i++) {
      if (fieldForHeader(headerRow[i]) == null && norm(headerRow[i])) ignored.push(String(headerRow[i]).trim());
    }
    var unmatchedRequired = REQUIRED.filter(function (f) { return bestMap[f] == null; });
    if (!TYPE_FIELDS.some(function (f) { return bestMap[f] != null; })) unmatchedRequired.push("types");
    return { map: bestMap, headerRowIndex: bestRow, unmatchedRequired: unmatchedRequired, ignored: ignored };
  }

  // ---- value parsing ---------------------------------------------------------------------

  function cell(row, idx) { return (idx == null || !row) ? undefined : row[idx]; }

  function toInt(v) {
    if (v == null || v === "") return 0;
    var n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    return isFinite(n) ? n : 0;
  }

  function parseCountries(raw) {
    return String(raw == null ? "" : raw).split(/[,;/]+/)
      .map(function (s) { return s.trim().toUpperCase(); })
      .filter(function (s) { return s.length > 0; });
  }

  // "Worksharing (RMS=DE)" -> "DE"; anything else -> null.
  function rmsFromLabel(procedureRaw) {
    var m = /rms\s*[=:]?\s*([a-z]{2})/i.exec(String(procedureRaw || ""));
    return m ? m[1].toUpperCase() : null;
  }

  // Procedure kind + RMS from the "Procedure No." cell: "national" -> national; "CP" -> cp;
  // "DE/H/1234/001-004" -> mrpdcp with RMS from the two-letter prefix.
  function kindFromProcNo(procNoRaw) {
    var s = String(procNoRaw == null ? "" : procNoRaw).trim();
    if (/^national$/i.test(s)) return { kind: "national", rms: null };
    if (/^cp$/i.test(s)) return { kind: "cp", rms: null };
    var m = /^([a-z]{2})\s*\//i.exec(s);
    if (m) return { kind: "mrpdcp", rms: m[1].toUpperCase() };
    return { kind: null, rms: null }; // unrecognized -> flagged later
  }

  function parseYear(v, fallback) {
    var n = parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10);
    return (isFinite(n) && n >= 2000 && n <= 2100) ? n : fallback;
  }

  function parseQuarter(v) {
    var m = /q\s*([1-4])/i.exec(String(v == null ? "" : v));
    return m ? "Q" + m[1] : null;
  }

  // One raw line per sheet data row. Derives procedure kind/anchor/countries, mode, counts and a
  // completeness flag; never throws, collects per-row warnings instead.
  function parseRows(aoa, detection, opts) {
    opts = opts || {};
    // The internal country universe uses composite codes ("DE - BfArM"); an Excel sheet carries the
    // short alias ("DE"). Build a short/full -> full-cc map so a resolved country stores the code the
    // fee engine actually prices with (otherwise a "DE" procedure would price at zero).
    var aliasMap = {};
    (opts.validCountries || []).forEach(function (full) {
      var f = String(full);
      aliasMap[f.toUpperCase()] = f;
      var short = f.split(/\s*-\s*/)[0].trim().toUpperCase();
      if (!(short in aliasMap)) aliasMap[short] = f;
    });
    var hasValidSet = (opts.validCountries || []).length > 0;
    function resolveCc(cc) { return aliasMap[String(cc).toUpperCase()] || null; }
    var defYear = opts.defaultYear || (new Date().getFullYear() + 1);
    var map = detection.map || {};
    var start = (detection.headerRowIndex || 0) + 1;
    var rawLines = [], warnings = [];

    for (var r = start; r < aoa.length; r++) {
      var row = aoa[r];
      if (!Array.isArray(row)) continue;
      var product = String(cell(row, map.product) == null ? "" : cell(row, map.product)).trim();
      var procedureRaw = String(cell(row, map.procedure) == null ? "" : cell(row, map.procedure)).trim();
      var procNoRaw = cell(row, map.procNo);
      // A blank line (no product and no procedure data) is skipped silently.
      if (!product && !procedureRaw && !procNoRaw && !cell(row, map.countries)) continue;

      var kindInfo = kindFromProcNo(procNoRaw);
      var countries = parseCountries(cell(row, map.countries));
      var counts = { IA: toInt(cell(row, map.typeIA)), IB: toInt(cell(row, map.typeIB)), II: toInt(cell(row, map.typeII)) };
      var wsLabel = /worksharing/i.test(procedureRaw) ? procedureRaw : null;
      var mode = wsLabel ? "worksharing" : "single";
      var w = [];

      var kind = kindInfo.kind, rms = kindInfo.rms, nat = null, cms = [];
      if (kind == null) { kind = "national"; w.push("Unrecognized procedure '" + String(procNoRaw || "") + "' — treated as national."); }

      function resolveOrWarn(cc) {
        var full = resolveCc(cc);
        if (hasValidSet && !full) { w.push("Unknown country code '" + cc + "'."); return cc; }
        return full || cc;
      }

      if (kind === "national") {
        nat = countries.length ? resolveOrWarn(countries[0]) : null;
        if (!nat) w.push("No country for national procedure.");
        if (countries.length > 1) w.push("National procedure lists " + countries.length + " countries — only '" + countries[0] + "' used.");
      } else if (kind === "mrpdcp") {
        var rawRms = rms || rmsFromLabel(procedureRaw);
        if (rawRms) rms = resolveOrWarn(rawRms);
        else w.push("No RMS for MRP/DCP procedure.");
        // CMS = the listed countries minus the RMS (compared on the raw short code), each resolved.
        cms = countries.filter(function (c) { return c !== String(rawRms || "").toUpperCase(); }).map(resolveOrWarn);
      } // cp: no country anchor needed

      var hasType = counts.IA + counts.IB + counts.II > 0;
      if (!hasType) w.push("No variation type set (IA/IB/II all 0).");

      var anchorOk = kind === "cp" || (kind === "national" && !!nat) || (kind === "mrpdcp" && !!rms);
      var complete = anchorOk && hasType && !w.some(function (m) { return /Unknown country/.test(m); });

      rawLines.push({
        rowIndex: r, product: product, procNoRaw: procNoRaw == null ? "" : String(procNoRaw),
        procKind: kind, rms: rms, nat: nat, cms: cms, countries: countries,
        mode: mode, wsLabel: wsLabel, counts: counts,
        strengths: Math.max(1, toInt(cell(row, map.strengths)) || 1),
        year: parseYear(cell(row, map.date), defYear), quarter: parseQuarter(cell(row, map.quarter)),
        warnings: w, complete: complete,
      });
    }
    return { rawLines: rawLines, warnings: warnings };
  }

  // ---- grouping + submission building ----------------------------------------------------

  var uid = 0;
  function newId() { return "line-import-" + Date.now() + "-" + (uid++); }

  function procedureFor(raw) {
    if (raw.procKind === "national") return { kind: "national", nat: raw.nat, rms: null, cms: [] };
    if (raw.procKind === "cp") return { kind: "cp", nat: null, rms: null, cms: [] };
    return { kind: "mrpdcp", nat: null, rms: raw.rms, cms: raw.cms || [] };
  }

  function variationsFromCounts(counts) {
    var out = [];
    ["IA", "IB", "II"].forEach(function (t) {
      for (var i = 0; i < (counts[t] || 0); i++) out.push({ code: null, variantId: null, type: t });
    });
    return out;
  }

  // Shapes a plan line ready for VCL_BUDGET_ENGINE.normalizeLine(). `submission` is the lite
  // shape normalizeSubmission accepts (mode, variations, procedures, strengths).
  function makeLine(raw, mode, procedures, counts, strengths) {
    return {
      id: newId(), product: raw.product, year: raw.year, quarter: raw.quarter,
      probability: 100, externalCost: 0, _incomplete: !raw.complete,
      submission: {
        mode: mode === "single" ? null : mode,
        variations: variationsFromCounts(counts),
        procedures: procedures,
        strengths: { default: Math.max(1, strengths || 1), overrides: {} },
      },
    };
  }

  // Rows sharing product + worksharing label collapse into one worksharing line (procedures
  // ordered with the RMS-bearing mrpdcp first). Everything else is one line per row. Same-product
  // singles and inconsistent group counts surface as groupWarnings (not auto-merged).
  function groupLines(rawLines) {
    rawLines = Array.isArray(rawLines) ? rawLines : [];
    var lines = [], groupWarnings = [];
    var wsGroups = {}, emitted = {};

    // First pass: collect worksharing members by product + label.
    rawLines.forEach(function (raw) {
      if (raw.mode === "worksharing" && raw.wsLabel) {
        var key = raw.product + "||" + raw.wsLabel;
        (wsGroups[key] = wsGroups[key] || []).push(raw);
      }
    });

    // Second pass preserves sheet order: a group is emitted where its first member appears,
    // singles emit in place.
    rawLines.forEach(function (raw) {
      if (raw.mode === "worksharing" && raw.wsLabel) {
        var key = raw.product + "||" + raw.wsLabel;
        if (emitted[key]) return;
        emitted[key] = true;
        var members = wsGroups[key];
        var first = members[0];
        var countsKey = function (c) { return c.IA + "/" + c.IB + "/" + c.II; };
        if (members.some(function (m) { return countsKey(m.counts) !== countsKey(first.counts); })) {
          groupWarnings.push({ product: first.product, message: "Worksharing group has inconsistent type counts across rows — first row's counts used." });
        }
        var procs = members.map(procedureFor);
        procs.sort(function (a, b) { return (a.kind === "mrpdcp" ? -1 : 0) - (b.kind === "mrpdcp" ? -1 : 0); });
        var incomplete = members.some(function (m) { return !m.complete; });
        var wsLine = makeLine({ product: first.product, year: first.year, quarter: first.quarter, complete: !incomplete },
          "worksharing", procs, first.counts, first.strengths);
        wsLine._warnings = members.reduce(function (acc, m) { return acc.concat(m.warnings || []); }, []);
        lines.push(wsLine);
      } else {
        var single = makeLine(raw, "single", [procedureFor(raw)], raw.counts, raw.strengths);
        single._warnings = (raw.warnings || []).slice();
        lines.push(single);
      }
    });

    // Informational: single lines sharing a product that were NOT grouped (candidate merges).
    var byProduct = {};
    lines.forEach(function (l) { (byProduct[l.product] = byProduct[l.product] || []).push(l); });
    Object.keys(byProduct).forEach(function (p) {
      if (byProduct[p].length > 1 && byProduct[p].every(function (l) { return l.submission.mode === null; })) {
        groupWarnings.push({ product: p, message: "Multiple separate lines for '" + p + "' — left ungrouped; group manually if they belong together." });
      }
    });

    return { lines: lines, groupWarnings: groupWarnings };
  }

  // ---- template + example ----------------------------------------------------------------

  var TEMPLATE_HEADERS = ["Product", "Procedure No.", "Strengths", "Countries", "Procedure",
    "Type IA", "Type IB", "Type II", "Planned Submission Date", "Quarter"];

  var EXAMPLE_ROWS = [
    TEMPLATE_HEADERS,
    ["Ibuprofen Gel 800 mg", "DE/H/2001/001", 1, "DE, AT, NL", "Worksharing (RMS=DE)", 2, 1, 1, 2027, "Q1"],
    ["Ibuprofen Gel 800 mg", "national", 1, "FR", "Worksharing (RMS=DE)", 2, 1, 1, 2027, "Q1"],
    ["Paracetamol Suppositories", "PT/H/2002/001-002", 2, "PT, ES", "n.a.", 1, 1, "", 2027, "Q2"],
    ["Omeprazole Gastro-resistant capsules", "national", 3, "DE", "n.a.", 2, "", 1, 2027, "Q3"],
    ["Metformin Film-coated tablets 1000 mg", "CP", 1, "EU", "n.a.", "", "", 1, 2027, "Q4"],
    ["Bisoprolol Tablets", "DE/H/2003/001-004", 4, "DE, IT, PL, SE", "n.a.", 3, 2, "", 2027, "Q2"],
  ];

  function buildTemplateAoa() { return EXAMPLE_ROWS.map(function (r) { return r.slice(); }); }

  var api = {
    detectColumns: detectColumns,
    parseRows: parseRows,
    groupLines: groupLines,
    buildTemplateAoa: buildTemplateAoa,
    EXAMPLE_ROWS: EXAMPLE_ROWS,
    TEMPLATE_HEADERS: TEMPLATE_HEADERS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_BUDGET_IMPORT = api;
})(typeof window !== "undefined" ? window : this);
