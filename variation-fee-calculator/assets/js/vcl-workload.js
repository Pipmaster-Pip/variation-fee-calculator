// Workload Planning -- a new, self-contained view of the Variation Toolbox.
//
// Deliberately isolated from vcl-app.js: reads window.VCL_DATA.ENTRIES read-only (for the
// classification picker) and window.VCL_WORKLOAD_DATA (placeholder durations/config), keeps its
// own local state, and exposes exactly one integration point -- window.VCL_WORKLOAD.render(container)
// -- so the existing Classification/Summary/Guidance/Timetables views never need to know this
// file exists, and this file never touches vcl-app.js's own `state`/`el`/render* internals.
//
// v1 scope: a single-case calculator (no saved/multi-case list, no localStorage persistence --
// state resets on reload). See assets/js/vcl-workload-data.js for the placeholder duration data
// this view computes with.
(function () {
  "use strict";

  const VCL_DATA = window.VCL_DATA || {};
  const WD = window.VCL_WORKLOAD_DATA;
  if (!WD) return;
  const WLH = window.VCL_WORKLOAD_HOURS;
  if (!WLH) return;

  const ENTRIES = VCL_DATA.ENTRIES || [];

  // ---- Country lists (would live in vcl-workload-data.js in the final version) ----
  const EU27 = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","EL","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];
  const EEA = ["IS","NO"];
  const sortCodes = (arr) => arr.slice().sort();
  const NATIONAL_COUNTRIES = sortCodes(EU27.concat(EEA));            // no UK
  const RMS_COUNTRIES = NATIONAL_COUNTRIES;                          // no UK (UK cannot be RMS)
  const CMS_COUNTRIES = sortCodes(EU27.concat(EEA).concat(["UK"]));  // incl. UK

  const CLUSTERS = { worksharing: "share", grouping: "share", annualUpdate: "annual", superGrouping: "annual" };

  const PRODUCT_INFO = [
    { key: "smpc", label: "SmPC" },
    { key: "leaflet", label: "Leaflet" },
    { key: "labelling", label: "Labelling" },
    { key: "mockups", label: "Mock-ups" },
  ];

  // Provenance for the factor/timing tables below, surfaced by the "How this estimate is built"
  // panel. The numbers are transcribed by hand from the workbook rather than generated from it
  // (unlike the Fee Calculator's convert.py pipeline), so `lastChecked` is the honest claim we
  // can make: "these were compared against the workbook on this date". BUMP IT whenever F,
  // TIMING or ASSESS is touched, or whenever a new workbook is linked on the settings page --
  // the panel prints it right next to the download link, so a stale date is visible to users.
  const F_META = {
    lastChecked: "2026-07-31",
    workbook: "Workload_RA_Stunden_Faktoren.xlsx",
  };

  // ---- RA-hours factor table (from Workload_RA_Stunden_Faktoren.xlsx, sheet "Faktoren") ----
  const F = {
    baseHours: { IA: 10, IAIN: 10, IB: 12, "IB (unforeseen)": 12, II: 15 },
    procedure: { national: 1.0, cp: 1.0, mrpdcpSmall: 1.1, mrpdcpLarge: 1.2, cmsThreshold: 10 },
    activeSubstance: { biologic: 1.1, chemical: 1.0 },
    cmsHoursPer: 1,
    submission: {
      worksharing: { factor: 1.2, perNational: 1, perMrpdcp: 2 },
      grouping: { factor: 1.2, perIA: 0.5, perIB: 1, perII: 2 },
      annualUpdate: { factor: 1.2, perIA: 0.5 },
      superGrouping: { factor: 1.2, perNational: 1, perMrpdcp: 1, perCp: 1 },
    },
    // Product Information (⑥): hours per ticked deliverable depend on the variation type (IA/IB/II);
    // only counted when "PI management in RA" gates them on. Source: workbook "Faktoren" H63:J66.
    productInfo: {
      smpc:      { IA: 1, IB: 2, II: 4 },
      leaflet:   { IA: 1, IB: 2, II: 4 },
      labelling: { IA: 1, IB: 2, II: 4 },
      mockups:   { IA: 1, IB: 2, II: 4 },
    },
  };

  // Departments -- Translations removed (part of PV), Pharmacovigilance shown as "PV".
  const DEPARTMENTS = [
    { key: "cmc", label: "CMC / Quality", dependsOn: null },
    { key: "pv", label: "PV", dependsOn: null },
    { key: "labelling", label: "Labelling / Artwork", dependsOn: "pv" },
    { key: "ra", label: "Regulatory Affairs (preparation)", dependsOn: null },
    { key: "docmgmt", label: "Document Management (compile & send)", dependsOn: "__all__" },
  ];

  // ---- Timeline run-times (calendar days), sheet "Zeiten" ----
  const TIMING = {
    prep: { IAIN: 7, IB: 7, "IB (unforeseen)": 14, II: 14 }, // fixed RA prep (IA = n.a., Annual Update)
    validation: { national: 14, cp: 7, mrpdcpSmall: 21, mrpdcpLarge: 28, worksharingGrouping: 28 }, // national provisional; cp 1 week (EMA only)
    closureDays: 7, // Closure by RA = EOP + 1 calendar week
  };
  // Assessment structure from the Timetables view (TT_II_DAYS / ttBuildIB in vcl-app.js):
  //   a1 = active days to the RSI/clock-stop point, a2 = active days from resume to EOP,
  //   pvar = day the RMS circulates the PVAR, stopMin..stopMax = clock-stop range (real days).
  //   Nominal EOP day = a1 + a2 (II: 30/90/120) or a1 (IB: accepted at day 30).
  const ASSESS = {
    IAIN: { a1: 30, a2: 0, pvar: 0, stopMin: 0, stopMax: 0 },
    IB: { a1: 30, a2: 30, pvar: 0, stopMin: 0, stopMax: 30 },
    "IB (unforeseen)": { a1: 30, a2: 30, pvar: 0, stopMin: 0, stopMax: 30 },
    II: {
      "30": { a1: 21, a2: 9, pvar: 15, stopMin: 0, stopMax: 20 },
      "60": { a1: 59, a2: 31, pvar: 40, stopMin: 0, stopMax: 120 },
      "90": { a1: 89, a2: 31, pvar: 70, stopMin: 0, stopMax: 150 },
    },
  };
  function timelinePrep(type) {
    if (type === "II") return TIMING.prep.II;
    return TIMING.prep[type] != null ? TIMING.prep[type] : 7;
  }
  function timelineValidation() {
    if (state.procOptions.worksharing || state.procOptions.grouping) return TIMING.validation.worksharingGrouping;
    if (state.procedure === "mrpdcp") return state.cmsCountries.length > 10 ? TIMING.validation.mrpdcpLarge : TIMING.validation.mrpdcpSmall;
    if (state.procedure === "cp") return TIMING.validation.cp;
    return TIMING.validation.national;
  }
  function timelineAssess(type) {
    const s = type === "II" ? ASSESS.II[state.iiSubProcedure] : ASSESS[type];
    if (!s) return null; // Type IA -> Annual Update, no individual clock
    const range = s.stopMax - s.stopMin;
    const stop = s.stopMax > 0 ? Math.round(s.stopMin + state.clockStopFraction * range) : 0;
    return { a1: s.a1, a2: s.a2, pvar: s.pvar || 0, stopMin: s.stopMin, stopMax: s.stopMax, stop: stop };
  }

  let mountedContainer = null;

  const state = {
    query: "",
    pickedCode: null,
    pickedVariantId: undefined,
    typeOnly: null,          // "IA" | "IB" | "II" when the user skips the classification and just picks a type (mirrors the Guided Workflow)
    activeSubstance: null,   // "biologic" | "chemical" | null
    procedure: "national",
    iiSubProcedure: "60",
    clockStopFraction: 1.0, // 0..1 slider position mapping clock-stop min..max
    implementationDate: "",
    nationalCountry: null,
    rmsCountry: "",
    cmsCountries: [],
    procOptions: { worksharing: false, grouping: false, annualUpdate: false, superGrouping: false },
    worksharingNational: 0,
    worksharingMrpdcp: 0,
    groupingIA: 0,
    groupingIB: 0,
    groupingII: 0,
    annualUpdateIaCount: 0,
    superGroupingNational: 0,
    superGroupingMrpdcp: 0,
    superGroupingCp: 0,
    productInfo: { smpc: false, leaflet: false, labelling: false, mockups: false },
    piManagementInRA: false,
    methodOpen: false, // "How this estimate is built" panel -- survives rerender() by living here
    departmentsOn: { cmc: false, pv: false, labelling: false, ra: true, docmgmt: true },
    plannedSubmissionDate: "",
  };

  // ------------------------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------------------------
  function findEntry(code) { return ENTRIES.find((e) => e.code === code) || null; }
  function findVariant(entry, variantId) {
    if (!entry || !entry.variants || !entry.variants.length) return null;
    if (entry.variants.length === 1) return entry.variants[0];
    return entry.variants.find((v) => v.id === variantId) || null;
  }
  function typeBadgeClass(type) {
    if (!type) return "badge";
    if (type.indexOf("IA") === 0) return "badge type-ia";
    if (type.indexOf("IB") === 0) return "badge type-ib";
    if (type.indexOf("II") === 0) return "badge type-ii";
    return "badge";
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function variantLabel(variant) {
    const parts = [];
    if (variant.group) parts.push(variant.group);
    if (variant.label) parts.push(variant.label);
    return parts.length ? parts.join(" — ") : "Default";
  }
  function fmtNum(n) {
    const r = Math.round(n * 10) / 10;
    return (r % 1 === 0 ? String(r) : r.toFixed(1));
  }
  function fmtMonths(days) {
    const mo = Math.round((days / 30.44) * 10) / 10;
    return (mo % 1 === 0 ? String(mo) : mo.toFixed(1)) + " mo";
  }
  function typeDisplay(type) {
    if (type === "II") return "Type II";
    if (type === "IB") return "Type IB";
    if (type === "IB (unforeseen)") return "Type IB (unforeseen)";
    if (type === "IAIN") return "Type IA (IAIN – immediate notification)";
    if (type === "IA") return "Type IA";
    return "Type " + type;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + n);
    return d;
  }
  function fmtDate(d) {
    if (!d) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return day + "." + m + "." + d.getFullYear();
  }

  // ------------------------------------------------------------------------------------------
  // RA-hours calculation
  // ------------------------------------------------------------------------------------------
  function procedureFactor(cmsCount) {
    if (state.procedure === "mrpdcp") return cmsCount > F.procedure.cmsThreshold ? F.procedure.mrpdcpLarge : F.procedure.mrpdcpSmall;
    if (state.procedure === "cp") return F.procedure.cp;
    return F.procedure.national;
  }
  function activeSubstanceFactor() {
    if (state.activeSubstance === "biologic") return F.activeSubstance.biologic;
    if (state.activeSubstance === "chemical") return F.activeSubstance.chemical;
    return 1.0;
  }
  function submissionFactorProduct() {
    let f = 1;
    const s = F.submission;
    if (state.procOptions.worksharing && s.worksharing.factor) f *= s.worksharing.factor;
    if (state.procOptions.grouping && s.grouping.factor) f *= s.grouping.factor;
    if (state.procOptions.annualUpdate && s.annualUpdate.factor) f *= s.annualUpdate.factor;
    if (state.procOptions.superGrouping && s.superGrouping.factor) f *= s.superGrouping.factor;
    return f;
  }
  function cmsAddHours() {
    if (state.procedure !== "mrpdcp") return 0;
    return (F.cmsHoursPer || 0) * state.cmsCountries.length;
  }
  function submissionAddHours() {
    return WLH.computeSubmissionAddHours(state.procOptions, state, F.submission);
  }
  function submissionPending() {
    const s = F.submission;
    if (state.procOptions.worksharing && s.worksharing.factor == null && s.worksharing.perNational == null && s.worksharing.perMrpdcp == null) return true;
    if (state.procOptions.grouping && s.grouping.factor == null && s.grouping.perIA == null && s.grouping.perIB == null && s.grouping.perII == null) return true;
    if (state.procOptions.annualUpdate && s.annualUpdate.factor == null && s.annualUpdate.perIA == null) return true;
    if (state.procOptions.superGrouping && s.superGrouping.factor == null && s.superGrouping.perNational == null && s.superGrouping.perMrpdcp == null && s.superGrouping.perCp == null) return true;
    return false;
  }
  // The workbook gives PI hours per Type IA/IB/II. IAIN counts as IA, "IB (unforeseen)" as IB.
  function piTypeBucket(type) {
    if (type === "II") return "II";
    if (type === "IA" || type === "IAIN") return "IA";
    return "IB"; // IB, IB (unforeseen)
  }
  function piElementHours(key, type) {
    const m = F.productInfo[key];
    return (m && m[piTypeBucket(type)]) || 0;
  }
  // Product-information text editing only burdens RA if it is managed in RA ("PI management in RA").
  function productInfoAddHours(type) {
    if (!state.piManagementInRA) return 0;
    let h = 0;
    PRODUCT_INFO.forEach((it) => { if (state.productInfo[it.key]) h += piElementHours(it.key, type); });
    return h;
  }
  function computeRaHours(type) {
    const base = F.baseHours[type] || 0;
    const mult = procedureFactor(state.cmsCountries.length) * activeSubstanceFactor() * submissionFactorProduct();
    return { total: base * mult + cmsAddHours() + submissionAddHours() + productInfoAddHours(type), base: base, mult: mult };
  }
  function raBreakdown(type) {
    const base = F.baseHours[type] || 0;
    const pf = procedureFactor(state.cmsCountries.length);
    const af = activeSubstanceFactor();
    const sf = submissionFactorProduct();
    const parts = ["Base " + base + " h"];
    if (pf !== 1) parts.push("× procedure " + fmtNum(pf));
    if (af !== 1) parts.push("× active substance " + fmtNum(af));
    if (sf !== 1) parts.push("× submission " + fmtNum(sf));
    const cms = cmsAddHours();
    if (cms > 0) parts.push("+ CMS " + state.cmsCountries.length + "×" + F.cmsHoursPer + " h");
    const sub = submissionAddHours();
    if (sub > 0) parts.push("+ groupings " + fmtNum(sub) + " h");
    const pi = productInfoAddHours(type);
    if (pi > 0) parts.push("+ PI in RA " + fmtNum(pi) + " h");
    return parts.join("  ");
  }
  function procedureLabel() {
    if (state.procedure === "mrpdcp") {
      const large = state.cmsCountries.length > F.procedure.cmsThreshold;
      return "MRP/DCP (" + (large ? ">" : "≤") + F.procedure.cmsThreshold + " CMS)";
    }
    if (state.procedure === "cp") return "CP";
    return "National";
  }
  function activeSubstanceLabel() {
    if (state.activeSubstance === "biologic") return "Biologic";
    if (state.activeSubstance === "chemical") return "Chemically-synthesized API";
    return null;
  }
  // Structured, itemised RA-hours breakdown for the transparency panel.
  function raBreakdownRows(type) {
    const base = F.baseHours[type] || 0;
    const pf = procedureFactor(state.cmsCountries.length);
    const af = activeSubstanceFactor();
    const rows = [{ label: "Base · " + typeDisplay(type), val: base + " h", kind: "base" }];
    if (pf !== 1) rows.push({ label: "× Procedure · " + procedureLabel(), val: "× " + fmtNum(pf), kind: "mult" });
    if (af !== 1) rows.push({ label: "× Active substance · " + (activeSubstanceLabel() || ""), val: "× " + fmtNum(af), kind: "mult" });
    if (state.procOptions.worksharing && F.submission.worksharing.factor) rows.push({ label: "× Worksharing", val: "× " + fmtNum(F.submission.worksharing.factor), kind: "mult" });
    if (state.procOptions.grouping && F.submission.grouping.factor) rows.push({ label: "× Grouping", val: "× " + fmtNum(F.submission.grouping.factor), kind: "mult" });
    if (state.procOptions.annualUpdate && F.submission.annualUpdate.factor) rows.push({ label: "× Annual Update", val: "× " + fmtNum(F.submission.annualUpdate.factor), kind: "mult" });
    if (state.procOptions.superGrouping && F.submission.superGrouping.factor) rows.push({ label: "× Super-Grouping", val: "× " + fmtNum(F.submission.superGrouping.factor), kind: "mult" });
    const mult = pf * af * submissionFactorProduct();
    const subtotal = base * mult;
    const cms = cmsAddHours();
    const sub = submissionAddHours();
    const pi = productInfoAddHours(type);
    if (mult !== 1) rows.push({ label: "Subtotal (base × factors)", val: fmtNum(subtotal) + " h", kind: "subtotal" });
    if (cms > 0) rows.push({ label: "+ CMS scaling · " + state.cmsCountries.length + " × " + F.cmsHoursPer + " h", val: "+ " + fmtNum(cms) + " h", kind: "add" });
    if (sub > 0) rows.push({ label: "+ Grouped / shared items", val: "+ " + fmtNum(sub) + " h", kind: "add" });
    if (pi > 0) rows.push({ label: "+ Product information in RA", val: "+ " + fmtNum(pi) + " h", kind: "add" });
    return rows;
  }
  function raSummary(type, total) {
    const bits = [typeDisplay(type)];
    if (state.activeSubstance) bits.push(activeSubstanceLabel());
    if (state.procedure === "national") bits.push("national" + (state.nationalCountry ? " (" + state.nationalCountry + ")" : ""));
    else if (state.procedure === "mrpdcp") bits.push("MRP/DCP" + (state.cmsCountries.length ? " (" + state.cmsCountries.length + " CMS)" : ""));
    else if (state.procedure === "cp") bits.push("centralised");
    return bits.join(" · ") + " — an estimated " + fmtNum(total) + " h of regulatory-affairs work.";
  }

  // ------------------------------------------------------------------------------------------
  // Department schedule + annual-update window (from WD placeholders)
  // ------------------------------------------------------------------------------------------
  function computeSchedule(type, departmentsOn) {
    const durations = WD.taskDurationDays;
    const perDept = {};
    DEPARTMENTS.forEach((dept) => {
      if (dept.key === "docmgmt" || !departmentsOn[dept.key]) return;
      const duration = (durations[dept.key] && durations[dept.key][type]) || 0;
      let start = 0;
      if (dept.dependsOn && dept.dependsOn !== "__all__" && perDept[dept.dependsOn]) start = perDept[dept.dependsOn].finish;
      perDept[dept.key] = { start, finish: start + duration, duration };
    });
    const finishes = Object.keys(perDept).map((k) => perDept[k].finish);
    const readyToSubmitDay = finishes.length ? Math.max.apply(null, finishes) : 0;
    let submissionDay = readyToSubmitDay;
    if (departmentsOn.docmgmt) {
      const duration = (durations.docmgmt && durations.docmgmt[type]) || 0;
      perDept.docmgmt = { start: readyToSubmitDay, finish: readyToSubmitDay + duration, duration };
      submissionDay = perDept.docmgmt.finish;
    }
    return { perDept, readyToSubmitDay, submissionDay };
  }
  function computeAnnualUpdateWindow(implementationDateStr) {
    if (!implementationDateStr) return null;
    const d = new Date(implementationDateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    const fmt = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    };
    const earliest = new Date(d); earliest.setMonth(earliest.getMonth() + WD.annualUpdate.earliestMonths);
    const latest = new Date(d); latest.setMonth(latest.getMonth() + WD.annualUpdate.latestMonths);
    return { earliest: fmt(earliest), latest: fmt(latest) };
  }

  // ------------------------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------------------------
  function rerender() {
    if (!mountedContainer) return;
    const active = document.activeElement;
    let focusInfo = null;
    if (active && mountedContainer.contains(active) && active.id) {
      focusInfo = { id: active.id, selStart: active.selectionStart, selEnd: active.selectionEnd };
    }
    mountedContainer.innerHTML = "";
    buildView(mountedContainer);
    if (focusInfo) {
      const el = document.getElementById(focusInfo.id);
      if (el) {
        el.focus();
        if (typeof el.setSelectionRange === "function" && focusInfo.selStart != null) {
          try { el.setSelectionRange(focusInfo.selStart, focusInfo.selEnd); } catch (e) {}
        }
      }
    }
  }

  function buildView(container) {
    const head = document.createElement("div"); head.className = "vcl-wl-head";
    head.innerHTML = `
      <h3>Workload Planning</h3>
      <p>Pick a classification, describe the procedure, and see an estimated preparation
      timeline, department workload, and likely submission/approval dates.</p>`;
    container.appendChild(head);
    const disclaimer = document.createElement("div"); disclaimer.className = "vcl-wl-disclaimer";
    disclaimer.innerHTML = `<span>&#9888;</span><span><strong>Draft tool.</strong> ${escapeHtml(WD.meta.disclaimer)}</span>`;
    container.appendChild(disclaimer);
    buildPicker(container);
    const entry = state.pickedCode ? findEntry(state.pickedCode) : null;
    const variant = entry ? findVariant(entry, state.pickedVariantId) : null;
    if (entry && variant) {
      buildForm(container, entry, variant);
      buildResults(container, variant.type);
    } else if (!entry && state.typeOnly) {
      // Type-only case (no classification code): buildForm/buildResults only ever read the
      // type, so a minimal variant stand-in carries it through unchanged.
      buildForm(container, null, { type: state.typeOnly });
      buildResults(container, state.typeOnly);
    }
    // Always rendered, even with nothing picked: the tables are a reference in their own right,
    // and someone who wants to know what the tool assumes shouldn't have to invent a case first.
    buildMethodology(container, variant ? variant.type : (!entry ? state.typeOnly : null));
  }

  function buildPicker(container) {
    const section = document.createElement("div"); section.className = "vcl-wl-section";
    const entry = state.pickedCode ? findEntry(state.pickedCode) : null;
    const variant = entry ? findVariant(entry, state.pickedVariantId) : null;

    if (entry && variant) {
      section.innerHTML = `<h4>Classification</h4>`;
      const picked = document.createElement("div"); picked.className = "vcl-wl-picked";
      picked.innerHTML = `<span><span class="vcl-wl-picked__code">${escapeHtml(entry.code)}</span> &mdash; ${escapeHtml(entry.title)} <span class="${typeBadgeClass(variant.type)}">${escapeHtml(variant.type)}</span></span>`;
      const changeBtn = document.createElement("button"); changeBtn.type = "button"; changeBtn.textContent = "Change";
      changeBtn.addEventListener("click", () => { state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
      picked.appendChild(changeBtn); section.appendChild(picked); container.appendChild(section); return;
    }
    if (entry && !variant) {
      section.innerHTML = `<h4>Classification</h4>`;
      const picked = document.createElement("div"); picked.className = "vcl-wl-picked";
      picked.innerHTML = `<span><span class="vcl-wl-picked__code">${escapeHtml(entry.code)}</span> &mdash; ${escapeHtml(entry.title)}</span>`;
      const changeBtn = document.createElement("button"); changeBtn.type = "button"; changeBtn.textContent = "Change";
      changeBtn.addEventListener("click", () => { state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
      picked.appendChild(changeBtn); section.appendChild(picked);
      const list = document.createElement("div"); list.className = "vcl-wl-variants";
      entry.variants.forEach((v) => {
        const row = document.createElement("div"); row.className = "vcl-wl-variant";
        row.innerHTML = `<span class="vcl-wl-variant__label">${escapeHtml(variantLabel(v))}</span> <span class="${typeBadgeClass(v.type)}">${escapeHtml(v.type)}</span>`;
        row.addEventListener("click", () => { state.pickedVariantId = v.id; rerender(); });
        list.appendChild(row);
      });
      section.appendChild(list); container.appendChild(section); return;
    }

    // Type-only case picked: same "picked" header treatment as a classification, with the
    // type badge and a Change button that reopens the picker.
    if (state.typeOnly) {
      section.innerHTML = `<h4>Classification</h4>`;
      const picked = document.createElement("div"); picked.className = "vcl-wl-picked";
      picked.innerHTML = `<span>Type ${escapeHtml(state.typeOnly)} <span class="${typeBadgeClass(state.typeOnly)}">${escapeHtml(state.typeOnly)}</span> <span class="vcl-wl-picked__muted">— no classification code</span></span>`;
      const changeBtn = document.createElement("button"); changeBtn.type = "button"; changeBtn.textContent = "Change";
      changeBtn.addEventListener("click", () => { state.typeOnly = null; state.query = ""; rerender(); });
      picked.appendChild(changeBtn); section.appendChild(picked); container.appendChild(section); return;
    }

    section.innerHTML = `<h4>Classification</h4>`;
    const searchBox = document.createElement("div"); searchBox.className = "search-box vcl-wl-search";
    searchBox.innerHTML = `<input type="text" id="vcl-wl-search-input" placeholder="Search by code or keyword (i. e. shape, shelf, leaflet) ..." autocomplete="off" />`;
    const input = searchBox.querySelector("input"); input.value = state.query;
    input.addEventListener("input", () => { state.query = input.value; rerender(); });
    section.appendChild(searchBox);

    const q = state.query.trim().toLowerCase();
    if (q.length >= 2) {
      const matches = ENTRIES.filter((e) => e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1);
      const results = document.createElement("div"); results.className = "vcl-wl-results";
      matches.slice(0, 25).forEach((e) => {
        const row = document.createElement("button"); row.type = "button"; row.className = "vcl-wl-result";
        row.innerHTML = `<span class="vcl-wl-result__code">${escapeHtml(e.code)}</span> <span class="vcl-wl-result__title">${escapeHtml(e.title)}</span>`;
        row.addEventListener("click", () => {
          state.pickedCode = e.code;
          const only = e.variants && e.variants.length === 1 ? e.variants[0] : null;
          state.pickedVariantId = only ? only.id : undefined;
          state.typeOnly = null;
          rerender();
        });
        results.appendChild(row);
      });
      if (!matches.length) { const empty = document.createElement("p"); empty.className = "vcl-wl-empty"; empty.textContent = "No matching classification codes."; results.appendChild(empty); }
      else if (matches.length > 25) { const note = document.createElement("p"); note.className = "vcl-wl-note"; note.textContent = matches.length - 25 + " more matches — refine your search."; results.appendChild(note); }
      section.appendChild(results);
    }

    // Type-only quick pick (mirrors the Guided Workflow's Station A): plan a case without a
    // classification code by choosing the variation type directly.
    const quick = document.createElement("div"); quick.className = "vcl-wl-quicktype";
    const quickLabel = document.createElement("div"); quickLabel.className = "vcl-wl-quicktype__label";
    quickLabel.textContent = "No classification code? Set the type directly:";
    quick.appendChild(quickLabel);
    const quickOpts = document.createElement("div"); quickOpts.className = "vcl-wl-quicktype__opts";
    ["IA", "IB", "II"].forEach((t) => {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "vcl-wl-typeopt";
      chip.innerHTML = `Type ${t} <span class="${typeBadgeClass(t)}">${t}</span>`;
      chip.addEventListener("click", () => { state.typeOnly = t; state.pickedCode = null; state.pickedVariantId = undefined; state.query = ""; rerender(); });
      quickOpts.appendChild(chip);
    });
    quick.appendChild(quickOpts);
    section.appendChild(quick);
    container.appendChild(section);
  }

  // --- Inline hint pills: show the workload weight of each control right next to it. ---
  // Three visual kinds so users can tell a multiplier from added hours at a glance:
  //   factor "×1.1" (outline) · add "+5 h" (filled) · base "15 h" (solid).
  function hintPill(text, variant) {
    const s = document.createElement("span");
    s.className = "vcl-wl-hint" + (variant ? " vcl-wl-hint--" + variant : "");
    s.textContent = text;
    return s;
  }
  // Always show one decimal so a neutral 1.0 reads clearly next to a 1.1 (used inline and in the panel).
  function fmtFactor(f) { return Number.isInteger(f) ? f.toFixed(1) : fmtNum(f); }
  function factorPill(f) { return hintPill("×" + fmtFactor(f), "factor"); }
  function hoursPill(h) { return hintPill("+" + fmtNum(h) + " h", "add"); }
  // Append a pill that is always laid out (reserving its width) but only painted when `visible`.
  // Keeping the ghost in the flow stops the label text from jumping as pills pop in and out.
  function appendPill(label, pill, visible) {
    if (!visible) pill.classList.add("is-ghost");
    label.appendChild(pill);
  }

  function numberField(id, labelText, value, onInput, hint) {
    const field = document.createElement("div"); field.className = "vcl-wl-field";
    const label = document.createElement("label"); label.setAttribute("for", id); label.textContent = labelText;
    if (hint) { label.appendChild(document.createTextNode(" ")); label.appendChild(hint); }
    field.appendChild(label);
    const input = document.createElement("input"); input.type = "number"; input.id = id; input.min = "0"; input.value = String(value);
    input.addEventListener("input", () => { onInput(Math.max(0, parseInt(input.value, 10) || 0)); rerender(); });
    field.appendChild(input);
    return field;
  }

  function singleSelectRow(section, options, current, onPick, gridClass) {
    const row = document.createElement("div"); row.className = gridClass || "vcl-wl-checks";
    options.forEach((opt) => {
      const label = document.createElement("label");
      const check = document.createElement("input"); check.type = "checkbox"; check.checked = current === opt.key;
      check.addEventListener("change", () => { onPick(check.checked ? opt.key : null); rerender(); });
      // The weight pill is painted only once this option is the selected one, but its
      // space is always reserved (ghost) so the label does not shift on selection.
      label.appendChild(check); label.appendChild(document.createTextNode(" " + opt.label));
      if (opt.hint) appendPill(label, opt.hint, current === opt.key);
      row.appendChild(label);
    });
    section.appendChild(row);
  }

  function buildNationalCountries(section) {
    const label = document.createElement("div"); label.className = "vcl-wl-flabel"; label.style.marginTop = "10px"; label.textContent = "Country";
    section.appendChild(label);
    const row = document.createElement("div"); row.className = "vcl-wl-cgrid";
    NATIONAL_COUNTRIES.forEach((code) => {
      const l = document.createElement("label");
      const check = document.createElement("input"); check.type = "checkbox"; check.checked = state.nationalCountry === code;
      check.addEventListener("change", () => { state.nationalCountry = check.checked ? code : null; rerender(); });
      l.appendChild(check); l.appendChild(document.createTextNode(" " + code));
      row.appendChild(l);
    });
    section.appendChild(row);
    const note = document.createElement("p"); note.className = "vcl-wl-note"; note.textContent = "Exactly one country for a national procedure (UK not applicable).";
    section.appendChild(note);
  }

  function buildMrpDcp(section) {
    const rmsRow = document.createElement("div"); rmsRow.className = "vcl-wl-row";
    const rmsField = document.createElement("div"); rmsField.className = "vcl-wl-field";
    rmsField.innerHTML = `<label for="vcl-wl-rms">RMS (Reference Member State)</label>`;
    const select = document.createElement("select"); select.id = "vcl-wl-rms"; select.className = "vcl-wl-select";
    const opt0 = document.createElement("option"); opt0.value = ""; opt0.textContent = "— select —"; select.appendChild(opt0);
    RMS_COUNTRIES.forEach((code) => {
      const o = document.createElement("option"); o.value = code; o.textContent = code;
      if (state.rmsCountry === code) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener("change", () => {
      state.rmsCountry = select.value;
      state.cmsCountries = state.cmsCountries.filter((c) => c !== state.rmsCountry);
      rerender();
    });
    rmsField.appendChild(select); rmsRow.appendChild(rmsField);
    section.appendChild(rmsRow);

    const cmsLabel = document.createElement("div"); cmsLabel.className = "vcl-wl-flabel"; cmsLabel.style.marginTop = "12px"; cmsLabel.textContent = "CMS (Concerned Member States)";
    section.appendChild(cmsLabel);
    const row = document.createElement("div"); row.className = "vcl-wl-cgrid";
    CMS_COUNTRIES.forEach((code) => {
      const isRms = state.rmsCountry === code;
      const l = document.createElement("label"); if (isRms) l.className = "is-disabled";
      const check = document.createElement("input"); check.type = "checkbox"; check.disabled = isRms; check.checked = state.cmsCountries.indexOf(code) !== -1;
      check.addEventListener("change", () => {
        if (check.checked) { if (state.cmsCountries.indexOf(code) === -1) state.cmsCountries.push(code); }
        else { state.cmsCountries = state.cmsCountries.filter((c) => c !== code); }
        rerender();
      });
      l.appendChild(check); l.appendChild(document.createTextNode(" " + code));
      row.appendChild(l);
    });
    section.appendChild(row);
    const note = document.createElement("p"); note.className = "vcl-wl-note";
    note.textContent = "CMS may be several, all, or none. The RMS cannot also be a CMS; the UK cannot be the RMS.";
    section.appendChild(note);
    const cmsHint = document.createElement("p"); cmsHint.className = "vcl-wl-note";
    cmsHint.appendChild(document.createTextNode("Each selected CMS adds "));
    cmsHint.appendChild(hoursPill(F.cmsHoursPer));
    const n = state.cmsCountries.length;
    if (n) cmsHint.appendChild(document.createTextNode(" — currently " + n + " × " + fmtNum(F.cmsHoursPer) + " h = +" + fmtNum(n * F.cmsHoursPer) + " h."));
    cmsHint.appendChild(document.createTextNode(" More than " + F.procedure.cmsThreshold + " CMS also raises the procedure factor to ×" + fmtNum(F.procedure.mrpdcpLarge) + "."));
    section.appendChild(cmsHint);
  }

  function allowedClusterForType(type) {
    return (type === "IA") ? "annual" : "share"; // IAIN is immediate -> individual (share), not annual
  }
  function allowedGroupingTypes(type) {
    if (type === "II") return ["IA", "IB", "II"];
    if (type === "IB" || type === "IB (unforeseen)") return ["IA", "IB"];
    if (type === "IAIN") return ["IA"];
    return [];
  }

  function buildProcedureOptions(section, type) {
    const allowedCluster = allowedClusterForType(type);
    Object.keys(state.procOptions).forEach((k) => { if (CLUSTERS[k] !== allowedCluster) state.procOptions[k] = false; });

    const heading = document.createElement("h4"); heading.textContent = "Submission type"; heading.style.marginTop = "18px";
    section.appendChild(heading);
    const OPTIONS = [
      { key: "worksharing", label: "Worksharing", factor: F.submission.worksharing.factor },
      { key: "grouping", label: "Grouping", factor: F.submission.grouping.factor },
      { key: "annualUpdate", label: "Annual Update", factor: F.submission.annualUpdate.factor },
      { key: "superGrouping", label: "Super-Grouping", factor: F.submission.superGrouping.factor },
    ];
    const row = document.createElement("div"); row.className = "vcl-wl-checks";
    OPTIONS.forEach((opt) => {
      const disabled = CLUSTERS[opt.key] !== allowedCluster;
      const label = document.createElement("label"); if (disabled) label.className = "is-disabled";
      const check = document.createElement("input"); check.type = "checkbox"; check.checked = !!state.procOptions[opt.key]; check.disabled = disabled;
      check.addEventListener("change", () => { state.procOptions[opt.key] = check.checked; rerender(); });
      label.appendChild(check); label.appendChild(document.createTextNode(" " + opt.label));
      // Factor pill painted only once this submission type is ticked; space reserved otherwise.
      if (opt.factor) appendPill(label, factorPill(opt.factor), state.procOptions[opt.key]);
      row.appendChild(label);
    });
    section.appendChild(row);

    const note = document.createElement("p"); note.className = "vcl-wl-note";
    if (allowedCluster === "annual") {
      note.textContent = "Type IA: only Annual Update or Super-Grouping apply (both may be combined).";
    } else {
      const isIB = type.indexOf("IB") === 0;
      note.textContent = "Type " + (isIB ? "IB" : "II") + ": only Worksharing or Grouping apply (both may be combined)."
        + (isIB ? " A Type IB grouping may include Type IA/IB variations only (not Type II)." : "");
    }
    section.appendChild(note);

    const subRow = document.createElement("div"); subRow.className = "vcl-wl-row"; subRow.style.marginTop = "12px";
    const ws = F.submission.worksharing, grp = F.submission.grouping, au = F.submission.annualUpdate;
    if (state.procOptions.worksharing) {
      subRow.appendChild(numberField("vcl-wl-ws-nat", "Other procedures — national", state.worksharingNational, (v) => { state.worksharingNational = v; }, hoursPill(ws.perNational)));
      subRow.appendChild(numberField("vcl-wl-ws-mrp", "Other procedures — MRP/DCP", state.worksharingMrpdcp, (v) => { state.worksharingMrpdcp = v; }, hoursPill(ws.perMrpdcp)));
    }
    if (state.procOptions.grouping) {
      const allowed = allowedGroupingTypes(type);
      if (allowed.indexOf("IA") !== -1) subRow.appendChild(numberField("vcl-wl-grp-ia", "Other variations — Type IA", state.groupingIA, (v) => { state.groupingIA = v; }, hoursPill(grp.perIA))); else state.groupingIA = 0;
      if (allowed.indexOf("IB") !== -1) subRow.appendChild(numberField("vcl-wl-grp-ib", "Other variations — Type IB", state.groupingIB, (v) => { state.groupingIB = v; }, hoursPill(grp.perIB))); else state.groupingIB = 0;
      if (allowed.indexOf("II") !== -1) subRow.appendChild(numberField("vcl-wl-grp-ii", "Other variations — Type II", state.groupingII, (v) => { state.groupingII = v; }, hoursPill(grp.perII))); else state.groupingII = 0;
    }
    if (state.procOptions.annualUpdate) subRow.appendChild(numberField("vcl-wl-au-count", "No. of Type IA", state.annualUpdateIaCount, (v) => { state.annualUpdateIaCount = v; }, hoursPill(au.perIA)));
    if (state.procOptions.superGrouping) {
      const kinds = WLH.computeSgCounterKinds(state.procedure);
      const sg = F.submission.superGrouping;
      if (kinds.indexOf("national") !== -1) subRow.appendChild(numberField("vcl-wl-sg-nat", "Other procedures — national", state.superGroupingNational, (v) => { state.superGroupingNational = v; }, hoursPill(sg.perNational))); else state.superGroupingNational = 0;
      if (kinds.indexOf("mrpdcp") !== -1) subRow.appendChild(numberField("vcl-wl-sg-mrp", "Other procedures — MRP/DCP", state.superGroupingMrpdcp, (v) => { state.superGroupingMrpdcp = v; }, hoursPill(sg.perMrpdcp))); else state.superGroupingMrpdcp = 0;
      if (kinds.indexOf("cp") !== -1) subRow.appendChild(numberField("vcl-wl-sg-cp", "Other procedures — CP", state.superGroupingCp, (v) => { state.superGroupingCp = v; }, hoursPill(sg.perCp))); else state.superGroupingCp = 0;
    }
    if (subRow.children.length) section.appendChild(subRow);
  }

  function buildForm(container, entry, variant) {
    const type = variant.type;
    const section = document.createElement("div"); section.className = "vcl-wl-section";

    // Base hours for the picked classification -- the starting point every factor multiplies.
    const baseLine = document.createElement("p"); baseLine.className = "vcl-wl-baseline";
    baseLine.appendChild(document.createTextNode("Base workload · " + methodTypeLabel(type) + " "));
    baseLine.appendChild(hintPill(F.baseHours[type] + " h", "base"));
    baseLine.appendChild(document.createTextNode(" "));
    const baseHint = document.createElement("span"); baseHint.className = "vcl-wl-baseline__note"; baseHint.textContent = "starting point, before the factors below";
    baseLine.appendChild(baseHint);
    section.appendChild(baseLine);

    const asHeading = document.createElement("h4"); asHeading.textContent = "Active Substance";
    section.appendChild(asHeading);
    singleSelectRow(section, [
      { key: "biologic", label: "Biologic", hint: factorPill(F.activeSubstance.biologic) },
      { key: "chemical", label: "Chemically-synthesized API", hint: factorPill(F.activeSubstance.chemical) },
    ], state.activeSubstance, (k) => { state.activeSubstance = k; });

    const procHeading = document.createElement("h4"); procHeading.textContent = "Procedure"; procHeading.style.marginTop = "18px";
    section.appendChild(procHeading);
    const procRow = document.createElement("div"); procRow.className = "vcl-wl-row";
    const procRadios = document.createElement("div"); procRadios.className = "vcl-wl-radios";
    [
      { key: "national", label: "National", hint: factorPill(F.procedure.national) },
      { key: "mrpdcp", label: "MRP / DCP", hint: hintPill("×" + fmtNum(F.procedure.mrpdcpSmall) + "–" + fmtNum(F.procedure.mrpdcpLarge), "factor") },
      { key: "cp", label: "CP", hint: factorPill(F.procedure.cp) },
    ].forEach((opt) => {
      const label = document.createElement("label");
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "vcl-wl-procedure"; radio.checked = state.procedure === opt.key;
      radio.addEventListener("change", () => { state.procedure = opt.key; rerender(); });
      label.appendChild(radio); label.appendChild(document.createTextNode(" " + opt.label));
      // Factor pill painted only for the chosen procedure; space reserved for the rest.
      appendPill(label, opt.hint, state.procedure === opt.key);
      procRadios.appendChild(label);
    });
    procRow.appendChild(procRadios);
    section.appendChild(procRow);

    if (state.procedure === "national") buildNationalCountries(section);
    if (state.procedure === "mrpdcp") buildMrpDcp(section);

    const ptHeading = document.createElement("h4"); ptHeading.textContent = "Procedure Type"; ptHeading.style.marginTop = "18px";
    section.appendChild(ptHeading);
    const ptLine = document.createElement("div"); ptLine.className = "vcl-wl-ptype";
    ptLine.innerHTML = `<span class="${typeBadgeClass(type)}">${escapeHtml(type)}</span> <span>${escapeHtml(typeDisplay(type))}</span>`;
    section.appendChild(ptLine);

    if (type === "II") {
      const subRow = document.createElement("div"); subRow.className = "vcl-wl-row";
      const subRadios = document.createElement("div"); subRadios.className = "vcl-wl-radios";
      ["30", "60", "90"].forEach((d) => {
        const label = document.createElement("label");
        const radio = document.createElement("input"); radio.type = "radio"; radio.name = "vcl-wl-ii-sub"; radio.checked = state.iiSubProcedure === d;
        radio.addEventListener("change", () => { state.iiSubProcedure = d; rerender(); });
        label.appendChild(radio); label.appendChild(document.createTextNode(" " + d + "-day procedure"));
        subRadios.appendChild(label);
      });
      subRow.appendChild(subRadios); section.appendChild(subRow);
      const ptNote = document.createElement("p"); ptNote.className = "vcl-wl-note";
      ptNote.textContent = "Sets the assessment clock (timeline below) — it does not change the RA hours.";
      section.appendChild(ptNote);
    }

    if (type === "IA") {
      const note = document.createElement("p"); note.className = "vcl-wl-note";
      note.textContent = "Type IA changes are not submitted individually — they are collected and filed via the next Annual Update. The implementation date of the first Type IA triggers the window: submit earliest +9 months, latest +12 months.";
      section.appendChild(note);
      const iaRow = document.createElement("div"); iaRow.className = "vcl-wl-row";
      const dateField = document.createElement("div"); dateField.className = "vcl-wl-field";
      dateField.innerHTML = `<label for="vcl-wl-impl-date">Implementation date (first Type IA)</label>`;
      const dateInput = document.createElement("input"); dateInput.type = "date"; dateInput.id = "vcl-wl-impl-date"; dateInput.value = state.implementationDate;
      dateInput.addEventListener("change", () => { state.implementationDate = dateInput.value; rerender(); });
      dateField.appendChild(dateInput); iaRow.appendChild(dateField);
      section.appendChild(iaRow);
    }

    buildProcedureOptions(section, type);

    const piHeading = document.createElement("h4"); piHeading.textContent = "Product Information"; piHeading.style.marginTop = "18px";
    section.appendChild(piHeading);

    // Gate first: only when the PI text editing is managed in RA are the deliverables shown at all.
    const piMgmtRow = document.createElement("div"); piMgmtRow.className = "vcl-wl-checks";
    const pmLabel = document.createElement("label");
    const pmCheck = document.createElement("input"); pmCheck.type = "checkbox"; pmCheck.checked = state.piManagementInRA;
    pmCheck.addEventListener("change", () => { state.piManagementInRA = pmCheck.checked; rerender(); });
    pmLabel.appendChild(pmCheck); pmLabel.appendChild(document.createTextNode(" PI management in RA"));
    piMgmtRow.appendChild(pmLabel);
    section.appendChild(piMgmtRow);
    const pmNote = document.createElement("p"); pmNote.className = "vcl-wl-note";
    pmNote.textContent = "Tick if the product-information text editing happens within RA (time-intensive). Only then do the deliverables below count towards RA.";
    section.appendChild(pmNote);

    // Deliverables revealed only when the gate is on; hours per element depend on the variation type.
    if (state.piManagementInRA) {
      const piChecks = document.createElement("div"); piChecks.className = "vcl-wl-checks"; piChecks.style.marginTop = "8px";
      PRODUCT_INFO.forEach((item) => {
        const label = document.createElement("label");
        const check = document.createElement("input"); check.type = "checkbox"; check.checked = !!state.productInfo[item.key];
        check.addEventListener("change", () => { state.productInfo[item.key] = check.checked; rerender(); });
        // Hours painted only once this deliverable is ticked; space reserved so nothing shifts.
        label.appendChild(check); label.appendChild(document.createTextNode(" " + item.label));
        appendPill(label, hoursPill(piElementHours(item.key, type)), state.productInfo[item.key]);
        piChecks.appendChild(label);
      });
      section.appendChild(piChecks);
    }

    // "Departments involved" input and its "Estimated workload" output (department timelines)
    // are temporarily removed -- to be reinstated once the departmental timing model is
    // confirmed. DEPARTMENTS / computeSchedule are kept in this file ready for that.

    const isHeading = document.createElement("h4"); isHeading.textContent = "Initial Submission Date"; isHeading.style.marginTop = "18px";
    section.appendChild(isHeading);
    const isRow = document.createElement("div"); isRow.className = "vcl-wl-row";
    const isField = document.createElement("div"); isField.className = "vcl-wl-field";
    const isInput = document.createElement("input"); isInput.type = "date"; isInput.id = "vcl-wl-planned-date"; isInput.value = state.plannedSubmissionDate;
    isInput.addEventListener("change", () => { state.plannedSubmissionDate = isInput.value; rerender(); });
    isField.appendChild(isInput); isRow.appendChild(isField);
    section.appendChild(isRow);

    container.appendChild(section);
  }

  // ------------------------------------------------------------------------------------------
  // Variation timeline: Prep -> Submission -> Validation (authorities) -> Day 0 (Start of
  // Assessment) -> Assessment 1 -> Clock-stop -> Assessment 2 -> EOP -> Closure by RA.
  // Dates run above the bar, procedure days below (Day 0 = start of assessment).
  // ------------------------------------------------------------------------------------------
  function buildTimeline(container, type) {
    const section = document.createElement("div"); section.className = "vcl-wl-section";
    section.innerHTML = `<h4>Variation timeline</h4>`;

    const a0 = timelineAssess(type);
    if (!a0) {
      const p = document.createElement("p"); p.className = "vcl-wl-note";
      p.textContent = "A Type IA is not submitted individually — it runs on the Annual Update window (first implementation date +9 to +12 months), not on a submission–assessment–closure clock. A dedicated Annual Update timeline is still to be designed.";
      section.appendChild(p); container.appendChild(section); return;
    }

    const prepDays = timelinePrep(type);
    const validationDays = timelineValidation();
    const closure = TIMING.closureDays;
    const isII = type === "II";

    // Hosts: the graphic and the legend are repainted on every clock-stop change;
    // the slider element itself is built once and kept, so dragging stays smooth
    // (rebuilding the <input> under the cursor is what made the old slider stutter).
    const graphicHost = document.createElement("div"); graphicHost.className = "vcl-wl-tl-wrap";
    const legendHost = document.createElement("div"); legendHost.className = "vcl-wl-tl-legendhost";

    let sliderLabel = null;
    const sliderHost = document.createElement("div");
    if (a0.stopMax > 0) {
      sliderHost.className = "vcl-wl-tl-slider";
      sliderLabel = document.createElement("label"); sliderLabel.setAttribute("for", "vcl-wl-clockstop");
      sliderHost.appendChild(sliderLabel);
      const input = document.createElement("input"); input.type = "range"; input.id = "vcl-wl-clockstop";
      input.min = String(a0.stopMin); input.max = String(a0.stopMax); input.step = "1"; input.value = String(a0.stop);
      let raf = 0;
      input.addEventListener("input", () => {
        const v = parseInt(input.value, 10);
        const range = a0.stopMax - a0.stopMin;
        state.clockStopFraction = range > 0 ? (v - a0.stopMin) / range : 0;
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; paint(); });
      });
      sliderHost.appendChild(input);
    }

    function paint() {
      const a = timelineAssess(type);
      const hasStop = a.stop > 0;
      // Assessment 2 only exists when the clock actually stopped (the authority raised
      // questions). With no clock-stop the procedure ends directly with the FVAR (= EOP) --
      // unlikely but possible, since authorities usually do ask. Same rule for II and IB now.
      const showA2 = a.a2 > 0 && hasStop;

      const dSub = prepDays;                       // Submission
      const dDay0 = prepDays + validationDays;      // Day 0 = Start of Assessment
      const dA1End = dDay0 + a.a1;                  // end of Assessment 1 (RSI / clock-stop point)
      const dStopEnd = dA1End + a.stop;             // clock resumes (FVAR)
      const dEop = dStopEnd + (showA2 ? a.a2 : 0);  // EOP (current slider scenario)
      const dClose = dEop + closure;
      const total = Math.max(dClose, 1);
      const pct = (d) => (d / total) * 100;
      // Guideline day-number of the outcome: II with a clock-stop runs to a1+a2; II without one
      // ends at the FVAR (a1+1); IB ends at its Decision day (a1).
      const nominalEop = isII ? (showA2 ? a.a1 + a.a2 : a.a1 + 1) : a.a1;

      // ---- Graphic ----------------------------------------------------------
      graphicHost.innerHTML = "";
      const inner = document.createElement("div"); inner.className = "vcl-wl-tl-inner";
      graphicHost.appendChild(inner);

      // Main markers: optional guideline day-number, label, then the arrow on the line.
      function mainMarker(dayPos, text, cls, dayNum) {
        const g = document.createElement("div"); g.className = "vcl-wl-tl-mlabel " + (cls || ""); g.style.left = pct(dayPos) + "%";
        const dn = dayNum != null ? `<span class="dn">d${dayNum}</span>` : "";
        g.innerHTML = `${dn}<span class="t">${escapeHtml(text)}</span><span class="a">&#9660;</span>`;
        inner.appendChild(g);
      }
      // Procedure sub-milestones (second row, lighter) — now with their day-number on top.
      function procMarker(dayPos, text, dayNum) {
        const g = document.createElement("div"); g.className = "vcl-wl-tl-pms"; g.style.left = pct(dayPos) + "%";
        const dn = dayNum != null ? `<span class="dn">d${dayNum}</span>` : "";
        g.innerHTML = `${dn}<span class="t">${escapeHtml(text)}</span><span class="a">&#9662;</span>`;
        inner.appendChild(g);
      }
      mainMarker(dSub, "Submission", "", null);
      mainMarker(dDay0, "Day 0", "mid", null);
      mainMarker(dEop, "EOP", "eop", nominalEop);
      if (isII) {
        if (a.pvar) procMarker(dDay0 + a.pvar, "PVAR", a.pvar);
        if (hasStop) {
          procMarker(dA1End, "RSI", a.a1);
          procMarker(dStopEnd, "FVAR", a.a1 + 1); // clock resumes the day after the RSI (guideline numbering excludes the stop)
        } else {
          // No questions raised: the assessment ends directly with the FVAR, which is the EOP.
          procMarker(dA1End, "FVAR", a.a1 + 1);
        }
      } else if (type === "IB" || type === "IB (unforeseen)") {
        procMarker(dA1End, "Decision", a.a1);
        if (hasStop) procMarker(dStopEnd, "New day 0"); // an IB clock-stop restarts the 30-day clock
      }

      // Date scale (above the bar).
      const sd = state.plannedSubmissionDate;
      if (sd) {
        const cands = [7, 14, 21, 30, 45, 60, 90, 180, 365];
        let interval = 365; for (let ci = 0; ci < cands.length; ci++) { if (total / cands[ci] <= 14) { interval = cands[ci]; break; } }
        const ticks = []; for (let d = 0; d <= total + 0.001; d += interval) ticks.push(Math.round(d));
        const fmtShort = (dt) => String(dt.getDate()).padStart(2, "0") + "." + String(dt.getMonth() + 1).padStart(2, "0") + ".";
        const dateScale = document.createElement("div"); dateScale.className = "vcl-wl-tl-scale vcl-wl-tl-scale--top";
        ticks.forEach((t) => {
          const tk = document.createElement("div"); tk.className = "vcl-wl-tl-tick"; tk.style.left = pct(t) + "%";
          tk.innerHTML = `<span>${fmtShort(addDays(sd, t - dSub))}</span>`;
          dateScale.appendChild(tk);
        });
        inner.appendChild(dateScale);
      }

      // Bar.
      const track = document.createElement("div"); track.className = "vcl-wl-tl-track";
      function seg(cls, startD, lenD, label) {
        if (lenD <= 0) return;
        const s = document.createElement("div"); s.className = "vcl-wl-tl-seg " + cls;
        s.style.left = pct(startD) + "%"; s.style.width = pct(lenD) + "%";
        if (label && pct(lenD) >= 7) s.innerHTML = `<span>${label}</span>`;
        track.appendChild(s);
      }
      seg("prep", 0, prepDays, "Preparation");
      seg("validation", dSub, validationDays, "Validation");
      seg("assessment", dDay0, a.a1, showA2 ? "Assessment 1" : "Assessment");
      if (hasStop) seg("assessment hatch", dA1End, a.stop, "Clock-stop");
      if (showA2) seg("assessment", dStopEnd, a.a2, "Assessment 2");
      seg("closure", dEop, closure, "Closure by RA");
      function mline(dayPos, cls) { const m = document.createElement("div"); m.className = "vcl-wl-tl-marker " + (cls || ""); m.style.left = pct(dayPos) + "%"; track.appendChild(m); }
      function pline(dayPos) { const m = document.createElement("div"); m.className = "vcl-wl-tl-pline"; m.style.left = pct(dayPos) + "%"; track.appendChild(m); }
      mline(dSub, ""); mline(dDay0, "mid"); mline(dEop, "eop");
      if (isII) { if (a.pvar) pline(dDay0 + a.pvar); pline(dA1End); if (hasStop) pline(dStopEnd); }
      else if (type === "IB" || type === "IB (unforeseen)") { pline(dA1End); if (hasStop) pline(dStopEnd); }
      inner.appendChild(track);

      // Duration arrows (below the bar) -- one per phase, labelled with its length.
      const durRow = document.createElement("div"); durRow.className = "vcl-wl-tl-durrow";
      function durArrow(startD, lenD, label) {
        if (lenD <= 0) return;
        const d = document.createElement("div"); d.className = "vcl-wl-tl-dur"; d.style.left = pct(startD) + "%"; d.style.width = pct(lenD) + "%";
        d.innerHTML = `<span>${escapeHtml(label)}</span>`;
        durRow.appendChild(d);
      }
      durArrow(0, prepDays, prepDays + " d");
      durArrow(dSub, validationDays, validationDays + " d");
      durArrow(dDay0, a.a1, a.a1 + " d");
      if (hasStop) durArrow(dA1End, a.stop, a.stop + " d");
      if (showA2) durArrow(dStopEnd, a.a2, a.a2 + " d");
      durArrow(dEop, closure, closure + " d");
      inner.appendChild(durRow);

      // ---- Slider label (element kept; only its text is refreshed) ----------
      if (sliderLabel) {
        const mo = a.stop >= 30 ? " (~" + fmtMonths(a.stop) + ")" : "";
        sliderLabel.innerHTML = `Clock-stop: <strong>${a.stop} d</strong>${mo} &nbsp;<span class="rng">range ${a.stopMin}–${a.stopMax} d</span>`;
      }

      // ---- Legend -----------------------------------------------------------
      legendHost.innerHTML = "";
      const dateAt = (d) => (sd ? fmtDate(addDays(sd, d)) : ("Day " + (d >= 0 ? "+" : "") + d));
      const eopFromDay0 = a.a1 + a.stop + (showA2 ? a.a2 : 0);
      const subToEop = validationDays + eopFromDay0; // Submission -> EOP, includes the clock-stop
      const rows = [
        ["Preparation start", dateAt(-prepDays), prepDays + " d", ""],
        ["Submission", dateAt(0), "anchor", ""],
        ["Start of Assessment (Day 0)", dateAt(validationDays), validationDays + " d validation", ""],
        ["EOP (End of Procedure)", dateAt(validationDays + eopFromDay0), "guideline day " + nominalEop, "is-eop"],
        ["Closure by RA", dateAt(validationDays + eopFromDay0 + closure), "+" + closure + " d", ""],
      ];
      const legend = document.createElement("div"); legend.className = "vcl-wl-tl-legend";
      rows.forEach((r) => {
        const row = document.createElement("div"); row.className = "vcl-wl-tl-row " + (r[3] || "");
        row.innerHTML = `<span class="n">${escapeHtml(r[0])}</span><span class="d">${escapeHtml(r[1])}</span><span class="u">${escapeHtml(r[2])}</span>`;
        legend.appendChild(row);
      });
      legendHost.appendChild(legend);

      // Total procedure length, Submission -> EOP, in days and months.
      const totalRow = document.createElement("div"); totalRow.className = "vcl-wl-tl-total";
      totalRow.innerHTML = `<span class="n">Duration · Submission &rarr; EOP</span><span class="v">${subToEop} d <span class="mo">&asymp; ${escapeHtml(fmtMonths(subToEop))}</span></span>`;
      legendHost.appendChild(totalRow);

      if (!sd) {
        const hint = document.createElement("p"); hint.className = "vcl-wl-note";
        hint.textContent = "Enter a Planned submission date above to see calendar dates above the bar.";
        legendHost.appendChild(hint);
      }
      if (a.stopMax > 0) {
        const cs = document.createElement("p"); cs.className = "vcl-wl-note";
        cs.textContent = "Drag the slider to set the clock-stop (authority pause for questions, RSI). The guideline day-numbering (EOP = day " + nominalEop + ") excludes the clock-stop; the calendar dates above include it.";
        legendHost.appendChild(cs);
      }
    }

    section.appendChild(graphicHost);
    if (sliderLabel) section.appendChild(sliderHost);
    section.appendChild(legendHost);
    paint();
    container.appendChild(section);
  }

  function buildResults(container, type) {
    // The department-level "Estimated workload" bars are temporarily removed (to be reinstated
    // once the departmental timing model is confirmed). The Annual Update window (Type IA)
    // stays as its own block.
    if (type === "IA") {
      const section = document.createElement("div"); section.className = "vcl-wl-section";
      const window_ = computeAnnualUpdateWindow(state.implementationDate);
      const summary = document.createElement("div"); summary.className = "vcl-wl-summary";
      summary.innerHTML = window_
        ? `<p><strong>Annual Update window:</strong> earliest ${window_.earliest}, latest ${window_.latest} (not an individual submission).</p>`
        : `<p>Enter an implementation date above to estimate the Annual Update window.</p>`;
      section.appendChild(summary);
      container.appendChild(section);
    }

    buildTimeline(container, type);

    const ra = computeRaHours(type);
    const hero = document.createElement("div"); hero.className = "vcl-wl-ra-hero";

    const top = document.createElement("div"); top.className = "vcl-wl-ra-top";
    top.innerHTML =
      `<div class="vcl-wl-ra-num"><span class="val">${fmtNum(ra.total)}</span><span class="unit">h</span></div>` +
      `<div class="vcl-wl-ra-headtext">` +
        `<span class="lbl">Estimated RA workload</span>` +
        `<span class="sum">${escapeHtml(raSummary(type, ra.total))}</span>` +
      `</div>`;
    hero.appendChild(top);

    const brk = document.createElement("div"); brk.className = "vcl-wl-ra-break";
    raBreakdownRows(type).forEach((r) => {
      const row = document.createElement("div"); row.className = "vcl-wl-ra-brow is-" + r.kind;
      row.innerHTML = `<span class="l">${escapeHtml(r.label)}</span><span class="v">${escapeHtml(r.val)}</span>`;
      brk.appendChild(row);
    });
    const totalRow = document.createElement("div"); totalRow.className = "vcl-wl-ra-brow is-grandtotal";
    totalRow.innerHTML = `<span class="l">Estimated total</span><span class="v">${fmtNum(ra.total)} h</span>`;
    brk.appendChild(totalRow);
    hero.appendChild(brk);

    if (submissionPending()) {
      const note = document.createElement("p"); note.className = "vcl-wl-ra-note";
      note.textContent = "Note: some submission-type factors/hours are not yet in the table — those ticked options don't change this number yet.";
      hero.appendChild(note);
    }
    container.appendChild(hero);
  }

  // ------------------------------------------------------------------------------------------
  // "How this estimate is built" -- the user-facing documentation of the factor tables.
  //
  // Every row below is generated from the same F / TIMING / ASSESS constants the calculation
  // itself reads. That is the whole point: a hand-typed copy of the tables would be a second
  // source of truth that silently drifts from the maths it claims to document (exactly the trap
  // the old vcl-workload-data.js fell into). Add a factor to F and it shows up here for free.
  // ------------------------------------------------------------------------------------------

  // rows: { label, val, active?, provisional? }
  // wide: span the whole grid instead of one ~250px column -- for tables whose values are
  // sentences rather than a single number (the assessment structure), which otherwise collide
  // with their own labels.
  function methodTable(title, rows, note, wide) {
    const wrap = document.createElement("div");
    wrap.className = "vcl-wl-mt" + (wide ? " is-wide" : "");
    const h = document.createElement("div");
    h.className = "vcl-wl-mt-title";
    h.textContent = title;
    wrap.appendChild(h);
    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "vcl-wl-mt-row" + (r.active ? " is-active" : "") + (r.provisional ? " is-prov" : "");
      // Numeric values render as the same pink pill used inline in the form; the wide
      // tables carry sentence-length values, so those stay as plain text.
      const inner = wide ? escapeHtml(String(r.val)) : '<span class="vcl-wl-hint">' + escapeHtml(String(r.val)) + "</span>";
      const val = inner + (r.provisional ? '<span class="prov">provisional</span>' : "");
      row.innerHTML = '<span class="l">' + escapeHtml(r.label) + '</span><span class="v">' + val + "</span>";
      wrap.appendChild(row);
    });
    if (note) {
      const n = document.createElement("p");
      n.className = "vcl-wl-mt-note";
      n.textContent = note;
      wrap.appendChild(n);
    }
    return wrap;
  }

  const TYPE_ORDER = ["IA", "IAIN", "IB", "IB (unforeseen)", "II"];

  // typeDisplay() spells IAIN out as "Type IA (IAIN – immediate notification)", which is a
  // caption: in a table cell it just wraps onto two lines and pushes the row out of shape.
  function methodTypeLabel(t) {
    return t === "IAIN" ? "Type IAIN" : typeDisplay(t);
  }

  function methodRaTables(type) {
    const out = [];
    const cms = state.cmsCountries.length;
    const isMrp = state.procedure === "mrpdcp";
    const large = cms > F.procedure.cmsThreshold;

    out.push(methodTable("Base hours per variation type", TYPE_ORDER.map((t) => ({
      label: methodTypeLabel(t), val: F.baseHours[t] + " h", active: t === type
    })), "The starting point, before any factor is applied."));

    out.push(methodTable("× Procedure", [
      { label: "National", val: "× " + fmtFactor(F.procedure.national), active: state.procedure === "national" },
      { label: "Centralised (CP)", val: "× " + fmtFactor(F.procedure.cp), active: state.procedure === "cp" },
      { label: "MRP/DCP, ≤ " + F.procedure.cmsThreshold + " CMS", val: "× " + fmtFactor(F.procedure.mrpdcpSmall), active: isMrp && !large },
      { label: "MRP/DCP, > " + F.procedure.cmsThreshold + " CMS", val: "× " + fmtFactor(F.procedure.mrpdcpLarge), active: isMrp && large },
    ], "MRP/DCP also adds hours per CMS on top — see the add-ons below."));

    out.push(methodTable("× Active substance", [
      { label: "Biologic", val: "× " + fmtFactor(F.activeSubstance.biologic), active: state.activeSubstance === "biologic" },
      { label: "Chemically-synthesized API", val: "× " + fmtFactor(F.activeSubstance.chemical), active: state.activeSubstance === "chemical" },
    ]));

    const s = F.submission;
    out.push(methodTable("× Submission type", [
      { label: "Worksharing", val: "× " + fmtFactor(s.worksharing.factor), active: state.procOptions.worksharing },
      { label: "Grouping", val: "× " + fmtFactor(s.grouping.factor), active: state.procOptions.grouping },
      { label: "Annual Update", val: "× " + fmtFactor(s.annualUpdate.factor), active: state.procOptions.annualUpdate },
      { label: "Super-Grouping", val: "× " + fmtFactor(s.superGrouping.factor), active: state.procOptions.superGrouping },
    ], "These multiply together when several apply at once."));

    out.push(methodTable("+ Add-ons (hours, added after the factors)", [
      { label: "Per CMS (MRP/DCP only)", val: "+ " + F.cmsHoursPer + " h each", active: isMrp && cms > 0 },
      { label: "Worksharing · per national procedure", val: "+ " + s.worksharing.perNational + " h", active: state.procOptions.worksharing && state.worksharingNational > 0 },
      { label: "Worksharing · per MRP/DCP procedure", val: "+ " + s.worksharing.perMrpdcp + " h", active: state.procOptions.worksharing && state.worksharingMrpdcp > 0 },
      { label: "Grouping · per Type IA", val: "+ " + s.grouping.perIA + " h", active: state.procOptions.grouping && state.groupingIA > 0 },
      { label: "Grouping · per Type IB", val: "+ " + s.grouping.perIB + " h", active: state.procOptions.grouping && state.groupingIB > 0 },
      { label: "Grouping · per Type II", val: "+ " + s.grouping.perII + " h", active: state.procOptions.grouping && state.groupingII > 0 },
      { label: "Annual Update · per Type IA", val: "+ " + s.annualUpdate.perIA + " h", active: state.procOptions.annualUpdate && state.annualUpdateIaCount > 0 },
      { label: "Super-Grouping · per national procedure", val: "+ " + s.superGrouping.perNational + " h", active: state.procOptions.superGrouping && state.superGroupingNational > 0 },
      { label: "Super-Grouping · per MRP/DCP procedure", val: "+ " + s.superGrouping.perMrpdcp + " h", active: state.procOptions.superGrouping && state.superGroupingMrpdcp > 0 },
      { label: "Super-Grouping · per CP procedure", val: "+ " + s.superGrouping.perCp + " h", active: state.procOptions.superGrouping && state.superGroupingCp > 0 },
    ]));

    out.push(methodTable("+ Product information · " + methodTypeLabel(type) + " (hours per element)", PRODUCT_INFO.map((it) => ({
      label: it.label, val: "+ " + fmtNum(piElementHours(it.key, type)) + " h", active: state.piManagementInRA && state.productInfo[it.key]
    })), "Only counted when “PI management in RA” is ticked — otherwise another department carries it. Hours scale with the variation type (IA/IB/II)."));

    return out;
  }

  function methodTimeTables(type) {
    const out = [];
    const cms = state.cmsCountries.length;
    const isMrp = state.procedure === "mrpdcp";
    const large = cms > F.procedure.cmsThreshold;
    const shared = state.procOptions.worksharing || state.procOptions.grouping;

    out.push(methodTable("Preparation (calendar days)", TYPE_ORDER.map((t) => ({
      label: methodTypeLabel(t),
      val: t === "IA" ? "n/a" : TIMING.prep[t] + " d",
      active: t === type,
      provisional: t === "IAIN",
    })), "Type IA has no preparation clock of its own — it rides on the Annual Update window."));

    out.push(methodTable("Validation, submission → Day 0 (calendar days)", [
      { label: "National", val: TIMING.validation.national + " d", active: state.procedure === "national" && !shared, provisional: true },
      { label: "Centralised (CP)", val: TIMING.validation.cp + " d", active: state.procedure === "cp" && !shared },
      { label: "MRP/DCP, ≤ " + F.procedure.cmsThreshold + " CMS", val: TIMING.validation.mrpdcpSmall + " d", active: isMrp && !large && !shared },
      { label: "MRP/DCP, > " + F.procedure.cmsThreshold + " CMS", val: TIMING.validation.mrpdcpLarge + " d", active: isMrp && large && !shared },
      { label: "Worksharing / Grouping", val: TIMING.validation.worksharingGrouping + " d", active: shared },
    ]));

    const assessRows = [];
    TYPE_ORDER.forEach((t) => {
      if (t === "IA") return;
      const src = t === "II" ? ASSESS.II[state.iiSubProcedure] : ASSESS[t];
      if (!src) return;
      const label = t === "II" ? "Type II · " + state.iiSubProcedure + "-day" : methodTypeLabel(t);
      assessRows.push({
        label: label,
        val: "assessment 0–" + src.a1 + (src.a2 ? " + " + src.a2 : "") + " d · clock-stop 0–" + src.stopMax + " d",
        active: t === type,
      });
    });
    out.push(methodTable("Assessment (guideline days)", assessRows,
      "Day numbering follows the CMDh Best Practice Guide and excludes the clock-stop: a procedure with a 120-day clock-stop still ends on “day 90”. The Timetables tool draws the same structure on a real calendar axis. Assessment 2 only exists when the clock actually stopped.",
      true));

    out.push(methodTable("Closure", [
      { label: "Closure by RA, after the End of Procedure", val: "+ " + TIMING.closureDays + " d", active: !!type },
    ]));

    return out;
  }

  function buildMethodology(container, type) {
    const sec = document.createElement("div");
    sec.className = "vcl-wl-method";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "vcl-wl-method-toggle" + (state.methodOpen ? " is-open" : "");
    toggle.innerHTML = '<span class="t">How this estimate is built</span><span class="s">Formula, the full factor tables, and the source workbook</span><span class="c">' + (state.methodOpen ? "&#9652;" : "&#9662;") + "</span>";
    toggle.addEventListener("click", () => { state.methodOpen = !state.methodOpen; rerender(); });
    sec.appendChild(toggle);

    if (state.methodOpen) {
      const body = document.createElement("div");
      body.className = "vcl-wl-method-body";

      const intro = document.createElement("p");
      intro.className = "vcl-wl-method-intro";
      intro.innerHTML = "Every number this tool shows comes from the tables below. Pick a variation and describe the procedure above, and the rows that apply to your case are <strong>highlighted</strong> — the rest show you what would change if you answered differently.";
      body.appendChild(intro);

      const formula = document.createElement("div");
      formula.className = "vcl-wl-method-formula";
      formula.innerHTML =
        '<div class="lbl">RA hours</div>' +
        '<div class="fx"><span class="b">Base[type]</span> × <span class="m">Active substance</span> × <span class="m">Procedure</span> × <span class="m">∏ Submission factors</span>' +
        '<br><span class="op">+</span> <span class="a">CMS × ' + F.cmsHoursPer + ' h</span> <span class="op">+</span> <span class="a">Σ grouped items</span> <span class="op">+</span> <span class="a">Σ Product information</span></div>' +
        '<div class="hint">Factors multiply the base first; the add-ons are added to that subtotal afterwards.</div>';
      body.appendChild(formula);

      const h1 = document.createElement("h5");
      h1.className = "vcl-wl-method-h";
      h1.textContent = "RA hours";
      body.appendChild(h1);
      const g1 = document.createElement("div");
      g1.className = "vcl-wl-method-grid";
      methodRaTables(type).forEach((t) => g1.appendChild(t));
      body.appendChild(g1);

      const h2 = document.createElement("h5");
      h2.className = "vcl-wl-method-h";
      h2.textContent = "Timeline (calendar days)";
      body.appendChild(h2);
      const g2 = document.createElement("div");
      g2.className = "vcl-wl-method-grid";
      methodTimeTables(type).forEach((t) => g2.appendChild(t));
      body.appendChild(g2);

      const src = document.createElement("div");
      src.className = "vcl-wl-method-src";
      const excelUrl = (window.VCL_CONFIG && window.VCL_CONFIG.workloadExcelUrl) || "";
      src.innerHTML =
        "<p><strong>Source:</strong> " + escapeHtml(F_META.workbook) + " — sheets “Faktoren” (hours and factors) and “Zeiten” (calendar days). " +
        "The figures above are transcribed from that workbook into the tool; they were last checked against it on <strong>" + escapeHtml(F_META.lastChecked) + "</strong>.</p>" +
        "<p>Rows marked <em>provisional</em> are working assumptions that have not been confirmed yet.</p>";
      if (excelUrl) {
        const a = document.createElement("a");
        a.className = "vcl-wl-method-dl";
        a.href = excelUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.innerHTML = "&#8681; Download the workbook (Excel)";
        src.appendChild(a);
      }

      // Right where someone would notice a figure is off -- the link carries the tool name in
      // its subject so the reply doesn't have to start with "which page were you on?".
      const contact = window.VCL_CONTACT && window.VCL_CONTACT.link("Tell me", "Workload Planning");
      if (contact) {
        const ask = document.createElement("p");
        ask.className = "vcl-wl-method-ask";
        ask.textContent = "A number here look wrong, or is something missing? ";
        ask.appendChild(contact);
        src.appendChild(ask);
      }
      body.appendChild(src);
      sec.appendChild(body);
    }

    container.appendChild(sec);
  }

  // ---- Pure helpers shared with the Guided Workflow (window.VCL_WORKFLOW) --------------------
  // Both reuse this tool's factor/timing tables (F / TIMING / ASSESS) but take explicit inputs
  // instead of this tool's own state, so the workflow reuses the same numbers -- one source.

  // Timeline schedule in calendar days from the submission (day 0 of the drawing = preparation
  // start). opts: { type, iiSub, procedure, cmsCount, shared, clockStopFraction }.
  function computeSchedule(opts) {
    const o = opts || {};
    const src = o.type === "II" ? ASSESS.II[o.iiSub || "60"] : ASSESS[o.type];
    if (!src) return null; // Type IA -> Annual Update window, no individual clock
    const range = src.stopMax - src.stopMin;
    const frac = (o.clockStopFraction == null) ? 1 : o.clockStopFraction;
    const stop = src.stopMax > 0 ? Math.round(src.stopMin + frac * range) : 0;
    const prep = (o.type === "II") ? TIMING.prep.II : (TIMING.prep[o.type] != null ? TIMING.prep[o.type] : 7);
    let validation;
    if (o.shared) validation = TIMING.validation.worksharingGrouping;
    else if (o.procedure === "mrpdcp") validation = (o.cmsCount || 0) > 10 ? TIMING.validation.mrpdcpLarge : TIMING.validation.mrpdcpSmall;
    else if (o.procedure === "cp") validation = TIMING.validation.cp;
    else validation = TIMING.validation.national;
    const showA2 = src.a2 > 0 && stop > 0;
    const dSub = prep;
    const dDay0 = prep + validation;
    const dA1End = dDay0 + src.a1;
    const dStopEnd = dA1End + stop;
    const dEop = dStopEnd + (showA2 ? src.a2 : 0);
    const dClose = dEop + TIMING.closureDays;
    return {
      prepDays: prep, validationDays: validation, a1: src.a1, a2: src.a2, stop: stop, showA2: showA2,
      pvar: src.pvar || 0, closureDays: TIMING.closureDays, stopMin: src.stopMin, stopMax: src.stopMax,
      dPrepStart: 0, dSub: dSub, dDay0: dDay0, dA1End: dA1End, dStopEnd: dStopEnd, dEop: dEop, dClose: dClose,
      subToEop: dEop - dSub, totalDays: dClose,
    };
  }

  // RA preparation hours for one (primary) procedure, mirroring computeRaHours() but from
  // explicit inputs. opts: { type, substance, procedure, cmsCount, grouping, worksharing,
  // annualUpdate, superGrouping, groupingCounts:{IA,IB,II}, worksharingProcs:{national,mrpdcp},
  // superGroupingProcs:{national,mrpdcp,cp}, annualUpdateIaCount,
  // piInRA, productInfo:{smpc,leaflet,labelling,mockups}, piType }. The per-item add-hours sum and
  // the PI hours are delegated to the shared pure module so this API and the tool's own view never
  // diverge. PI defaults to nothing when piInRA is falsy, so existing callers are unaffected.
  function raHoursFor(opts) {
    const o = opts || {};
    const base = F.baseHours[o.type] || 0;
    let pf = F.procedure.national;
    if (o.procedure === "mrpdcp") pf = (o.cmsCount || 0) > F.procedure.cmsThreshold ? F.procedure.mrpdcpLarge : F.procedure.mrpdcpSmall;
    else if (o.procedure === "cp") pf = F.procedure.cp;
    const af = o.substance === "biologic" ? F.activeSubstance.biologic : (o.substance === "chemical" ? F.activeSubstance.chemical : 1);
    let sf = 1;
    if (o.grouping) sf *= F.submission.grouping.factor;
    if (o.worksharing) sf *= F.submission.worksharing.factor;
    if (o.annualUpdate) sf *= F.submission.annualUpdate.factor;
    if (o.superGrouping) sf *= F.submission.superGrouping.factor;
    const gc = o.groupingCounts || {};
    const wp = o.worksharingProcs || {};
    const sp = o.superGroupingProcs || {};
    const procOptions = { worksharing: o.worksharing, grouping: o.grouping, annualUpdate: o.annualUpdate, superGrouping: o.superGrouping };
    const counts = {
      worksharingNational: wp.national || 0, worksharingMrpdcp: wp.mrpdcp || 0,
      groupingIA: gc.IA || 0, groupingIB: gc.IB || 0, groupingII: gc.II || 0,
      annualUpdateIaCount: o.annualUpdateIaCount || 0,
      superGroupingNational: sp.national || 0, superGroupingMrpdcp: sp.mrpdcp || 0, superGroupingCp: sp.cp || 0,
    };
    let add = WLH.computeSubmissionAddHours(procOptions, counts, F.submission);
    if (o.procedure === "mrpdcp") add += (F.cmsHoursPer || 0) * (o.cmsCount || 0);
    const pi = WLH.computePiAddHours(o.piInRA, o.productInfo, o.piType || o.type, F.productInfo);
    return base * (pf * af * sf) + add + pi;
  }

  window.VCL_WORKLOAD = {
    render: function (container) { if (!container) return; mountedContainer = container; rerender(); },
    schedule: computeSchedule,
    raHours: raHoursFor,
    // Read-only views of the factor table and its provenance, so the Guided Workflow can render its
    // "How the RA hours are calculated" box from the same numbers (single source). Treat as read-only.
    factors: F,
    factorsMeta: F_META,
  };
})();
