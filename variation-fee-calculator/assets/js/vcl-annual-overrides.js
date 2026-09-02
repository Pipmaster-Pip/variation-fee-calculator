// Lays the amounts typed in the fee editor over the shipped annual-fee data.
//
// Same discipline as applyOverrides() in vcl-calc-app.js: a snapshot of the
// shipped amounts is taken once, every run resets to it and re-applies the
// overlay, so running this twice gives the same result as running it once. The
// editor's live preview relies on that.
//
// Only `base` and `addStrength` are overridable, and `addStrength` only where the
// shipped tariff actually scales with the number of strengths -- a tariff with
// `addStrength: null` does not, and turning that into a number would change the
// structure rather than an amount. Labels, roles, currency and the set of tariffs
// themselves stay with the generated data file.
(function (root) {
  "use strict";

  var SHIPPED = null;

  function data() {
    return (root && root.VCL_ANNUAL_DATA) || null;
  }

  function takeSnapshot() {
    var out = {};
    var d = data();
    if (!d || !Array.isArray(d.COUNTRIES)) return out;
    d.COUNTRIES.forEach(function (c) {
      var byId = {};
      (c.tariffs || []).forEach(function (t) {
        byId[t.id] = { base: t.base, addStrength: t.addStrength };
      });
      out[c.cc] = byId;
    });
    return out;
  }

  function shipped() {
    if (!SHIPPED) SHIPPED = takeSnapshot();
    return SHIPPED;
  }

  function usable(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
  }

  function apply() {
    var d = data();
    if (!d || !Array.isArray(d.COUNTRIES)) return 0;

    var base = shipped();
    var ov = (root.VCLCALC_OVERRIDES && root.VCLCALC_OVERRIDES.annual) || {};
    var applied = 0;

    d.COUNTRIES.forEach(function (c) {
      var shippedTariffs = base[c.cc] || {};
      var edits = ov[c.cc] || {};
      (c.tariffs || []).forEach(function (t) {
        var was = shippedTariffs[t.id] || {};
        // Start from the shipped state every time, so this is idempotent.
        t.base = was.base;
        t.addStrength = was.addStrength;

        var e = edits[t.id];
        if (!e || typeof e !== "object") return;
        if (usable(e.base)) { t.base = e.base; applied++; }
        if (was.addStrength !== null && usable(e.addStrength)) {
          t.addStrength = e.addStrength;
          applied++;
        }
      });
    });

    return applied;
  }

  var api = { apply: apply, shipped: shipped };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_ANNUAL_OVERRIDES = api;

  // Applies whatever PHP printed before this file ran, so a page that only
  // includes the scripts already sees the live amounts.
  apply();
})(typeof window !== "undefined" ? window : this);
