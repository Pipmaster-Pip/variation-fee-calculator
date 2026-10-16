// Shared "Variations + Procedures" editor, extracted verbatim from the Budget tool's modal wizard
// (vcl-budget.js renderStationA / renderStationB and their helpers) so Budget Planning AND the Fee
// Calculator's Worksharing/Super-Grouping flow render the SAME Guided-Workflow-exact input and can
// never drift. See docs/superpowers/specs/2026-10-15-vfc-worksharing-supergrouping-design.md.
//
// The markup is byte-identical to Budget's when created with prefix "vcl-bud" -- every class that
// was "vcl-bud-*" is now `prefix + "-*"`, while shared/literal classes (vcl-rat-stepper, the
// is-on/is-zero/is-disabled state classes) are kept exactly. A second caller passes its own prefix
// (e.g. "vclws") and themes those classes with its own stylesheet.
//
// No pricing logic lives here: the editor only mutates the Submission draft and asks the host to
// repaint. mode/lead normalisation delegates to VCL_SUBMISSION + VCL_SG_LOGIC (the shared engines).
//
// Dual-mode export like the other modules (browser global + Node require, though it is DOM-coupled
// and only exercised in the browser harnesses).
(function (root) {
  "use strict";

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function typeBucketClass(type) {
    var t = String(type || "");
    if (t.indexOf("IA") === 0) return "ia";
    if (t.indexOf("IB") === 0) return "ib";
    if (t.indexOf("II") === 0) return "ii";
    return "";
  }

  var NON_EU_PROCEDURE_COUNTRIES = ["CH", "RS", "UK"];

  // cfg: { prefix, getSub, engines, onChange, onFullRerender }
  //   prefix          -- class-name prefix for this instance ("vcl-bud" | "vclws" | ...)
  //   getSub()        -- returns the Submission draft being edited (mutated in place)
  //   engines()       -- returns the shared engines bundle (computeFees, sgLogic, ...)
  //   onChange()      -- targeted repaint (Budget: refreshEditor) -- used by the Procedures station
  //   onFullRerender()-- full repaint (Budget: rerender) -- used by the focus-sensitive Variations
  //                      station (its search <input> is rebuilt only via populateSearchResults).
  function create(cfg) {
    var P = cfg.prefix;
    var getSub = cfg.getSub;
    var engines = cfg.engines;
    var onChange = cfg.onChange || function () {};
    var onFullRerender = cfg.onFullRerender || function () {};
    // autoMode: the Fee Calculator's WS/SG flow sets this. The submission-type chips are hidden and
    // the mode is derived from the variation mix instead (all-IA -> Super-Grouping, else Worksharing);
    // the Procedures heading names the derived mode. Budget leaves it off and keeps the chips.
    var autoMode = !!cfg.autoMode;
    // WS/SG redesign flags (2026-10-16), set ONLY by the Fee Calculator's WS flow so Budget's
    // markup is byte-identical. leadFirst: render the lead select at the very top. boxFirstProcedure:
    // render procedure 0 in the same boxed card as the additional ones. cmsSelectAll: a Select all /
    // Reset toggle after the CMS grid.
    var leadFirst = !!cfg.leadFirst;
    var boxFirstProcedure = !!cfg.boxFirstProcedure;
    var cmsSelectAll = !!cfg.cmsSelectAll;

    var SUB = root.VCL_SUBMISSION;
    var DATA = root.VCL_DATA || {};
    var ENTRIES = DATA.ENTRIES || [];
    var BUDENG = root.VCL_BUDGET_ENGINE || {};

    // Per-instance search state (was modalState.query / modalState.searchResults in Budget).
    var inst = { query: "", searchResults: [] };

    function resetSearch() { inst.query = ""; inst.searchResults = []; }

    function countriesByRole(role) {
      var all = (root.VCLCALC && root.VCLCALC.countries) ? root.VCLCALC.countries() : [];
      return all.filter(function (c) { return c.roles.indexOf(role) !== -1; });
    }

    // ---- Guideline code fragments and names (shared with the Guided Workflow via vcl-data.js) ----
    function variantPrefix(v, underGroup) { return DATA.variantPrefix ? DATA.variantPrefix(v, underGroup) : ""; }
    function variantFullName(entry, v) { return DATA.variantFullName ? DATA.variantFullName(entry, v) : (entry && entry.title) || ""; }
    function fullCodeOf(code, variantId) { return DATA.variantFullCode ? DATA.variantFullCode(code, variantId) : code; }
    function findVariantById(entry, variantId) {
      if (!entry || !entry.variants || !entry.variants.length) return null;
      if (entry.variants.length === 1) return entry.variants[0];
      return entry.variants.find(function (v) { return v.id === variantId; }) || null;
    }
    // One entry's variants, with the Guideline's group headings and the bracketed code fragment
    // in front of each wording. Used by both variant lists in this editor.
    function appendVariantOptions(host, entry, onPick) {
      var lastGroup = null;
      (entry && entry.variants ? entry.variants : []).forEach(function (v) {
        if (v.group !== lastGroup) {
          if (v.group) host.appendChild(el("div", P + "-vgroup", escapeHtml(v.group)));
          lastGroup = v.group;
        }
        var pre = variantPrefix(v, !!v.group);
        var row = el("div", P + "-variant");
        row.innerHTML = '<span class="' + P + '-variant__label">'
          + (pre ? '<span class="' + P + '-vpre">' + escapeHtml(pre) + "</span>" : "")
          + escapeHtml(v.label || (entry && entry.title) || v.type) + "</span> "
          + '<span class="' + P + '-type-badge ' + P + '-type-badge--' + typeBucketClass(v.type) + '">' + escapeHtml(v.type) + "</span>";
        row.addEventListener("click", function () { onPick(v); });
        host.appendChild(row);
      });
    }

    // Targeted search-results rebuild (focus-safe: never rebuilds the <input> itself).
    function populateSearchResults(host) {
      if (!host) return;
      host.innerHTML = "";
      host.style.display = inst.searchResults.length ? "" : "none";
      inst.searchResults.forEach(function (entry) {
        var item = el("button", P + "-search-result", escapeHtml(entry.code + " — " + entry.title));
        item.type = "button";
        item.addEventListener("click", function () {
          var sub = getSub();
          // Resolve immediately when the code has a single variant; else fill the base slot's code
          // and let the variant list below take over.
          var variants = entry.variants || [];
          var only = variants.length === 1 ? variants[0] : null;
          sub.variations[0] = { code: entry.code, variantId: only ? only.id : null, type: only ? only.type : null };
          resetSearch();
          onFullRerender();
        });
        host.appendChild(item);
      });
    }

    // "Classification" search field (focus-safe targeted-update pattern: populateSearchResults only
    // ever rebuilds the results host below, never this input).
    function renderClassificationSearch(host) {
      var varField = el("div", P + "-field");
      varField.appendChild(el("label", P + "-field-label", "Classification"));
      var varInput = el("input", P + "-input");
      varInput.type = "text";
      varInput.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ...";
      varInput.value = inst.query || "";
      varInput.addEventListener("input", function () {
        inst.query = varInput.value;
        inst.searchResults = BUDENG.searchEntries ? BUDENG.searchEntries(ENTRIES, inst.query) : [];
        populateSearchResults(host.querySelector("." + P + "-search-results"));
      });
      varField.appendChild(varInput);
      var results = el("div", P + "-search-results");
      varField.appendChild(results);
      populateSearchResults(results);
      host.appendChild(varField);
    }

    // Picked base header (+ Change) -- GW's buildPickedHeader / buildTypeOnlyHeader. When the picked
    // classification entry offers more than one type, a small type chooser lets the user switch.
    function renderPickedBaseHeader(host, base) {
      var entry = base.code ? ENTRIES.find(function (e) { return e.code === base.code; }) : null;
      var variant = entry && base.type ? findVariantById(entry, base.variantId) : null;
      var badge = base.type ? '<span class="' + P + '-type-badge ' + P + '-type-badge--' + typeBucketClass(base.type) + '">' + escapeHtml(base.type) + "</span>" : "";
      var picked = el("div", P + "-picked");
      var label = el("span");
      if (entry) label.innerHTML = '<span class="' + P + '-picked__code">' + escapeHtml(variant ? fullCodeOf(entry.code, variant.id) : entry.code) + "</span> — " + escapeHtml(variant ? variantFullName(entry, variant) : entry.title);
      else if (base.code) label.innerHTML = '<span class="' + P + '-picked__code">' + escapeHtml(base.code) + "</span>";
      else label.innerHTML = 'Variation type <span class="' + P + '-picked__muted">— no classification code</span>';
      picked.appendChild(label);
      var right = el("span", P + "-picked__right", badge);
      var change = el("button", P + "-change", "Change");
      change.type = "button";
      change.addEventListener("click", function () {
        getSub().variations[0] = { code: null, variantId: null, type: null };
        resetSearch();
        onFullRerender();
      });
      right.appendChild(change);
      picked.appendChild(right);
      host.appendChild(picked);
    }

    function renderVariantChooser(host, entry, base) {
      var chooser = el("div", P + "-variants");
      appendVariantOptions(chooser, entry, function (v) { base.variantId = v.id; base.type = v.type; onFullRerender(); });
      host.appendChild(chooser);
    }

    // ---- code-less variations, counted rather than listed one by one ----
    function codelessCount(t) {
      return getSub().variations.filter(function (v) { return !v.code && v.type === t; }).length;
    }
    function addCodeless(t) {
      var vars = getSub().variations;
      if (vars[0] && !vars[0].code && !vars[0].type) {
        vars[0] = { code: null, variantId: null, type: t, query: "" };
        return;
      }
      vars.push({ code: null, variantId: null, type: t, query: "" });
    }
    function removeCodeless(t, all) {
      var vars = getSub().variations;
      for (var i = vars.length - 1; i >= 1; i--) {
        if (!vars[i].code && vars[i].type === t) { vars.splice(i, 1); if (!all) return; }
      }
      if (vars[0] && !vars[0].code && vars[0].type === t) vars[0] = { code: null, variantId: null, type: null, query: "" };
    }
    function panelVariationCount() {
      var codeless = ["IA", "IB", "II"].reduce(function (n, t) { return n + codelessCount(t); }, 0);
      return codeless + getSub().variations.filter(function (v, i) { return i >= 1 && !!v.code && !!v.type; }).length;
    }

    // The three type counters at the foot of the variations block. "+" adds one code-less
    // variation of that type, "-" takes the last one away. Mirrors the Guided Workflow.
    function renderTypeCounters(host) {
      var wrap = el("div", P + "-typecount");
      wrap.appendChild(el("span", P + "-hint " + P + "-typecount__label", "or add variations without a classification code:"));
      var cells = el("div", P + "-typecount__row");
      ["IA", "IB", "II"].forEach(function (t) {
        var n = codelessCount(t);
        var cell = el("div", P + "-typecount__cell");
        cell.appendChild(el("span", P + "-typecount__l",
          "Type " + escapeHtml(t) + ' <span class="' + P + '-type-badge ' + P + '-type-badge--' + typeBucketClass(t) + '">' + escapeHtml(t) + "</span>"));
        var st = el("span", "vcl-rat-stepper");
        var minus = el("button", null, "&minus;");
        minus.type = "button"; minus.disabled = n === 0;
        minus.setAttribute("aria-label", "Remove one Type " + t + " variation without a classification code");
        minus.addEventListener("click", function () { removeCodeless(t, false); onFullRerender(); });
        var plus = el("button", null, "+");
        plus.type = "button";
        plus.setAttribute("aria-label", "Add one Type " + t + " variation without a classification code");
        plus.addEventListener("click", function () { addCodeless(t); onFullRerender(); });
        st.appendChild(minus);
        st.appendChild(el("span", "vcl-rat-stepper__val" + (n === 0 ? " is-zero" : ""), String(n)));
        st.appendChild(plus);
        cell.appendChild(st);
        cells.appendChild(cell);
      });
      wrap.appendChild(cells);
      host.appendChild(wrap);
    }

    // One additional (grouping) variation row -- mirrors the Guided Workflow's buildGroupingRow
    // state machine: resolved → text; a code with several types → a type chooser; empty → a per-row
    // search + quick-pick. The row's search rebuilds only its own matches host (focus-safe).
    function renderVariationRow(v, idx) {
      var sub = getSub();
      var row = el("div", P + "-brow");

      if (v.type) {
        row.classList.add(P + "-brow--compact");
        var main = el("div", P + "-brow__main");
        if (v.code) {
          var e0 = ENTRIES.find(function (x) { return x.code === v.code; });
          var v0 = findVariantById(e0, v.variantId);
          main.innerHTML = '<span class="' + P + '-brow__text"><span class="' + P + '-picked__code">' + escapeHtml(v0 ? fullCodeOf(v.code, v0.id) : v.code) + "</span> " + escapeHtml(e0 ? variantFullName(e0, v0) : "") + "</span>" +
            ' <span class="' + P + '-type-badge ' + P + '-type-badge--' + typeBucketClass(v.type) + '">' + escapeHtml(v.type) + "</span>";
        } else {
          main.innerHTML = 'Type <span class="' + P + '-type-badge ' + P + '-type-badge--' + typeBucketClass(v.type) + '">' + escapeHtml(v.type) +
            '</span> <span class="' + P + '-picked__muted">— no classification code</span>';
        }
        row.appendChild(main);
      } else if (v.code) {
        var e1 = ENTRIES.find(function (x) { return x.code === v.code; });
        var mainC = el("div", P + "-brow__main");
        mainC.innerHTML = '<span class="' + P + '-picked__code">' + escapeHtml(v.code) + "</span> " + escapeHtml(e1 ? e1.title : "");
        var chooser = el("div", P + "-brow__pick " + P + "-variants");
        appendVariantOptions(chooser, e1, function (variant) { v.variantId = variant.id; v.type = variant.type; onFullRerender(); });
        mainC.appendChild(chooser);
        row.appendChild(mainC);
      } else {
        var mainE = el("div", P + "-brow__main");
        var inp = el("input", P + "-brow__input");
        inp.type = "text";
        inp.placeholder = "Search by code or keyword (i. e. shape, shelf, leaflet) ...";
        inp.value = v.query || "";
        inp.addEventListener("input", function () { v.query = inp.value; renderMatches(); });
        mainE.appendChild(inp);
        var matches = el("div", P + "-brow__matches");
        mainE.appendChild(matches);
        row.appendChild(mainE);
        renderMatches();
        function renderMatches() {
          matches.innerHTML = "";
          var q = (v.query || "").trim().toLowerCase();
          if (!q) return;
          ENTRIES.filter(function (e) {
            return e.code.toLowerCase().indexOf(q) !== -1 || (e.title || "").toLowerCase().indexOf(q) !== -1;
          }).slice(0, 6).forEach(function (e) {
            var m = el("button", P + "-brow__match");
            m.type = "button";
            m.innerHTML = '<span class="' + P + '-var-row__code">' + escapeHtml(e.code) + "</span> " + escapeHtml(e.title);
            m.addEventListener("click", function () {
              v.code = e.code;
              var variants = e.variants || [];
              var only = variants.length === 1 ? variants[0] : null;
              v.variantId = only ? only.id : null;
              v.type = only ? only.type : null;
              onFullRerender();
            });
            matches.appendChild(m);
          });
        }
      }

      var rm = el("button", P + "-rm", "✕");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove variation");
      rm.addEventListener("click", function () { sub.variations.splice(idx, 1); onFullRerender(); });
      row.appendChild(rm);
      return row;
    }

    // The variations list. Headed "Additional variations" when a coded base variation sits above
    // it, otherwise "Variations" -- because then the list holds the base variation too.
    function renderVariationsPanel(host, hasCodeHeader) {
      var sub = getSub();
      var panel = el("div", P + "-builder");
      var head = el("div", P + "-builder__head");
      head.appendChild(el("span", null, hasCodeHeader ? "Additional variations" : "Variations"));
      head.appendChild(el("span", P + "-count", String(panelVariationCount())));
      panel.appendChild(head);

      ["IA", "IB", "II"].forEach(function (t) {
        var n = codelessCount(t);
        if (!n) return;
        var row = el("div", P + "-brow " + P + "-brow--compact");
        var main = el("div", P + "-brow__main");
        main.innerHTML = '<span class="' + P + '-brow__text"><span class="' + P + '-mult">' + n + " &times;</span>Type "
          + escapeHtml(t) + ' <span class="' + P + '-picked__muted">— no classification code</span></span>'
          + ' <span class="' + P + '-type-badge ' + P + '-type-badge--' + typeBucketClass(t) + '">' + escapeHtml(t) + "</span>";
        row.appendChild(main);
        var rm = el("button", P + "-rm", "✕");
        rm.type = "button";
        rm.setAttribute("aria-label", "Remove all " + n + " Type " + t + " variations without a classification code");
        rm.addEventListener("click", function () { removeCodeless(t, true); onFullRerender(); });
        row.appendChild(rm);
        panel.appendChild(row);
      });

      var openIdx = sub.variations.findIndex(function (v, i) { return i >= 1 && !v.type; });

      sub.variations.forEach(function (v, i) {
        if (i === 0 || i === openIdx) return;
        if (!v.code && v.type) return;
        panel.appendChild(renderVariationRow(v, i));
      });

      panel.appendChild(el("div", P + "-subhead", "Add a variation by code"));
      if (openIdx !== -1) {
        panel.appendChild(renderVariationRow(sub.variations[openIdx], openIdx));
      } else {
        var add = el("button", P + "-add", "＋ Add variation");
        add.type = "button";
        add.addEventListener("click", function () { sub.variations.push({ code: null, variantId: null, type: null, query: "" }); onFullRerender(); });
        panel.appendChild(add);
      }

      panel.appendChild(el("hr", P + "-rule"));
      renderTypeCounters(panel);
      host.appendChild(panel);

      var total = panelVariationCount() + (hasCodeHeader ? 1 : 0);
      if (total >= 2) {
        host.appendChild(el("p", P + "-hint", total + " variations — this line is priced as a Grouping."));
      }
    }

    // ---- Station: Variations -- mirrors the Guided Workflow's buildStationA exactly. ----
    function renderVariations(host) {
      var sub = getSub();
      host.appendChild(el("div", P + "-body__title", "Variations"));
      host.appendChild(el("div", P + "-body__sub", "Which variation, or variations, are you submitting?"));

      var base = sub.variations[0];
      var entry = base && base.code ? ENTRIES.find(function (e) { return e.code === base.code; }) : null;

      if (entry && !base.type) {
        renderPickedBaseHeader(host, base);
        renderVariantChooser(host, entry, base);
        return;
      }
      if (entry) renderPickedBaseHeader(host, base);

      var anythingChosen = sub.variations.some(function (v) { return v.code || v.type; });
      if (!entry && !anythingChosen) {
        renderClassificationSearch(host);
        host.appendChild(el("hr", P + "-rule"));
        renderTypeCounters(host);
        return;
      }
      renderVariationsPanel(host, !!entry);
    }

    // ---- Station: Procedures + multi-authorisation strategy ----
    function countrySelectField(labelText, list, current, onPick, disabled) {
      var field = el("div", P + "-field");
      field.appendChild(el("label", P + "-field-label", escapeHtml(labelText)));
      var sel = el("select", P + "-select " + P + "-select--country");
      if (disabled) sel.disabled = true;
      var opt0 = el("option", null, "— select —"); opt0.value = "";
      if (!current) opt0.selected = true;
      sel.appendChild(opt0);
      list.forEach(function (c) {
        var o = el("option", null, escapeHtml((c.name || c.cc) + " (" + c.cc + ")")); o.value = c.cc;
        if (current === c.cc) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { onPick(sel.value || null); });
      field.appendChild(sel);
      return field;
    }

    function procKindChips(p) {
      var sub = getSub();
      var kinds = [{ k: "national", l: "National" }, { k: "mrpdcp", l: "MRP / DCP" }, { k: "cp", l: "CP" }];
      var allowed = SUB.sgActive(sub) ? engines().sgLogic.computeAllowedProcedureKinds(sub.procedures, p) : null;
      var row = el("div", P + "-chips");
      kinds.forEach(function (it) {
        var isAllowed = !allowed || allowed.indexOf(it.k) !== -1;
        var chip = el("button", P + "-chip" + (p.kind === it.k ? " is-on" : "") + (isAllowed ? "" : " is-disabled"), escapeHtml(it.l));
        chip.type = "button";
        if (!isAllowed) {
          chip.disabled = true;
          chip.title = it.k === "cp"
            ? "Not allowed together with national/MRP-DCP procedures in Super-Grouping"
            : "Not allowed together with CP in Super-Grouping";
        } else {
          chip.addEventListener("click", function () {
            p.kind = it.k;
            if (it.k === "cp") p.ema = SUB.emaCc(engines());
            onChange();
          });
        }
        row.appendChild(chip);
      });
      return row;
    }

    function cmsChips(p) {
      var wrap = el("div", P + "-field");
      wrap.appendChild(el("label", P + "-field-label", "CMS (Concerned Member States)"));
      var grid = el("div", P + "-cgrid");
      countriesByRole("CMS").forEach(function (c) {
        if (c.cc === p.rms) return;
        var on = (p.cms || []).indexOf(c.cc) !== -1;
        var m = /^([A-Za-z]{2})\s*[-–]\s*(.+)$/.exec(c.cc);
        var label = m ? escapeHtml(m[1]) + '<span class="' + P + '-cc__sfx">' + escapeHtml(m[2]) + "</span>" : escapeHtml(c.cc);
        var chip = el("button", P + "-cc-chip-btn" + (on ? " is-on" : ""), label);
        chip.type = "button";
        chip.title = c.name || c.cc;
        chip.addEventListener("click", function () {
          if (on) p.cms = p.cms.filter(function (x) { return x !== c.cc; });
          else if (p.cms.indexOf(c.cc) === -1) p.cms.push(c.cc);
          onChange();
        });
        grid.appendChild(chip);
      });
      wrap.appendChild(grid);
      // WS flow: one button after the grid that selects every eligible CMS, then flips to Reset
      // once they are all on (helps large DCP/MRP with many countries).
      if (cmsSelectAll) {
        var eligible = countriesByRole("CMS").filter(function (c) { return c.cc !== p.rms; });
        var allOn = eligible.length > 0 && eligible.every(function (c) { return (p.cms || []).indexOf(c.cc) !== -1; });
        var toggle = el("button", P + "-cms-selectall", allOn ? "Reset" : "Select all");
        toggle.type = "button";
        toggle.addEventListener("click", function () {
          p.cms = allOn ? [] : eligible.map(function (c) { return c.cc; });
          onChange();
        });
        wrap.appendChild(toggle);
      }
      return wrap;
    }

    function procedureBody(host, p) {
      var sub = getSub();
      host.appendChild(procKindChips(p));
      if (p.kind === "national") {
        var euOnly = SUB.multiProcedureMode(sub) || SUB.auActive(sub);
        var natList = countriesByRole("national").filter(function (c) {
          return !euOnly || NON_EU_PROCEDURE_COUNTRIES.indexOf(c.cc) === -1;
        });
        host.appendChild(countrySelectField("Country", natList, p.nat, function (cc) { p.nat = cc; onChange(); }));
      } else if (p.kind === "mrpdcp") {
        host.appendChild(countrySelectField("RMS (Reference Member State)", countriesByRole("RMS"), p.rms, function (cc) {
          p.rms = cc; p.cms = (p.cms || []).filter(function (x) { return x !== cc; }); onChange();
        }));
        host.appendChild(cmsChips(p));
        host.appendChild(el("p", P + "-hint", "Each selected CMS is charged its own national fee. The RMS cannot also be a CMS."));
      } else if (p.kind === "cp") {
        host.appendChild(el("p", P + "-hint", "CP · EMA — centralised procedure, one authority (EMA), no country selection."));
      }
    }

    function renderProcedureRow(p, idx, first) {
      var sub = getSub();
      var card = el("div", P + "-proc-card");
      var head = el("div", P + "-proc-card__head");
      head.appendChild(el("span", P + "-proc-card__title", "Procedure " + (idx + 1)));
      // The base procedure (idx 0, boxFirstProcedure) carries no remove button -- it is the one
      // the submission is built on, so it cannot be taken away.
      if (!first) {
        var rm = el("button", P + "-btn " + P + "-btn--ghost " + P + "-btn--small " + P + "-btn--danger", "✕");
        rm.type = "button"; rm.setAttribute("aria-label", "Remove procedure");
        rm.addEventListener("click", function () { sub.procedures.splice(idx, 1); onChange(); });
        head.appendChild(rm);
      }
      card.appendChild(head);
      procedureBody(card, p);
      return card;
    }

    // The lead (RMS) select, shared by the two render positions (top when leadFirst, otherwise in
    // its classic spot after the base procedure). WS only -- leadPricingActive gates the caller.
    function renderLeadField(host, sub) {
      var leadList = countriesByRole("RMS").slice();
      countriesByRole("EMA").forEach(function (c) {
        if (!leadList.some(function (x) { return x.cc === c.cc; })) leadList.push(c);
      });
      var hasCP = sub.procedures.some(function (p) { return p.kind === "cp"; });
      var label = leadFirst ? "Worksharing / Super-Grouping RMS (lead)"
        : (SUB.sgActive(sub) ? "Super-Grouping RMS (lead)" : "Worksharing RMS (lead)");
      host.appendChild(countrySelectField(label, leadList, sub.lead, function (cc) { sub.lead = cc; onChange(); }, hasCP));
      if (hasCP) {
        host.appendChild(el("p", P + "-hint", SUB.sgActive(sub)
          ? "Automatically the EMA — this Super-Grouping consists of Centralised procedures."
          : "Automatically the EMA, because a Centralised procedure (CP) is part of the worksharing."));
      }
    }

    // Strategy-enablement rule shared by the chips AND the always-on normaliser (mirrors the Guided
    // Workflow): a mixed submission may only Worksharing; an all-Type-IA one may only
    // Super-Group / Annual-Update. A CP inside an active WS/SG auto-leads via the EMA. Returns allIA.
    function normalizeModeEnablement(sub) {
      var allIA = SUB.allVariationsAreIA(sub, engines());
      if (autoMode) {
        // No submission-type chips in the WS/SG flow: derive the mode (Annual Update stays classic).
        sub.mode = allIA ? "superGrouping" : "worksharing";
      } else {
        if (sub.mode === "worksharing" && allIA) sub.mode = null;
        if ((sub.mode === "superGrouping" || sub.mode === "annualUpdate") && !allIA) sub.mode = null;
      }
      // A CP inside an active WS/SG auto-leads via the EMA. When the CP is later switched back to
      // national/MRP the EMA is no longer a valid lead, so a stale EMA lead is cleared (it used to
      // stick on the top field and every following station).
      if (SUB.leadPricingActive(sub)) {
        var ema = SUB.emaCc(engines());
        if (sub.procedures.some(function (p) { return p.kind === "cp"; })) sub.lead = ema;
        else if (sub.lead === ema) sub.lead = null;
      }
      return allIA;
    }

    function renderProcedures(host) {
      var sub = getSub();
      var allIA = normalizeModeEnablement(sub);

      host.appendChild(el("div", P + "-body__title", autoMode
        ? (leadFirst ? "Worksharing / Super-Grouping Procedures" : (SUB.sgActive(sub) ? "Super-Grouping Procedures" : "Worksharing Procedures"))
        : "Procedures"));
      host.appendChild(el("div", P + "-body__sub", "How is it submitted, and where? Fees are per country, so the countries are set here."));

      // WS redesign: the lead (RMS) select sits at the very top, above the procedures.
      if (leadFirst && SUB.leadPricingActive(sub)) renderLeadField(host, sub);

      // 1. Base procedure. boxFirstProcedure (WS) renders it in the same boxed card as the
      //    additional ones; otherwise (Budget) it is inline under a "Procedure" section label.
      if (boxFirstProcedure) {
        host.appendChild(renderProcedureRow(sub.procedures[0], 0, true));
      } else {
        host.appendChild(el("div", P + "-section-label", "Procedure"));
        procedureBody(host, sub.procedures[0]);
      }

      // 2. Submission type chips (Budget only). In the WS/SG flow the mode is derived from the
      // variations (autoMode), so the chips + derived-label block are skipped.
      if (!autoMode) {
      host.appendChild(el("div", P + "-section-label", "Submission type"));
      var chips = el("div", P + "-chips");
      (allIA
        ? [{ mode: "superGrouping", label: "Super-Grouping" }, { mode: "annualUpdate", label: "Annual Update" }]
        : [{ mode: "worksharing", label: "Worksharing" }]
      ).forEach(function (s) {
        var on = sub.mode === s.mode;
        var chip = el("button", P + "-chip" + (on ? " is-on" : ""), escapeHtml(s.label));
        chip.type = "button";
        chip.addEventListener("click", function () { sub.mode = on ? null : s.mode; onChange(); });
        chips.appendChild(chip);
      });
      host.appendChild(chips);
      host.appendChild(el("p", P + "-hint", allIA
        ? "Available because every listed variation is Type IA. Super-Grouping shares the change across several authorisations; Annual Update keeps it within this one."
        : "Turn on when the change is shared across several procedures or authorisations. Grouping is applied automatically when you list more than one variation."));
      if (allIA && !sub.mode) {
        host.appendChild(el("p", P + "-hint " + P + "-hint--req", "Select Super-Grouping or Annual Update to continue — a Type IA is never submitted on its own."));
      }
      if (!sub.mode && !allIA) {
        var dm = SUB.displayMode(sub); // "single" | "grouping"
        var MODE_LABEL = { worksharing: "Worksharing", superGrouping: "Super-Grouping", annualUpdate: "Annual Update", grouping: "Grouping", single: "Single" };
        var derived = el("div", P + "-derived");
        derived.innerHTML = "No submission type — priced as <strong>" + escapeHtml(MODE_LABEL[dm]) + "</strong>.";
        host.appendChild(derived);
      }
      } // end if (!autoMode) — submission-type chips

      // 3. Lead (classic position, after the base procedure) -- skipped when leadFirst already
      //    rendered it at the top. + additional procedures (WS / SG only).
      if (!leadFirst && SUB.leadPricingActive(sub)) renderLeadField(host, sub);

      if (SUB.multiProcedureMode(sub)) {
        host.appendChild(el("div", P + "-section-label", "Additional procedures"));
        var list = el("div", P + "-proc-list");
        sub.procedures.slice(1).forEach(function (p, i) { list.appendChild(renderProcedureRow(p, i + 1)); });
        host.appendChild(list);
        var add = el("button", P + "-btn " + P + "-btn--ghost " + P + "-btn--small", "+ Add procedure");
        add.type = "button";
        add.addEventListener("click", function () {
          var np = { kind: "national", nat: null, rms: null, cms: [] };
          if (SUB.sgActive(sub)) {
            var allowed = engines().sgLogic.computeAllowedProcedureKinds(sub.procedures, np);
            if (allowed.indexOf(np.kind) === -1) np.kind = allowed[0];
          }
          sub.procedures.push(np);
          onChange();
        });
        host.appendChild(add);
      }
    }

    // Involved countries across all procedures (+ lead), deduped; first role seen wins.
    function strengthsInvolvedCountries(sub) {
      var seen = {}, out = [];
      function add(cc, role) { if (!cc || seen[cc]) return; seen[cc] = 1; out.push({ cc: cc, role: role }); }
      sub.procedures.forEach(function (p) {
        if (p.kind === "national") add(p.nat, "national");
        else if (p.kind === "mrpdcp") { add(p.rms, "RMS"); (p.cms || []).forEach(function (c) { add(c, "CMS"); }); }
        else if (p.kind === "cp") add(SUB.emaCc(engines()), "EMA");
      });
      if (SUB.leadPricingActive(sub) && sub.lead) add(sub.lead, "RMS");
      return out;
    }
    // Of those, the ones whose fee actually changes between 1 and 2 strengths (probe via the engine).
    function strengthsSensitiveCountries(sub) {
      var eng = engines();
      if (!eng.computeFees) return [];
      var counts = SUB.feeCounts(sub);
      if (SUB.feeCountsTotal(counts) === 0) {
        // The WS flow reaches Strengths BEFORE Variations, so no types are set yet. Probe with
        // one of every type so a country that charges per strength for any type still gets its
        // stepper (type-independent sensitivity). Budget (no autoMode) keeps the old empty result.
        if (!autoMode) return [];
        counts = { IA: 1, IB: 1, II: 1 };
      }
      return strengthsInvolvedCountries(sub).filter(function (x) {
        function fee(n) { var r = eng.computeFees({ countries: [{ cc: x.cc, role: x.role, strengths: n }], counts: counts }); return (r.countries && r.countries[0] && r.countries[0].total) || 0; }
        return Math.abs(fee(2) - fee(1)) > 0.005;
      });
    }
    // − value + stepper (same shape as the calculator's .num-stepper / RA-tasks stepper).
    function numStepper(value, onset) {
      var wrap = el("div", P + "-num-stepper");
      var dec = el("button", null, "−"); dec.type = "button";
      var inp = el("input"); inp.type = "text"; inp.setAttribute("inputmode", "numeric"); inp.value = String(value);
      var inc = el("button", null, "+"); inc.type = "button";
      function commit(n) { if (isNaN(n) || n < 1) n = 1; inp.value = String(n); onset(n); onChange(); }
      dec.addEventListener("click", function () { commit((parseInt(inp.value, 10) || 1) - 1); });
      inc.addEventListener("click", function () { commit((parseInt(inp.value, 10) || 1) + 1); });
      inp.addEventListener("change", function () { commit(parseInt(inp.value, 10)); });
      wrap.appendChild(dec); wrap.appendChild(inp); wrap.appendChild(inc);
      return wrap;
    }
    function distinctInvolved(sub) {
      var seen = {}, out = [];
      sub.procedures.forEach(function (p) { procCountryList(p).forEach(function (x) { if (!seen[x.cc]) { seen[x.cc] = 1; out.push(x); } }); });
      return out;
    }
    function kindLabel(p) { return p.kind === "mrpdcp" ? "MRP / DCP" : (p.kind === "cp" ? "CP" : "National"); }
    function procCountryList(p) {
      var out = [];
      if (p.kind === "national") { if (p.nat) out.push({ cc: p.nat, role: "national" }); }
      else if (p.kind === "mrpdcp") { if (p.rms) out.push({ cc: p.rms, role: "RMS" }); (p.cms || []).forEach(function (c) { out.push({ cc: c, role: "CMS" }); }); }
      else if (p.kind === "cp") { var ema = SUB.emaCc(engines()); if (ema) out.push({ cc: ema, role: "EMA" }); }
      return out;
    }
    // Dedicated "Strengths" station (mirrors the classic calculator's "Country details" step, minus
    // the role which the procedures already fix): a highlighted default box, then the procedures
    // listed, each country a two-column card with its own strengths stepper. A country keeps its own
    // number once set (sub.strengths.overrides); setting it back to the default drops the override.
    function renderStrengths(host) {
      var sub = getSub();
      if (!sub.strengths) sub.strengths = { default: 1, overrides: {} };
      host.appendChild(el("div", P + "-body__title", "Strengths per country"));
      host.appendChild(el("div", P + "-body__sub", "Set the number of authorised strengths for each country — these can differ from country to country (e.g. one country may have 2 authorised strengths where another only has 1)."));

      var defN = Math.max(1, parseInt(sub.strengths.default, 10) || 1);
      var involved = distinctInvolved(sub);
      var M = involved.length;
      var N = involved.filter(function (x) { return sub.strengths.overrides[x.cc] != null; }).length;

      var box = el("div", P + "-strbox");
      box.appendChild(el("div", P + "-strbox__head", "Strengths for all countries"));
      box.appendChild(el("p", P + "-strbox__sub", "Applies to every country below. Give a single country its own number afterwards and it keeps that number, even if you change this default again."));
      var brow = el("div", P + "-strbox__row");
      var dcol = el("div");
      dcol.appendChild(el("span", P + "-strbox__fieldlabel", "Number of authorised strengths"));
      dcol.appendChild(numStepper(defN, function (n) { sub.strengths.default = n; }));
      brow.appendChild(dcol);
      var reset = el("button", P + "-strbox__reset", "↺ Reset all to default");
      reset.type = "button"; reset.disabled = N === 0;
      reset.addEventListener("click", function () { sub.strengths.overrides = {}; onChange(); });
      brow.appendChild(reset);
      box.appendChild(brow);
      box.appendChild(el("p", P + "-strbox__note", N === 0
        ? "All " + M + " countries follow the default of " + defN + (defN === 1 ? " strength." : " strengths.")
        : N + " of " + M + " countries " + (N === 1 ? "has" : "have") + " its own number and keeps it when you change the default."));
      host.appendChild(box);

      var nameByCc = {}; (engines().countries || []).forEach(function (c) { nameByCc[c.cc] = c.name; });
      var sensSet = {}; strengthsSensitiveCountries(sub).forEach(function (x) { sensSet[x.cc] = 1; });

      sub.procedures.forEach(function (p, i) {
        var ctys = procCountryList(p);
        if (!ctys.length) return;
        host.appendChild(el("div", P + "-strbox-prochead", "Procedure " + (i + 1) + " · " + kindLabel(p)));
        var list = el("div", P + "-strlist");
        // Strength-sensitive markets get their own stepper; the rest follow the default and are
        // collected into one muted row so every country is still accounted for.
        ctys.filter(function (x) { return sensSet[x.cc]; }).forEach(function (x) {
          var own = sub.strengths.overrides[x.cc] != null;
          var row = el("div", P + "-strrow" + (own ? " has-own-strengths" : ""));
          row.appendChild(el("span", P + "-strrow__name", escapeHtml(nameByCc[x.cc] || x.cc) + ' <span class="' + P + '-badge">' + escapeHtml(x.cc) + "</span>"));
          row.appendChild(numStepper(SUB.strengthsFor(sub, x.cc), function (n) {
            if (n === Math.max(1, parseInt(sub.strengths.default, 10) || 1)) delete sub.strengths.overrides[x.cc];
            else sub.strengths.overrides[x.cc] = n;
          }));
          list.appendChild(row);
        });
        var nonSens = ctys.filter(function (x) { return !sensSet[x.cc]; });
        if (nonSens.length) {
          var nrow = el("div", P + "-strrow " + P + "-strrow--none");
          nrow.appendChild(el("span", P + "-strrow__note", "No strength-dependent fees here"));
          nrow.appendChild(el("span", P + "-strrow__ccs", nonSens.map(function (x) { return escapeHtml(nameByCc[x.cc] || x.cc); }).join(", ")));
          list.appendChild(nrow);
        }
        host.appendChild(list);
      });
    }

    return {
      state: inst,
      resetSearch: resetSearch,
      normalizeModeEnablement: normalizeModeEnablement,
      renderVariations: renderVariations,
      renderProcedures: renderProcedures,
      renderStrengths: renderStrengths,
    };
  }

  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_PROC_EDITOR = api;
})(typeof window !== "undefined" ? window : this);
