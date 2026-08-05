// Pure variation-timeline engine. No DOM, no window state.
// Dual-mode: attaches to window.VCL_TIMELINE in the browser and exports via module.exports
// in Node so it can be unit-tested without a browser. Extracted verbatim from vcl-workload.js
// (the standalone Workload Planning tool) so the Guided Workflow's Date & Timeline station keeps
// its exact output after that tool is removed.
(function (root) {
  "use strict";

  const TIMING = {
    prep: { IAIN: 7, IB: 7, "IB (unforeseen)": 14, II: 14 }, // fixed RA prep (IA = n.a., Annual Update)
    validation: { national: 14, cp: 7, mrpdcpSmall: 21, mrpdcpLarge: 28, worksharingGrouping: 28 }, // national provisional; cp 1 week (EMA only)
    closureDays: 7, // Closure by RA = EOP + 1 calendar week
  };
  // Assessment structure from the Timetables view: a1 = active days to the RSI/clock-stop point,
  // a2 = active days from resume to EOP, pvar = day the RMS circulates the PVAR,
  // stopMin..stopMax = clock-stop range (real days). Nominal EOP = a1 + a2 (II) or a1 (IB).
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

  var api = { schedule: computeSchedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_TIMELINE = api;
})(typeof window !== "undefined" ? window : null);
