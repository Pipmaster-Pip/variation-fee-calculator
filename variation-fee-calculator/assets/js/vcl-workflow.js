// Guided Workflow -- the Variation Toolbox's 8th tool. A station-by-station path that
// carries the user through one variation across all of the other tools: Identify the
// classification & substance -> describe the Procedure (with grouping/worksharing list
// builders) -> pick the submission Date & see the Timeline -> read the Fees per procedure.
//
// Self-contained like the Workload tool: vcl-app.js only wires the nav button and calls
// window.VCL_WORKFLOW.render(col) once; everything below manages its own state and rerender.
// Reuses the shared classification data (window.VCL_DATA) and, in later phases, the fee engine
// (window.VCLCALC) and the workload factor tables.
(function () {
  "use strict";

  const DATA = window.VCL_DATA || {};
  const ENTRIES = DATA.ENTRIES || [];
  const WD = window.VCL_WORKLOAD_DATA || {};

  // Annual Update, Super-Grouping, and Worksharing are EU-law multi-country submission
  // constructs (Art. 7(2)(b) / Art. 20 VO (EG) 1234/2008), open only to EU member states plus
  // Iceland and Norway (EEA/EFTA, full MRP/DCP participants). CH and RS are non-EU/EEA
  // national-only jurisdictions with no MRP/DCP role at all. The UK left the EU (Brexit) and
  // can no longer take part in any EU multi-country procedure -- it remains valid ONLY as a CMS
  // in MRP/DCP (a role this list never touches) and for the standalone single-country Fee
  // Calculator (a separate tool/file, unaffected by this list).
  const NON_EU_PROCEDURE_COUNTRIES = ["CH", "RS", "UK"];

  const STATIONS = [
    { key: "A", label: "Variations" },
    { key: "B", label: "Procedures" },
    { key: "C", label: "RA tasks" },
    { key: "D", label: "Date & Timeline" },
    { key: "E", label: "Fees" },
  ];

  // Only referenced by buildPlaceholder (the fallback for a station without a real builder);
  // every station A–E now has one, so this is effectively unused but kept as a harmless fallback.
  const STATION_META = {
    D: { title: "Date & Timeline", sub: "When, and how does the clock run?", note: "The desired initial-submission date and the timeline go here." },
    E: { title: "Fees", sub: "What does it cost, per procedure?", note: "Fees per procedure (at country level) and the export go here." },
  };

  const state = {
    station: "A",
    // The furthest station the user has reached -- gates which dots are clickable.
    reached: { A: true, B: false, C: false, D: false, E: false },
    // Station A
    pickedCode: null,
    pickedVariantId: undefined,
    query: "",
    typeOnly: null,        // 'IA' | 'IB' | 'II' when the user skips the classification and just picks a type
    // Station "RA tasks" -- optional RA modules beyond the always-on core RA work.
    activeSubstance: null, // 'biologic' | 'chemical' -- only drives CMC dossier hours (set in the CMC module)
    cmcInRA: false,        // CMC dossier written in RA (needs an active substance)
    compilationInRA: false,// dossier compilation (docuBridge/Veeva) + CESP submission done in RA
    // Product information module: gate + which documents this change touches.
    piInRA: false,
    piDocs: { smpc: false, leaflet: false, labelling: false, mockups: false },
    // "How the RA hours are calculated" box open/closed (persists across stations).
    methodOpen: false,
    // "RA-hours reference" lookup box: open/closed + its independent filters.
    refOpen: false,
    refType: "II",
    refRole: "national",
    refStream: "all",
    // Station B
    procedure: newProcedure(),        // the primary procedure ("procedure 1")
    // mode: null | 'worksharing' | 'annualUpdate' | 'superGrouping'
    submission: { grouping: false, mode: null },
    grouping: [],                      // additional variations: [{ code, variantId, type }]
    worksharing: [],                   // additional procedures: [newProcedure(), ...]
    worksharingLead: null,             // cc of the authority leading the worksharing (auto = EMA when a CP is involved)
    // Station C
    submissionDate: "",
    earliestImplDate: "",              // earliest implementation date across the grouped variations (Annual Update deadline calc)
    iiSub: "60",                       // Type II sub-procedure: 30 | 60 | 90 (days)
    clockStopFraction: 1,              // 0..1 across the clock-stop min..max
    // Strengths (Station D): a global default, with per-country overrides only where it matters.
    strengthsDefault: 1,
    strengthsOverrides: {},            // cc -> number of strengths (shown for strength-sensitive countries)
    // Summary (Station D): reveal the grouped variations' codes & descriptions on demand.
    summaryShowVariations: false,
    // Worksharing pricing (Station D): the lead's one-off Type-II special-case pick, and the
    // per-line picks for every participating authority (keyed "cc|role").
    worksharingLeadSpecial: null,
    wsSpecials: {},
    // Single-variation pricing (Station D, non-worksharing): per-line fee-category picks
    // (e.g. DE Type II "simple" vs "complex"), keyed "cc|role".
    specials: {},
  };

  let container = null;

  // ---- procedure model (fee-engine ready: each procedure -> [{cc, role}]) ----
  function newProcedure() { return { kind: "national", nat: null, rms: null, cms: [] }; }

  // Country universe from the fee engine, cached and split by supported role.
  let COUNTRIES = null;
  function countryData() {
    if (COUNTRIES) return COUNTRIES;
    const all = (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [];
    const nameOf = {};
    all.forEach((c) => { nameOf[c.cc] = c.name; });
    const national = all.filter((c) => c.roles.indexOf("national") !== -1).map((c) => c.cc);
    COUNTRIES = {
      all: all,
      nameOf: nameOf,
      national: national,
      nationalEU: national.filter((cc) => NON_EU_PROCEDURE_COUNTRIES.indexOf(cc) === -1),
      leadEligible: all.filter((c) => NON_EU_PROCEDURE_COUNTRIES.indexOf(c.cc) === -1),
      rms: all.filter((c) => c.roles.indexOf("RMS") !== -1).map((c) => c.cc),
      cms: all.filter((c) => c.roles.indexOf("CMS") !== -1).map((c) => c.cc),
      ema: (all.find((c) => c.roles.indexOf("EMA") !== -1) || {}).cc || null,
    };
    return COUNTRIES;
  }

  // Number of strengths registered for a country: the global default unless overridden.
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function strengthsFor(cc) { return window.VCL_SUBMISSION.strengthsFor(submissionFromState(), cc); }

  // Flatten a procedure to the (cc, role, strengths) triples the fee engine consumes.
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function procCountries(p) { return window.VCL_SUBMISSION.procCountries(submissionFromState(), p, subEngines()); }
  function procComplete(p) {
    if (!p) return false;
    if (p.kind === "national") return !!p.nat;
    if (p.kind === "cp") return true;
    if (p.kind === "mrpdcp") return !!p.rms; // at least the RMS
    return false;
  }
  function procLabel(p) {
    if (!p) return "";
    if (p.kind === "national") return "National" + (p.nat ? " · " + p.nat : "");
    if (p.kind === "cp") return "CP · EMA";
    if (p.kind === "mrpdcp") return "MRP/DCP · " + (p.rms || "?") + (p.cms.length ? " +" + p.cms.length + " CMS" : "");
    return "";
  }

  // ---- shared submission builder (feeds window.VCL_SUBMISSION, the module both the Guided
  // Workflow and the Budget tool build a Submission for and call for fee/hours math -- see
  // docs/superpowers/specs/2026-08-05-budget-submission-model-design.md). The single mapping
  // point (Substitution Table in the Phase-1 plan) from the Guided-Workflow `state` to the
  // canonical Submission shape.
  function submissionFromState() {
    var base = currentType();
    // variations[0] is ALWAYS the base slot: the shared engine treats variations[0] as the base and
    // variations.slice(1) as the grouped extras. Keep the slot even when the base type is transiently
    // unset (e.g. the user clicked "Change" on the base while grouping rows remain) so a grouping item
    // is never mis-promoted into the base position — that would drop it from the grouping counts and
    // change the displayed RA hours, breaking behaviour parity.
    var variations = [{ code: state.pickedCode, variantId: state.pickedVariantId, type: base }];
    if (state.submission.grouping) state.grouping.forEach(function (g) { variations.push({ code: g.code, variantId: g.variantId, type: g.type }); });
    var procedures = [state.procedure].concat(multiProcedureMode() ? state.worksharing : []);
    return {
      mode: state.submission.mode,
      variations: variations,
      procedures: procedures,
      lead: state.worksharingLead,
      raTasks: { cmc: !!state.cmcInRA, compilation: !!state.compilationInRA, pi: state.piInRA, piDocs: state.piDocs, activeSubstance: state.activeSubstance },
      strengths: { default: state.strengthsDefault, overrides: state.strengthsOverrides },
      specials: { line: state.specials, ws: state.wsSpecials, lead: state.worksharingLeadSpecial },
    };
  }
  function subEngines() {
    return {
      computeFees: window.VCLCALC && window.VCLCALC.computeFees,
      countries: (window.VCLCALC && window.VCLCALC.countries) ? window.VCLCALC.countries() : [],
      feeRows: (window.VCLCALC_DATA && window.VCLCALC_DATA.FEE_ROWS) || [],
      workload: window.VCL_WORKLOAD_HOURS, workloadData: window.VCL_WORKLOAD_HD, sgLogic: window.VCL_SG_LOGIC,
    };
  }

  // ---- fees ----
  // The fee engine buckets by IA/IB/II; IAIN counts as IA, "IB (unforeseen)" as IB.
  function feeBucket(type) {
    if (!type) return null;
    if (type.indexOf("II") === 0) return "II";
    if (type.indexOf("IB") === 0) return "IB";
    if (type.indexOf("IA") === 0) return "IA";
    return null;
  }
  // Every procedure carries the same variation content: the base variation plus any grouped ones.
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function feeCounts() { return window.VCL_SUBMISSION.feeCounts(submissionFromState()); }
  function feeCountsTotal(c) { return window.VCL_SUBMISSION.feeCountsTotal(c); }
  // Highest-severity type across the whole submission (base + grouping): a grouped bundle is
  // procedurally governed by its most complex member (IA < IB < II), so the live-preview's
  // "no classification code picked" badge must track this, not just the base's own type.
  function highestType() { return window.VCL_SUBMISSION.highestType(submissionFromState()); }
  function allProcedures() { return window.VCL_SUBMISSION.allPricedProcedures(submissionFromState()); }
  // A Centralised procedure (CP/EMA) taking part in a worksharing automatically leads it.
  function worksharingHasCP() { return allProcedures().some((p) => p.kind === "cp"); }

  // ---- worksharing pricing ----
  // Worksharing is priced through the "… - worksharing" special-case rows the fee data
  // already carries (Type II today, Type IB as soon as the Excel lists them); the engine
  // (VCLCALC.computeFees) takes `special` per country and type, so nothing below touches
  // the engine. Pricing switches to worksharing once state.submission.mode is 'worksharing'.
  //
  // state.submission.mode: null | 'worksharing' | 'annualUpdate' | 'superGrouping'. AU and SG
  // both require an all-Type-IA submission (guarded in rerender()); worksharing requires the
  // opposite (not all-IA). leadPricingActive()/multiProcedureMode() widen the old worksharing-only
  // gates to also cover Super-Grouping, which shares the same "one lead + several procedures" shape.
  function wsActive() { return state.submission.mode === 'worksharing'; }
  function auActive() { return state.submission.mode === 'annualUpdate'; }
  function sgActive() { return state.submission.mode === 'superGrouping'; }
  function leadPricingActive() { return wsActive() || sgActive(); }
  function multiProcedureMode() { return wsActive() || sgActive(); }
  function annualUpdateActive() { return auActive() || sgActive(); }

  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function allVariationsAreIA() { return window.VCL_SUBMISSION.allVariationsAreIA(submissionFromState(), subEngines()); }

  // Base + grouped variations, each annotated with its classification chapter (E/Q/C/M).
  function variationsWithChapter() {
    var out = [];
    var pushOne = function (code, title, type) {
      var chapter = null;
      if (code) {
        var e = (DATA.ENTRIES || []).filter(function (x) { return x.code === code; })[0];
        chapter = e ? e.chapter : null;
      }
      out.push({ code: code || null, title: title || '', type: type || null, chapter: chapter });
    };
    var v = pickedVariant(), e = pickedEntry();
    if (v) pushOne(e ? e.code : null, e ? e.title : '', v.type);
    else if (currentType()) pushOne(null, '', currentType());
    state.grouping.forEach(function (g) {
      if (!g.type) return;
      var ge = g.code ? (DATA.ENTRIES || []).filter(function (x) { return x.code === g.code; })[0] : null;
      pushOne(g.code || null, ge ? ge.title : '', g.type);
    });
    return out;
  }

  function superGroupingConflicts() {
    if (!sgActive()) return [];
    var procs = allProcedures().map(function (p) { return { kind: p.kind, rms: p.rms }; });
    return VCL_SG_LOGIC.computeSuperGroupingConflicts(variationsWithChapter(), procs);
  }

  // Latest permitted filing: implementation date + WD.annualUpdate.latestMonths (12).
  // Shared by both Annual Update and Super-Grouping.
  function annualUpdateDeadline() {
    var months = (WD.annualUpdate && WD.annualUpdate.latestMonths) || 12;
    return VCL_SG_LOGIC.computeAnnualUpdateDeadline(state.earliestImplDate, months);
  }
  // Earliest permitted filing: mode-dependent. Annual Update follows the classical
  // "+WD.annualUpdate.earliestMonths (9) to +12 months" window; Super-Grouping may be
  // filed any time from the implementation date itself (no earliest-bound computation needed).
  function annualUpdateEarliestDate() {
    if (sgActive()) return (state.earliestImplDate ? new Date(state.earliestImplDate) : null);
    var months = (WD.annualUpdate && WD.annualUpdate.earliestMonths) || 9;
    return VCL_SG_LOGIC.computeAnnualUpdateDeadline(state.earliestImplDate, months);
  }
  function feeRows() { return (window.VCLCALC_DATA && window.VCLCALC_DATA.FEE_ROWS) || []; }
  // The variation types actually being priced (from the IA/IB/II tally) -- the fee-category
  // choices below are drawn from exactly these types' rows, so an IB worksharing shows IB
  // categories (DK) and not Type II ones.
  function activeTypes() {
    const c = feeCounts();
    return ["IA", "IB", "II"].filter((t) => c[t] > 0);
  }
  // Special-case labels published for a country+role across the active types ("complex -
  // worksharing", "quality, simple (\"B\" or \"D\")", ...). A literal "standard" label just
  // duplicates the default option, so it is dropped from the list (resolveRow falls back to
  // that row anyway when nothing is chosen).
  function specialOptionsFor(cc, role) {
    const types = activeTypes();
    const seen = {}; const out = [];
    feeRows().forEach((r) => {
      if (r.cc !== cc || r.role !== role || types.indexOf(r.type) === -1) return;
      const s = r.special;
      if (!s || /^standard$/i.test(s) || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }
  // Does this country+role publish a plain standard row for any active type? Where it
  // doesn't (DK, ES: every row is labelled), a "Standard" option would be misleading --
  // the dropdown then offers only the real categories, first one preselected.
  function hasStandardRow(cc, role) {
    const types = activeTypes();
    return feeRows().some((r) => r.cc === cc && r.role === role && types.indexOf(r.type) !== -1
      && (!r.special || /^standard$/i.test(r.special)));
  }
  // A non-lead RMS of an MRP/DCP inside a Worksharing or Super-Grouping pays its
  // worksharing-CMS fee, not its standalone RMS fee (confirmed decision). Every lookup
  // below (dropdown options and pricing) follows from this single spot.
  const WS_RMS_PRICES_AS = "CMS";
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function wsPricingRole(role) { return window.VCL_SUBMISSION.wsPricingRole(role); }
  function wsSpecialKey(cc, role) { return cc + "|" + role; }
  function isWorksharingSpecial(s) { return /worksharing/i.test(s || ""); }
  // Options offered in a worksharing pricing context: where an authority publishes
  // "… - worksharing" variants, ONLY those are offered (standard is no longer a choice);
  // authorities without them keep their normal special cases as the fallback.
  function wsOptionsFor(cc, role) {
    const all = specialOptionsFor(cc, role);
    const ws = all.filter(isWorksharingSpecial);
    return ws.length ? ws : all;
  }
  // The effective pick for a line: the stored choice if it is still on offer; otherwise the
  // first option wherever "no pick" is not a real alternative -- WS-only dropdowns (user
  // decision) and countries without a plain standard row (DK, ES), where the engine would
  // silently price the first row anyway; naming it keeps display and pricing in sync.
  function defaultSpecial(cc, role, opts) {
    if (!opts.length) return null;
    if (isWorksharingSpecial(opts[0]) || !hasStandardRow(cc, role)) return opts[0];
    return null;
  }
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function wsSpecialFor(cc, role) { return window.VCL_SUBMISSION.wsSpecialFor(submissionFromState(), cc, role, subEngines()); }
  // Non-worksharing fee-category options (e.g. DE Type II "simple"/"complex"): the published
  // labels minus the "… - worksharing" variants, which belong to the worksharing path only.
  function nonWsOptionsFor(cc, role) {
    return specialOptionsFor(cc, role).filter((s) => !isWorksharingSpecial(s));
  }
  // The effective pick for a single (non-worksharing) line: the stored choice if still on
  // offer, otherwise defaultSpecial (first option where "no pick" is not a real alternative,
  // e.g. DK/ES/DE-II with no plain standard row -- so display and pricing stay in sync).
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function specialFor(cc, role) { return window.VCL_SUBMISSION.specialFor(submissionFromState(), cc, role, subEngines()); }
  // Same rule for the lead's own pick.
  function leadSpecial() { return window.VCL_SUBMISSION.leadSpecial(submissionFromState(), subEngines()); }
  // The role the lead is priced under: the EMA as EMA; otherwise RMS where the authority
  // publishes RMS rows, falling back to national, then CMS.
  function leadPricingRole() { return window.VCL_SUBMISSION.leadPricingRole(submissionFromState(), subEngines()); }
  // The lead's one-off fee: a single engine country-result, or null while it can't be priced.
  function leadFees(counts) { return window.VCL_SUBMISSION.leadFees(submissionFromState(), counts, subEngines()); }
  function fmtEUR(v) {
    if (v === null || v === undefined) return "–";
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  }
  // Flatten a procedure for PRICING: in a worksharing the lead authority is excluded here
  // (it is priced exactly once, in Station D's lead box) and every remaining line carries
  // its chosen fee category, applied to every type (resolveRow falls back to standard per
  // type wherever the label is not published).
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function procPricedCountries(p) { return window.VCL_SUBMISSION.procPricedCountries(submissionFromState(), p, subEngines()); }
  // Fees for one procedure, via the shared engine (window.VCLCALC.computeFees).
  function procFees(p, counts) {
    if (!window.VCLCALC || !window.VCLCALC.computeFees) return null;
    if (!procCountries(p).length || feeCountsTotal(counts) === 0) return { countries: [], grandTotal: 0 };
    return window.VCLCALC.computeFees({ countries: procPricedCountries(p), counts: counts });
  }
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function grandTotalFees() { return window.VCL_SUBMISSION.computeSubmissionFees(submissionFromState(), subEngines()).total; }

  // Unique selected countries across all procedures (keyed by cc, strengths is per product/cc).
  function selectedCcs() {
    const seen = {}; const out = [];
    // In a worksharing (or super-grouping) the lead is a fee-payer of its own (even when it
    // sits in none of the procedures), so it must show up here too -- e.g. for the strengths list.
    if (leadPricingActive() && state.worksharingLead) { seen[state.worksharingLead] = 1; out.push({ cc: state.worksharingLead, role: leadPricingRole() }); }
    allProcedures().forEach((p) => procCountries(p).forEach((x) => { if (!seen[x.cc]) { seen[x.cc] = 1; out.push({ cc: x.cc, role: x.role }); } }));
    return out;
  }
  // Does the fee for this country actually change with the number of strengths? (Many don't.)
  function strengthsMatters(cc, role) {
    const counts = feeCounts();
    if (feeCountsTotal(counts) === 0 || !window.VCLCALC || !window.VCLCALC.computeFees) return false;
    const a = window.VCLCALC.computeFees({ countries: [{ cc: cc, role: role, strengths: 1 }], counts: counts });
    const b = window.VCLCALC.computeFees({ countries: [{ cc: cc, role: role, strengths: 2 }], counts: counts });
    return Math.abs((a.grandTotal || 0) - (b.grandTotal || 0)) > 0.01;
  }
  function strengthsSensitiveList() { return selectedCcs().filter((x) => strengthsMatters(x.cc, x.role)); }

  // ---- timeline + RA effort (reuse the workload tool's shared helpers) ----
  // A group runs as its HIGHEST type -- a Type II anywhere makes it a Type II grouping, which
  // drives the procedure, timeline, II sub-procedure and RA effort. (Fees stay per-variation via
  // feeCounts, so each variation is still charged at its own type.)
  function typeRankOf(type) { const b = feeBucket(type); return b === "II" ? 3 : b === "IB" ? 2 : b === "IA" ? 1 : 0; }
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function primaryType() { return window.VCL_SUBMISSION.primaryType(submissionFromState()); }
  // Which type drives the PI per-document hours, bucketed to IA/IB/II (F.productInfo's keys) so
  // IAIN / "IB (unforeseen)" map correctly. For a grouped, mixed-type submission this uses the
  // HIGHEST type (primaryType), consistent with how the group's timeline and RA effort are derived.
  // OPEN ITEM (see spec): if the domain rule turns out to be "per variation", change only this.
  function piType() { return feeBucket(primaryType()); }
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool).
  function groupingBuckets() { return window.VCL_SUBMISSION.groupingBuckets(submissionFromState()); }
  function worksharingKinds() { return window.VCL_SUBMISSION.worksharingKinds(submissionFromState()); }
  // Further Super-Grouping procedures counted by kind (incl. CP, unlike worksharingKinds). The
  // primary procedure (state.procedure) is the base and is not counted here.
  function sgProcKinds() { return window.VCL_SUBMISSION.sgProcKinds(submissionFromState()); }
  // RA effort via the additive workload model (window.VCL_WORKLOAD_HOURS + window.VCL_WORKLOAD_HD,
  // generated from RA-CMC-hours.xlsx). Returns the granular {min,max} parts, the three composed
  // sections (RA / CMC / Compilation & submission) and the grand total, or null when no variation
  // type is set yet or the engine/data is unavailable. CMC and Compilation & submission are gated
  // by the RA-task modules Station "RA tasks" adds (state.cmcInRA / state.compilationInRA); until
  // those gates exist they read as off, so only the RA-activities section contributes.
  // Delegates to vcl-submission.js (single implementation shared with the Budget tool). Returns
  // the exact superset (parts/items/sections/total/expected + flat min/max) the transparency box
  // consumes -- a thin pass-through.
  function raEffort() { return window.VCL_SUBMISSION.computeSubmissionHours(submissionFromState(), subEngines()); }
  // Format a {min,max} hour band for display: whole hours (ceil each end), collapsed to a single
  // figure when both ends coincide.
  function raRangeText(mm) {
    if (!mm) return "—";
    const lo = Math.ceil(mm.min), hi = Math.ceil(mm.max);
    return lo === hi ? (lo + " h") : (lo + "–" + hi + " h");
  }
  // Raw min–max band for the transparency box, matching the reference table exactly: half-hours
  // are NOT rounded up and there is no unit (e.g. "0.5–1", "2–4"). Collapses when both ends match.
  function raBand(mm) {
    if (!mm) return "—";
    const lo = fmtNum(mm.min), hi = fmtNum(mm.max);
    return lo === hi ? lo : (lo + "–" + hi);
  }
  // Bare band without the unit, e.g. "34–65" — for the parenthetical range under the headline.
  function raRangeBare(mm) {
    if (!mm) return "—";
    const lo = Math.ceil(mm.min), hi = Math.ceil(mm.max);
    return lo === hi ? String(lo) : (lo + "–" + hi);
  }
  // The single headline figure: the right-skewed PERT expected value, whole hours.
  function raExpectedText(ra) {
    if (!ra || ra.expected == null) return "—";
    return Math.round(ra.expected) + " h";
  }
  function workflowSchedule() {
    const t = primaryType();
    if (!t || !window.VCL_TIMELINE || !window.VCL_TIMELINE.schedule) return null;
    return window.VCL_TIMELINE.schedule({
      type: t, iiSub: state.iiSub, procedure: state.procedure.kind,
      cmsCount: state.procedure.kind === "mrpdcp" ? state.procedure.cms.length : 0,
      shared: state.submission.grouping || multiProcedureMode(),
      clockStopFraction: state.clockStopFraction,
    });
  }
  function addDays(dateStr, n) { const d = new Date(dateStr); if (isNaN(d.getTime())) return null; d.setDate(d.getDate() + n); return d; }
  function fmtDate(d) { return d ? (String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear()) : "—"; }

  // ---- shared data helpers (previously mirrored from the removed vcl-workload.js) ----
  function findEntry(code) { return ENTRIES.find((e) => e.code === code) || null; }
  function findVariant(entry, variantId) {
    if (!entry || !entry.variants || !entry.variants.length) return null;
    if (entry.variants.length === 1) return entry.variants[0];
    return entry.variants.find((v) => v.id === variantId) || null;
  }
  function variantLabel(v) { return v && v.label ? v.label : ""; }
  function typeBadgeClass(type) {
    if (!type) return "badge";
    if (type.indexOf("IA") === 0) return "badge type-ia";
    if (type.indexOf("IB") === 0) return "badge type-ib";
    if (type.indexOf("II") === 0) return "badge type-ii";
    return "badge";
  }
  function pickedEntry() { return state.pickedCode ? findEntry(state.pickedCode) : null; }
  function pickedVariant() { const e = pickedEntry(); return e ? findVariant(e, state.pickedVariantId) : null; }
  // The variation type in play -- from the picked classification variant, or a type picked
  // directly without a classification (state.typeOnly).
  function currentType() { if (state.typeOnly) return state.typeOnly; const v = pickedVariant(); return v ? v.type : null; }
  function hasVariation() { return !!currentType(); }

  // ---- station gating ----
  function stationIndex(key) { return STATIONS.findIndex((s) => s.key === key); }
  function stationComplete(key) {
    if (key === "A") return hasVariation();                          // active substance moved to "RA tasks"
    // Type-IA-only submissions must choose a bundling mode (Super-Grouping /
    // Annual Update) before advancing -- a Type IA is never submitted on its own.
    if (key === "B") return procComplete(state.procedure) && (!allVariationsAreIA() || !!state.submission.mode);
    if (key === "C") return !state.cmcInRA || !!state.activeSubstance; // CMC dossier needs a substance
    return true; // D (Date & Timeline) / E (Fees): no gating
  }
  // Station changes land the user at the top of the tool again (same behaviour as the
  // toolbox nav's jumpToTop) -- without this, Next/Back/Start over left the view at the
  // bottom of the new station.
  function jumpTop() {
    if (container && container.scrollIntoView) container.scrollIntoView({ block: "start", behavior: "auto" });
  }
  function goto(key) { if (state.reached[key]) { state.station = key; rerender(); jumpTop(); } }
  function advance(dir) {
    const i = stationIndex(state.station);
    const j = Math.max(0, Math.min(STATIONS.length - 1, i + dir));
    const key = STATIONS[j].key;
    state.reached[key] = true;
    state.station = key;
    rerender();
    jumpTop();
  }
  function resetAll() {
    jumpTop();
    state.station = "A";
    state.reached = { A: true, B: false, C: false, D: false, E: false };
    state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; state.typeOnly = null; state.activeSubstance = null;
    state.cmcInRA = false; state.compilationInRA = false;
    state.piInRA = false; state.piDocs = { smpc: false, leaflet: false, labelling: false, mockups: false };
    state.methodOpen = false;
    state.refOpen = false; state.refType = "II"; state.refRole = "national"; state.refStream = "all";
    state.procedure = newProcedure(); state.submission = { grouping: false, mode: null };
    state.grouping = []; state.worksharing = []; state.worksharingLead = null;
    state.worksharingLeadSpecial = null; state.wsSpecials = {}; state.specials = {};
    state.submissionDate = ""; state.earliestImplDate = ""; state.iiSub = "60"; state.clockStopFraction = 1;
    state.strengthsDefault = 1; state.strengthsOverrides = {};
    state.summaryShowVariations = false;
    rerender();
  }

  // ------------------------------------------------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildStations() {
    const wrap = el("div", "vcl-wf-stations");
    const activeIdx = stationIndex(state.station);
    STATIONS.forEach((s, i) => {
      const done = i < activeIdx && state.reached[s.key];
      const active = s.key === state.station;
      const btn = el("button", "vcl-wf-station" + (active ? " is-active" : "") + (done ? " is-done" : ""));
      btn.type = "button";
      btn.disabled = !state.reached[s.key];
      const dot = el("div", "vcl-wf-station__dot", done ? '<span aria-hidden="true">✓</span>' : s.key);
      const label = el("div", "vcl-wf-station__label", escapeHtml(s.label));
      btn.appendChild(dot); btn.appendChild(label);
      btn.addEventListener("click", () => goto(s.key));
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // ---- Station A: Identify (classification + active substance) ----
  function buildStationA(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Variations"));
    body.appendChild(el("div", "vcl-wf-body__sub", "Which variation, or variations, are you submitting?"));

    // The (base) variation. Active substance and product information used to sit here; they drive
    // the RA effort, so they now live in the "RA tasks" station.
    if (state.typeOnly) {
      buildTypeOnlyHeader(body);
    } else {
      const entry = pickedEntry();
      const variant = pickedVariant();
      if (!entry) { buildSearch(body); buildTypeQuickPick(body); return; }
      if (!variant) {
        buildPickedHeader(body, entry, null);
        const chooser = el("div", "vcl-wf-variants");
        entry.variants.forEach((v) => {
          const row = el("div", "vcl-wf-variant");
          row.innerHTML = `<span class="vcl-wf-variant__label">${escapeHtml(variantLabel(v) || entry.title)}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`;
          row.addEventListener("click", () => { state.pickedVariantId = v.id; rerender(); });
          chooser.appendChild(row);
        });
        body.appendChild(chooser);
        return;
      }
      buildPickedHeader(body, entry, variant);
    }

    // Further variations -- more than one is treated as a grouping automatically.
    buildGroupingList(body);
  }

  // ---- Station "RA tasks": the optional RA modules, beyond the always-on core RA work. ----
  // Active substance and product information moved here from "Variations" (both drive RA effort),
  // alongside the two new modules. Every gate uses the same switch look as the old PI gate: a gate
  // on -> its hours join the RA workload and its own section appears in the "How the RA hours are
  // calculated" box. CMC carries the active substance it depends on.
  function buildStationRA(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "RA tasks"));
    body.appendChild(el("div", "vcl-wf-body__sub", "Which activities fall to RA here? Core RA preparation is always included — switch on any extra module your department also handles."));

    // --- CMC dossier (carries the active substance it depends on) ---
    const cmcHead = el("div", "vcl-wf-flabel", "CMC dossier"); cmcHead.style.marginTop = "16px"; body.appendChild(cmcHead);
    const cmcGate = el("label", "vcl-wf-switch" + (state.cmcInRA ? " is-on" : ""));
    cmcGate.innerHTML = '<span class="vcl-wf-switch__track"><span class="vcl-wf-switch__thumb"></span></span>'
      + '<span class="vcl-wf-switch__label">CMC dossier written in RA</span>';
    cmcGate.addEventListener("click", (e) => { e.preventDefault(); state.cmcInRA = !state.cmcInRA; rerender(); });
    body.appendChild(cmcGate);
    if (!state.cmcInRA) {
      body.appendChild(el("p", "vcl-wf-hint", "Off: a separate CMC / quality unit writes the dossier — it adds no RA hours."));
    } else {
      body.appendChild(el("p", "vcl-wf-hint", "The dossier effort depends on the active substance:"));
      buildSubstance(body);
      if (!state.activeSubstance) body.appendChild(el("p", "vcl-wf-hint", "Pick the active substance to include the CMC dossier hours."));
    }

    // --- Product information (moved from Variations) ---
    buildProductInfo(body);

    // --- Compilation & submission (docuBridge/Veeva + CESP) ---
    const compHead = el("div", "vcl-wf-flabel", "Compilation & submission"); compHead.style.marginTop = "16px"; body.appendChild(compHead);
    const compGate = el("label", "vcl-wf-switch" + (state.compilationInRA ? " is-on" : ""));
    compGate.innerHTML = '<span class="vcl-wf-switch__track"><span class="vcl-wf-switch__thumb"></span></span>'
      + '<span class="vcl-wf-switch__label">Compilation & submission in RA</span>';
    compGate.addEventListener("click", (e) => { e.preventDefault(); state.compilationInRA = !state.compilationInRA; rerender(); });
    body.appendChild(compGate);
    body.appendChild(el("p", "vcl-wf-hint", state.compilationInRA
      ? "Dossier compilation (docuBridge / Veeva), internal checks and CESP submission are done in RA."
      : "Off: dossier compilation and submission are handled elsewhere — they add no RA hours."));
  }

  function buildSubstance(body) {
    const asHead = el("div", "vcl-wf-flabel", "Active substance");
    asHead.style.marginTop = "16px";
    body.appendChild(asHead);
    const opts = el("div", "vcl-wf-opts");
    [{ key: "biologic", label: "Biologic" }, { key: "chemical", label: "Chemically-synthesized API" }].forEach((o) => {
      const chip = el("button", "vcl-wf-opt" + (state.activeSubstance === o.key ? " is-on" : ""), escapeHtml(o.label));
      chip.type = "button";
      chip.addEventListener("click", () => { state.activeSubstance = o.key; rerender(); });
      opts.appendChild(chip);
    });
    // Same 16px rhythm as between the other Station A blocks -- without it the chips sit
    // flush on the variation box below.
    opts.style.marginBottom = "16px";
    body.appendChild(opts);
  }

  // Product information module (Station "RA tasks"): does RA prepare the product information for
  // this change, and which documents does it touch? Gate defaults OFF (another department carries
  // PI -> no RA hours). Chips reuse the green .vcl-wf-opt look; the ticked documents filter which
  // PI rows count (sumPi), and the hours are shown only in the methodology box, never as pills.
  function buildProductInfo(body) {
    const head = el("div", "vcl-wf-flabel", "Product information");
    head.style.marginTop = "16px";
    body.appendChild(head);

    const gate = el("label", "vcl-wf-switch" + (state.piInRA ? " is-on" : ""));
    gate.innerHTML = '<span class="vcl-wf-switch__track"><span class="vcl-wf-switch__thumb"></span></span>'
      + '<span class="vcl-wf-switch__label">Product information managed in RA</span>';
    gate.addEventListener("click", (e) => { e.preventDefault(); state.piInRA = !state.piInRA; rerender(); });
    body.appendChild(gate);

    if (!state.piInRA) {
      body.appendChild(el("p", "vcl-wf-hint", "Off: another department prepares the product information — it adds no RA hours."));
      return;
    }

    body.appendChild(el("p", "vcl-wf-hint", "Which documents does this change touch?"));
    const opts = el("div", "vcl-wf-opts");
    [
      { key: "smpc", label: "SmPC" },
      { key: "leaflet", label: "Package leaflet" },
      { key: "labelling", label: "Labelling" },
      { key: "mockups", label: "Mock-ups" },
    ].forEach((o) => {
      const chip = el("button", "vcl-wf-opt" + (state.piDocs[o.key] ? " is-on" : ""), escapeHtml(o.label));
      chip.type = "button";
      chip.addEventListener("click", () => { state.piDocs[o.key] = !state.piDocs[o.key]; rerender(); });
      opts.appendChild(chip);
    });
    body.appendChild(opts);
  }

  // Direct type pick when there is no classification code to choose.
  function buildTypeQuickPick(body) {
    const wrap = el("div", "vcl-wf-quicktype");
    wrap.appendChild(el("div", "vcl-wf-quicktype__label", "No classification code? Set the type directly:"));
    const opts = el("div", "vcl-wf-opts");
    ["IA", "IB", "II"].forEach((t) => {
      const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm", `Type ${t} <span class="${typeBadgeClass(t)}">${t}</span>`);
      chip.type = "button";
      chip.addEventListener("click", () => { state.typeOnly = t; state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
      opts.appendChild(chip);
    });
    wrap.appendChild(opts);
    body.appendChild(wrap);
  }

  function buildTypeOnlyHeader(body) {
    const picked = el("div", "vcl-wf-picked");
    picked.innerHTML = `<span>Variation type <span class="${typeBadgeClass(state.typeOnly)}">${escapeHtml(state.typeOnly)}</span> <span class="vcl-wf-sum__muted">&mdash; no classification code</span></span>`;
    const change = el("button", "vcl-wf-change", "Change");
    change.type = "button";
    change.addEventListener("click", () => { state.typeOnly = null; rerender(); });
    picked.appendChild(change);
    body.appendChild(picked);
  }

  function buildSearch(body) {
    const label = el("div", "vcl-wf-flabel", "Classification");
    body.appendChild(label);
    const box = el("div", "vcl-wf-search");
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ..."; input.value = state.query;
    input.addEventListener("input", () => { state.query = input.value; renderResults(); });
    box.appendChild(input);
    body.appendChild(box);

    const results = el("div", "vcl-wf-results");
    results.id = "vcl-wf-results";
    body.appendChild(results);
    renderResults();

    function renderResults() {
      const host = document.getElementById("vcl-wf-results");
      if (!host) return;
      host.innerHTML = "";
      const q = state.query.trim().toLowerCase();
      if (!q) { host.appendChild(el("p", "vcl-wf-hint", "Start typing a code (e.g. B.II.a) or a keyword.")); return; }
      const matches = ENTRIES.filter((e) => e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1);
      if (!matches.length) { host.appendChild(el("p", "vcl-wf-hint", "No matching classification codes.")); return; }
      matches.slice(0, 25).forEach((e) => {
        const row = el("button", "vcl-wf-result");
        row.type = "button";
        row.innerHTML = `<span class="vcl-wf-result__code">${escapeHtml(e.code)}</span> <span class="vcl-wf-result__title">${escapeHtml(e.title)}</span>`;
        row.addEventListener("click", () => {
          state.pickedCode = e.code;
          const only = e.variants && e.variants.length === 1 ? e.variants[0] : null;
          state.pickedVariantId = only ? only.id : undefined;
          rerender();
        });
        host.appendChild(row);
      });
      if (matches.length > 25) host.appendChild(el("p", "vcl-wf-hint", (matches.length - 25) + " more — refine your search."));
    }
  }

  function buildPickedHeader(body, entry, variant) {
    const picked = el("div", "vcl-wf-picked");
    const badge = variant ? ` <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>` : "";
    picked.innerHTML = `<span><span class="vcl-wf-picked__code">${escapeHtml(entry.code)}</span> &mdash; ${escapeHtml(entry.title)}${badge}</span>`;
    const change = el("button", "vcl-wf-change", "Change");
    change.type = "button";
    change.addEventListener("click", () => { state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
    picked.appendChild(change);
    body.appendChild(picked);
  }

  // ---- Station B: Procedure (country level) + submission type + list builders ----
  function buildStationB(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Procedures"));
    body.appendChild(el("div", "vcl-wf-body__sub", "How is it submitted, and where? Fees are per country, so the countries are set here."));

    body.appendChild(flabel("Procedure", 0));
    procEditor(body, state.procedure, {});

    // Submission type -- grouping is automatic (set in Identify by listing more than
    // one variation); only worksharing is chosen here.
    body.appendChild(flabel("Submission type", 18));
    const opts = el("div", "vcl-wf-opts");
    if (allVariationsAreIA()) {
      // Type-IA-only: Super-Grouping (first) and Annual Update replace Worksharing.
      const sgChip = el("button", "vcl-wf-opt" + (sgActive() ? " is-on" : ""), "Super-Grouping");
      sgChip.type = "button";
      sgChip.addEventListener("click", () => { state.submission.mode = sgActive() ? null : 'superGrouping'; rerender(); });
      opts.appendChild(sgChip);
      const auChip = el("button", "vcl-wf-opt" + (auActive() ? " is-on" : ""), "Annual Update");
      auChip.type = "button";
      auChip.addEventListener("click", () => { state.submission.mode = auActive() ? null : 'annualUpdate'; rerender(); });
      opts.appendChild(auChip);
      body.appendChild(opts);
      body.appendChild(el("p", "vcl-wf-hint", "Available because every listed variation is Type IA — Worksharing is not offered here. Super-Grouping shares the same Type IA change(s) across several authorisations; Annual Update keeps them within this one."));
      if (!state.submission.mode) {
        body.appendChild(el("p", "vcl-wf-hint vcl-wf-hint--req", "Select Super-Grouping or Annual Update to continue — a Type IA is never submitted on its own."));
      }
    } else {
      const wsChip = el("button", "vcl-wf-opt" + (wsActive() ? " is-on" : ""), "Worksharing");
      wsChip.type = "button";
      wsChip.addEventListener("click", () => { state.submission.mode = wsActive() ? null : 'worksharing'; rerender(); });
      opts.appendChild(wsChip);
      body.appendChild(opts);
      body.appendChild(el("p", "vcl-wf-hint", "Turn on when the change is shared across several procedures or authorisations. Grouping is applied automatically when you list more than one variation in Identify."));
    }

    if (multiProcedureMode()) {
      buildWorksharingLead(body, sgActive() ? "Super-Grouping RMS (lead)" : "Worksharing RMS (lead)");
      buildExtraProcedureList(body, state.submission.mode);

      // Chapter-C variation(s) shared across >=2 RMS cannot be Super-Grouped -- surface a
      // non-blocking warning naming the conflicting variation(s) and RMS (Task 3 logic).
      var conflicts = superGroupingConflicts();
      if (conflicts.length) {
        var rms = conflicts[0].rmsList.join(" and ");
        var names = conflicts.map(function (c) { return c.code ? (c.code + (c.title ? " (" + c.title + ")" : "")) : "Type IA (Chapter C)"; }).join(", ");
        var warn = el("div", "vcl-wf-warn");
        warn.innerHTML =
          '<div class="vcl-wf-warn__title">Chapter C change across two different RMS</div>' +
          '<div class="vcl-wf-warn__body">The Chapter C variation(s) <b>' + escapeHtml(names) + '</b> cannot be bundled together across the RMS <b>' + escapeHtml(rms) + '</b>. Either remove the Chapter C change from the Super-Grouping, or submit it separately per RMS. Chapters E and Q are unaffected.</div>';
        body.appendChild(warn);
      }
    }
  }

  // Reusable procedure editor: kind (National/MRP-DCP/CP) + country-level selection.
  // In Super-Grouping, CP cannot mix with national/mrpdcp (computeAllowedProcedureKinds);
  // the incompatible kind chip(s) are disabled rather than shown as a later warning, so the
  // invalid combination can never be created. Worksharing is unaffected (allowedKinds stays null).
  function procEditor(host, p, o) {
    const kinds = [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }];
    const allowedKinds = sgActive() ? VCL_SG_LOGIC.computeAllowedProcedureKinds(allProcedures(), p) : null;
    const row = el("div", "vcl-wf-opts");
    kinds.forEach((it) => {
      const isAllowed = !allowedKinds || allowedKinds.indexOf(it.k) !== -1;
      const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm" + (p.kind === it.k ? " is-on" : "") + (isAllowed ? "" : " is-disabled"), escapeHtml(it.l));
      chip.type = "button";
      if (!isAllowed) {
        chip.disabled = true;
        chip.title = it.k === "cp"
          ? "Not allowed together with national/MRP-DCP procedures in Super-Grouping"
          : "Not allowed together with CP in Super-Grouping";
      }
      chip.addEventListener("click", () => { p.kind = it.k; rerender(); });
      row.appendChild(chip);
    });
    host.appendChild(row);

    const cd = countryData();
    if (p.kind === "national") {
      // AU/WS/SG are EU-only procedures (NON_EU_PROCEDURE_COUNTRIES); a plain single-procedure
      // submission (mode null) keeps the full national list.
      const natList = (auActive() || multiProcedureMode()) ? cd.nationalEU : cd.national;
      host.appendChild(countrySelect("Country", natList, p.nat, (cc) => { p.nat = cc; rerender(); }));
    } else if (p.kind === "mrpdcp") {
      host.appendChild(countrySelect("RMS (Reference Member State)", cd.rms, p.rms, (cc) => {
        p.rms = cc; p.cms = p.cms.filter((x) => x !== cc); rerender();
      }));
      const cmsLabel = flabel("CMS (Concerned Member States)", 10); host.appendChild(cmsLabel);
      const grid = el("div", "vcl-wf-cgrid");
      cd.cms.forEach((cc) => {
        const isRms = p.rms === cc;
        const on = p.cms.indexOf(cc) !== -1;
        // Composite codes ("DE - BfArM") render as the base code plus a tiny authority
        // suffix on one line, so every chip keeps the same compact size.
        const m = /^([A-Za-z]{2})\s*[-–]\s*(.+)$/.exec(cc);
        const chipLabel = m ? escapeHtml(m[1]) + '<span class="vcl-wf-cc__sfx">' + escapeHtml(m[2]) + "</span>" : escapeHtml(cc);
        const chip = el("button", "vcl-wf-cc" + (on ? " is-on" : "") + (isRms ? " is-disabled" : ""), chipLabel);
        chip.type = "button"; chip.disabled = isRms; chip.title = cd.nameOf[cc] || cc;
        chip.addEventListener("click", () => {
          if (on) p.cms = p.cms.filter((x) => x !== cc); else p.cms.push(cc);
          rerender();
        });
        grid.appendChild(chip);
      });
      host.appendChild(grid);
      host.appendChild(el("p", "vcl-wf-hint", "Each selected CMS is charged its own national fee. The RMS cannot also be a CMS."));
    } else if (p.kind === "cp") {
      host.appendChild(el("p", "vcl-wf-hint", "Centralised procedure — one authority (EMA), no country selection."));
    }
  }

  function countrySelect(labelText, ccList, current, onPick) {
    const wrap = el("div", "vcl-wf-field");
    wrap.appendChild(flabel(labelText, 10));
    const sel = document.createElement("select"); sel.className = "vcl-wf-select";
    const opt0 = document.createElement("option"); opt0.value = ""; opt0.textContent = "— select —"; sel.appendChild(opt0);
    const cd = countryData();
    ccList.forEach((cc) => {
      const o = document.createElement("option"); o.value = cc; o.textContent = (cd.nameOf[cc] || cc) + " (" + cc + ")";
      if (current === cc) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => onPick(sel.value || null));
    wrap.appendChild(sel);
    return wrap;
  }

  // Grouping list: additional variations sharing the same procedure(s)/countries.
  function buildGroupingList(host) {
    const panel = el("div", "vcl-wf-builder");
    const head = el("div", "vcl-wf-builder__head");
    head.appendChild(el("span", null, "Additional variations"));
    head.appendChild(el("span", "vcl-wf-count", String(state.grouping.length)));
    panel.appendChild(head);

    state.grouping.forEach((g, idx) => panel.appendChild(buildGroupingRow(g, idx)));

    const add = el("button", "vcl-wf-add", "＋ Add variation");
    add.type = "button";
    add.addEventListener("click", () => { state.grouping.push({ code: null, variantId: undefined, type: null, query: "" }); rerender(); });
    panel.appendChild(add);
    host.appendChild(panel);
  }

  function buildGroupingRow(g, idx) {
    const row = el("div", "vcl-wf-brow");
    if (g.type) {
      // Resolved -- either a classification code or a bare type.
      if (g.code) {
        const e = findEntry(g.code);
        row.innerHTML = `<span class="vcl-wf-brow__main"><span class="vcl-wf-picked__code">${escapeHtml(g.code)}</span> ${escapeHtml(e ? e.title : "")} <span class="${typeBadgeClass(g.type)}">${escapeHtml(g.type)}</span></span>`;
      } else {
        row.innerHTML = `<span class="vcl-wf-brow__main">Type <span class="${typeBadgeClass(g.type)}">${escapeHtml(g.type)}</span> <span class="vcl-wf-sum__muted">&mdash; no classification code</span></span>`;
      }
    } else if (g.code) {
      // Code picked, but it has several variants -- pick the type.
      const e = findEntry(g.code);
      const main = el("div", "vcl-wf-brow__main");
      main.innerHTML = `<span><span class="vcl-wf-picked__code">${escapeHtml(g.code)}</span> ${escapeHtml(e ? e.title : "")}</span>`;
      // Full-width variant rows (label left, badge right) rather than mixed-width chips, so the
      // options line up cleanly down the whole width.
      const chooser = el("div", "vcl-wf-brow__pick");
      chooser.appendChild(el("div", "vcl-wf-hint", "pick the type:"));
      (e && e.variants ? e.variants : []).forEach((v) => {
        const opt = el("div", "vcl-wf-variant");
        opt.innerHTML = `<span class="vcl-wf-variant__label">${escapeHtml(variantLabel(v) || v.type)}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`;
        opt.addEventListener("click", () => { g.variantId = v.id; g.type = v.type; rerender(); });
        chooser.appendChild(opt);
      });
      main.appendChild(chooser);
      row.appendChild(main);
    } else {
      // Search by code/title, or set the type directly (no classification).
      const main = el("div", "vcl-wf-brow__main");
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "vcl-wf-brow__input"; inp.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ..."; inp.value = g.query || "";
      inp.addEventListener("input", () => { g.query = inp.value; renderMatches(); });
      main.appendChild(inp);
      const matches = el("div", "vcl-wf-brow__matches");
      main.appendChild(matches);
      const quick = el("div", "vcl-wf-brow__variants");
      quick.innerHTML = '<span class="vcl-wf-hint" style="margin:6px 6px 0 0;">or set the type directly:</span>';
      ["IA", "IB", "II"].forEach((t) => {
        const b = el("button", "vcl-wf-opt vcl-wf-opt--sm", `Type ${t} <span class="${typeBadgeClass(t)}">${t}</span>`);
        b.type = "button";
        b.addEventListener("click", () => { g.type = t; g.code = null; g.variantId = undefined; rerender(); });
        quick.appendChild(b);
      });
      main.appendChild(quick);
      row.appendChild(main);
      renderMatches();
      function renderMatches() {
        matches.innerHTML = "";
        const q = (g.query || "").trim().toLowerCase();
        if (!q) return;
        const hits = ENTRIES.filter((e) => e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1).slice(0, 6);
        hits.forEach((e) => {
          const m = el("button", "vcl-wf-brow__match");
          m.type = "button";
          m.innerHTML = `<span class="vcl-wf-result__code">${escapeHtml(e.code)}</span> ${escapeHtml(e.title)}`;
          m.addEventListener("click", () => {
            g.code = e.code;
            const only = e.variants && e.variants.length === 1 ? e.variants[0] : null;
            if (only) { g.variantId = only.id; g.type = only.type; } else { g.variantId = undefined; g.type = null; }
            rerender();
          });
          matches.appendChild(m);
        });
      }
    }
    const rm = el("button", "vcl-wf-rm", "✕");
    rm.type = "button"; rm.setAttribute("aria-label", "Remove");
    rm.addEventListener("click", () => { state.grouping.splice(idx, 1); rerender(); });
    row.appendChild(rm);
    return row;
  }

  // Worksharing lead (Station B): one authority leads the whole worksharing. Free choice of any
  // authority (including the EMA); locks to the EMA automatically when a CP is part of it. The fee
  // category is chosen later, in Station D (Fees).
  function buildWorksharingLead(host, label) {
    const cd = countryData();
    const hasCP = worksharingHasCP();
    const wrap = el("div", "vcl-wf-field");
    wrap.appendChild(flabel(label || "Worksharing RMS (lead)", 12));
    const sel = document.createElement("select");
    sel.className = "vcl-wf-select";
    sel.disabled = hasCP;
    const opt0 = document.createElement("option");
    opt0.value = ""; opt0.textContent = "— select —";
    sel.appendChild(opt0);
    cd.leadEligible.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.cc; o.textContent = (c.name || c.cc) + " (" + c.cc + ")";
      if (state.worksharingLead === c.cc) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => { state.worksharingLead = sel.value || null; rerender(); });
    wrap.appendChild(sel);
    wrap.appendChild(el("p", "vcl-wf-hint", hasCP
      ? (sgActive()
          ? "Automatically the EMA — this Super-Grouping consists of Centralised procedures."
          : "Automatically the EMA, because a Centralised procedure (CP) is part of the worksharing.")
      : (sgActive()
          ? "Any authority can lead the Super-Grouping — including the EMA. The fee category is set later, in Fees."
          : "Any authority can lead the worksharing — including the EMA. The fee category is set later, in Fees.")));
    host.appendChild(wrap);
  }

  // Additional procedures (procedure 1 is the primary one above), shared between Worksharing
  // and Super-Grouping -- only the panel title depends on which mode is active.
  function buildExtraProcedureList(host, mode) {
    const label = (mode === 'superGrouping') ? "super-grouping" : "worksharing";
    const panel = el("div", "vcl-wf-builder");
    const head = el("div", "vcl-wf-builder__head");
    head.appendChild(el("span", null, "Additional procedures (" + label + ")"));
    head.appendChild(el("span", "vcl-wf-count", String(state.worksharing.length)));
    panel.appendChild(head);
    panel.appendChild(el("p", "vcl-wf-hint", "The primary procedure above counts as procedure 1. Add every further procedure the change is shared into — each with its own countries."));

    state.worksharing.forEach((p, idx) => {
      const card = el("div", "vcl-wf-pcard");
      const chead = el("div", "vcl-wf-pcard__head");
      chead.appendChild(el("span", null, "Procedure " + (idx + 2)));
      const rm = el("button", "vcl-wf-rm", "✕");
      rm.type = "button"; rm.setAttribute("aria-label", "Remove procedure");
      rm.addEventListener("click", () => { state.worksharing.splice(idx, 1); rerender(); });
      chead.appendChild(rm);
      card.appendChild(chead);
      procEditor(card, p, { removable: true });
      panel.appendChild(card);
    });

    const add = el("button", "vcl-wf-add", "＋ Add procedure");
    add.type = "button";
    add.addEventListener("click", () => {
      const p = newProcedure();
      if (sgActive()) {
        const allowed = VCL_SG_LOGIC.computeAllowedProcedureKinds(allProcedures(), p);
        if (allowed.indexOf(p.kind) === -1) p.kind = allowed[0];
      }
      state.worksharing.push(p);
      rerender();
    });
    panel.appendChild(add);
    host.appendChild(panel);
  }

  function flabel(text, marginTop) {
    const d = el("div", "vcl-wf-flabel", escapeHtml(text));
    if (marginTop) d.style.marginTop = marginTop + "px";
    return d;
  }

  // ---- Station C: Date & Timeline ----
  function buildStationC(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Date & Timeline"));
    body.appendChild(el("div", "vcl-wf-body__sub", "When do you plan to submit, and how does the assessment clock run?"));

    // Desired submission date. In an Annual Update / Super-Grouping this input is not shown
    // here -- it is rendered further down (as "Planned submission date") beneath the
    // implementation-date block, constrained to the mode-dependent filing corridor.
    if (!annualUpdateActive()) {
      body.appendChild(flabel("Desired initial submission date", 0));
      const dwrap = el("div", "vcl-wf-field");
      const date = document.createElement("input"); date.type = "date"; date.className = "vcl-wf-select"; date.value = state.submissionDate;
      date.addEventListener("change", () => { state.submissionDate = date.value; rerender(); });
      dwrap.appendChild(date); body.appendChild(dwrap);
    }

    const t = primaryType();
    // Type II sub-procedure.
    if (t === "II") {
      body.appendChild(flabel("Type II procedure", 14));
      const opts = el("div", "vcl-wf-opts");
      ["30", "60", "90"].forEach((d) => {
        const chip = el("button", "vcl-wf-opt vcl-wf-opt--sm" + (state.iiSub === d ? " is-on" : ""), d + "-day");
        chip.type = "button";
        chip.addEventListener("click", () => { state.iiSub = d; rerender(); });
        opts.appendChild(chip);
      });
      body.appendChild(opts);
    }

    const sch = workflowSchedule();
    if (!sch) {
      body.appendChild(el("div", "vcl-wf-placeholder", "A Type IA is not submitted individually — it is bundled into an Annual Update or Super-Grouping filing (see the options below)."));

      // Annual Update / Super-Grouping: earliest implementation date drives both the
      // mode-dependent earliest filing date (annualUpdateEarliestDate()) and the shared
      // latest deadline (annualUpdateDeadline(), implementation + 12 calendar months).
      if (annualUpdateActive()) {
        body.appendChild(flabel("Earliest implementation date", 14));
        const iwrap = el("div", "vcl-wf-field");
        const idate = document.createElement("input");
        idate.type = "date"; idate.className = "vcl-wf-select"; idate.value = state.earliestImplDate;
        // The change has already been implemented in practice, so the date cannot be in the future.
        const today = new Date();
        idate.max = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
        idate.addEventListener("change", () => { state.earliestImplDate = idate.value; rerender(); });
        iwrap.appendChild(idate); body.appendChild(iwrap);

        const earliest = annualUpdateEarliestDate();
        const dl = annualUpdateDeadline();
        const earliestMonths = (WD.annualUpdate && WD.annualUpdate.earliestMonths) || 9;
        const latestMonths = (WD.annualUpdate && WD.annualUpdate.latestMonths) || 12;
        const list = el("div", "vcl-wf-tl-list");
        list.style.marginTop = "12px"; // breathing room below the date input
        const dlRow = (label, value, strong) => {
          const line = el("div", "vcl-wf-tl-row" + (strong ? " is-strong" : ""));
          line.innerHTML = `<span class="vcl-wf-tl-row__l">${escapeHtml(label)}</span>`
            + `<span class="vcl-wf-tl-row__d">${escapeHtml(value)}</span>`;
          list.appendChild(line);
        };
        dlRow("Earliest implementation date", state.earliestImplDate ? fmtDate(new Date(state.earliestImplDate)) : "—");
        dlRow(
          "Earliest submission",
          sgActive()
            ? "from implementation — possible today"
            : (earliest ? (fmtDate(earliest) + " (implementation + " + earliestMonths + " months)") : "—")
        );
        dlRow("Latest submission", dl ? (fmtDate(dl) + " (implementation + " + latestMonths + " months)") : "—", true);
        body.appendChild(list);

        // Planned submission date: must fall inside the mode-dependent corridor -- Annual
        // Update: implementation +earliestMonths..+latestMonths; Super-Grouping: implementation
        // date .. implementation +latestMonths. The corridor is only known once an
        // implementation date is entered, so this field sits below the block above.
        const toIso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        body.appendChild(flabel("Planned submission date", 18));
        const swrap = el("div", "vcl-wf-field");
        swrap.style.marginBottom = "12px"; // breathing room before the nav, analogous to the implementation-date block
        const sdate = document.createElement("input");
        sdate.type = "date"; sdate.className = "vcl-wf-select"; sdate.value = state.submissionDate;
        if (earliest && dl) { sdate.min = toIso(earliest); sdate.max = toIso(dl); }
        sdate.addEventListener("change", () => { state.submissionDate = sdate.value; rerender(); });
        swrap.appendChild(sdate); body.appendChild(swrap);
        if (!state.earliestImplDate) {
          body.appendChild(el("p", "vcl-wf-hint", "Enter the implementation date first to set the submission window."));
        }
      }
      return;
    }

    // Timeline lives in its own host so the clock-stop slider can repaint just this part
    // (and the live preview) without rebuilding the slider under the cursor -- which is what
    // made the old version stutter.
    const tlHost = el("div", "vcl-wf-tlhost");

    if (sch.stopMax > 0) {
      const sl = el("div", "vcl-wf-slider");
      const lab = document.createElement("label");
      lab.innerHTML = "Clock-stop: <strong class=\"csv\">" + sch.stop + " d</strong> <span class=\"vcl-wf-hint\" style=\"display:inline;\">(range " + sch.stopMin + "–" + sch.stopMax + " d)</span>";
      sl.appendChild(lab);
      const range = document.createElement("input"); range.type = "range"; range.min = String(sch.stopMin); range.max = String(sch.stopMax); range.step = "1"; range.value = String(sch.stop);
      let raf = 0;
      range.addEventListener("input", () => {
        const v = parseInt(range.value, 10); const rg = sch.stopMax - sch.stopMin;
        state.clockStopFraction = rg > 0 ? (v - sch.stopMin) / rg : 0;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const s2 = workflowSchedule();
          const cs = lab.querySelector(".csv"); if (cs) cs.textContent = s2.stop + " d";
          tlHost.innerHTML = ""; buildTimelineView(tlHost, s2);
          repaintLive();
        });
      });
      sl.appendChild(range);
      body.appendChild(sl);
    }

    body.appendChild(tlHost);
    buildTimelineView(tlHost, sch);
  }

  function buildTimelineView(body, sch) {
    const total = Math.max(sch.dClose, 1);
    const pct = (d) => (d / total) * 100;
    const sd = state.submissionDate;
    const dateAt = (dayOffset) => sd ? fmtDate(addDays(sd, dayOffset - sch.dSub)) : null;

    const isII = primaryType() === "II";
    const hasStop = sch.stop > 0;
    // Guideline day-number of the outcome (excludes the clock-stop, exactly like the Workload
    // tool's nominalEop): II with questions runs to a1+a2 (e.g. day 90), II without ends at the
    // FVAR (a1+1, e.g. day 60), IB ends at its decision day (a1).
    const nominalEop = isII ? (sch.showA2 ? sch.a1 + sch.a2 : sch.a1 + 1) : sch.a1;

    // ---- Milestone markers pointing down at the bar: Submission -> Day 0 -> (RSI) -> EOP.
    // The close Submission/Day-0 pair is staggered vertically (lift) so the labels never collide.
    const marks = el("div", "vcl-wf-tl-marks");
    function mark(pos, main, sub, lift) {
      const m = el("div", "vcl-wf-tl-mark");
      m.style.left = pct(pos) + "%";
      m.innerHTML = (sub ? '<span class="s">' + escapeHtml(sub) + "</span>" : "")
        + '<span class="t">' + escapeHtml(main) + "</span>"
        + '<span class="conn" style="height:' + (lift ? 18 : 2) + 'px;"></span>'
        + '<span class="a" aria-hidden="true">&#9660;</span>';
      marks.appendChild(m);
    }
    // Short labels only -- the long glosses live in the legend below, so nothing collides.
    mark(sch.dSub, "Submission", "", true);
    mark(sch.dDay0, "Day 0", "", false);
    if (hasStop) mark(sch.dA1End, "Day " + sch.a1, "RSI", true);
    mark(sch.dEop, "Day " + nominalEop, "EOP", false);
    body.appendChild(marks);

    // Mini bar.
    const bar = el("div", "vcl-wf-tl");
    function seg(cls, start, len) { if (len <= 0) return; const s = el("div", "vcl-wf-tl-seg " + cls); s.style.left = pct(start) + "%"; s.style.width = pct(len) + "%"; bar.appendChild(s); }
    seg("prep", 0, sch.dSub);
    seg("val", sch.dSub, sch.validationDays);
    seg("assess", sch.dDay0, sch.a1);
    if (sch.stop > 0) seg("stop", sch.dA1End, sch.stop);
    if (sch.showA2) seg("assess", sch.dStopEnd, sch.a2);
    seg("closure", sch.dEop, sch.closureDays);
    body.appendChild(bar);

    // Duration arrows under the bar (like the Timetables view): the key spans from Submission
    // through Day 0 to the EOP, each labelled with its length in calendar days. Same 0..dClose
    // scale as the bar above, so every arrow sits directly under its segment.
    const durRow = el("div", "vcl-wf-tl-durrow");
    function durArrow(fromDay, toDay, label) {
      if (toDay - fromDay <= 0) return;
      const d = el("div", "vcl-wf-tl-dur");
      d.style.left = pct(fromDay) + "%";
      d.style.width = (pct(toDay) - pct(fromDay)) + "%";
      d.innerHTML = "<span>" + escapeHtml(label) + "</span>";
      durRow.appendChild(d);
    }
    durArrow(sch.dSub, sch.dDay0, sch.validationDays + " d");   // Submission -> Day 0 (validation)
    durArrow(sch.dDay0, sch.dA1End, sch.a1 + " d");             // assessment (to RSI / clock-stop)
    if (sch.stop > 0) durArrow(sch.dA1End, sch.dStopEnd, sch.stop + " d"); // clock-stop
    if (sch.showA2) durArrow(sch.dStopEnd, sch.dEop, sch.a2 + " d");       // assessment 2 -> EOP
    body.appendChild(durRow);

    // Phase labels under the arrows -- names the assessment phases the arrows measure.
    const phases = el("div", "vcl-wf-tl-phases");
    function phase(start, len, label) {
      if (len <= 0) return;
      const p = el("div", "vcl-wf-tl-phase");
      p.style.left = pct(start) + "%";
      p.style.width = pct(len) + "%";
      p.innerHTML = "<span>" + escapeHtml(label) + "</span>";
      phases.appendChild(p);
    }
    phase(sch.dSub, sch.validationDays, "Validation");
    phase(sch.dDay0, sch.a1, sch.showA2 ? "Assessment 1" : "Assessment");
    if (hasStop) phase(sch.dA1End, sch.stop, "Clock-stop");
    if (sch.showA2) phase(sch.dStopEnd, sch.a2, "Assessment 2");
    body.appendChild(phases);

    // Small legend: the two RA-owned segments that book-end the clock (shown as colour swatches
    // keyed to the bar), plus a gloss for the marker abbreviations.
    const legend = el("div", "vcl-wf-tl-legend");
    legend.innerHTML =
      '<span class="k"><i class="sw prep"></i>Preparation (RA)</span>'
      + '<span class="k"><i class="sw closure"></i>Closure by RA</span>'
      + '<span class="note">Day 0 = start of assessment · EOP = end of procedure'
      + (hasStop ? " · RSI = authority's questions (clock-stop)" : "") + "</span>";
    body.appendChild(legend);

    // Milestones.
    const rows = [
      { l: "Preparation start", d: 0 },
      { l: "Submission", d: sch.dSub, strong: true },
      { l: "Start of assessment (Day 0)", d: sch.dDay0 },
      { l: "End of Procedure (EOP)", d: sch.dEop, strong: true },
      { l: "Closure by RA", d: sch.dClose },
    ];
    const list = el("div", "vcl-wf-tl-list");
    rows.forEach((r) => {
      const line = el("div", "vcl-wf-tl-row" + (r.strong ? " is-strong" : ""));
      const dateStr = dateAt(r.d);
      line.innerHTML = `<span class="vcl-wf-tl-row__l">${escapeHtml(r.l)}</span>`
        + `<span class="vcl-wf-tl-row__d">${dateStr ? escapeHtml(dateStr) : "day " + (r.d - sch.dSub >= 0 ? "+" : "") + (r.d - sch.dSub)}</span>`;
      list.appendChild(line);
    });
    body.appendChild(list);

    const dur = el("p", "vcl-wf-hint", "Submission → EOP: <strong>" + sch.subToEop + " calendar days</strong> (~" + Math.round(sch.subToEop / 30.4 * 10) / 10 + " months). Preparation → closure: " + sch.totalDays + " days."
      + (hasStop ? " The day-numbers above (EOP = day " + nominalEop + ") follow the guideline clock and exclude the clock-stop." : "")
      + (sd ? "" : " Enter a date above to see calendar dates."));
    body.appendChild(dur);
  }

  // ---- Station D: Fees, per procedure, at country level ----
  function buildStationD(body) {
    body.appendChild(el("div", "vcl-wf-body__title", "Fees"));
    body.appendChild(el("div", "vcl-wf-body__sub", "The official fee for each procedure, country by country."));

    const counts = feeCounts();
    if (feeCountsTotal(counts) === 0) {
      body.appendChild(el("div", "vcl-wf-placeholder", "Pick a classification in step A first — then the fees appear here."));
      return;
    }

    // What is being priced (IA/IB/II tally).
    const tally = ["IA", "IB", "II"].filter((t) => counts[t] > 0).map((t) => counts[t] + " × Type " + t).join(" · ");
    body.appendChild(el("p", "vcl-wf-hint", "Priced for: " + tally + " in every procedure."));

    buildStrengths(body);

    // "ws" here means "lead-priced layout" -- worksharing or super-grouping both price
    // through the shared lead-once/exclude-lead path (leadPricingActive()); which one is
    // active only changes the labels below (sgActive()).
    const ws = leadPricingActive();
    const lead = leadFees(counts); // null unless the lead authority can be priced
    const procs = allProcedures();
    let grand = 0;
    let anyCountries = false;

    // Worksharing / Super-Grouping: the lead's one-off fee sits in its own box, above the procedures.
    if (ws) {
      buildWorksharingLeadBox(body, lead);
      if (lead) { grand += lead.total || 0; anyCountries = true; }
    }

    const cd = countryData();
    procs.forEach((p, i) => {
      const card = el("div", "vcl-wf-fee-proc");
      const head = el("div", "vcl-wf-fee-proc__head");
      head.appendChild(el("span", null, "Procedure " + (i + 1) + " — " + escapeHtml(procLabel(p))));
      const ccAll = procCountries(p);
      if (!ccAll.length) {
        head.appendChild(el("span", "vcl-wf-fee-proc__sum", "no countries yet"));
        card.appendChild(head);
        body.appendChild(card);
        return;
      }
      anyCountries = true;
      const r = procFees(p, counts); // in a worksharing the lead is already excluded here
      head.appendChild(el("span", "vcl-wf-fee-proc__sum", fmtEUR(r.grandTotal)));
      card.appendChild(head);
      grand += r.grandTotal;

      // The engine results run in ccAll order minus (in a worksharing) the lead, which gets
      // a zero line instead -- walk both lists in lockstep.
      let k = 0;
      if (ws) {
        // Worksharing view: one column grid per card (Country · Role · Fee category ·
        // Strengths · Fee) so the dropdowns line up at a uniform width and the amounts
        // read as one column ("V1" layout, user-picked).
        const grid = el("div", "vcl-wf-fee-grid");
        grid.appendChild(el("div", "vcl-wf-fee-grid__h", "Country"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h", "Role"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h", "Fee category"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h is-c", "Strengths"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h is-r", "Fee"));
        ccAll.forEach((x) => {
          const isLeadLine = x.cc === state.worksharingLead;
          const cr = isLeadLine ? null : r.countries[k++];
          const name = (cd.nameOf[x.cc] || x.cc);
          const roleShort = { RMS: "RMS", CMS: "CMS", national: "national", EMA: "EMA" }[x.role] || x.role;
          grid.appendChild(el("div", "vcl-wf-fee-line__c", `${escapeHtml(name)} <span class="vcl-wf-fee-line__cc">${escapeHtml(x.cc)}</span>`));
          grid.appendChild(el("div", "vcl-wf-fee-line__role", escapeHtml(roleShort)));
          if (isLeadLine) {
            // Double-counting guard: the lead is priced once, in the lead box above.
            grid.appendChild(el("div", "vcl-wf-fee-line__note", (sgActive() ? "super-grouping lead" : "worksharing lead") + " — priced above"));
            grid.appendChild(el("div", "vcl-wf-fee-grid__str", "—"));
            grid.appendChild(el("div", "vcl-wf-fee-line__amt is-r", fmtEUR(0)));
          } else {
            const prole = wsPricingRole(x.role);
            grid.appendChild(buildFeeCategoryCell(x.cc, prole, x.strengths, wsSpecialFor(x.cc, prole), (v) => {
              if (v) state.wsSpecials[wsSpecialKey(x.cc, prole)] = v;
              else delete state.wsSpecials[wsSpecialKey(x.cc, prole)];
              rerender();
            }));
            grid.appendChild(el("div", "vcl-wf-fee-grid__str", String(x.strengths)));
            grid.appendChild(el("div", "vcl-wf-fee-line__amt is-r", cr.hasData ? fmtEUR(cr.total) : "no fee data"));
          }
        });
        card.appendChild(grid);
      } else {
        // Single-variation view: same column grid as worksharing (Country · Role · Fee
        // category · Strengths · Fee) so authorities that distinguish variants (e.g. DE
        // Type II simple/complex) get a picker; the rest collapse to a static "Standard".
        const grid = el("div", "vcl-wf-fee-grid");
        grid.appendChild(el("div", "vcl-wf-fee-grid__h", "Country"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h", "Role"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h", "Fee category"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h is-c", "Strengths"));
        grid.appendChild(el("div", "vcl-wf-fee-grid__h is-r", "Fee"));
        ccAll.forEach((x) => {
          const cr = r.countries[k++];
          const name = (cd.nameOf[x.cc] || x.cc);
          const roleShort = { RMS: "RMS", CMS: "CMS", national: "national", EMA: "EMA" }[x.role] || x.role;
          grid.appendChild(el("div", "vcl-wf-fee-line__c", `${escapeHtml(name)} <span class="vcl-wf-fee-line__cc">${escapeHtml(x.cc)}</span>`));
          grid.appendChild(el("div", "vcl-wf-fee-line__role", escapeHtml(roleShort)));
          grid.appendChild(buildFeeCategoryCell(x.cc, x.role, x.strengths, specialFor(x.cc, x.role), (v) => {
            if (v) state.specials[wsSpecialKey(x.cc, x.role)] = v;
            else delete state.specials[wsSpecialKey(x.cc, x.role)];
            rerender();
          }, nonWsOptionsFor(x.cc, x.role)));
          grid.appendChild(el("div", "vcl-wf-fee-grid__str", String(x.strengths)));
          grid.appendChild(el("div", "vcl-wf-fee-line__amt is-r", cr.hasData ? fmtEUR(cr.total) : "no fee data"));
        });
        card.appendChild(grid);
      }
      body.appendChild(card);
    });

    if (anyCountries) {
      const gt = el("div", "vcl-wf-fee-grand");
      gt.innerHTML = `<span>Total across ${procs.length} procedure${procs.length > 1 ? "s" : ""}</span><span>${fmtEUR(grand)}</span>`;
      body.appendChild(gt);
      body.appendChild(el("p", "vcl-wf-hint", "Fees are per country and per procedure; grouped variations share a procedure, worksharing repeats the change across procedures. Live rates apply where a country charges in local currency."));
    }

    buildSummaryCard(body, grand, anyCountries);
  }

  // The lead's one-off fee (Station D): the lead authority is charged exactly once, here,
  // with its own special-case pick -- and shown as a zero line wherever it also appears
  // inside a procedure below. Shared by Worksharing and Super-Grouping (leadPricingActive());
  // only the label text below distinguishes which mode is active (sgActive()).
  function buildWorksharingLeadBox(host, lead) {
    const modeLabel = sgActive() ? "Super-Grouping" : "Worksharing";
    const box = el("div", "vcl-wf-ws-lead");
    box.appendChild(el("div", "vcl-wf-ws-lead__head", modeLabel + " RMS (lead)"));
    if (!state.worksharingLead) {
      box.appendChild(el("p", "vcl-wf-hint", "Pick the lead authority in step B (Procedure) — its one-off " + modeLabel.toLowerCase() + " fee will appear here."));
      host.appendChild(box);
      return;
    }
    const cd = countryData();
    const cc = state.worksharingLead;
    // Same column grid as the procedure cards below (Country / Role / Fee category /
    // Strengths / Fee), just without the header row -- so the lead's dropdown, strengths
    // and amount sit exactly over the cards' columns.
    const grid = el("div", "vcl-wf-fee-grid");
    grid.appendChild(el("div", "vcl-wf-fee-line__c",
      `${escapeHtml(cd.nameOf[cc] || cc)} <span class="vcl-wf-fee-line__cc">${escapeHtml(cc)}</span>${worksharingHasCP() ? ' <span class="vcl-wf-fee-line__role">auto (CP)</span>' : ""}`));
    grid.appendChild(el("div", "vcl-wf-fee-line__role", sgActive() ? "SG Lead" : "WS Lead"));
    grid.appendChild(buildFeeCategoryCell(cc, leadPricingRole(), strengthsFor(cc), leadSpecial(),
      (v) => { state.worksharingLeadSpecial = v; rerender(); }));
    grid.appendChild(el("div", "vcl-wf-fee-grid__str", String(strengthsFor(cc))));
    grid.appendChild(el("div", "vcl-wf-fee-line__amt is-r", (lead && lead.hasData) ? fmtEUR(lead.total) : "no fee data"));
    box.appendChild(grid);
    box.appendChild(el("p", "vcl-wf-hint", "The lead is charged once, here — its " + modeLabel.toLowerCase() + " fee category where published, otherwise the standard one. In its own procedure below it is not charged again."));
    host.appendChild(box);
  }

  // One line's fee-category cell: a dropdown over the published categories -- or, when
  // there is nothing real to choose, a static field. Collapses when (a) there is at most
  // one choice, or (b) every choice prices identically with the current counts/strengths
  // (e.g. ES's "full" vs "abbreviated" IB applications carry the same fee). Data-driven:
  // should the Excel ever price them apart, the dropdown reappears on the next regen.
  function buildFeeCategoryCell(cc, role, strengths, current, onPick, opts) {
    opts = opts || wsOptionsFor(cc, role);
    const withStd = hasStandardRow(cc, role);
    const choices = (withStd ? [null] : []).concat(opts);
    let collapse = choices.length <= 1;
    if (!collapse && window.VCLCALC && window.VCLCALC.computeFees) {
      const counts = feeCounts();
      const probe = (s) => window.VCLCALC.computeFees({
        countries: [{ cc: cc, role: role, strengths: strengths, special: { IA: s, IB: s, II: s } }],
        counts: counts,
      }).grandTotal || 0;
      const fees = choices.map(probe);
      collapse = fees.every((f) => Math.abs(f - fees[0]) < 0.005);
    }
    const cell = el("div");
    if (collapse) {
      cell.appendChild(el("span", "vcl-wf-fee-sel vcl-wf-fee-sel--static", escapeHtml(current || "Standard")));
    } else {
      cell.appendChild(specialSelect(opts, current, onPick, withStd));
    }
    return cell;
  }

  // Small dropdown over the published special-case labels. "Standard" (= no special) is
  // offered only where a plain standard row exists and the list is not worksharing-only.
  function specialSelect(options, current, onChange, includeStandard) {
    const sel = document.createElement("select");
    sel.className = "vcl-wf-fee-sel";
    if (includeStandard !== false) {
      const o0 = document.createElement("option");
      o0.value = ""; o0.textContent = "Standard";
      sel.appendChild(o0);
    }
    options.forEach((s) => {
      const o = document.createElement("option");
      o.value = s; o.textContent = s;
      if (current === s) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => onChange(sel.value || null));
    return sel;
  }

  // Every variation in play (base + resolved grouping) -- for the summary's Variation(s) row.
  function summaryVariations() {
    const out = [];
    const e = pickedEntry(); const v = pickedVariant();
    if (v) out.push({ code: e.code, title: e.title, type: v.type, variantId: v.id });
    else if (state.typeOnly) out.push({ code: null, title: null, type: state.typeOnly, variantId: undefined });
    if (state.submission.grouping) {
      state.grouping.forEach((g) => {
        if (!g.type) return; // still unresolved -- not a real variation yet
        const ge = g.code ? findEntry(g.code) : null;
        out.push({ code: g.code || null, title: ge ? ge.title : null, type: g.type, variantId: g.variantId });
      });
    }
    return out;
  }

  // Example "precise scope" wording for a code + variant, mirroring findPreciseScopeWording in
  // vcl-app.js against the shared PRECISE_SCOPE_GUIDANCE data (only ~284 codes carry one, so this
  // returns null for the rest). Used by the .docx export's Precise Scope Wordings section.
  function preciseScopeFor(code, variantId) {
    if (!code) return null;
    const g = DATA.PRECISE_SCOPE_GUIDANCE;
    if (!g || !g.sections) return null;
    const target = variantId ? code + "." + variantId : code;
    for (const section of g.sections) {
      for (const item of section.items) {
        if (item.code.split(",").map((c) => c.trim()).indexOf(target) !== -1) return item;
      }
    }
    return null;
  }

  // One procedure spelled out for the summary: "National: DE", "RMS: DE · CMS: BG, FR", or "CP".
  function procDetail(p) {
    if (!p) return "—";
    if (p.kind === "national") return "National: " + (p.nat || "?");
    if (p.kind === "cp") return "CP";
    if (p.kind === "mrpdcp") {
      let s = "RMS: " + (p.rms || "?");
      if (p.cms && p.cms.length) s += " · CMS: " + p.cms.join(", ");
      return s;
    }
    return "";
  }

  // Closing recap of the whole path -- the "you are here, and this is the plan" card.
  function buildSummaryCard(body, grand, anyCountries) {
    const card = el("div", "vcl-wf-sum");
    card.appendChild(el("div", "vcl-wf-sum__title", "Summary"));

    function line(label, valueHtml) {
      const r = el("div", "vcl-wf-sum__row");
      r.innerHTML = `<span class="vcl-wf-sum__l">${escapeHtml(label)}</span><span class="vcl-wf-sum__v">${valueHtml}</span>`;
      card.appendChild(r);
      return r;
    }

    // 1) Active substance -- first.
    if (state.activeSubstance) line("Active substance", state.activeSubstance === "biologic" ? "Biologic" : "Chemically-synthesized API");

    // 2) Variation (single) / Variations (grouped). The old separate Grouping row is folded in here.
    const vars = summaryVariations();
    if (vars.length <= 1) {
      const v = vars[0];
      if (v && v.code) line("Variation", `${escapeHtml(v.code)} — ${escapeHtml(v.title || "")} <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`);
      else if (v) line("Variation", `Type <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span> <span class="vcl-wf-sum__muted">(no classification code)</span>`);
    } else {
      const counts = { IA: 0, IB: 0, II: 0 };
      vars.forEach((v) => { const b = feeBucket(v.type); if (b) counts[b]++; });
      const bits = ["IA", "IB", "II"].filter((t) => counts[t] > 0).map((t) => counts[t] + " × " + t);
      const row = line("Variations",
        `<span class="vcl-wf-sum__tag">Grouping</span> ${vars.length} variations <span class="vcl-wf-sum__muted">(${escapeHtml(bits.join(" · "))})</span>`
        + ` <button type="button" class="vcl-wf-sum__toggle" data-sum-toggle>${state.summaryShowVariations ? "Hide" : "Show"} codes &amp; descriptions</button>`);
      const tg = row.querySelector("[data-sum-toggle]");
      if (tg) tg.addEventListener("click", () => { state.summaryShowVariations = !state.summaryShowVariations; rerender(); });
      if (state.summaryShowVariations) {
        // One line per variation (IA -> IB -> II, no sub-headers): code + badge + muted
        // one-line description.
        const vlist = el("div", "vcl-wf-sum__vlist");
        const sorted = vars.slice().sort((a, b) => typeRankOf(a.type) - typeRankOf(b.type));
        sorted.forEach((v) => {
          const it = el("div", "vcl-wf-sum__vitem1");
          const desc = v.title ? escapeHtml(v.title) : "no classification code";
          it.innerHTML = `<span class="vcl-wf-sum__vcode">${escapeHtml(v.code || "Type " + v.type)}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span> <span class="vcl-wf-sum__vdesc">— ${desc}</span>`;
          vlist.appendChild(it);
        });
        card.appendChild(vlist);
      }
    }

    // 3) Procedure (single) / Procedures (worksharing). The old separate Worksharing row is folded in.
    const procs = allProcedures();
    if (procs.length <= 1) {
      line("Procedure", escapeHtml(procDetail(procs[0])));
    } else {
      // [Proposal B, shown live] Worksharing header (with the lead) + each procedure on its own line.
      const cd = countryData();
      const leadBit = state.worksharingLead
        ? ` led by <strong>${escapeHtml(cd.nameOf[state.worksharingLead] || state.worksharingLead)}</strong> <span class="vcl-wf-sum__muted">·</span>`
        : "";
      line("Procedures", `<span class="vcl-wf-sum__tag">${sgActive() ? "Super-Grouping" : "Worksharing"}</span>${leadBit} ${procs.length} procedures`);
      const plist = el("div", "vcl-wf-sum__plist");
      procs.forEach((p, i) => {
        const it = el("div", "vcl-wf-sum__pitem");
        it.innerHTML = `<span class="vcl-wf-sum__pn">${i + 1}</span> ${escapeHtml(procDetail(p))}`;
        plist.appendChild(it);
      });
      card.appendChild(plist);
    }

    // 3b) Annual Update / Super-Grouping filing window (mode + implementation-driven dates).
    if (annualUpdateActive()) {
      line("Mode", `<span class="vcl-wf-sum__tag">${sgActive() ? "Super-Grouping" : "Annual Update"}</span>`);
      const auEarliest = annualUpdateEarliestDate();
      const auDl = annualUpdateDeadline();
      const auEarlyM = (WD.annualUpdate && WD.annualUpdate.earliestMonths) || 9;
      const auLateM = (WD.annualUpdate && WD.annualUpdate.latestMonths) || 12;
      line("Implementation date", escapeHtml(state.earliestImplDate ? fmtDate(new Date(state.earliestImplDate)) : "—"));
      line("Earliest submission", escapeHtml(sgActive()
        ? "from implementation — possible today"
        : (auEarliest ? (fmtDate(auEarliest) + " (implementation + " + auEarlyM + " months)") : "—")));
      line("Latest submission", escapeHtml(auDl ? (fmtDate(auDl) + " (implementation + " + auLateM + " months)") : "—"));
    }

    // 4) Timeline / RA effort / fees.
    const sch = workflowSchedule();
    if (sch) {
      const sd = state.submissionDate;
      const dm = `${sch.subToEop} days, ${fmtMonths(sch.subToEop)} months`;
      if (sd) {
        line("Timeline", `${escapeHtml(fmtDate(addDays(sd, 0)))} &rarr; EOP ${escapeHtml(fmtDate(addDays(sd, sch.subToEop)))} <span class="vcl-wf-sum__muted">(${escapeHtml(dm)})</span>`);
      } else {
        line("Timeline", `Submission &rarr; EOP <strong>${sch.subToEop} days</strong> <span class="vcl-wf-sum__muted">(${escapeHtml(fmtMonths(sch.subToEop))} months) — add a date in step C</span>`);
      }
    }

    const ra = raEffort();
    if (ra) line("RA workload", escapeHtml(raExpectedText(ra) + " (" + raRangeBare(ra.total) + ")"));
    if (anyCountries) line("Total fees", `<strong>${escapeHtml(fmtEUR(grand))}</strong>`);

    // Export link: mirrors the whole summary into a .docx plus the variations table in the
    // three Letter-of-Intent columns (Number / Title / Type). Reuses the existing dashed-green
    // xlink style (the retired calculator hand-off used it) -- no new UI vocabulary. The label
    // gains the "WS Letter of Intent" wording only for a worksharing, where that document is used.
    if (summaryVariations().length) {
      const xwrap = el("div", "vcl-wf-xlink");
      const xbtn = el("button", "vcl-wf-xlink__btn",
        sgActive()
          ? "Export summary, classification codes and precise scopes to .docx for use in the Super-Grouping Letter of Intent and eAF"
          : wsActive()
            ? "Export summary, classification codes and precise scopes to .docx for use in the WS Letter of Intent and eAF"
            : "Export summary, classification codes and precise scopes to .docx for use in the eAF");
      xbtn.type = "button";
      xbtn.addEventListener("click", () => exportSummaryDocx(grand, anyCountries));
      xwrap.appendChild(xbtn);
      card.appendChild(xwrap);
    }
    body.appendChild(card);
  }

  // Build the Word document behind the summary's export link (Proposal A, user decision
  // 2026-07-24): the on-screen summary rendered as text, then a "Variations" table in the
  // official Letter-of-Intent columns. Uses the docx library already loaded for the
  // Classification summary export; the variation numbers/titles come straight from the
  // classification data, never free text.
  async function exportSummaryDocx(grand, anyCountries) {
    if (!window.docx) {
      window.alert("The Word export library failed to load (no internet connection?). Please check your connection and try again.");
      return;
    }
    const vars = summaryVariations();
    if (!vars.length) { window.alert("No variations selected yet — nothing to export."); return; }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, LineRuleType } = window.docx;
    const meta = DATA.CLASSIFICATION_META || {};
    const ws = wsActive();
    const multiProc = multiProcedureMode(); // true for Worksharing OR Super-Grouping -- drives the "list every procedure" branch below, independent of which one's label text is used
    const cd = countryData();

    // Document-wide look (matches the user's reference .docx 2026-07-24): 12 pt body
    // (size 24 half-points) and 1.2 line spacing on every paragraph. `sp()` folds that line
    // spacing into any per-paragraph before/after so it is never lost.
    const LINE = { line: 288, lineRule: LineRuleType.AUTO };
    function sp(extra) { return Object.assign({}, LINE, extra || {}); }
    // Fonts matching the on-screen preview: clean sans-serif body, monospace for the
    // classification codes (in the table's Number column and the precise-scope headings).
    const SANS = "Calibri";
    const MONO = "Consolas";

    const children = [];
    children.push(new Paragraph({ text: sgActive() ? "Super-Grouping — Summary & Variations" : (ws ? "Worksharing — Summary & Variations" : "Variation — Summary & Variations"), heading: HeadingLevel.HEADING_1, spacing: sp() }));

    const metaBits = ["Generated " + new Date().toLocaleDateString()];
    if (meta.guidelineRef) metaBits.push("Classification Guideline " + meta.guidelineRef + (meta.applicableFrom ? ", applicable from " + meta.applicableFrom : ""));
    if (ws) metaBits.push("for use in the Worksharing Letter of Intent");
    else if (sgActive()) metaBits.push("for use in the Super-Grouping Letter of Intent");
    children.push(new Paragraph({ children: [new TextRun({ text: metaBits.join(" · "), italics: true, color: "5B6572" })], spacing: sp({ after: 300 }) }));

    // ---- Summary block (mirrors the on-screen card) ----
    children.push(new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_2, spacing: sp() }));
    function kv(label, valueRuns) {
      return new Paragraph({ children: [new TextRun({ text: label + ":  ", bold: true })].concat(valueRuns), spacing: sp({ after: 80 }) });
    }
    if (state.activeSubstance) children.push(kv("Active substance", [new TextRun(state.activeSubstance === "biologic" ? "Biologic" : "Chemically-synthesized API")]));

    const counts = { IA: 0, IB: 0, II: 0 };
    vars.forEach((v) => { const b = feeBucket(v.type); if (b) counts[b]++; });
    const bits = ["IA", "IB", "II"].filter((t) => counts[t] > 0).map((t) => counts[t] + " × " + t).join(" · ");
    if (vars.length > 1) {
      children.push(kv("Variations", [new TextRun("Grouping · " + vars.length + " variations"), new TextRun({ text: bits ? " (" + bits + ")" : "", color: "5B6572" })]));
    } else {
      const v = vars[0];
      children.push(kv("Variation", [new TextRun(v.code ? v.code + " — " + (v.title || "") + " (Type " + v.type + ")" : "Type " + v.type + " (no classification code)")]));
    }

    const procs = allProcedures();
    if (multiProc && procs.length > 1) {
      const leadName = state.worksharingLead ? (cd.nameOf[state.worksharingLead] || state.worksharingLead) : null;
      const modeLabel = sgActive() ? "Super-Grouping" : "Worksharing";
      children.push(kv("Procedures", [new TextRun(modeLabel + (leadName ? " led by " + leadName : "") + " · " + procs.length + " procedures")]));
      procs.forEach((p, i) => {
        children.push(new Paragraph({ children: [new TextRun({ text: (i + 1) + ". ", bold: true }), new TextRun(procDetail(p))], indent: { left: 360 }, spacing: sp({ after: 40 }) }));
      });
    } else {
      children.push(kv("Procedure", [new TextRun(procDetail(procs[0]))]));
    }

    const sch = workflowSchedule();
    if (sch) {
      const sd = state.submissionDate;
      children.push(kv("Timeline", [new TextRun(sd ? fmtDate(addDays(sd, 0)) + " → EOP " + fmtDate(addDays(sd, sch.subToEop)) + " (" + sch.subToEop + " days)" : "Submission → EOP " + sch.subToEop + " days")]));
    }
    const ra = raEffort();
    if (ra) children.push(kv("RA workload", [new TextRun(raExpectedText(ra) + " (" + raRangeBare(ra.total) + ")")]));
    if (anyCountries) children.push(kv("Total fees", [new TextRun({ text: fmtEUR(grand), bold: true })]));

    // ---- Annual Update / Super-Grouping block (absent for Worksharing and no-mode-selected) ----
    if (annualUpdateActive()) {
      children.push(new Paragraph({ text: sgActive() ? "Super-Grouping" : "Annual Update", heading: HeadingLevel.HEADING_2, spacing: sp({ before: 200 }) }));
      children.push(kv("Mode", [new TextRun(sgActive() ? "Super-Grouping (Type IA)" : "Annual Update (Type IA)")]));
      children.push(kv("Implementation date", [new TextRun(state.earliestImplDate ? fmtDate(new Date(state.earliestImplDate)) : "—")]));
      const auEarliest = annualUpdateEarliestDate();
      const auDl = annualUpdateDeadline();
      children.push(kv("Earliest submission", [new TextRun(
        sgActive()
          ? "from implementation — possible today"
          : (auEarliest ? (fmtDate(auEarliest) + " (implementation + " + ((WD.annualUpdate && WD.annualUpdate.earliestMonths) || 9) + " months)") : "—")
      )]));
      children.push(kv("Latest submission", [new TextRun(auDl ? fmtDate(auDl) + " (implementation + " + ((WD.annualUpdate && WD.annualUpdate.latestMonths) || 12) + " months)" : "—")]));

      if (sgActive()) {
        const auLines = allProcedures().map((p) => procDetail(p));
        children.push(kv("Authorisations / procedures", [new TextRun(auLines.join("; "))]));
        const auConf = superGroupingConflicts();
        if (auConf.length) {
          const auRms = auConf[0].rmsList.join(" and ");
          const auNames = auConf.map((c) => c.code || "Type IA (Chapter C)").join(", ");
          children.push(kv("Chapter C note", [new TextRun("Chapter C variation(s) " + auNames + " cannot be bundled together across RMS " + auRms + " — remove them or submit separately per RMS.")]));
        }
      }
    }

    // ---- Variations table (Letter-of-Intent columns; doubles as the Super-Grouping LoI) ----
    children.push(new Paragraph({ text: sgActive() ? "Letter of Intent" : (ws ? "Variations (for the Letter of Intent)" : "Variations"), heading: HeadingLevel.HEADING_2, spacing: sp({ before: 200 }) }));
    const border = { style: BorderStyle.SINGLE, size: 4, color: "9A9A9A" };
    function cell(text, opts) {
      opts = opts || {};
      return new TableCell({
        width: { size: opts.width, type: WidthType.PERCENTAGE },
        shading: opts.header ? { fill: "EDEDE7" } : undefined,
        // Padded cells (before/after 60 + left/right indent) so text does not hug the borders.
        children: [new Paragraph({ alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: sp({ before: 60, after: 60 }), indent: { left: 127, right: 137 }, children: [new TextRun({ text: text, bold: !!opts.bold, font: opts.mono ? MONO : undefined })] })],
      });
    }
    const rows = [new TableRow({ tableHeader: true, children: [
      cell("Number as in the classification guideline", { header: true, bold: true, width: 22 }),
      cell("Title of variation as in the classification guideline", { header: true, bold: true, width: 63 }),
      cell("Type of variation", { header: true, bold: true, width: 15, center: true }),
    ] })];
    vars.slice().sort((a, b) => typeRankOf(a.type) - typeRankOf(b.type)).forEach((v) => {
      rows.push(new TableRow({ children: [
        cell(v.code || "—", { width: 22, mono: true }),
        cell(v.title || "No classification code (type only)", { width: 63 }),
        cell(v.type || "—", { width: 15, center: true }),
      ] }));
    });
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      margins: { left: 10, right: 10 },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: rows,
    }));

    children.push(new Paragraph({ children: [new TextRun({ text: "Variation numbering and titles as in the Classification Guideline" + (meta.guidelineRef ? " (" + meta.guidelineRef + ")" : "") + ". Generated by the Variation Toolbox.", italics: true, size: 18, color: "6A6A6A" })], spacing: sp({ before: 240 }) }));

    // ---- Precise Scope Wordings (for the eAF's 'precise scope' field) ----
    // Only the variations that carry an example wording in the guidance are listed; each wording's
    // "/"-separated alternatives become their own bullet. Section (and its blue heading) is dropped
    // entirely when none of the variations has a wording.
    const psg = DATA.PRECISE_SCOPE_GUIDANCE || {};
    const scoped = vars.slice()
      .sort((a, b) => typeRankOf(a.type) - typeRankOf(b.type)) // same order as the table above
      .map((v) => ({ v: v, item: preciseScopeFor(v.code, v.variantId) }))
      .filter((x) => x.item);
    if (scoped.length) {
      children.push(new Paragraph({ text: "Precise Scope Wordings", heading: HeadingLevel.HEADING_2, spacing: sp({ before: 240 }) }));
      children.push(new Paragraph({ children: [new TextRun({ text: (psg.subtitle || "Example wordings for the ‘precise scope’ section of the variation application form") + " (eAF). Only variations for which the guidance provides an example are listed.", italics: true, color: "5B6572" })], spacing: sp({ after: 160 }) }));
      scoped.forEach((x) => {
        const v = x.v;
        const codeLabel = (v.code || ("Type " + v.type)) + (v.variantId ? "." + v.variantId : "");
        children.push(new Paragraph({
          children: [
            new TextRun({ text: codeLabel, bold: true, font: MONO }),
            new TextRun({ text: v.title ? " — " + v.title : "" }),
            new TextRun({ text: "  (Type " + v.type + ")", color: "5B6572" }),
          ],
          spacing: sp({ before: 120, after: 40 }),
        }));
        // "/" separates the guidance's alternative wordings -> one bullet each.
        x.item.text.split(" / ").map((s) => s.trim()).filter(Boolean).forEach((alt) => {
          children.push(new Paragraph({ text: alt, bullet: { level: 0 }, spacing: sp({ after: 40 }) }));
        });
      });
      const src = psg.source;
      const srcText = src
        ? "Precise scope example wordings from: " + src.docTitle + (src.docRef ? " (" + src.docRef + (src.docDate ? ", " + src.docDate : "") + ")" : "") + ". Placeholders in { } and options in < > are to be completed/selected by the applicant."
        : "Precise scope example wordings from the Classification of Variations (this Toolbox).";
      children.push(new Paragraph({ children: [new TextRun({ text: srcText, italics: true, size: 18, color: "6A6A6A" })], spacing: sp({ before: 160 }) }));
    }

    // 12 pt sans-serif body + 1.2 line spacing as document defaults; headings sans-serif too
    // so the whole document reads like the on-screen preview (blue heading colours stay).
    const doc = new Document({
      styles: {
        default: { document: { run: { size: 24, font: SANS }, paragraph: { spacing: sp() } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", run: { font: SANS } },
          { id: "Heading2", name: "Heading 2", run: { font: SANS } },
        ],
      },
      sections: [{ children: children }],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ws ? "Worksharing-Summary-and-Variations.docx" : "Variation-Summary.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


  // Strengths (Proposal 3): one default for all countries, with per-country overrides shown
  // only for countries whose fee actually changes with the number of strengths.
  function buildStrengths(host) {
    const wrap = el("div", "vcl-wf-strength");
    const row = el("div", "vcl-wf-strength__row");
    row.appendChild(el("span", "vcl-wf-strength__l vcl-wf-strength__l--head", "Strengths (default for all countries)"));
    const def = numInput(state.strengthsDefault, (v) => { state.strengthsDefault = v; });
    row.appendChild(def);
    wrap.appendChild(row);

    const sens = strengthsSensitiveList();
    if (!sens.length) {
      wrap.appendChild(el("p", "vcl-wf-hint", "None of the selected countries charge per strength — this default is all that is needed."));
      host.appendChild(wrap);
      return;
    }

    // Show the strength-sensitive countries straight away: users can't be expected to know which
    // markets charge per strength, so we list them here (rather than hiding them behind a toggle)
    // each with its own input, pre-filled from the default. Changing one makes it a per-country
    // value; the rest keep following the default. Countries that deviate are tinted green, and
    // the reset button clears every deviation so all fields follow the default again.
    const cd = countryData();
    const hintRow = el("div", "vcl-wf-strength__hintrow");
    hintRow.appendChild(el("p", "vcl-wf-hint", "These countries charge per strength — set a different number for any that differ from the default:"));
    const reset = el("button", "vcl-wf-strength__reset", "↺ Set all strengths to default");
    reset.type = "button";
    reset.disabled = !Object.keys(state.strengthsOverrides).length;
    reset.addEventListener("click", () => { state.strengthsOverrides = {}; rerender(); });
    hintRow.appendChild(reset);
    wrap.appendChild(hintRow);
    const list = el("div", "vcl-wf-strength__list");
    sens.forEach((x) => {
      const r = el("div", "vcl-wf-strength__row");
      r.appendChild(el("span", "vcl-wf-strength__l", `${escapeHtml(cd.nameOf[x.cc] || x.cc)} <span class="vcl-wf-fee-line__cc">${escapeHtml(x.cc)}</span>`));
      const cur = strengthsFor(x.cc);
      const inp = numInput(cur, (v) => { state.strengthsOverrides[x.cc] = v; });
      if (cur !== Math.max(1, parseInt(state.strengthsDefault, 10) || 1)) inp.classList.add("is-diff");
      r.appendChild(inp);
      list.appendChild(r);
    });
    wrap.appendChild(list);
    host.appendChild(wrap);
  }
  function numInput(value, onInput) {
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "1"; inp.className = "vcl-wf-num"; inp.value = String(value);
    inp.addEventListener("input", () => { onInput(Math.max(1, parseInt(inp.value, 10) || 1)); });
    inp.addEventListener("change", () => rerender());
    return inp;
  }

  // ---- placeholder stations ----
  function buildPlaceholder(body, key) {
    const meta = STATION_META[key];
    body.appendChild(el("div", "vcl-wf-body__title", escapeHtml(meta.title)));
    body.appendChild(el("div", "vcl-wf-body__sub", escapeHtml(meta.sub)));
    body.appendChild(el("div", "vcl-wf-placeholder", escapeHtml(meta.note)));
  }

  function buildBody() {
    const body = el("div", "vcl-wf-body");
    if (state.station === "A") buildStationA(body);        // Variations
    else if (state.station === "B") buildStationB(body);   // Procedure
    else if (state.station === "C") buildStationRA(body);  // RA tasks (optional modules)
    else if (state.station === "D") buildStationC(body);   // Date & Timeline
    else if (state.station === "E") buildStationD(body);   // Fees
    else buildPlaceholder(body, state.station);

    const nav = el("div", "vcl-wf-nav");
    const back = el("button", "vcl-wf-btn", "← Back");
    back.type = "button";
    back.disabled = stationIndex(state.station) === 0;
    back.addEventListener("click", () => advance(-1));
    const isLast = stationIndex(state.station) === STATIONS.length - 1;
    if (isLast) {
      const over = el("button", "vcl-wf-btn", "↺ Start over");
      over.type = "button";
      over.addEventListener("click", resetAll);
      nav.appendChild(back); nav.appendChild(over);
    } else {
      const next = el("button", "vcl-wf-btn vcl-wf-btn--primary", "Next →");
      next.type = "button";
      next.disabled = !stationComplete(state.station);
      next.addEventListener("click", () => advance(1));
      nav.appendChild(back); nav.appendChild(next);
    }
    body.appendChild(nav);
    return body;
  }

  // ---- Live preview (docked at the bottom) ----
  // "How the RA hours are calculated" -- a collapsible box under the live preview, available on
  // every station. Reads the current Workflow state and the additive engine
  // (window.VCL_WORKLOAD_HOURS + window.VCL_WORKLOAD_HD); content is filled in buildMethodPanel.
  function buildMethodBox() {
    const box = el("div", "vcl-wf-meth" + (state.methodOpen ? " is-open" : ""));
    const bar = el("button", "vcl-wf-meth-bar");
    bar.type = "button";
    bar.innerHTML = '<span class="i" aria-hidden="true">i</span>'
      + '<span class="t">How the RA hours are calculated</span>'
      + '<span class="chev" aria-hidden="true">' + (state.methodOpen ? "&#9652;" : "&#9662;") + '</span>';
    bar.addEventListener("click", () => { state.methodOpen = !state.methodOpen; rerender(); });
    box.appendChild(bar);
    if (state.methodOpen) box.appendChild(buildMethodPanel());
    return box;
  }

  // ---- "RA-hours reference": a collapsible in-page lookup of the whole RA-CMC-hours.xlsx table. ----
  // Rendered live from window.VCL_WORKLOAD_HD (the exact data the workload above is summed from), so
  // the reference can never drift out of sync with the tool. Filterable by variation type, role and
  // stream. This is the transparency "look it up" surface (design decision: in-page, not a download).
  function buildReferenceBox() {
    const HD = window.VCL_WORKLOAD_HD;
    const box = el("div", "vcl-wf-meth" + (state.refOpen ? " is-open" : ""));
    const bar = el("button", "vcl-wf-meth-bar");
    bar.type = "button";
    bar.innerHTML = '<span class="i" aria-hidden="true">&#9776;</span>'
      + '<span class="t">RA-hours reference — look up any activity</span>'
      + '<span class="chev" aria-hidden="true">' + (state.refOpen ? "&#9652;" : "&#9662;") + '</span>';
    bar.addEventListener("click", () => { state.refOpen = !state.refOpen; rerender(); });
    box.appendChild(bar);
    if (state.refOpen) box.appendChild(HD ? buildReferencePanel(HD) : el("div", "vcl-wf-meth-panel", '<div class="vcl-wf-meth-inner"><p class="vcl-wf-meth-note">The RA-hours data is not available.</p></div>'));
    return box;
  }

  function refSelect(labelText, opts, current, onPick) {
    const wrap = el("div", "vcl-wf-ref-filter");
    wrap.appendChild(el("label", null, escapeHtml(labelText)));
    const sel = document.createElement("select"); sel.className = "vcl-wf-select";
    opts.forEach((o) => {
      const op = document.createElement("option"); op.value = o.value; op.textContent = o.label;
      if (current === o.value) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", () => onPick(sel.value));
    wrap.appendChild(sel);
    return wrap;
  }

  function buildReferencePanel(HD) {
    const S = HD.streams || {};
    const bucketOf = (window.VCL_WORKLOAD_HOURS && window.VCL_WORKLOAD_HOURS.typeBucket) || function (t) { return t; };
    const panel = el("div", "vcl-wf-meth-panel");
    const inner = el("div", "vcl-wf-meth-inner");
    panel.appendChild(inner);

    const tb = state.refType, role = state.refRole, stream = state.refStream;

    const filters = el("div", "vcl-wf-ref-filters");
    filters.appendChild(refSelect("Type", [{ value: "IA", label: "Type IA" }, { value: "IB", label: "Type IB" }, { value: "II", label: "Type II" }], state.refType, (v) => { state.refType = v; rerender(); }));
    filters.appendChild(refSelect("Role", [{ value: "national", label: "National" }, { value: "MRP/DCP", label: "MRP / DCP" }, { value: "CP", label: "CP" }], state.refRole, (v) => { state.refRole = v; rerender(); }));
    filters.appendChild(refSelect("Stream", [{ value: "all", label: "All streams" }, { value: "RA", label: "RA" }, { value: "PI", label: "Product information" }, { value: "Comp.", label: "Compilation & submission" }, { value: "CMC", label: "CMC" }], state.refStream, (v) => { state.refStream = v; rerender(); }));
    inner.appendChild(filters);

    inner.appendChild(buildActivityTable(S, bucketOf, tb, role, stream));
    // Below the activities: the grouping / worksharing / AU / SG per-unit rates that apply to this
    // type + role, in the currently selected stream(s).
    const mods = buildModifierSection(S, bucketOf, tb, role, stream);
    if (mods) inner.appendChild(mods);
    inner.appendChild(el("p", "vcl-wf-meth-note", "Straight from RA-CMC-hours.xlsx — the same numbers the workload above is built from."));
    return panel;
  }

  // The activity view: per-activity rows from the flat sheets, filtered by the Stream select.
  function buildActivityTable(S, bucketOf, tb, role, stream) {
    const rows = [];
    function collect(list, label) {
      (list || []).forEach((r) => {
        if (bucketOf(r.type) === tb && r.role1 === role) rows.push({ stream: label, activity: (r.process || "").trim(), min: r.min, max: r.max });
      });
    }
    if (stream === "all" || stream === "RA") collect(S.ra && S.ra["RA - Variations & Roles"], "RA");
    if (stream === "all" || stream === "PI") collect(S.piActivities, "PI");
    if (stream === "all" || stream === "Comp.") collect(S.compilationSubmission, "Comp.");
    if (stream === "all" || stream === "CMC") collect(S.cmc && S.cmc["CMC - Variations & Roles"], "CMC");

    const table = el("div", "vcl-wf-ref-table");
    const head = el("div", "vcl-wf-ref-row vcl-wf-ref-row--head");
    head.innerHTML = "<span>Stream</span><span>Activity</span><span>min&ndash;max</span>";
    table.appendChild(head);
    if (!rows.length) {
      table.appendChild(el("p", "vcl-wf-meth-note", "No activities listed for this combination."));
    } else {
      rows.forEach((r) => {
        const hrs = (r.min == null && r.max == null) ? "n.a." : (fmtNum(r.min || 0) + "–" + fmtNum(r.max || 0));
        const row = el("div", "vcl-wf-ref-row");
        row.innerHTML = '<span class="vcl-wf-ref-stream">' + escapeHtml(r.stream) + "</span>"
          + "<span>" + escapeHtml(r.activity) + "</span>"
          + '<span class="vcl-wf-ref-hrs">' + escapeHtml(hrs) + "</span>";
        table.appendChild(row);
      });
    }
    return table;
  }

  // Below the activity list: the per-unit rates for every grouping / worksharing / annual update /
  // super-grouping modifier that applies to this type + role, headed per modifier, one "each
  // additional …" row per dimension. The Stream select chooses the columns: a single stream shows
  // one range, "All streams" shows RA and CMC side by side. Dimensions with no value in the shown
  // stream(s) are omitted; if nothing applies the whole block is dropped (returns null).
  function buildModifierSection(S, bucketOf, tb, role, stream) {
    const modDefs = [
      { key: "grouping", label: "Grouping" },
      { key: "worksharing", label: "Worksharing" },
      { key: "annualUpdate", label: "Annual Update" },
      { key: "superGrouping", label: "Super-Grouping" },
    ];
    const showRA = stream !== "CMC";
    const showCMC = stream === "all" || stream === "CMC";
    const twoCol = showRA && showCMC;
    const has = (x) => x && (x.min != null || x.max != null);
    const band = (x) => has(x) ? (fmtNum(x.min || 0) + "–" + fmtNum(x.max || 0)) : "—";

    const blocks = [];
    modDefs.forEach((m) => {
      const mrow = (S[m.key] || []).filter((r) => bucketOf(r.type) === tb && r.role === role)[0];
      if (!mrow) return;
      const dims = [];
      Object.keys(mrow.ra || {}).forEach((d) => {
        const ra = mrow.ra[d], cmc = (mrow.cmc || {})[d];
        if ((showRA && has(ra)) || (showCMC && has(cmc))) dims.push({ d: d, ra: ra, cmc: cmc });
      });
      if (dims.length) blocks.push({ label: m.label, dims: dims });
    });
    if (!blocks.length) return null;

    const wrap = el("div", "vcl-wf-ref-mods");
    const head = el("div", twoCol ? "vcl-wf-ref-mod-head vcl-wf-ref-mod-head--2" : "vcl-wf-ref-mod-head");
    head.innerHTML = twoCol
      ? "<span>Grouping &amp; shared</span><span>RA</span><span>CMC</span>"
      : "<span>Grouping &amp; shared</span><span>min&ndash;max</span>";
    wrap.appendChild(head);

    blocks.forEach((b) => {
      wrap.appendChild(el("div", "vcl-wf-ref-mod-title", escapeHtml(b.label)));
      b.dims.forEach((it) => {
        const row = el("div", twoCol ? "vcl-wf-ref-mod-row vcl-wf-ref-mod-row--2" : "vcl-wf-ref-mod-row");
        if (twoCol) {
          row.innerHTML = "<span>each additional " + escapeHtml(it.d) + "</span><span>" + escapeHtml(band(it.ra)) + "</span><span>" + escapeHtml(band(it.cmc)) + "</span>";
        } else {
          row.innerHTML = "<span>each additional " + escapeHtml(it.d) + "</span><span>" + escapeHtml(showRA ? band(it.ra) : band(it.cmc)) + "</span>";
        }
        wrap.appendChild(row);
      });
    });
    return wrap;
  }

  // One methodology row: label + pink/green value pill.
  function methRow(label, val, cls) {
    const row = el("div", "vcl-wf-meth-row" + (cls ? " " + cls : ""));
    row.innerHTML = '<span class="l">' + escapeHtml(label) + '</span>'
      + '<span class="vcl-wf-meth-val">' + escapeHtml(val) + '</span>';
    return row;
  }

  // One named section of the additive breakdown: a title, one itemised line per activity (each an
  // {label, min, max} band) and a dashed subtotal. Sections are dropped entirely by the caller when
  // their gate is off (their subtotal would be 0), matching the confirmed "Variant A" display.
  function methSection(title, items, subtotal) {
    const sec = el("div", "vcl-wf-meth-sec");
    sec.appendChild(el("div", "vcl-wf-meth-sec__title", escapeHtml(title)));
    items.forEach((it) => sec.appendChild(methRow(it.label, raBand(it))));

    sec.appendChild(methRow("Subtotal · " + title, raBand(subtotal), "vcl-wf-meth-subtotal"));
    return sec;
  }

  // Methodology panel: the confirmed additive "Variant A" build-up. Three fine-line-separated,
  // named sections (RA activities / CMC activities / Compilation & submission activities), each
  // listing its individual activities (verbatim from RA-CMC-hours.xlsx; Product information, the
  // per-CMS row and grouped/shared items collapse to one line each), with its own subtotal, ending
  // in the grand "RA workload total". A closing note explains the right-skewed headline figure.
  // CMC and Compilation & submission only appear when handled in RA (their gate on).
  function buildMethodPanel() {
    const panel = el("div", "vcl-wf-meth-panel");
    const inner = el("div", "vcl-wf-meth-inner");
    panel.appendChild(inner);

    const ra = raEffort();
    if (!ra) { inner.appendChild(el("p", "vcl-wf-meth-note", "Pick a variation type to see how the RA workload is built up.")); return panel; }
    const it = ra.items, sec = ra.sections;
    const nz = (mm) => !!(mm && (mm.min || mm.max));

    inner.appendChild(el("div", "vcl-wf-meth-formula",
      "RA workload is summed bottom-up from the individual activities below, each an experience-based "
      + "min–max estimate. CMC and compilation &amp; submission count only when they are handled in RA."));
    inner.appendChild(el("div", "vcl-wf-meth-colhead", "min. – max."));

    inner.appendChild(methSection("RA activities", it.ra, sec.ra));
    if (nz(sec.cmc)) inner.appendChild(methSection("CMC activities", it.cmc, sec.cmc));
    if (nz(sec.compilation)) inner.appendChild(methSection("Compilation & submission activities", it.compilation, sec.compilation));

    inner.appendChild(methRow("RA workload total", raBand(sec.total) + " h", "vcl-wf-meth-total"));

    // Explain the single headline figure (right-skewed PERT expected value).
    const expected = Math.round(ra.expected);
    const mid = Math.round((sec.total.min + sec.total.max) / 2);
    const skew = el("p", "vcl-wf-meth-note");
    skew.innerHTML = "The headline <strong>" + expected + " h</strong> is the expected value: the most-likely "
      + "point sits at &#8531; of the range and is weighted four times (PERT), so it lands a little below the "
      + "midpoint (" + mid + " h) — RA effort is right-skewed, with occasional overruns stretching the maximum.";
    inner.appendChild(skew);

    const src = el("div", "vcl-wf-meth-src");
    src.innerHTML = "<strong>Source:</strong> RA-CMC-hours.xlsx — per-activity RA and CMC hour ranges.";
    const excelUrl = (window.VCL_CONFIG && window.VCL_CONFIG.workloadExcelUrl) || "";
    if (excelUrl) {
      const a = document.createElement("a");
      a.className = "vcl-wf-meth-dl"; a.href = excelUrl; a.target = "_blank"; a.rel = "noopener";
      a.innerHTML = "⬇ Download the workbook (Excel)";
      src.appendChild(a);
    }
    inner.appendChild(src);
    return panel;
  }

  function buildLive() {
    const live = el("div", "vcl-wf-live");
    live.appendChild(el("div", "vcl-wf-live__head",
      '<span aria-hidden="true">◉</span> Live preview <span class="hint">updates as you go</span>'));

    // Running summary of decisions made so far.
    const chips = el("div", "vcl-wf-live__chips");
    const variant = pickedVariant();
    if (variant) {
      const e = pickedEntry();
      chips.appendChild(el("span", "vcl-wf-chip", `${escapeHtml(e.code)} <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span>`));
    } else if (state.typeOnly) {
      const ht = highestType() || state.typeOnly;
      chips.appendChild(el("span", "vcl-wf-chip", `<span class="${typeBadgeClass(ht)}">${escapeHtml(ht)}</span>`));
    }
    // Grouping: a type tally of ALL variations -- including the base one, so the chip reads
    // as the whole submission (replaces the old bare "N variations" count).
    if (state.submission.grouping) {
      const gc = feeCounts();
      const bits = ["IA", "IB", "II"].filter((t) => gc[t] > 0).map((t) => gc[t] + " × " + t);
      if (bits.length) chips.appendChild(el("span", "vcl-wf-chip", "Grouping " + bits.join(" · ")));
    }
    if (state.activeSubstance) {
      chips.appendChild(el("span", "vcl-wf-chip", state.activeSubstance === "biologic" ? "Biologic" : "Chemical API"));
    }
    // Procedure: in a worksharing, "Worksharing" + the lead replace the procedure chip (and
    // the old "N procedures" count); otherwise the primary procedure shows as before.
    if (multiProcedureMode()) {
      chips.appendChild(el("span", "vcl-wf-chip", sgActive() ? "Super-Grouping" : "Worksharing"));
      if (state.worksharingLead) chips.appendChild(el("span", "vcl-wf-chip", (sgActive() ? "SG Lead: " : "WS-Lead-RMS: ") + escapeHtml(state.worksharingLead)));
    } else {
      // Annual Update is single-procedure: show its own chip alongside the procedure chip.
      if (auActive()) chips.appendChild(el("span", "vcl-wf-chip", "Annual Update"));
      if (procComplete(state.procedure)) chips.appendChild(el("span", "vcl-wf-chip", escapeHtml(procLabel(state.procedure))));
    }
    if (!chips.children.length) chips.appendChild(el("span", "vcl-wf-hint", "Your choices will appear here as you go."));
    live.appendChild(chips);

    const row = el("div", "vcl-wf-live__row");
    const ra = raEffort();
    const raStat = ra
      ? '<div class="v">' + escapeHtml(raExpectedText(ra)) + '</div>'
        + '<div class="vcl-wf-live__range">(' + escapeHtml(raRangeBare(ra.total)) + ')</div>'
      : '<div class="v">—</div>';
    row.appendChild(el("div", "vcl-wf-live__stat", raStat + '<div class="l">RA workload</div>'));

    const sch = workflowSchedule();
    // Plain "Timeline" -- the clock-stop actually applied (from Station C's slider) is
    // carried by its marker under the bar, so a label suffix would only repeat it.
    let midHtml = '<div class="l" style="font-size:10px;color:var(--muted);margin-bottom:2px;">Timeline</div>';
    if (sch) {
      const total = Math.max(sch.dClose, 1);
      const p = (d) => (d / total) * 100;
      // Dates line above the bar: real calendar dates once Station C has a submission date,
      // otherwise the old duration-only fallback.
      const sd = state.submissionDate;
      const eopD = sd ? addDays(sd, sch.subToEop) : null;
      if (sd) {
        midHtml += '<div class="vcl-wf-tl-dates">Submission <strong>' + escapeHtml(fmtDate(addDays(sd, 0))) + '</strong> &rarr; EOP <strong>' + escapeHtml(fmtDate(eopD)) + '</strong> <span class="vcl-wf-tl-dates__muted">&middot; ' + sch.subToEop + ' d (' + fmtMonths(sch.subToEop) + ' months)</span></div>';
      } else {
        midHtml += '<div class="vcl-wf-tl-dates vcl-wf-tl-dates--muted">Sub &rarr; EOP &asymp; ' + sch.subToEop + ' d (' + fmtMonths(sch.subToEop) + ' months) &mdash; add a date in step C</div>';
      }
      midHtml += '<div class="vcl-wf-tl vcl-wf-tl--mini">'
        + seg2("prep", 0, sch.dSub, p) + seg2("val", sch.dSub, sch.validationDays, p)
        + seg2("assess", sch.dDay0, sch.a1, p) + (sch.stop > 0 ? seg2("stop", sch.dA1End, sch.stop, p) : "")
        + (sch.showA2 ? seg2("assess", sch.dStopEnd, sch.a2, p) : "") + seg2("closure", sch.dEop, sch.closureDays, p)
        + '</div>';
      // Key points under the bar -- Submission, Clock-stop, EOP, deliberately nothing more.
      const shortDate = (d) => d ? String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." : "";
      let marks = '<span style="left:' + p(sch.dSub) + '%">' + (sd ? "Sub " + shortDate(addDays(sd, 0)) : "Sub") + '</span>';
      if (sch.stop > 0) marks += '<span style="left:' + p(sch.dA1End + sch.stop / 2) + '%">Clock-stop ' + sch.stop + ' d</span>';
      marks += '<span style="left:' + p(sch.dEop) + '%">' + (sd ? "EOP " + shortDate(eopD) : "EOP") + '</span>';
      midHtml += '<div class="vcl-wf-live-marks">' + marks + '</div>';
    } else {
      midHtml += '<div style="font-size:11px;color:var(--ink-faint);">set the procedure and date first</div>';
    }
    row.appendChild(el("div", "vcl-wf-live__mid", midHtml));

    const fee = grandTotalFees();
    row.appendChild(el("div", "vcl-wf-live__stat", '<div class="v">' + (fee !== null ? escapeHtml(fmtEUR(fee)) : "—") + '</div><div class="l">Fee (total)</div>'));
    live.appendChild(row);
    return live;
  }

  let liveHost = null;

  function rerender() {
    if (!container) return;
    // Grouping is automatic: it is "on" whenever more than the base variation is
    // listed in Identify. Derived here so every downstream reader (fees, timeline,
    // RA workload, summary, live preview) stays correct without a manual toggle.
    state.submission.grouping = state.grouping.some((g) => g.type);
    // Mode consistency: AU/SG require Type-IA-only; Worksharing requires NOT all-IA.
    if ((state.submission.mode === 'annualUpdate' || state.submission.mode === 'superGrouping') && !allVariationsAreIA()) {
      state.submission.mode = null;
    } else if (state.submission.mode === 'worksharing' && allVariationsAreIA()) {
      state.submission.mode = null;
    }
    // Super-Grouping requires every procedure to share one family (CP-only, or national/mrpdcp).
    // A mixed list can be built legally under Worksharing (any mix is allowed there) and survive
    // an intermediate mode=null, landing here still mixed when the user switches into
    // Super-Grouping. Resolve to the base procedure's family every render (idempotent once
    // already consistent) -- the base procedure was configured first, so it wins; incompatible
    // extras are dropped.
    if (sgActive()) {
      const baseFamily = VCL_SG_LOGIC.computeAllowedProcedureKinds([state.procedure], {});
      state.worksharing = state.worksharing.filter((p) => baseFamily.indexOf(p.kind) !== -1);
    }
    // AU/WS/SG are EU-only procedures: a "national" country or lead authority picked before the
    // mode was active (or before NON_EU_PROCEDURE_COUNTRIES existed) can otherwise survive as a
    // stale, no-longer-selectable value. Reset idempotently every render -- once already
    // consistent, this is a no-op.
    if (auActive() || multiProcedureMode()) {
      allProcedures().forEach((p) => {
        if (p.kind === "national" && p.nat && NON_EU_PROCEDURE_COUNTRIES.indexOf(p.nat) !== -1) p.nat = null;
      });
      if (state.worksharingLead && NON_EU_PROCEDURE_COUNTRIES.indexOf(state.worksharingLead) !== -1) state.worksharingLead = null;
    }
    // Lead authority: a Centralised procedure (EMA) auto-leads a worksharing or super-grouping
    // (the field locks) -- same rule for both modes since both price via the shared lead path.
    if (leadPricingActive() && worksharingHasCP()) state.worksharingLead = countryData().ema;
    container.innerHTML = "";
    const root = el("div", "vcl-wf");
    const head = el("div", "vcl-wf-head");
    // Reference / "Last updated" note mirrors the Fee Calculator's (this tool carries the same
    // official fees), using the same admin-editable VCL_CONFIG keys with the calculator's
    // fee-data date as the fallback -- see fillCalcHead() in vcl-app.js.
    const calcUpdated = (window.VCLCALC_META && window.VCLCALC_META.lastUpdated) || "see fee schedules";
    head.innerHTML = "<h3>Guided Workflow</h3>"
      + "<p>The Guided Workflow helps to plan single variations, grouped variations and/or variations submitted under the Worksharing Procedure from classification through procedures and timelines to fees. The live preview below updates as you go.</p>"
      + '<p class="ref-line">Reference: ' + cfgReferenceText("calculator", "Official fee schedules of the respective authorities (EU-27, EMA, CH, IS, NO, UK, RS).") + "</p>"
      + '<p class="ref-updated">Last updated in Variation Toolbox: ' + cfgLastUpdated("calculator", calcUpdated) + "</p>";
    root.appendChild(head);
    root.appendChild(buildStations());
    root.appendChild(buildBody());
    const live = buildLive();
    liveHost = live;
    root.appendChild(live);
    root.appendChild(buildMethodBox());
    root.appendChild(buildReferenceBox());
    container.appendChild(root);
  }

  // Repaint just the live-preview card (used by the clock-stop slider so it stays smooth).
  function repaintLive() {
    if (!liveHost || !liveHost.parentNode) return;
    const fresh = buildLive();
    liveHost.parentNode.replaceChild(fresh, liveHost);
    liveHost = fresh;
  }

  // Admin-editable "Last updated"/"Reference" values, same lookup as vcl-app.js's helpers --
  // this IIFE can't reach those, so it reads window.VCL_CONFIG directly, with a fallback.
  function cfgLastUpdated(key, fallback) {
    return (window.VCL_CONFIG && window.VCL_CONFIG.lastUpdated && window.VCL_CONFIG.lastUpdated[key]) || fallback;
  }
  function cfgReferenceText(key, fallback) {
    return (window.VCL_CONFIG && window.VCL_CONFIG.referenceText && window.VCL_CONFIG.referenceText[key]) || fallback;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtNum(n) {
    if (n == null) return "—";
    const r = Math.round(n * 100) / 100;
    return (Math.abs(r - Math.round(r)) < 0.005) ? String(Math.round(r)) : String(r);
  }
  // Days -> months for the timeline, one decimal, average month length (365.25/12 ≈ 30.44 days).
  function fmtMonths(days) { return (days / 30.4375).toFixed(1); }
  // Mini-bar segment as an HTML string (for the live-preview timeline sketch).
  function seg2(cls, start, len, p) {
    if (len <= 0) return "";
    return '<div class="vcl-wf-tl-seg ' + cls + '" style="left:' + p(start) + '%;width:' + p(len) + '%;"></div>';
  }

  // Hand-off from the Reference Guide's Summary: seed Station A with the first variation and,
  // when there is more than one, tick Grouping and drop the rest into the grouping list (each
  // carrying its classification code). The user can still add more variations. A single variation
  // leaves Grouping off. vcl-app.js calls this right before switching to the workflow view.
  function prefillFromVariations(vars) {
    resetAll();
    if (!vars || !vars.length) return;
    // The base shown in Identify is the HIGHEST-type variation, since that one drives the group's
    // flow (a Type II grouping runs as a Type II). The rest go into the grouping list.
    const sorted = vars.slice().sort((a, b) => typeRankOf(b.type) - typeRankOf(a.type));
    const first = sorted[0];
    state.pickedCode = first.code || null;
    state.pickedVariantId = first.variantId;
    const rest = sorted.slice(1);
    if (rest.length) {
      state.submission.grouping = true;
      state.grouping = rest.map((v) => ({ code: v.code || null, variantId: v.variantId, type: v.type || null, query: "" }));
    }
    rerender();
  }

  window.VCL_WORKFLOW = {
    render(col) {
      container = col;
      rerender();
    },
    prefill(payload) {
      prefillFromVariations((payload && payload.variations) || []);
    },
  };
})();
