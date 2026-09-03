// The "RA tasks" station, rendered once and used by BOTH the Guided Workflow (Station C) and the
// Budget line editor, so the two can never drift apart. Pure DOM + callbacks: it mutates the
// raTasks object it is handed and calls ctx.onChange(); it never reads global state and never
// computes hours itself (the bands come in via ctx.blocks, from VCL_SUBMISSION.computeSubmissionHours).
// Colours come from the host tool through --vcl-rat-accent* (see vcl-ra-tasks.css).
// See docs/superpowers/specs/2026-09-03-editable-ra-hours-design.md.
(function (root) {
  "use strict";

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Whole-hours-ish band: keeps half hours, drops a trailing ".0" (the workbook has 0.5 steps).
  function num(n) { return (Math.round(n * 10) / 10).toString().replace(/\.0$/, ""); }
  function bandHtml(b) { return num(b.min) + ' <span class="vcl-rat-dash">–</span> ' + num(b.max) + " h"; }

  var BLOCKS = [
    { key: "core", name: "RA preparation", always: true, tag: "always included" },
    { key: "cmc", name: "CMC dossier written in RA", gate: "cmc",
      onHint: "The dossier effort depends on the active substance:",
      offHint: "Off: a separate CMC / quality unit writes the dossier — it adds no RA hours." },
    { key: "pi", name: "Product information", gate: "pi",
      onHint: "Which documents does this change touch?",
      offHint: "Off: another department prepares the product information — it adds no RA hours." },
    { key: "compilation", name: "Compilation & submission", gate: "compilation",
      onHint: "Dossier compilation (docuBridge / Veeva), internal checks and CESP submission are done in RA.",
      offHint: "Off: dossier compilation and submission are handled elsewhere — they add no RA hours." },
  ];

  // Which blocks currently show their stepper. Keyed by block key; a block whose adjustment is
  // non-zero is always expanded, so this only tracks the "opened but still at 0" case. Module-level
  // (not per render) so the row survives the host tool's rerender on every click.
  var expanded = {};

  function adjustOf(raTasks, key) {
    var a = raTasks.hourAdjust || (raTasks.hourAdjust = { core: 0, cmc: 0, pi: 0, compilation: 0 });
    return a[key] || 0;
  }
  function setAdjust(raTasks, key, value) {
    if (!raTasks.hourAdjust) raTasks.hourAdjust = { core: 0, cmc: 0, pi: 0, compilation: 0 };
    raTasks.hourAdjust[key] = value;
  }

  function toggle(isOn, label, onClick) {
    var b = el("button", "vcl-rat-toggle" + (isOn ? " is-on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", isOn ? "true" : "false");
    b.setAttribute("aria-label", label);
    b.innerHTML = '<span class="vcl-rat-toggle__track"><span class="vcl-rat-toggle__thumb"></span></span>';
    b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  function chips(options, isOn, onPick) {
    var wrap = el("div", "vcl-rat-chips");
    options.forEach(function (o) {
      var c = el("button", "vcl-rat-chip" + (isOn(o.k) ? " is-on" : ""), esc(o.l));
      c.type = "button";
      c.addEventListener("click", function () { onPick(o.k); });
      wrap.appendChild(c);
    });
    return wrap;
  }

  // "Own adjustment  [−] ± 0 h [+]" plus, once non-zero, the untouched benchmark beside it.
  function adjustRow(ctx, block, base) {
    var raTasks = ctx.raTasks;
    var d = adjustOf(raTasks, block.key);
    var row = el("div", "vcl-rat-adj");
    row.appendChild(el("span", "vcl-rat-adj__label", "Own adjustment"));

    var st = el("span", "vcl-rat-stepper");
    // The lowest delta that still leaves the block at 0 h or more; mirrors the engine's clamp.
    var minDelta = base ? -base.min + d : -Infinity;

    var minus = el("button", null, "&minus;");
    minus.type = "button";
    minus.setAttribute("aria-label", "Decrease " + block.name + " by one hour");
    minus.disabled = base ? (d <= minDelta) : false;
    minus.addEventListener("click", function () {
      setAdjust(raTasks, block.key, d - 1);
      ctx.onChange();
    });

    var val = el("span", "vcl-rat-stepper__val" + (d === 0 ? " is-zero" : ""),
      d === 0 ? "&pm; 0 h" : (d > 0 ? "+ " : "&minus; ") + Math.abs(d) + " h");

    var plus = el("button", null, "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "Increase " + block.name + " by one hour");
    plus.addEventListener("click", function () {
      setAdjust(raTasks, block.key, d + 1);
      ctx.onChange();
    });

    st.appendChild(minus); st.appendChild(val); st.appendChild(plus);
    row.appendChild(st);

    if (d !== 0 && base) {
      row.appendChild(el("span", "vcl-rat-adj__base",
        "Benchmark " + num(base.min - d) + " – " + num(base.max - d) + " h"));
    }
    return row;
  }

  function adjustLink(ctx, block) {
    var row = el("div", "vcl-rat-adj");
    var b = el("button", "vcl-rat-link", "Adjust these hours");
    b.type = "button";
    b.addEventListener("click", function () { expanded[block.key] = true; ctx.onChange(); });
    row.appendChild(b);
    return row;
  }

  function render(host, ctx) {
    host.innerHTML = "";
    var rt = ctx.raTasks;
    var wrap = el("div", "vcl-rat" + (ctx.compact ? " is-compact" : ""));

    BLOCKS.forEach(function (block) {
      var on = block.always ? true : !!rt[block.gate];
      var base = (ctx.blocks && ctx.blocks[block.key]) || null;
      var card = el("div", "vcl-rat-block" + (block.always ? " is-core" : "") + (on ? "" : " is-off"));

      var top = el("div", "vcl-rat-block__top");
      var id = el("div", "vcl-rat-block__id");
      if (!block.always) {
        id.appendChild(toggle(on, block.name, function () { rt[block.gate] = !rt[block.gate]; ctx.onChange(); }));
      }
      id.appendChild(el("span", "vcl-rat-block__name", esc(block.name)));
      if (block.tag) id.appendChild(el("span", "vcl-rat-tag", esc(block.tag)));
      top.appendChild(id);
      top.appendChild(el("span", "vcl-rat-hrs" + (on && base ? "" : " is-none"),
        on ? (base ? bandHtml(base) : "—") : "not in RA"));
      card.appendChild(top);

      if (block.always) {
        card.appendChild(el("p", "vcl-rat-hint", "Based on your variations &amp; procedures — including any grouping, worksharing or super-grouping."));
      } else {
        card.appendChild(el("p", "vcl-rat-hint", on ? esc(block.onHint) : esc(block.offHint)));
      }

      if (on && block.key === "cmc") {
        card.appendChild(chips(
          [{ k: "biologic", l: "Biologic" }, { k: "chemical", l: "Chemically-synthesized API" }],
          function (k) { return rt.activeSubstance === k; },
          function (k) { rt.activeSubstance = k; ctx.onChange(); }));
        if (!rt.activeSubstance) {
          card.appendChild(el("p", "vcl-rat-hint", "Pick the active substance to include the CMC dossier hours."));
        }
      }
      if (on && block.key === "pi") {
        // piDocs keys MUST match the workload engine's PI filter (smpc / leaflet / labelling /
        // mockups), consumed via sub.raTasks.piDocs in vcl-submission.js.
        card.appendChild(chips(
          [{ k: "smpc", l: "SmPC" }, { k: "leaflet", l: "Package leaflet" },
           { k: "labelling", l: "Labelling" }, { k: "mockups", l: "Mock-ups" }],
          function (k) { return !!(rt.piDocs && rt.piDocs[k]); },
          function (k) {
            if (!rt.piDocs) rt.piDocs = {};
            rt.piDocs[k] = !rt.piDocs[k];
            ctx.onChange();
          }));
      }

      if (on) {
        var d = adjustOf(rt, block.key);
        if (d === 0 && !expanded[block.key]) card.appendChild(adjustLink(ctx, block));
        else card.appendChild(adjustRow(ctx, block, base));
      }

      wrap.appendChild(card);
    });

    host.appendChild(wrap);
  }

  var api = { render: render };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_RA_TASKS = api;
})(typeof window !== "undefined" ? window : null);
