// Pure Workload-Planning hour helpers. No DOM, no window state.
// Dual-mode: attaches to window.VCL_WORKLOAD_HOURS in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser.
(function (root) {
  'use strict';

  // Sum of the per-item ("+ hours") add-ons across the ticked submission types. Factor
  // multipliers are applied elsewhere (submissionFactorProduct); this is only the additive part.
  function computeSubmissionAddHours(procOptions, counts, s) {
    procOptions = procOptions || {};
    counts = counts || {};
    s = s || {};
    var h = 0;
    if (procOptions.worksharing && s.worksharing) {
      h += (s.worksharing.perNational || 0) * (counts.worksharingNational || 0)
         + (s.worksharing.perMrpdcp || 0) * (counts.worksharingMrpdcp || 0);
    }
    if (procOptions.grouping && s.grouping) {
      h += (s.grouping.perIA || 0) * (counts.groupingIA || 0)
         + (s.grouping.perIB || 0) * (counts.groupingIB || 0)
         + (s.grouping.perII || 0) * (counts.groupingII || 0);
    }
    if (procOptions.annualUpdate && s.annualUpdate) {
      h += (s.annualUpdate.perIA || 0) * (counts.annualUpdateIaCount || 0);
    }
    if (procOptions.superGrouping && s.superGrouping) {
      h += (s.superGrouping.perNational || 0) * (counts.superGroupingNational || 0)
         + (s.superGrouping.perMrpdcp || 0) * (counts.superGroupingMrpdcp || 0)
         + (s.superGrouping.perCp || 0) * (counts.superGroupingCp || 0);
    }
    return h;
  }

  // Which SG per-procedure counters to show, given the single main procedure. CP cannot mix
  // with national/mrpdcp (mirrors the Guided Workflow's CP exclusivity): a CP main procedure
  // shows only the CP counter; anything else shows national + MRP/DCP.
  function computeSgCounterKinds(procedure) {
    return procedure === 'cp' ? ['cp'] : ['national', 'mrpdcp'];
  }

  // Product-information hours: per ticked deliverable, scaled by the variation type (IA/IB/II).
  // Zero when PI is not managed in RA (gate off) or the factor table is missing. Values come from
  // F.productInfo (passed in) so this stays pure and the factors keep their single source.
  function computePiAddHours(piInRA, piDocs, type, productInfo) {
    if (!piInRA || !productInfo) return 0;
    piDocs = piDocs || {};
    var keys = ['smpc', 'leaflet', 'labelling', 'mockups'];
    var h = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (piDocs[k] && productInfo[k]) h += (productInfo[k][type] || 0);
    }
    return h;
  }

  // ============================================================================================
  // Additive workload model (from RA-CMC-hours.xlsx via window.VCL_WORKLOAD_HD).
  //
  // Replaces the old multiplicative "base × factors" estimate with a bottom-up sum of named
  // building blocks, each carrying a min and a max. The display shows a naive Sum(min)–Sum(max)
  // band per section (RA / CMC / Compilation & submission) and a grand total, exactly as agreed
  // in the confirmed "Variant A" display design. (PERT expected-value narrowing is reserved for
  // the future Budget tool and is NOT applied here.)
  //
  // These functions are pure: they take the data object and a selection descriptor, and return
  // granular {min,max} parts. The UI composes the three visible sections from these parts, so a
  // gate being off simply means that part is zero and its section is dropped.
  // ============================================================================================

  // A running {min,max} accumulator. null hour cells (source "n.a.") contribute nothing.
  function zero() { return { min: 0, max: 0 }; }
  function addInto(acc, row) {
    if (row && typeof row.min === "number") acc.min += row.min;
    if (row && typeof row.max === "number") acc.max += row.max;
    return acc;
  }
  function scaledInto(acc, part, n) {
    if (part && typeof part.min === "number") acc.min += part.min * n;
    if (part && typeof part.max === "number") acc.max += part.max * n;
    return acc;
  }

  // UI variation types collapse onto the three the workbook defines.
  function typeBucket(type) {
    if (type === "II") return "II";
    if (type === "IA" || type === "IAIN") return "IA";
    return "IB"; // IB, IB (unforeseen)
  }
  // state.procedure (national/mrpdcp/cp) -> the workbook's role1 label.
  function procedureRole1(procedure) {
    if (procedure === "mrpdcp") return "MRP/DCP";
    if (procedure === "cp") return "CP";
    return "national";
  }

  // Sum a "flat" RA-style sheet (RA - Variations & Roles, RA - Compilation & Submission). The base
  // block (role2 !== 'CMS') is counted once; a per-CMS block (role2 === 'CMS', the "for each CMS"
  // row) is scaled by cmsCount. national/CP rows have no CMS row, so they are all base and cmsCount
  // is ignored. Returns {min, max, items}: one itemised {label, min, max} entry per base row, plus
  // a single collapsed "<process> ×N" entry for the per-CMS row (only when N > 0).
  function sumFlat(rows, bucket, role1, cmsCount) {
    var acc = zero(); acc.items = [];
    if (!rows) return acc;
    var n = cmsCount || 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeBucket(r.type) !== bucket || r.role1 !== role1) continue;
      var label = (r.process || "").trim();
      if (r.role2 === "CMS") {
        if (n > 0) {
          var lo = (r.min || 0) * n, hi = (r.max || 0) * n;
          acc.min += lo; acc.max += hi;
          var cmsLabel = /\beach\b/i.test(label) ? label.replace(/\beach\b/i, String(n)) : (label + " ×" + n);
          acc.items.push({ label: cmsLabel, min: lo, max: hi });
        }
      } else {
        addInto(acc, r);
        acc.items.push({ label: label, min: r.min || 0, max: r.max || 0 });
      }
    }
    return acc;
  }

  // Product-information deliverable -> substring looked for (lower-case) in a PI activity's
  // process text ("Preparation and internal check of English SmPC", "... Leaflet", ...). Lets the
  // UI's four document chips (SmPC / leaflet / labelling / mock-ups) select exactly the PI rows a
  // change touches, so an SmPC-only change is not charged for leaflet/labelling/mock-up work.
  var PI_DOC_KEYWORDS = { smpc: "smpc", leaflet: "leaflet", labelling: "labelling", mockups: "mock" };

  // Sum the Product Information sheet, but only the rows matching a ticked document (piDocs). Same
  // base/per-CMS role handling as sumFlat. With no document ticked, PI contributes nothing even
  // when its gate is on (nothing is touched), matching the "which documents?" question in the UI.
  function sumPi(rows, bucket, role1, cmsCount, piDocs) {
    var acc = zero();
    if (!rows || !piDocs) return acc;
    var wanted = [];
    for (var k in PI_DOC_KEYWORDS) {
      if (PI_DOC_KEYWORDS.hasOwnProperty(k) && piDocs[k]) wanted.push(PI_DOC_KEYWORDS[k]);
    }
    if (!wanted.length) return acc;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeBucket(r.type) !== bucket || r.role1 !== role1) continue;
      var proc = (r.process || "").toLowerCase();
      var match = false;
      for (var j = 0; j < wanted.length; j++) { if (proc.indexOf(wanted[j]) !== -1) { match = true; break; } }
      if (!match) continue;
      if (r.role2 === "CMS") scaledInto(acc, r, cmsCount || 0);
      else addInto(acc, r);
    }
    return acc;
  }

  // Sum the CMC core sheet (CMC - Variations & Roles). Includes rows tagged with the selected
  // active substance PLUS substance-neutral rows (activeSubstance === null, e.g. the eAF annex
  // and QM coordination). With no active substance chosen, only the neutral rows count.
  function sumCmcCore(rows, bucket, role1, activeSubstance) {
    var acc = zero(); acc.items = [];
    if (!rows) return acc;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeBucket(r.type) !== bucket || r.role1 !== role1) continue;
      if (r.activeSubstance == null || r.activeSubstance === activeSubstance) {
        addInto(acc, r);
        acc.items.push({ label: (r.process || "").trim(), min: r.min || 0, max: r.max || 0 });
      }
    }
    return acc;
  }

  // Sum one "modifier" sheet (annualUpdate/grouping/superGrouping/worksharing) for one stream
  // ('ra' or 'cmc'). Finds the row matching the current type and procedure role, then adds each
  // dimension's {min,max} scaled by its count. `counts` is keyed by the sheet's own dimension
  // labels (e.g. {'Type IA': 2} or {'national': 1, 'MRP/DCP': 3}).
  function sumModifier(rows, stream, bucket, role1, counts) {
    var acc = zero();
    if (!rows || !counts) return acc;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeBucket(r.type) !== bucket || r.role !== role1) continue;
      var dims = r[stream] || {};
      for (var dim in counts) {
        if (!counts.hasOwnProperty(dim)) continue;
        var n = counts[dim] || 0;
        if (n && dims[dim]) scaledInto(acc, dims[dim], n);
      }
    }
    return acc;
  }

  // How each submission modifier is named in the itemised breakdown, and how its count is worded.
  var MODIFIER_META = {
    worksharing:   { name: "Worksharing",    unit: "further procedure", plural: true },
    grouping:      { name: "Grouping",       unit: "further variation", plural: true },
    annualUpdate:  { name: "Annual Update",  unit: "Type IA",           plural: false },
    superGrouping: { name: "Super-Grouping", unit: "further procedure", plural: true },
  };
  function countTotal(counts) {
    var n = 0; if (!counts) return 0;
    for (var d in counts) { if (counts.hasOwnProperty(d)) n += counts[d] || 0; }
    return n;
  }
  function modifierLabel(key, counts) {
    var m = MODIFIER_META[key]; var n = countTotal(counts);
    var unit = m.unit; if (m.plural && n !== 1) unit += "s";
    return m.name + " · " + n + " " + unit;
  }

  // Sum the RA and CMC contributions of all active submission modifiers, and list each active one
  // as its own itemised {label, min, max} line (Worksharing / Grouping / Annual Update /
  // Super-Grouping) instead of a single collapsed "Grouped / shared items" line.
  function sumSubmissionModifiers(HD, stream, bucket, role1, submission) {
    var acc = zero(); acc.items = [];
    if (!submission) return acc;
    var order = ["worksharing", "grouping", "annualUpdate", "superGrouping"];
    var map = {
      annualUpdate: HD.streams.annualUpdate,
      grouping: HD.streams.grouping,
      superGrouping: HD.streams.superGrouping,
      worksharing: HD.streams.worksharing,
    };
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var cfg = submission[key];
      if (!cfg || !cfg.on) continue;
      var part = sumModifier(map[key], stream, bucket, role1, cfg.counts);
      if (part.min || part.max) {
        acc.min += part.min; acc.max += part.max;
        acc.items.push({ label: modifierLabel(key, cfg.counts), min: part.min, max: part.max });
      }
    }
    return acc;
  }

  // Product-information deliverable -> display name for the single aggregated PI line.
  var PI_DOC_LABELS = { smpc: "SmPC", leaflet: "Leaflet", labelling: "Labelling", mockups: "Mock-ups" };
  // Label for the one aggregated "Product information (...)" line, naming the ticked documents.
  function piLabel(piDocs) {
    piDocs = piDocs || {};
    var names = [];
    for (var k in PI_DOC_LABELS) { if (PI_DOC_LABELS.hasOwnProperty(k) && piDocs[k]) names.push(PI_DOC_LABELS[k]); }
    return names.length ? ("Product information (" + names.join(", ") + ")") : "Product information";
  }

  // Right-skewed PERT expected value: the most-likely point sits at 1/3 of the min–max range
  // (RA effort skews towards overruns), weighted 4x. E = (min + 4*mode + max) / 6, which lands a
  // little below the midpoint. Returns null if either bound is missing.
  function pertExpected(min, max) {
    if (typeof min !== "number" || typeof max !== "number") return null;
    var mode = min + (max - min) / 3;
    return (min + 4 * mode + max) / 6;
  }

  // ---- user hour adjustments ------------------------------------------------------------------
  // The benchmark workbook is the default; a department that works differently adds its own delta
  // per block. Deltas are whole hours and may be negative. Applying a delta shifts min AND max by
  // the same amount, so the band keeps its width, and it is clamped so a block's min never goes
  // below 0 (a block cannot cost less than no work at all).
  var ADJUST_KEYS = ["core", "cmc", "pi", "compilation"];
  function normalizeHourAdjust(raw) {
    var out = {};
    raw = raw || {};
    for (var i = 0; i < ADJUST_KEYS.length; i++) {
      var k = ADJUST_KEYS[i];
      var v = raw[k];
      out[k] = (typeof v === "number" && isFinite(v)) ? Math.round(v) : 0;
    }
    return out;
  }
  function sumParts(a, b) {
    return { min: (a ? a.min : 0) + (b ? b.min : 0), max: (a ? a.max : 0) + (b ? b.max : 0) };
  }
  // The delta actually applied: 0 when the block's gate is off, otherwise never below -min.
  function applicableAdjust(delta, base, gateOn) {
    if (!gateOn || !delta) return 0;
    return Math.max(delta, -base.min);
  }
  function shiftBand(base, delta) { return { min: base.min + delta, max: base.max + delta }; }

  // Main entry point. `sel` describes the current case:
  //   { type, procedure, cmsCount, activeSubstance, piDocs,
  //     modules: { pi, cmc, compilation },     // gate booleans
  //     submission: { worksharing:{on,counts}, grouping:{on,counts}, ... } }
  // Returns granular {min,max} parts, plus `items` — the itemised activity lines per section that
  // the transparency box lists (core rows individually; PI, per-CMS and grouped/shared collapsed
  // to one line each). The caller composes the visible sections and total from the parts.
  function computeAdditiveWorkload(HD, sel) {
    sel = sel || {};
    var modules = sel.modules || {};
    var bucket = typeBucket(sel.type);
    var role1 = procedureRole1(sel.procedure);
    var cmsCount = sel.procedure === "mrpdcp" ? (sel.cmsCount || 0) : 0;
    var S = (HD && HD.streams) ? HD.streams : {};

    var raCore = sumFlat(S.ra && S.ra["RA - Variations & Roles"], bucket, role1, cmsCount);
    var pi = modules.pi ? sumPi(S.piActivities, bucket, role1, cmsCount, sel.piDocs) : zero();
    var compilation = modules.compilation ? sumFlat(S.compilationSubmission, bucket, role1, cmsCount) : zero();
    var cmcCore = modules.cmc
      ? sumCmcCore(S.cmc && S.cmc["CMC - Variations & Roles"], bucket, role1, sel.activeSubstance)
      : zero();

    var submissionRa = sumSubmissionModifiers(HD, "ra", bucket, role1, sel.submission);
    var submissionCmc = modules.cmc
      ? sumSubmissionModifiers(HD, "cmc", bucket, role1, sel.submission)
      : zero();

    // Per-block bands (the four cards Station "RA tasks" renders) plus the user's own adjustment.
    // Blocks map onto the engine parts as: core = RA core + the grouped/shared submission
    // modifiers, pi = product information, cmc = CMC core + its modifiers, compilation = the
    // compilation & submission sheet.
    var rawAdjust = normalizeHourAdjust(sel.hourAdjust);
    var blockBase = {
      core: sumParts(raCore, submissionRa),
      pi: pi,
      cmc: sumParts(cmcCore, submissionCmc),
      compilation: compilation,
    };
    var gates = { core: true, pi: !!modules.pi, cmc: !!modules.cmc, compilation: !!modules.compilation };
    var adjust = {}, blocks = {};
    for (var ai = 0; ai < ADJUST_KEYS.length; ai++) {
      var ak = ADJUST_KEYS[ai];
      adjust[ak] = applicableAdjust(rawAdjust[ak], blockBase[ak], gates[ak]);
      blocks[ak] = shiftBand(blockBase[ak], adjust[ak]);
    }

    // Itemised lines per visible section. Core rows are already itemised by the summers; PI, the
    // grouped/shared modifiers (and the per-CMS row, inside sumFlat) collapse to one line each.
    // Each non-zero own adjustment is appended as its own line, tagged own:true so the UI can
    // colour it apart from the benchmark rows.
    function ownItem(label, delta) { return { label: label, min: delta, max: delta, own: true }; }

    var raItems = (raCore.items || []).slice();
    if (modules.pi && (pi.min || pi.max)) raItems.push({ label: piLabel(sel.piDocs), min: pi.min, max: pi.max });
    (submissionRa.items || []).forEach(function (it) { raItems.push(it); });
    if (adjust.core) raItems.push(ownItem("Own adjustment · RA preparation", adjust.core));
    if (adjust.pi) raItems.push(ownItem("Own adjustment · Product information", adjust.pi));

    var cmcItems = (cmcCore.items || []).slice();
    (submissionCmc.items || []).forEach(function (it) { cmcItems.push(it); });
    if (adjust.cmc) cmcItems.push(ownItem("Own adjustment", adjust.cmc));

    var compItems = (compilation.items || []).slice();
    if (adjust.compilation) compItems.push(ownItem("Own adjustment", adjust.compilation));

    return {
      raCore: raCore, pi: pi, submissionRa: submissionRa,
      cmcCore: cmcCore, submissionCmc: submissionCmc,
      compilation: compilation,
      adjust: adjust, blocks: blocks,
      items: { ra: raItems, cmc: cmcItems, compilation: compItems },
    };
  }

  // Compose the confirmed "Variant A" three-section view from the granular parts. Returns each
  // section's {min,max} subtotal plus the grand total. CMC only counts into the total when its
  // gate is on (its part is already zero otherwise, so the sum is correct either way). The user's
  // own adjustments (already clamped and gated by computeAdditiveWorkload) are added into the
  // section they belong to: RA carries both the core and the product-information delta.
  function composeSections(parts) {
    var adj = parts.adjust || { core: 0, cmc: 0, pi: 0, compilation: 0 };
    var ra = { min: parts.raCore.min + parts.pi.min + parts.submissionRa.min + adj.core + adj.pi,
               max: parts.raCore.max + parts.pi.max + parts.submissionRa.max + adj.core + adj.pi };
    var cmc = { min: parts.cmcCore.min + parts.submissionCmc.min + adj.cmc,
                max: parts.cmcCore.max + parts.submissionCmc.max + adj.cmc };
    var compilation = { min: parts.compilation.min + adj.compilation,
                        max: parts.compilation.max + adj.compilation };
    var total = { min: ra.min + cmc.min + compilation.min,
                  max: ra.max + cmc.max + compilation.max };
    return { ra: ra, cmc: cmc, compilation: compilation, total: total };
  }

  var api = {
    computeSubmissionAddHours: computeSubmissionAddHours,
    computeSgCounterKinds: computeSgCounterKinds,
    computePiAddHours: computePiAddHours,
    // Additive model:
    computeAdditiveWorkload: computeAdditiveWorkload,
    composeSections: composeSections,
    normalizeHourAdjust: normalizeHourAdjust,
    pertExpected: pertExpected,
    typeBucket: typeBucket,
    procedureRole1: procedureRole1,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VCL_WORKLOAD_HOURS = api;
})(typeof window !== 'undefined' ? window : null);
