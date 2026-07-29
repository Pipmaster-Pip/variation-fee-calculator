// Pure Super-Grouping / Annual Update rules. No DOM, no window state.
// Dual-mode: attaches to window.VCL_SG_LOGIC in the browser and exports via
// module.exports in Node so it can be unit-tested without a browser.
(function (root) {
  'use strict';

  // Every variation in play is Type IA (base + grouped extras). Empty -> false.
  function computeAllVariationsAreIA(baseType, groupingTypes) {
    var types = [baseType].concat(groupingTypes || []).filter(function (t) { return !!t; });
    if (types.length === 0) return false;
    return types.every(function (t) { return t === 'IA'; });
  }

  // Implementation date + 12 calendar months. '' -> null. Month-end is clamped
  // (e.g. 2028-02-29 -> 2029-02-28) so the day never rolls into the next month.
  function computeAnnualUpdateDeadline(isoDateStr) {
    if (!isoDateStr) return null;
    var parts = String(isoDateStr).split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d) return null;
    var target = new Date(y + 1, m - 1, d);
    if (target.getMonth() !== (m - 1)) target = new Date(y + 1, m, 0); // clamp to last day of intended month
    return target;
  }

  // Sorted unique RMS codes across the MRP/DCP procedures.
  function computeDistinctRms(procedures) {
    var set = {};
    (procedures || []).forEach(function (p) {
      if (p && p.kind === 'mrpdcp' && p.rms) set[p.rms] = true;
    });
    return Object.keys(set).sort();
  }

  // Chapter-C multi-RMS conflicts: only when >= 2 distinct RMS AND >= 1 chapter-C
  // variation. Returns one entry per offending chapter-C variation.
  function computeSuperGroupingConflicts(variations, procedures) {
    var rms = computeDistinctRms(procedures);
    if (rms.length < 2) return [];
    return (variations || [])
      .filter(function (v) { return v && v.chapter === 'C'; })
      .map(function (v) { return { code: (v.code || null), title: (v.title || ''), chapter: 'C', rmsList: rms }; });
  }

  var api = {
    computeAllVariationsAreIA: computeAllVariationsAreIA,
    computeAnnualUpdateDeadline: computeAnnualUpdateDeadline,
    computeDistinctRms: computeDistinctRms,
    computeSuperGroupingConflicts: computeSuperGroupingConflicts
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VCL_SG_LOGIC = api;
})(typeof window !== 'undefined' ? window : null);
