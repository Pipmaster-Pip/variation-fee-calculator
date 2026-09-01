'use strict';
/**
 * Pure helpers for the public fee-data page. No DOM, no globals of its own, so
 * it can be unit-tested with node --test like vcl-sg-logic.js. Everything that
 * needs the fee engine goes through window.VCLCALC instead of living here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.VCL_FEEDATA = api; }
}(typeof window !== 'undefined' ? window : null, function () {

  var ROLE_ORDER = ['RMS', 'CMS', 'national'];

  /** The metadata strip above a country's tables: dates, source, authority,
   *  payment method. Overrides win over the shipped HA_WEBSITES entry, but only
   *  for the two fields the editor actually maintains. */
  function countryMeta(cc, haEntries, ccToCurrency, overrides) {
    var entry = null;
    for (var i = 0; i < (haEntries || []).length; i++) {
      if (haEntries[i].cc === cc) { entry = haEntries[i]; break; }
    }
    var ov = (overrides && overrides.countries && overrides.countries[cc]) || {};
    return {
      cc: cc,
      currency: (ccToCurrency && ccToCurrency[cc]) || null,
      checked: ov.checked || (entry && entry.checked_ha) || '',
      edited: ov.updated || (entry && entry.updated_calc) || '',
      source: ov.source || (entry && entry.comments) || '',
      linkText: (entry && entry.link_text) || '',
      linkUrl: (entry && entry.link_url) || '',
      payment: (entry && entry.payment) || ''
    };
  }

  /** The euro amounts are derived from the local ones, so the rate can be read
   *  back off any row that carries both. Five decimals is what the source data
   *  actually resolves to (Denmark: 7.47454 across every row). */
  function deriveRate(rows) {
    var pairs = [['F', 'F_lc'], ['K', 'K_lc'], ['H', 'H_lc'], ['I', 'I_lc'], ['J', 'J_lc']];
    for (var i = 0; i < (rows || []).length; i++) {
      for (var p = 0; p < pairs.length; p++) {
        var eur = rows[i][pairs[p][0]], lc = rows[i][pairs[p][1]];
        if (typeof eur === 'number' && eur > 0 && typeof lc === 'number' && lc > 0) {
          return Math.round((lc / eur) * 100000) / 100000;
        }
      }
    }
    return null;
  }

  /** One section per procedure role, in the order the calculator uses. */
  function groupByRole(rows) {
    var byRole = {};
    (rows || []).forEach(function (r) {
      if (!byRole[r.role]) { byRole[r.role] = []; }
      byRole[r.role].push(r);
    });
    var known = ROLE_ORDER.filter(function (r) { return byRole[r]; });
    var extra = Object.keys(byRole).filter(function (r) {
      return ROLE_ORDER.indexOf(r) === -1;
    }).sort();
    return known.concat(extra).map(function (role) {
      return { role: role, rows: byRole[role] };
    });
  }

  /** The country chips: only countries that actually have fee rows, with the
   *  number of rows behind the name — same rule as the fee editor's picker. */
  function chipList(countryNames, rows) {
    var counts = {};
    (rows || []).forEach(function (r) { counts[r.cc] = (counts[r.cc] || 0) + 1; });
    return Object.keys(countryNames)
      .filter(function (cc) { return counts[cc] > 0; })
      .map(function (cc) { return { cc: cc, name: countryNames[cc], n: counts[cc] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'en'); });
  }

  return {
    countryMeta: countryMeta,
    deriveRate: deriveRate,
    groupByRole: groupByRole,
    chipList: chipList
  };
}));
