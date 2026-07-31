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

  var api = {
    computeSubmissionAddHours: computeSubmissionAddHours,
    computeSgCounterKinds: computeSgCounterKinds
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VCL_WORKLOAD_HOURS = api;
})(typeof window !== 'undefined' ? window : null);
