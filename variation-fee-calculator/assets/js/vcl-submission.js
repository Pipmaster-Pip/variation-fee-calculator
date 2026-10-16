// Pure fee/hours orchestration for a canonical Submission object. No DOM, no direct window reads
// (engines/data are injected). Dual-mode: window.VCL_SUBMISSION in the browser + module.exports in
// Node. Mirrors vcl-workload-hours.js. The Guided Workflow (vcl-workflow.js) and the Budget tool
// (vcl-budget.js, Phase 2) both build a Submission and call these functions, so the two tools can
// never disagree. See docs/superpowers/specs/2026-08-05-budget-submission-model-design.md.
(function (root) {
  "use strict";

  // ---- derivation layer (pure, no engines except sgLogic) ----
  function feeBucket(type) {
    if (!type) return null;
    if (type.indexOf("II") === 0) return "II";
    if (type.indexOf("IB") === 0) return "IB";
    if (type.indexOf("IA") === 0) return "IA";
    return null;
  }
  function baseType(sub) { return (sub.variations[0] && sub.variations[0].type) || null; }
  function feeCounts(sub) {
    var c = { IA: 0, IB: 0, II: 0 };
    var bt = baseType(sub);
    if (bt) { var b = feeBucket(bt); if (b) c[b]++; }
    sub.variations.slice(1).forEach(function (g) { if (g.type) { var b2 = feeBucket(g.type); if (b2) c[b2]++; } });
    return c;
  }
  function feeCountsTotal(c) { return c.IA + c.IB + c.II; }
  function highestType(sub) {
    var c = feeCounts(sub);
    if (c.II) return "II"; if (c.IB) return "IB"; if (c.IA) return "IA"; return null;
  }
  function typeRankOf(type) { var b = feeBucket(type); return b === "II" ? 3 : b === "IB" ? 2 : b === "IA" ? 1 : 0; }
  function primaryType(sub) {
    var best = baseType(sub);
    sub.variations.slice(1).forEach(function (g) { if (g.type && typeRankOf(g.type) > typeRankOf(best)) best = g.type; });
    return best;
  }
  function groupingBuckets(sub) {
    var c = { IA: 0, IB: 0, II: 0 };
    sub.variations.slice(1).forEach(function (g) { if (g.type) { var b = feeBucket(g.type); if (b) c[b]++; } });
    return c;
  }
  function wsActive(sub) { return sub.mode === "worksharing"; }
  function auActive(sub) { return sub.mode === "annualUpdate"; }
  function sgActive(sub) { return sub.mode === "superGrouping"; }
  function leadPricingActive(sub) { return wsActive(sub) || sgActive(sub); }
  function multiProcedureMode(sub) { return wsActive(sub) || sgActive(sub); }
  function annualUpdateActive(sub) { return auActive(sub) || sgActive(sub); }
  function worksharingKinds(sub) {
    var k = { national: 0, mrpdcp: 0 };
    if (multiProcedureMode(sub)) sub.procedures.slice(1).forEach(function (p) { if (p.kind === "national") k.national++; else if (p.kind === "mrpdcp") k.mrpdcp++; });
    return k;
  }
  function sgProcKinds(sub) {
    var k = { national: 0, mrpdcp: 0, cp: 0 };
    if (sgActive(sub)) sub.procedures.slice(1).forEach(function (p) { if (k[p.kind] !== undefined) k[p.kind]++; });
    return k;
  }
  function allPricedProcedures(sub) {
    return [sub.procedures[0]].concat(multiProcedureMode(sub) ? sub.procedures.slice(1) : []);
  }
  function allVariationsAreIA(sub, engines) {
    return engines.sgLogic.computeAllVariationsAreIA(baseType(sub), sub.variations.slice(1).map(function (v) { return v.type; }));
  }
  function displayMode(sub) {
    if (sub.mode) return sub.mode;
    return sub.variations.length > 1 ? "grouping" : "single";
  }

  // ---- fee-special resolution sub-layer (reads engines.feeRows / engines.countries) ----
  function emaCc(engines) { return (engines.countries.find(function (c) { return c.roles.indexOf("EMA") !== -1; }) || {}).cc || null; }
  // Number of strengths registered for a country: the global default unless overridden.
  function strengthsFor(sub, cc) {
    var o = sub.strengths.overrides[cc];
    var n = (o != null) ? o : sub.strengths.default;
    return Math.max(1, parseInt(n, 10) || 1);
  }
  // Flatten a procedure to the (cc, role, strengths) triples the fee engine consumes.
  function procCountries(sub, p, engines) {
    if (!p) return [];
    if (p.kind === "national") return p.nat ? [{ cc: p.nat, role: "national", strengths: strengthsFor(sub, p.nat) }] : [];
    if (p.kind === "cp") { var e = emaCc(engines); return e ? [{ cc: e, role: "EMA", strengths: strengthsFor(sub, e) }] : []; }
    if (p.kind === "mrpdcp") {
      var out = [];
      if (p.rms) out.push({ cc: p.rms, role: "RMS", strengths: strengthsFor(sub, p.rms) });
      p.cms.forEach(function (cc) { out.push({ cc: cc, role: "CMS", strengths: strengthsFor(sub, cc) }); });
      return out;
    }
    return [];
  }
  // The variation types actually being priced (from the IA/IB/II tally): reuses the derivation
  // layer's feeCounts(sub) in place of the source's closure-only feeCounts(); not part of the
  // brief's listed interface but required for specialOptionsFor/hasStandardRow to be faithful
  // (the source functions depend on it), so it stays an internal (non-exported) helper.
  function activeTypes(sub) {
    var c = feeCounts(sub);
    return ["IA", "IB", "II"].filter(function (t) { return c[t] > 0; });
  }
  // Special-case labels published for a country+role across the active types.
  function specialOptionsFor(sub, cc, role, engines) {
    var types = activeTypes(sub);
    var seen = {}; var out = [];
    engines.feeRows.forEach(function (r) {
      if (r.cc !== cc || r.role !== role || types.indexOf(r.type) === -1) return;
      var s = r.special;
      if (!s || /^standard$/i.test(s) || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }
  // Does this country+role publish a plain standard row for any active type?
  function hasStandardRow(sub, cc, role, engines) {
    var types = activeTypes(sub);
    return engines.feeRows.some(function (r) {
      return r.cc === cc && r.role === role && types.indexOf(r.type) !== -1
        && (!r.special || /^standard$/i.test(r.special));
    });
  }
  // Per-TYPE variants (the fee-category choice is per type, like the classic calculator's Special
  // cases panel), used by the WS Fee Calculator's per-type special picker. Mirror the all-types
  // helpers above but filter to a single variation type.
  function specialOptionsForType(cc, role, type, engines) {
    var seen = {}, out = [];
    engines.feeRows.forEach(function (r) {
      if (r.cc !== cc || r.role !== role || r.type !== type) return;
      var s = r.special;
      if (!s || /^standard$/i.test(s) || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }
  function hasStandardRowType(cc, role, type, engines) {
    return engines.feeRows.some(function (r) {
      return r.cc === cc && r.role === role && r.type === type && (!r.special || /^standard$/i.test(r.special));
    });
  }
  function wsOptionsForType(cc, role, type, engines) {
    var all = specialOptionsForType(cc, role, type, engines).filter(function (s) { return !isSuperGroupingSpecial(s); });
    var ws = all.filter(isWorksharingSpecial);
    return ws.length ? ws : all;
  }
  function leadOptionsForType(sub, cc, role, type, engines) {
    if (sgActive(sub)) {
      var sg = specialOptionsForType(cc, role, type, engines).filter(isSuperGroupingSpecial);
      if (sg.length) return sg;
    }
    return wsOptionsForType(cc, role, type, engines);
  }
  // Resolve a stored special that may be a per-type object { IA, IB, II } (WS Fee Calculator) or a
  // plain string (Guided Workflow / Budget, one category for all types). Legacy string -> that
  // string for every type; null/undefined -> null.
  function storedSpecialFor(raw, type) {
    if (raw && typeof raw === "object") return type ? (raw[type] || null) : null;
    return raw || null;
  }
  // A non-lead RMS of an MRP/DCP inside a Worksharing or Super-Grouping pays its
  // worksharing-CMS fee, not its standalone RMS fee.
  var WS_RMS_PRICES_AS = "CMS";
  function wsPricingRole(role) { return role === "RMS" ? WS_RMS_PRICES_AS : role; }
  function wsSpecialKey(cc, role) { return cc + "|" + role; }
  function isWorksharingSpecial(s) { return /worksharing/i.test(s || ""); }
  function isSuperGroupingSpecial(s) { return /supergrouping/i.test(s || ""); }
  // Options offered in a worksharing pricing context: where an authority publishes
  // "… - worksharing" variants, ONLY those are offered; otherwise the normal special cases.
  // Super-grouping specials are never offered here -- they belong to the SG lead path.
  function wsOptionsFor(sub, cc, role, engines) {
    var all = specialOptionsFor(sub, cc, role, engines).filter(function (s) { return !isSuperGroupingSpecial(s); });
    var ws = all.filter(isWorksharingSpecial);
    return ws.length ? ws : all;
  }
  // Lead-fee options. In a super-grouping the "… - supergrouping" variants win where the
  // authority publishes them (DK's 3119); otherwise it falls back to the worksharing rule.
  // Both WS and SG price a one-off lead fee, but at different schedules.
  function leadOptionsFor(sub, cc, role, engines) {
    if (sgActive(sub)) {
      var sg = specialOptionsFor(sub, cc, role, engines).filter(isSuperGroupingSpecial);
      if (sg.length) return sg;
    }
    return wsOptionsFor(sub, cc, role, engines);
  }
  // The effective pick for a line: the stored choice if it is still on offer; otherwise the
  // first option wherever "no pick" is not a real alternative.
  function defaultSpecial(sub, cc, role, opts, engines) {
    if (!opts.length) return null;
    var lead = isWorksharingSpecial(opts[0]) || isSuperGroupingSpecial(opts[0]);
    if (lead || !hasStandardRow(sub, cc, role, engines)) {
      // Honour a configured per-country default (e.g. DK -> "quality, simple (Q)") for a plain
      // line where it is on offer; worksharing/super-grouping lead options keep their first row.
      if (!lead) {
        var ds = (typeof window !== "undefined" && window.VCLCALC_DATA && window.VCLCALC_DATA.DEFAULT_SPECIALS)
          ? window.VCLCALC_DATA.DEFAULT_SPECIALS[cc] : null;
        if (ds && opts.indexOf(ds) !== -1) return ds;
      }
      return opts[0];
    }
    return null;
  }
  // `type` (optional) selects the per-type fee category -- the WS Fee Calculator stores one choice
  // per IA/IB/II; without it the all-active-types options are used (legacy, Guided Workflow).
  function wsSpecialFor(sub, cc, role, engines, type) {
    var opts = type ? wsOptionsForType(cc, role, type, engines) : wsOptionsFor(sub, cc, role, engines);
    var stored = storedSpecialFor(sub.specials.ws[wsSpecialKey(cc, role)], type);
    if (stored && opts.indexOf(stored) !== -1) return stored;
    return defaultSpecial(sub, cc, role, opts, engines);
  }
  // Non-worksharing fee-category options: the published labels minus the "… - worksharing"
  // and "… - supergrouping" variants (both belong to the lead-fee paths, not a plain line).
  function nonWsOptionsFor(sub, cc, role, engines) {
    return specialOptionsFor(sub, cc, role, engines).filter(function (s) { return !isWorksharingSpecial(s) && !isSuperGroupingSpecial(s); });
  }
  // The effective pick for a single (non-worksharing) line.
  function specialFor(sub, cc, role, engines) {
    var opts = nonWsOptionsFor(sub, cc, role, engines);
    var stored = sub.specials.line[wsSpecialKey(cc, role)];
    if (stored && opts.indexOf(stored) !== -1) return stored;
    return defaultSpecial(sub, cc, role, opts, engines);
  }
  // Same rule for the lead's own pick (per-type when `type` is given, like wsSpecialFor).
  function leadSpecial(sub, engines, type) {
    if (!sub.lead) return null;
    var role = leadPricingRole(sub, engines);
    var opts = type ? leadOptionsForType(sub, sub.lead, role, type, engines) : leadOptionsFor(sub, sub.lead, role, engines);
    var stored = storedSpecialFor(sub.specials.lead, type);
    if (stored && opts.indexOf(stored) !== -1) return stored;
    return defaultSpecial(sub, sub.lead, role, opts, engines);
  }
  // The role the lead is priced under: the EMA as EMA; otherwise RMS where the authority
  // publishes RMS rows, falling back to national, then CMS.
  function leadPricingRole(sub, engines) {
    var cc = sub.lead;
    if (!cc) return null;
    if (cc === emaCc(engines)) return "EMA";
    var has = function (role) { return engines.feeRows.some(function (r) { return r.cc === cc && r.role === role; }); };
    return has("RMS") ? "RMS" : (has("national") ? "national" : "CMS");
  }
  // Flatten a procedure for PRICING: in a worksharing the lead authority is excluded here
  // (it is priced exactly once, as the lead) and every remaining line carries its chosen fee
  // category, applied to every type (resolveRow falls back to standard per type wherever the
  // label is not published).
  function procPricedCountries(sub, p, engines) {
    var list = procCountries(sub, p, engines);
    if (!leadPricingActive(sub)) return list.map(function (x) {
      var s = specialFor(sub, x.cc, x.role, engines);
      return s ? { cc: x.cc, role: x.role, strengths: x.strengths, special: { IA: s, IB: s, II: s } } : x;
    });
    return list.filter(function (x) { return x.cc !== sub.lead; }).map(function (x) {
      var role = wsPricingRole(x.role);
      // Per-type fee category (IA/IB/II resolved independently), so a country can carry e.g. a
      // standard IB and an "analytical" II, exactly like the classic calculator's Special cases.
      return { cc: x.cc, role: role, strengths: x.strengths, special: {
        IA: wsSpecialFor(sub, x.cc, role, engines, "IA"),
        IB: wsSpecialFor(sub, x.cc, role, engines, "IB"),
        II: wsSpecialFor(sub, x.cc, role, engines, "II") } };
    });
  }
  // Fees for one procedure, via the shared engine (engines.computeFees).
  function procFees(sub, p, counts, engines) {
    if (!engines.computeFees) return null;
    if (!procCountries(sub, p, engines).length || feeCountsTotal(counts) === 0) return { countries: [], grandTotal: 0 };
    // adminFees/processFees:false -- both once-per-application fees are charged once
    // at the submission level (computeSubmissionFees), not per procedure.
    return engines.computeFees({ countries: procPricedCountries(sub, p, engines), counts: counts, adminFees: false, processFees: false });
  }
  // The lead's one-off fee: a single engine country-result, or null while it can't be priced.
  // Where the lead authority publishes a flat worksharing/super-grouping process fee (Finland:
  // WS 4500 / SG 1120), it is added ON TOP of the lead's per-variation fees -- unlike the DK
  // pattern, whose flat "… - worksharing" row replaces the per-variation pricing. For DK the flat
  // amount is 0 (no ws/sg in PROCESS_FEES), so this leaves it unchanged.
  function leadFees(sub, counts, engines) {
    if (!leadPricingActive(sub) || !sub.lead || !engines.computeFees) return null;
    if (feeCountsTotal(counts) === 0) return null;
    var role = leadPricingRole(sub, engines);
    var r = engines.computeFees({
      countries: [{ cc: sub.lead, role: role, strengths: strengthsFor(sub, sub.lead), special: {
        IA: leadSpecial(sub, engines, "IA"), IB: leadSpecial(sub, engines, "IB"), II: leadSpecial(sub, engines, "II") } }],
      counts: counts,
      adminFees: false, processFees: false,  // charged once at the submission level
    });
    var lf = (r.countries && r.countries[0]) || null;
    if (lf && engines.processFeeFlatFor) {
      var mode = sgActive(sub) ? "sg" : "ws";
      var flat = engines.processFeeFlatFor(sub.lead, role, mode);
      if (flat) {
        lf.total = (lf.total || 0) + flat;
        lf.processFeeFlat = flat;         // for the lead-box breakdown line (variant A)
        lf.processFeeFlatMode = mode;     // 'ws' | 'sg'
      }
    }
    return lf;
  }
  // ---- IT (AIFA) per-product pricing ----
  // IT charges variations per medicinal product in WS/SG, unlike the per-authority model of
  // the other countries. The shared path above prices IT once (lead) and dedupes extra IT
  // procedures by country, so the product dimension is lost. These helpers add it back for IT
  // only, as a submission-level adjustment (like the admin/process fees below). See design
  // 2026-10-13-it-worksharing-supergrouping-per-product. GW + Budget both flow through here.
  var IT_CC = "IT";

  // Number of procedures that involve IT, and IT's single pricing role across them.
  function itProcedureCount(sub) {
    var P = 0, role = null;
    (sub.procedures || []).forEach(function (p) {
      if (!p) return;
      if (p.kind === "national" && p.nat === IT_CC) { P++; role = role || "national"; }
      else if (p.kind === "mrpdcp") {
        if (p.rms === IT_CC) { P++; role = "RMS"; }
        else if ((p.cms || []).indexOf(IT_CC) !== -1) { P++; role = role || "CMS"; }
      }
    });
    return { P: P, role: role };
  }

  // The per-Type-II rate IT actually charges for a role, as the base pricing resolves it
  // (standard 29357/24465 or reduced 14678/12232 — reduced is IT's default). Derived from the
  // engine with the SAME special the base used, so the 3rd+ II discount is sized against the
  // real base rate rather than a hard-coded assumption. Marginal = fee(II=2) - fee(II=1).
  function itMarginalTypeIIRate(sub, role, engines) {
    if (!engines.computeFees) return null;
    var special = (sub.lead === IT_CC) ? leadSpecial(sub, engines, "II") : wsSpecialFor(sub, IT_CC, role, engines, "II");
    var sp = { IA: null, IB: null, II: special };
    function fee(n) {
      var r = engines.computeFees({ countries: [{ cc: IT_CC, role: role, strengths: 1, special: sp }],
        counts: { IA: 0, IB: 0, II: n }, adminFees: false, processFees: false });
      return (r.countries && r.countries[0] && r.countries[0].total) || 0;
    }
    return fee(2) - fee(1);
  }

  // The amount to ADD to IT's share (and the grand total) so IT is priced per product.
  // Worksharing:   (P-1) * perProductAdminFee(highestType, role)   minus the 3rd+ II discount.
  // Super-grouping:(P-1) * base(1 product)                         => base * P.
  // Returns 0 for every non-IT / non-WS-SG case, so other countries are bitwise unchanged.
  function itPerProductAdjustment(sub, counts, engines) {
    if (!leadPricingActive(sub) || !engines || !engines.itWsFees) return 0;
    var pc = itProcedureCount(sub);
    if (pc.P < 1) return 0;
    var role = (sub.lead === IT_CC) ? leadPricingRole(sub, engines) : wsPricingRole(pc.role || "CMS");
    if (role !== "RMS" && role !== "CMS") return 0; // national out of scope (spec §7)
    var data = engines.itWsFees;
    var extra = pc.P - 1;

    if (sgActive(sub)) {
      if (extra <= 0 || !engines.computeFees) return 0;
      var rb = engines.computeFees({ countries: [{ cc: IT_CC, role: role, strengths: 1, special: { IA: null, IB: null, II: null } }],
        counts: counts, adminFees: false, processFees: false });
      var base = (rb.countries && rb.countries[0] && rb.countries[0].total) || 0;
      return extra * base;
    }

    // worksharing
    var adj = 0;
    if (extra > 0 && data.perProduct && data.perProduct[role]) {
      var ht = highestType(sub);
      var rate = ht === "II" ? data.perProduct[role].II : (ht === "IB" ? data.perProduct[role].IB : 0);
      adj += extra * (rate || 0);
    }
    var O = counts.II || 0;
    if (O >= 3 && data.reducedTypeII && data.reducedTypeII[role] != null) {
      var marginal = itMarginalTypeIIRate(sub, role, engines);
      // Only discount when the 3rd+ rate is actually lower than the base rate.
      if (marginal != null && marginal > data.reducedTypeII[role]) {
        adj -= (marginal - data.reducedTypeII[role]) * (O - 2);
      }
    }
    return adj;
  }

  // Assemble per-procedure + lead pricing into one grand total (parity with vcl-workflow.js's
  // grandTotalFees) plus a NEW by-country breakdown for the Budget tool.
  function computeSubmissionFees(sub, engines) {
    var counts = feeCounts(sub);
    if (feeCountsTotal(counts) === 0) return { total: null, byCountry: [] };
    var byCc = {}; var total = 0; var any = false; var roleByCc = {};
    // Additive per-country component breakdown (new; existing total/byCountry are unchanged, so the
    // Guided Workflow and Budget keep working and simply ignore `details`). Captures the pieces that
    // make up each country's total -- the worksharing/super-grouping variation fee, the lead one-off,
    // admin, process and the IT per-product adjustment -- plus its currency/fx for a local view.
    var detByCc = {};
    function det(cc) {
      return detByCc[cc] || (detByCc[cc] = { cc: cc, role: null, currency: null, fxRate: null,
        varFee: 0, lead: 0, it: 0, admin: 0, process: 0, adminLocal: null, adminCurrency: null });
    }
    allPricedProcedures(sub).forEach(function (p) {
      // The role each country is priced under this procedure, for the process fee below.
      procPricedCountries(sub, p, engines).forEach(function (x) { if (roleByCc[x.cc] === undefined) roleByCc[x.cc] = x.role; if (!det(x.cc).role) det(x.cc).role = x.role; });
      var r = procFees(sub, p, counts, engines);
      if (!r) return;
      total += r.grandTotal || 0;
      if (procCountries(sub, p, engines).length) any = true;
      (r.countries || []).forEach(function (c) { byCc[c.cc] = (byCc[c.cc] || 0) + (c.total || 0); var dc = det(c.cc); dc.varFee += (c.total || 0); if (c.currency) { dc.currency = c.currency; dc.fxRate = c.fxRate; } });
    });
    if (leadPricingActive(sub)) {
      var lf = leadFees(sub, counts, engines);
      if (lf) { total += lf.total || 0; byCc[lf.cc] = (byCc[lf.cc] || 0) + (lf.total || 0); any = true; var dl = det(lf.cc); dl.lead += (lf.total || 0); dl.role = leadPricingRole(sub, engines); if (lf.currency) { dl.currency = lf.currency; dl.fxRate = lf.fxRate; } }
    }
    // Per-application admin fee (CZ 2000 CZK, EE 16 EUR, ...): once per distinct
    // involved country, no matter how many procedures it took part in. The
    // per-procedure/lead pricing above ran with adminFees:false, so this is the
    // one place it is charged. Deduped by the admin fee's own (base) country code.
    if (engines.adminFeeFor) {
      var adminSeen = {};
      Object.keys(byCc).forEach(function (cc) {
        var af = engines.adminFeeFor(cc);
        if (!af || !af.eur || adminSeen[af.cc]) return;
        adminSeen[af.cc] = true;
        total += af.eur;
        byCc[cc] = (byCc[cc] || 0) + af.eur;
        var dadm = det(cc); dadm.admin += af.eur; dadm.adminLocal = af.amountLocal; dadm.adminCurrency = af.currency;
        any = true;
      });
    }
    // Process fee (Finland as RMS): once per involved country, by the submission's
    // highest type, for a plain single/grouping only. In a worksharing/super-grouping
    // the process fee is the lead's one-off fee, priced through its special row above,
    // so this is skipped there to avoid charging it twice.
    if (engines.processFeeFor && !leadPricingActive(sub)) {
      Object.keys(roleByCc).forEach(function (cc) {
        var pf = engines.processFeeFor(cc, roleByCc[cc], counts);
        if (!pf) return;
        total += pf;
        byCc[cc] = (byCc[cc] || 0) + pf;
        det(cc).process += pf;
        any = true;
      });
    }
    // IT (AIFA) per-product scaling in worksharing/super-grouping. Zero for every other
    // country and for mode === null, so nothing else changes. See itPerProductAdjustment.
    var itAdj = itPerProductAdjustment(sub, counts, engines);
    if (itAdj) {
      total += itAdj;
      byCc[IT_CC] = (byCc[IT_CC] || 0) + itAdj;
      det(IT_CC).it += itAdj;
      any = true;
    }
    var byCountry = Object.keys(byCc).map(function (cc) { return { cc: cc, total: byCc[cc] }; });
    // Build the per-country component list (sums to byCc[cc]). Labels follow the submission mode.
    var varLbl = sgActive(sub) ? "Super-Grouping fee" : (wsActive(sub) ? "Worksharing fee" : "Variation fee");
    var leadLbl = sgActive(sub) ? "Super-Grouping lead fee" : "Worksharing lead fee";
    var details = Object.keys(detByCc).map(function (cc) {
      var d = detByCc[cc];
      var comps = [];
      if (d.varFee) comps.push({ label: varLbl, eur: d.varFee });
      if (d.lead) comps.push({ label: leadLbl, eur: d.lead });
      if (d.it) comps.push({ label: "Per-product adjustment (AIFA)", eur: d.it });
      if (d.admin) comps.push({ label: "Administrative fee (once per application)", eur: d.admin, local: d.adminLocal, currency: d.adminCurrency });
      if (d.process) comps.push({ label: "Process fee (once per application)", eur: d.process });
      return { cc: cc, role: d.role, currency: d.currency, fxRate: d.fxRate, components: comps, total: byCc[cc] || 0 };
    });
    return { total: any ? total : null, byCountry: byCountry, details: details, mode: sub.mode || null };
  }

  // RA effort via the additive workload model (engines.workload + engines.workloadData, generated
  // from RA-CMC-hours.xlsx). Faithful move of vcl-workflow.js's raEffort() (state.* -> sub.*,
  // window.VCL_WORKLOAD_HOURS/window.VCL_WORKLOAD_HD -> engines.workload/engines.workloadData).
  // Returns the granular {min,max} parts, the three composed sections (RA / CMC / Compilation &
  // submission), the grand total, plus flat min/max/expected (the superset both the Guided
  // Workflow transparency box and the Budget tool consume), or null when no variation type is set
  // yet or the engine/data is unavailable.
  function computeSubmissionHours(sub, engines) {
    var t = primaryType(sub);
    if (!t || !engines.workload || !engines.workload.computeAdditiveWorkload || !engines.workloadData) return null;
    var gb = groupingBuckets(sub);
    var wk = worksharingKinds(sub);
    var sp = sgProcKinds(sub);
    var grouped = sub.variations.length > 1 && !(auActive(sub) || sgActive(sub));
    var parts = engines.workload.computeAdditiveWorkload(engines.workloadData, {
      type: t,
      procedure: sub.procedures[0].kind,
      cmsCount: sub.procedures[0].kind === "mrpdcp" ? sub.procedures[0].cms.length : 0,
      // The workbook's CMC rows are tagged "chemical"/"biological"; the workflow state uses
      // "biologic"/"chemical", so map biologic -> biological here.
      activeSubstance: sub.raTasks.activeSubstance === "biologic" ? "biological"
        : (sub.raTasks.activeSubstance === "chemical" ? "chemical" : null),
      modules: {
        pi: sub.raTasks.pi,
        cmc: !!sub.raTasks.cmc,                    // Station "RA tasks" CMC gate
        compilation: !!sub.raTasks.compilation,    // Station "RA tasks" compilation & submission gate
      },
      piDocs: sub.raTasks.piDocs,                   // which PI documents the change touches (filter)
      // The user's own per-block hour adjustment (Station "RA tasks" steppers). The engine clamps
      // and gates it; a submission stored before this feature simply has none.
      hourAdjust: sub.raTasks.hourAdjust,
      submission: {
        worksharing: { on: wsActive(sub), counts: { "national": wk.national, "MRP/DCP": wk.mrpdcp } },
        grouping: { on: grouped, counts: { "Type IA": gb.IA, "Type IB": gb.IB, "Type II": gb.II } },
        annualUpdate: { on: auActive(sub), counts: { "Type IA": 1 + gb.IA } },
        superGrouping: { on: sgActive(sub), counts: { "national": sp.national, "MRP/DCP": sp.mrpdcp, "CP": sp.cp } },
      },
    });
    var sections = engines.workload.composeSections(parts);
    return { parts: parts, items: parts.items, sections: sections, total: sections.total,
      adjust: parts.adjust, blocks: parts.blocks,
      min: sections.total.min, max: sections.total.max,
      expected: engines.workload.pertExpected(sections.total.min, sections.total.max) };
  }

  var api = {
    feeBucket: feeBucket, feeCounts: feeCounts, feeCountsTotal: feeCountsTotal, highestType: highestType,
    primaryType: primaryType, groupingBuckets: groupingBuckets, worksharingKinds: worksharingKinds,
    sgProcKinds: sgProcKinds, allPricedProcedures: allPricedProcedures, allVariationsAreIA: allVariationsAreIA,
    wsActive: wsActive, auActive: auActive, sgActive: sgActive, leadPricingActive: leadPricingActive,
    multiProcedureMode: multiProcedureMode, annualUpdateActive: annualUpdateActive, displayMode: displayMode,
    emaCc: emaCc, strengthsFor: strengthsFor, procCountries: procCountries,
    specialOptionsFor: specialOptionsFor, hasStandardRow: hasStandardRow,
    specialOptionsForType: specialOptionsForType, hasStandardRowType: hasStandardRowType,
    wsOptionsForType: wsOptionsForType, leadOptionsForType: leadOptionsForType,
    wsPricingRole: wsPricingRole, wsSpecialKey: wsSpecialKey, isWorksharingSpecial: isWorksharingSpecial,
    isSuperGroupingSpecial: isSuperGroupingSpecial, leadOptionsFor: leadOptionsFor,
    wsOptionsFor: wsOptionsFor, defaultSpecial: defaultSpecial, wsSpecialFor: wsSpecialFor,
    nonWsOptionsFor: nonWsOptionsFor, specialFor: specialFor, leadSpecial: leadSpecial,
    leadPricingRole: leadPricingRole, procPricedCountries: procPricedCountries, procFees: procFees,
    leadFees: leadFees, computeSubmissionFees: computeSubmissionFees,
    itProcedureCount: itProcedureCount, itPerProductAdjustment: itPerProductAdjustment,
    computeSubmissionHours: computeSubmissionHours,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_SUBMISSION = api;
})(typeof window !== "undefined" ? window : this);
