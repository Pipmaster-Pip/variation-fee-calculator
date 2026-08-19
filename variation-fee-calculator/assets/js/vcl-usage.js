// Anonymous usage-counter client for the Variation Toolbox. Fires at most one POST
// per tool+event per page load (in-memory dedup); every failure is swallowed so
// counting can never disturb the tool. No IP, no timestamp -- see
// includes/usage-counter.php for the endpoint and the GDPR rationale.
(function (root) {
  "use strict";

  var counted = Object.create(null); // "tool:event" -> true, for this page load only

  function track(tool, event) {
    var key = tool + ":" + event;
    if (counted[key]) return;

    // Read config + fetch fresh on every call: an early call before VCL_CONFIG is
    // set must not permanently mark the key as done.
    var cfg = root.VCL_CONFIG || {};
    var url = cfg.countUrl;
    if (!url || typeof root.fetch !== "function") return;

    counted[key] = true; // mark only once we actually attempt the request
    try {
      root.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool, event: event }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {
      /* never let counting throw into the caller */
    }
  }

  var api = { track: track };
  root.VCL_USAGE = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
