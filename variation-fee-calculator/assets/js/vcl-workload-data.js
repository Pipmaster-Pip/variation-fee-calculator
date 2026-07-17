// Workload Planning -- department task durations + Annual Update config, wrapped for WordPress
// plugin use. Exposes window.VCL_WORKLOAD_DATA so it cannot collide with vcl-data.js's
// window.VCL_DATA or the sibling Fee Calculator plugin's own data/scripts.
//
// =============================================================================================
// SCOPE -- read before adding anything here.
//
// This file holds ONLY the numbers that vcl-workload.js reads from it: `meta`, `annualUpdate`
// and `taskDurationDays`. It is deliberately NOT the home of the RA-hours factors, the timeline
// day counts, or the department list -- those live in vcl-workload.js (`F`, `TIMING`, `ASSESS`,
// `DEPARTMENTS`), transcribed from Workload_RA_Stunden_Faktoren.xlsx, and are surfaced to users
// by the "How this estimate is built" panel.
//
// This file used to carry a second, older copy of some of those (raHoursByType, and a set of
// validationPhaseDays/procedureClockDays) which disagreed with the live values -- RA base hours
// of 3/6/12 against the real 10/12/15, national validation of 0 d against the real 14 d. Nothing
// read them, so the tool was right and the file was wrong, but anyone reading the source got a
// contradiction. They are gone. Keep exactly one home per number: if a value belongs to the
// factor table, it goes in vcl-workload.js next to the rest of the table -- not here.
//
// The department task durations below ARE still placeholders: none of them has been confirmed
// against real departmental timings. They currently feed only computeSchedule(), which is
// dormant while the "Estimated workload" department bars are out of the UI.
// =============================================================================================
(function () {
  "use strict";

  const meta = {
    lastUpdated: "2026-07-13",
    disclaimer:
      "Workload Planning is a first working draft. All preparation durations and effort estimates below are placeholder values, not yet confirmed against real departmental timings -- treat every number here as illustrative only.",
  };

  // Placeholder working-day durations per department, keyed by the variant "type" strings already
  // used in vcl-data.js's ENTRIES[].variants[].type ("IA", "IAIN", "IB", "IB (unforeseen)", "II").
  // Read by computeSchedule() only -- see the scope note above.
  const taskDurationDays = {
    cmc: { IA: 5, IAIN: 3, IB: 8, "IB (unforeseen)": 8, II: 15 },
    pv: { IA: 3, IAIN: 2, IB: 5, "IB (unforeseen)": 5, II: 10 },
    labelling: { IA: 5, IAIN: 5, IB: 7, "IB (unforeseen)": 7, II: 10 },
    translations: { IA: 5, IAIN: 5, IB: 6, "IB (unforeseen)": 6, II: 8 },
    ra: { IA: 2, IAIN: 1, IB: 3, "IB (unforeseen)": 3, II: 5 },
    docmgmt: { IA: 1, IAIN: 1, IB: 1, "IB (unforeseen)": 1, II: 2 },
  };

  // Type IA changes are normally not filed individually but bundled into the next Annual Update,
  // submitted earliest 9 and latest 12 months after the change was first implemented.
  const annualUpdate = {
    earliestMonths: 9,
    latestMonths: 12,
  };

  window.VCL_WORKLOAD_DATA = {
    meta,
    taskDurationDays,
    annualUpdate,
  };
})();
