(function () {
  "use strict";

  const { CLASSIFICATION_META, SECTIONS, CHAPTERS, ENTRIES, GROUPING_GUIDANCE, PRECISE_SCOPE_GUIDANCE, REVISION_HISTORY } = window.VCL_DATA;

  // Its own generated file (see vcl-qa-data.js). Optional on purpose: the Q&A nav row and view
  // are simply left out when the script isn't enqueued, rather than the whole guide failing.
  const QA_DATA = window.VCL_QA_DATA || null;

  // Same optional-generated-file arrangement for the Art. 5 tracking table (see vcl-art5-data.js).
  const ART5_DATA = window.VCL_ART5_DATA || null;

  // Returns the most recent REVISION_HISTORY entry that touched this code, or undefined if the
  // code has never been logged as changed. Used to show the small "changed" badge/callout in
  // both the browse-tree card and the entry detail (Option A from the revision-history preview).
  function revisionForCode(code) {
    let found;
    REVISION_HISTORY.forEach((rev) => {
      if (rev.changedCodes.includes(code) && (!found || rev.date > found.date)) found = rev;
    });
    return found;
  }

  // Admin-editable via the "Variation Toolbox" section on the plugin's settings page (see
  // vcl_get_last_updated() in includes/admin.php); falls back to the date baked into
  // vcl-data.js/vcl-app.js when running standalone (no VCL_CONFIG.lastUpdated at all) or
  // before the option has ever been saved.
  function lastUpdated(key, fallback) {
    return (window.VCL_CONFIG && window.VCL_CONFIG.lastUpdated && window.VCL_CONFIG.lastUpdated[key]) || fallback;
  }

  // Same admin-editable/fallback pattern as lastUpdated() above, for the free-text guideline
  // reference shown next to it -- kept separate from the hardcoded guideline names/numbers below
  // so an admin can correct them (e.g. a new revision number) without a code change.
  function referenceText(key, fallback) {
    return (window.VCL_CONFIG && window.VCL_CONFIG.referenceText && window.VCL_CONFIG.referenceText[key]) || fallback;
  }

  const SELECTIONS_STORAGE_KEY = "variationLookupSelections";

  // Selection shape: state.selections["E.1|a"] = { qty: number, units: [unit, unit, ...] }
  // unit = { docs: { [docNum]: { checked: bool, note: string } }, note: string } -- one entry
  // per physical instance of that variant/type in the application (e.g. 3x the same code for
  // 3 different sites). unit.note is the free-text justification for that whole Summary line,
  // separate from the per-document notes inside unit.docs.
  function loadSelections() {
    try {
      const raw = JSON.parse(localStorage.getItem(SELECTIONS_STORAGE_KEY) || "{}");
      const out = {};
      Object.keys(raw).forEach((k) => {
        const v = raw[k];
        let qty, units;
        if (typeof v === "number") {
          // Legacy format from an earlier version of this tool: just a quantity, no per-unit data.
          qty = Math.floor(v);
          units = Array.from({ length: Math.max(0, qty) }, () => ({ docs: {}, note: "" }));
        } else if (v && typeof v === "object" && Array.isArray(v.units)) {
          units = v.units.map((u) => ({ docs: (u && u.docs) || {}, note: (u && u.note) || "" }));
          qty = units.length;
        } else {
          return;
        }
        if (qty > 0) out[k] = { qty, units };
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  const state = {
    classifyOpen: false, // whether the "Classification of Variations" chapter branch is expanded
    guidanceOpen: false, // whether the "Guidance on Variations" sub-nav branch is expanded
    guidanceHub: false, // whether the detail area shows the Guidance hub (its three documents as cards) instead of the welcome overview
    activeChapter: null, // no chapter expanded at first -- only E/Q/C/M show, all collapsed
    activeSection: null, // e.g. "I", "II" ... within a chapter that has SECTIONS (currently only Q)
    query: "",
    activeVariant: null, // { code, variantId } | null -- the single variant currently expanded to its full conditions/documentation/precise-scope content; every sibling variant of the same entry stays in its compact row form
    openHeading: null, // the one group heading explicitly opened by the user (accordion: closes all others)
    forcedClosedHeadings: new Set(), // default-open headings the user has explicitly closed
    checkedConditions: {}, // "E.1|a" -> Set of condition numbers checked
    selections: loadSelections(), // "E.1|a" -> { qty, units }
    selectionExpanded: false,
    view: "browse", // "browse" | "summary" | "grouping" | "precisescope" | "qa" | "timetables" | "workload" | "calculator" -- the app opens on the browse view, whose detail area shows the first-load overview (see renderDetail)
    summaryExpandedUnits: new Set(), // "E.1|a#0" -> that unit's long form is open in the Summary view
    groupingOpen: null, // "acceptable" | "notAcceptable" | "singleChangeInstead" | null -- at most one grouping-guidance section is ever expanded
    preciseScopeOpen: null, // section key of the Precise Scope Wording view -- same one-at-a-time accordion as groupingOpen
    qaOpenChapter: null, // chapter key of the Q&A view -- same one-at-a-time accordion
    qaOpenQuestion: null, // id ("3.12") of the single Q&A whose answer is expanded
    qaQuery: "", // the Q&A view's own filter box -- separate from the global `query`, which drives Classification
    qaShowDeleted: false, // the source keeps withdrawn questions in place; hidden unless asked for
    art5OpenGroup: null, // section key of the Art. 5 archive whose recommendations are expanded
    art5Query: "", // the Art. 5 view's own filter box
    ttType: "ia", // "ia" | "ib" | "ii" -- active tab in the Timetables view
    ttIIVariant: "60", // "30" | "60" | "90" -- active Type II sub-procedure
    ttCompare: false, // Timetables view: showing the 30/60/90-day comparison instead of a single timetable
    // Clock-stop slider position, as a fraction of the active type's 0..stopMax range -- kept
    // as a fraction (not a day count) so switching IB <-> II-90 keeps the slider where the
    // user put it proportionally, instead of clamping a 150-day value down to IB's 30.
    ttStopFraction: 1.0,
  };

  // Entries currently "in scope" while browsing/searching Classification -- rebuilt as a side
  // effect at the top of every renderBrowse() call (pushed to from renderEntryGroup() wherever an
  // entry would previously have become a clickable card in the left nav). renderDetail() reads
  // this afterwards to render the same entries as a stacked list in the detail panel instead.
  let visibleEntries = [];

  const el = {
    appRoot: document.getElementById("vcl-app"),
    browseTree: document.getElementById("vcl-browseTree"),
    search: document.getElementById("vcl-searchInput"),
    detail: document.getElementById("vcl-detailPanel"),
    detailEmpty: document.getElementById("vcl-detailEmpty"),
    detailHead: document.getElementById("vcl-detailHead"),
    detailCol: document.getElementById("vcl-detailCol"),
    selectionBar: document.getElementById("vcl-selectionBar"),
    selectionToggle: document.getElementById("vcl-selectionToggle"),
    selectionChevron: document.getElementById("vcl-selectionChevron"),
    selectionCount: document.getElementById("vcl-selectionCount"),
    selectionClear: document.getElementById("vcl-selectionClear"),
    selectionList: document.getElementById("vcl-selectionList"),
    selectionViewSummary: document.getElementById("vcl-selectionViewSummary"),
    summaryCol: document.getElementById("vcl-summaryCol"),
    summaryCount: document.getElementById("vcl-summaryCount"),
    summaryList: document.getElementById("vcl-summaryList"),
    summaryExpandAll: document.getElementById("vcl-summaryExpandAll"),
    summaryCollapseAll: document.getElementById("vcl-summaryCollapseAll"),
    summaryExportDocx: document.getElementById("vcl-summaryExportDocx"),
    summaryPrint: document.getElementById("vcl-summaryPrint"),
    summaryExportCalculator: document.getElementById("vcl-summaryExportCalculator"),
    summaryExportWorkflow: document.getElementById("vcl-summaryExportWorkflow"),
    groupingCol: document.getElementById("vcl-groupingCol"),
    preciseScopeCol: document.getElementById("vcl-preciseScopeCol"),
    qaCol: document.getElementById("vcl-qaCol"),
    art5Col: document.getElementById("vcl-art5Col"),
    timetablesCol: document.getElementById("vcl-timetablesCol"),
    workloadCol: document.getElementById("vcl-workloadCol"),
    workflowCol: document.getElementById("vcl-workflowCol"),
    calculatorCol: document.getElementById("vcl-calculatorCol"),
    calcHead: document.getElementById("vcl-calcHead"),
  };

  if (!el.appRoot) return; // Shortcode markup not on this page -- nothing to do.

  // The reference head (title, one paragraph, Reference, "Last updated" note) stays visible in
  // vcl-detailHead regardless of whether an entry is selected -- previously it lived inside
  // vcl-detailEmpty and disappeared together with it once an entry was opened. Content is
  // static, so this only needs to run once. vcl-detailEmpty now only holds the hint text and
  // toggles with vcl-detailPanel as before (see renderDetail()).
  el.detailHead.innerHTML = `
    <h3>Classification of Variations</h3>
    <p>Search or browse variation codes from the EU Variation Classification Guideline. Pick a matching entry to see the conditions, required documentation and resulting procedure type.</p>
    <p class="ref-line">Reference: ${referenceText("classification", `${CLASSIFICATION_META.guidelineRef}, applicable from ${CLASSIFICATION_META.applicableFrom}`)}</p>
    <p class="ref-updated">Last updated in Variation Toolbox: ${lastUpdated("classification", CLASSIFICATION_META.lastUpdated)}</p>
  `;
  // Fee Calculator view heading -- rendered by the guide (not by the embedded calculator,
  // whose own header is dropped) so it matches the Classification/Timetables heading style
  // and uses the same admin-editable "Reference"/"Last updated" mechanism (key "calculator").
  // The last-updated fallback comes from the calculator's own fee-data date once its script
  // has booted (window.VCLCALC_META); re-run on first open so a late boot still shows it.
  function fillCalcHead() {
    if (!el.calcHead) return;
    const calcUpdated = (window.VCLCALC_META && window.VCLCALC_META.lastUpdated) || "see fee schedules";
    // Optional: a download link to the source Excel workbook, configured in the admin page
    // (its URL changes on every WordPress re-upload, hence an editable field there).
    const excelUrl = (window.VCL_CONFIG && window.VCL_CONFIG.calcExcelUrl) || "";
    const excelHtml = excelUrl
      ? `<p class="calc-excel-dl"><a href="${excelUrl}" target="_blank" rel="noopener">&#8681; Download the Excel version of the calculator</a></p>`
      : "";
    el.calcHead.innerHTML = `
      <h3>Variation Fee Calculator</h3>
      <p>Calculate the official regulatory fees for variation applications (Type IA / IB / II) across one or more markets &mdash; EU-27, EMA, CH, IS, NO, UK and RS. Select markets and roles, set the number of strengths, then choose the variations.</p>
      <p class="ref-line">Reference: ${referenceText("calculator", "Official fee schedules of the respective authorities (EU-27, EMA, CH, IS, NO, UK, RS).")}</p>
      <p class="ref-updated">Last updated in Variation Toolbox: ${lastUpdated("calculator", calcUpdated)}</p>
      ${excelHtml}
    `;
  }
  fillCalcHead();

  // Static default hint text -- renderDetail() overwrites this dynamically with a
  // "no matching entries" variant while a search query yields zero results.
  const DETAIL_EMPTY_HINT =
    "Browse a chapter or section on the left, or search above, to see its variations listed here. Pick one to see its conditions, required documentation and procedure type.";
  el.detailEmpty.innerHTML = `<p class="classification-empty-hint">${DETAIL_EMPTY_HINT}</p>`;

  // The browse column (search + chapter/section/subsection accordion) stays on screen in every
  // view -- only the right-hand column switches between the entry detail, the Summary, and the
  // (static) Grouping guidance.
  function switchViewVisibility() {
    const isSummary = state.view === "summary";
    const isGrouping = state.view === "grouping";
    const isPreciseScope = state.view === "precisescope";
    const isQa = state.view === "qa";
    const isArt5 = state.view === "art5";
    const isTimetables = state.view === "timetables";
    const isWorkload = state.view === "workload";
    const isWorkflow = state.view === "workflow";
    const isCalculator = state.view === "calculator";
    el.detailCol.classList.toggle("hidden", isSummary || isGrouping || isPreciseScope || isQa || isArt5 || isTimetables || isWorkload || isWorkflow || isCalculator);
    el.summaryCol.classList.toggle("hidden", !isSummary);
    el.groupingCol.classList.toggle("hidden", !isGrouping);
    el.preciseScopeCol.classList.toggle("hidden", !isPreciseScope);
    if (el.qaCol) el.qaCol.classList.toggle("hidden", !isQa);
    if (el.art5Col) el.art5Col.classList.toggle("hidden", !isArt5);
    el.timetablesCol.classList.toggle("hidden", !isTimetables);
    el.workloadCol.classList.toggle("hidden", !isWorkload);
    if (el.workflowCol) el.workflowCol.classList.toggle("hidden", !isWorkflow);
    if (el.calculatorCol) el.calculatorCol.classList.toggle("hidden", !isCalculator);
  }

  function normalize(s) {
    return (s || "").toLowerCase();
  }

  function entryMatchesQuery(entry, q) {
    if (!q) return true;
    const hay = [
      entry.code,
      entry.title,
      ...(entry.keywords || []),
      ...Object.values(entry.conditionsText || {}),
      ...Object.values(entry.documentationText || {}),
    ]
      .map(normalize)
      .join(" • ");
    return q
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => hay.includes(term));
  }

  function typeBadgeClass(type) {
    if (type.startsWith("IA")) return "badge type-ia";
    if (type.startsWith("IB")) return "badge type-ib";
    if (type.startsWith("II")) return "badge type-ii";
    return "badge";
  }

  // Nav-only display shortening: "IB (unforeseen)" wraps awkwardly in the ~250px-wide browse
  // column cards. The detail panel (which has room) keeps showing the full type text.
  function navBadgeLabel(type) {
    return type === "IB (unforeseen)" ? "IB (unf.)" : type;
  }

  // How a variant should be labelled in the Summary: the code suffix and whether a subtitle
  // is worth showing. Some variants (e.g. the "z-ib"/"z-ii" catch-all pair behind a single
  // "(z) Other variation" label) already carry their own bracketed short form in the label --
  // for those, use that short form ("z") instead of the raw internal id ("z-ib"), and skip the
  // subtitle since it would just repeat the same text with no extra information.
  function summaryLabelInfo(entry, variant) {
    if (!variant.id) return { code: entry.code, subtitle: null };
    const bracketMatch = variant.label && variant.label.trim().match(/^\(([^)]+)\)/);
    if (bracketMatch) {
      const shortId = bracketMatch[1];
      // Entries whose own code already ends in e.g. ".z" (M.z, Q.III.z, ...) would otherwise
      // get a redundant "(z)" suffix repeating what the code already says.
      const redundant = entry.code.endsWith(`.${shortId}`);
      return { code: redundant ? entry.code : `${entry.code}(${shortId})`, subtitle: null };
    }
    return { code: `${entry.code}(${variant.id})`, subtitle: variant.label || null };
  }

  // The type actually applicable right now, given which conditions are ticked. For Type IA
  // (incl. IAIN) variants with conditions, that's IB by default until all conditions are met.
  function effectiveVariantType(entry, variant) {
    if (variant.type.startsWith("IA") && variant.conditions.length > 0) {
      const checked = state.checkedConditions[conditionKey(entry.code, variant.id)] || new Set();
      const allMet = variant.conditions.every((c) => checked.has(c));
      if (!allMet) return { label: "IB (default)", badgeClass: "badge type-ib" };
    }
    return { label: variant.type, badgeClass: typeBadgeClass(variant.type) };
  }

  function subsectionHeading(entry) {
    if (entry.listGroup) return entry.listGroup;
    const chSections = SECTIONS[entry.chapter];
    if (!chSections || !entry.section) return null;
    const sec = chSections[entry.section];
    if (!sec) return null;
    if (entry.subsection && sec.subsections && sec.subsections[entry.subsection]) {
      return `${entry.chapter}.${entry.section}.${entry.subsection}) ${sec.subsections[entry.subsection]}`;
    }
    return `${entry.chapter}.${entry.section} — ${sec.title}`;
  }

  // True only for a real subsection-level heading (e.g. "Q.V.a) PMF/VAMF" or an E/C/M
  // listGroup) -- false for the coarse whole-section fallback subsectionHeading() returns when
  // a section has no finer subsections (e.g. "Q.III — CEP/TSE/Monographs"). That fallback just
  // repeats what the section row / breadcrumb already say, so callers use this to avoid
  // showing it a second time as if it were a meaningful sub-heading.
  function isGenuineSubsectionHeading(entry) {
    if (entry.listGroup) return true;
    const chSections = SECTIONS[entry.chapter];
    const sec = chSections && entry.section ? chSections[entry.section] : null;
    return !!(sec && entry.subsection && sec.subsections && sec.subsections[entry.subsection]);
  }

  function defaultGroupOpen(entry) {
    const chSections = SECTIONS[entry.chapter];
    const sec = chSections && entry.section ? chSections[entry.section] : null;
    return !!(sec && sec.autoExpandGroups);
  }

  // Accordion: at most one group is ever open. If the user has explicitly opened a
  // heading, that one wins and every other heading is forced closed. Otherwise a
  // heading falls back to its section default, unless the user explicitly closed it.
  function isHeadingOpen(heading, entry) {
    if (state.openHeading !== null) return state.openHeading === heading;
    if (state.forcedClosedHeadings.has(heading)) return false;
    return defaultGroupOpen(entry);
  }

  function jumpToTop() {
    el.appRoot.scrollIntoView({ block: "start", behavior: "auto" });
  }

  // Deep-linking: reflects the currently open entry in the page URL (?code=Q.I.a) via
  // replaceState, so no extra back-button history entry is created for every click. Read
  // back on page load by openEntryFromUrl() so a link with ?code=... reopens that exact
  // entry instead of the app's default Summary view.
  function syncUrlToState() {
    const url = new URL(window.location.href);
    if (state.activeVariant) {
      url.searchParams.set("code", state.activeVariant.code);
    } else {
      url.searchParams.delete("code");
    }
    if (url.toString() !== window.location.href) {
      window.history.replaceState(null, "", url.toString());
    }
  }

  // Navigates the browse tree to one entry. Shared by the ?code= deep link and the code chips
  // in the Q&A answers -- both mean "show me this classification entry", and doing it in one
  // place keeps a chip from landing in a subtly different state than a shared link would.
  // Returns false for a code this dataset doesn't have, so callers can decline to link it.
  function openEntryByCode(code, variantId) {
    const entry = ENTRIES.find((e) => e.code === code);
    if (!entry) return false;
    state.classifyOpen = true;
    state.guidanceOpen = false;
    state.activeChapter = entry.chapter;
    state.activeSection = entry.section || null;
    // Default to the entry's first variant -- a shared/deep link should land straight on full
    // content rather than the collapsed list, even though the link itself only names the entry.
    const known = variantId != null && entry.variants.some((v) => v.id === variantId);
    state.activeVariant = {
      code: entry.code,
      variantId: known ? variantId : entry.variants[0] ? entry.variants[0].id : null,
    };
    state.view = "browse";
    const heading = subsectionHeading(entry);
    if (heading) {
      state.openHeading = heading;
      state.forcedClosedHeadings.delete(heading);
    }
    return true;
  }

  function openEntryFromUrl() {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) openEntryByCode(code);
  }

  // Renders `matches` into `container`, optionally grouped into collapsible subsection
  // headings (Q's Q.I.a/Q.I.b/... and M's flat listGroup headings) -- the same
  // accordion-of-at-most-one behaviour as the chapter/section levels, driven by
  // isHeadingOpen(). Ungrouped for the flat global-search list, where headings would mix
  // entries from unrelated chapters.
  //
  // Entries themselves are no longer rendered as cards here -- only the (collapsible) heading
  // structure is built in `container` (the left nav). Whichever entries are currently "in
  // scope" (i.e. would previously have shown a card) are pushed to the module-level
  // `visibleEntries` array instead; renderDetail() picks that up afterwards and renders those
  // entries, stacked, in the detail panel.
  function renderEntryGroup(container, matches, grouped) {
    if (matches.length === 0) return;

    // Appended to `container` only at the end, and only if it actually gained a child (a
    // group-toggle heading) -- for a fully ungrouped/flat set of entries (nothing but pushes to
    // visibleEntries happen below) this would otherwise sit in the nav as a dead, empty,
    // padded box now that the entries themselves no longer render as cards inside it.
    const list = document.createElement("div");
    list.className = "results-list";

    let lastHeading = undefined;
    let groupIsOpen = false; // whether the currently-iterated heading group is open (or ungrouped, always "open")

    matches.forEach((entry) => {
      const heading = grouped ? subsectionHeading(entry) : null;

      if (heading !== lastHeading) {
        lastHeading = heading;
        groupIsOpen = false;

        if (heading && defaultGroupOpen(entry)) {
          // Sections whose subsections.autoExpandGroups is set (Q.III/IV/V/z...) are small
          // enough that their heading(s) are always fully shown -- there is no real choice a
          // nav-level toggle could offer here (it would just sit permanently open), so it's
          // skipped entirely. Entries go straight into visibleEntries; if more than one such
          // heading ends up mixed together (e.g. Q.V.a + Q.V.b), renderDetail() tells them
          // apart with a plain inline heading instead of a nav box.
          groupIsOpen = true;
        } else if (heading) {
          const isOpen = isHeadingOpen(heading, entry);
          const groupEntries = matches.filter((e) => subsectionHeading(e) === heading);
          const countInGroup = groupEntries.length;
          const firstCode = groupEntries[0].code;
          const lastCode = groupEntries[groupEntries.length - 1].code;
          const codeRange = firstCode === lastCode ? firstCode : `${firstCode}–${lastCode}`;

          // Chapters with a Section level (Q) already carry their code inline in the heading
          // text itself (e.g. "Q.I.a) Manufacture"). Chapters without one (currently only M)
          // pass a plain listGroup string instead -- show the chapter code as its own chip so
          // this level looks the same as .section-row's code+title pair.
          const codeChip = entry.listGroup ? entry.chapter : null;

          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "group-toggle" + (isOpen ? " group-toggle--open" : "");
          toggle.innerHTML = `
            ${codeChip ? `<span class="group-toggle__code">${codeChip}</span>` : ""}
            <span class="group-toggle__label">${heading}<span class="group-toggle__range">${codeRange}</span></span>
            <span class="group-toggle__count">${countInGroup}</span>
          `;
          toggle.addEventListener("click", () => {
            if (isOpen) {
              // User is closing the open heading.
              if (state.openHeading === heading) state.openHeading = null;
              state.forcedClosedHeadings.add(heading);
            } else {
              // User is opening a heading -> accordion: it becomes the only open one.
              state.openHeading = heading;
              state.forcedClosedHeadings.delete(heading);
            }
            // Direct tree navigation always wins over a stale search -- otherwise the toggle
            // visibly opens/closes here while the detail panel keeps showing search matches
            // instead, since those take priority over tree state whenever state.query is set.
            state.query = "";
            el.search.value = "";
            renderBrowse();
            renderDetail();
            el.detailCol.scrollTop = 0;
          });
          list.appendChild(toggle);

          groupIsOpen = isOpen;
        } else {
          groupIsOpen = true; // ungrouped (flat search list, or a chapter/listGroup-less entry)
        }
      }

      // Collapsed group -> this entry isn't in scope yet.
      if (!groupIsOpen) return;

      visibleEntries.push(entry);
    });

    if (list.children.length > 0) container.appendChild(list);
  }

  // Level 2: one section row (Q.I, Q.II, ...) nested inside the open Q chapter branch. Only
  // one section is ever open at a time; opening it reveals its entries (grouped by
  // subsection) directly beneath, instead of in a separate results column.
  function renderSectionBranch(container, chapter, secKey) {
    const secMeta = SECTIONS[chapter.code][secKey];
    const hasData = ENTRIES.some((e) => e.chapter === chapter.code && e.section === secKey);
    const isOpen = state.activeSection === secKey;

    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "section-row" + (isOpen ? " section-row--active" : "") + (!hasData ? " section-row--pending" : "");
    row.innerHTML = `
      <span class="section-row__code">${chapter.code}.${secKey}</span>
      <span class="section-row__title">${secMeta.title}</span>
    `;
    row.addEventListener("click", () => {
      state.activeSection = state.activeSection === secKey ? null : secKey;
      state.activeVariant = null;
      state.openHeading = null;
      state.forcedClosedHeadings.clear();
      state.query = "";
      el.search.value = "";
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      el.detailCol.scrollTop = 0;
      jumpToTop();
    });
    container.appendChild(row);

    if (!isOpen) return;

    // Same deferred-append pattern as .chapter__body/.results-list above -- only added to the
    // DOM once it's known to actually contain something.
    const body = document.createElement("div");
    body.className = "subsection-body";

    if (!hasData) {
      const div = document.createElement("div");
      div.className = "empty-note";
      div.textContent = `${chapter.code}.${secKey} — ${secMeta.title} is in preparation and will be added in a later pass.`;
      body.appendChild(div);
      container.appendChild(body);
      return;
    }

    const matches = ENTRIES.filter((e) => e.chapter === chapter.code && e.section === secKey);
    renderEntryGroup(body, matches, true);
    if (body.children.length > 0) container.appendChild(body);
  }

  // Level 1: one chapter (E, Q, C, M). Exactly one chapter is active at a time -- clicking a
  // chapter switches to it and resets section/entry selection, same as the old tab behaviour.
  function renderChapterBranch(container, chapter) {
    const isActive = chapter.code === state.activeChapter;

    const wrap = document.createElement("div");
    wrap.className = "chapter" + (chapter.status === "in-preparation" ? " chapter--pending" : "");
    wrap.dataset.open = isActive ? "true" : "false";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "chapter__head";
    head.innerHTML = `
      <span class="chapter__code">${chapter.code}</span>
      <span class="chapter__title">${chapter.title}</span>
      ${chapter.status === "in-preparation" ? '<span class="tab__pill">in preparation</span>' : ""}
      ${chapter.status === "partial" ? '<span class="tab__pill tab__pill--partial">partial</span>' : ""}
    `;
    head.addEventListener("click", () => {
      // Clicking the already-open chapter collapses it back to just the top-level list.
      state.activeChapter = state.activeChapter === chapter.code ? null : chapter.code;
      state.activeVariant = null;
      state.activeSection = null;
      state.openHeading = null;
      state.forcedClosedHeadings.clear();
      state.query = "";
      el.search.value = "";
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      el.detailCol.scrollTop = 0;
      jumpToTop();
    });
    wrap.appendChild(head);

    if (isActive) {
      // Appended to `wrap` only at the end, and only if it actually gained a child -- for a
      // chapter whose entries are all ungrouped/flat (nothing but pushes to visibleEntries
      // happen inside renderEntryGroup below), this would otherwise sit as a dead, empty,
      // padded box under the chapter head, showing up as a stray gap before the next chapter.
      const body = document.createElement("div");
      body.className = "chapter__body";

      if (chapter.status === "in-preparation") {
        const div = document.createElement("div");
        div.className = "empty-note";
        div.textContent = `Chapter ${chapter.code} — ${chapter.title} is in preparation and will be added in a later pass.`;
        body.appendChild(div);
      } else if (SECTIONS[chapter.code]) {
        // Chapters with an internal I/II/III... structure (currently only Q): section rows
        // nest directly here; entries only appear once the user picks one.
        Object.keys(SECTIONS[chapter.code]).forEach((secKey) => renderSectionBranch(body, chapter, secKey));
      } else {
        if (chapter.status === "partial" && chapter.generalNote) {
          const note = document.createElement("div");
          note.className = "partial-note";
          note.textContent = chapter.generalNote;
          body.appendChild(note);
        }
        const matches = ENTRIES.filter((e) => e.chapter === chapter.code);
        renderEntryGroup(body, matches, true);
      }

      if (body.children.length > 0) wrap.appendChild(body);
    }

    container.appendChild(wrap);
  }

  // Only the intro (head + general notes) is shown in full; the three example lists are long,
  // so each sits behind its own toggle and only the clicked one(s) expand -- otherwise this view
  // was a wall of 52 bullet points to scroll past before reaching anything else.
  function renderGrouping() {
    const g = GROUPING_GUIDANCE;

    // No chevron (removed on feedback) -- the badge itself is the whole clickable row. At
    // most one category is ever open (state.groupingOpen holds a single key, not a Set):
    // opening one closes whichever was open before.
    const section = (key, badgeClass, label, items) => {
      const isOpen = state.groupingOpen === key;
      return `
        <div class="grouping-section">
          <button type="button" class="grouping-section__title" data-grouping-toggle="${key}">
            <span class="grouping-section__badge ${badgeClass}">${label}</span>
            <span class="grouping-section__count">${items.length}</span>
          </button>
          ${isOpen ? `<ul class="grouping-list">${items.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
        </div>
      `;
    };

    el.groupingCol.innerHTML = `
      <div class="grouping-head">
        <h3>${g.title}</h3>
        <p>${g.source.docTitle}.</p>
        <p class="ref-line">Reference: ${referenceText("grouping", `${g.source.docRef} (${g.source.docDate})`)}</p>
        <p class="ref-updated">Last updated in Variation Toolbox: ${lastUpdated("grouping", g.lastUpdated)}</p>
      </div>
      <ul class="grouping-notes">${g.generalNotes.map((t) => `<li>${t}</li>`).join("")}</ul>
      ${section("acceptable", "grouping-section__badge--ok", "Acceptable groupings", g.acceptable)}
      ${section("notAcceptable", "grouping-section__badge--no", "Not acceptable groupings", g.notAcceptable)}
      ${section("singleChangeInstead", "grouping-section__badge--alt", "Acceptable as single change instead of grouping", g.singleChangeInstead)}
      <p class="grouping-source">¹ ${g.footnote}</p>
      <p class="grouping-source">Source: ${g.source.docRef} (${g.source.docDate}) — ${g.source.docTitle}.</p>
    `;

    el.groupingCol.querySelectorAll("[data-grouping-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.groupingToggle;
        const opening = state.groupingOpen !== key;
        state.groupingOpen = opening ? key : null;
        renderGrouping();
        // When opening a section, scroll its list into view at the top of .grouping-col's own
        // scroll container -- otherwise the list renders below the fold and the user has to
        // scroll up manually to find where it starts.
        if (opening) {
          const reopened = el.groupingCol.querySelector(`[data-grouping-toggle="${key}"]`);
          if (reopened) reopened.scrollIntoView({ block: "start" });
        }
      });
    });
  }

  // Escapes the literal "<...>"/"{...}" bracket-choice placeholders used throughout the source
  // guideline text (e.g. "<active substance>") before it goes through innerHTML below -- without
  // this, the browser would parse them as (unknown, content-swallowing) HTML tags instead of
  // showing them as text. The one deliberate bit of real HTML per item (the code-chip span) is
  // added by the caller after escaping, not before.
  function escapePreciseScopeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Looks up the PRECISE_SCOPE_GUIDANCE example wording for a specific classification code +
  // variant (e.g. entry "Q.II.b.1" + variant "a" -> "Q.II.b.1.a"), for the Summary's own
  // "Precise scope wording" note and the .docx export. Only ~284 of the classification's many
  // codes have a matching example in the source guideline, so this returns null for the rest --
  // callers hide the whole section in that case rather than showing an empty placeholder.
  function findPreciseScopeWording(entry, variant) {
    const target = variant.id ? `${entry.code}.${variant.id}` : entry.code;
    for (const section of PRECISE_SCOPE_GUIDANCE.sections) {
      for (const item of section.items) {
        if (
          item.code
            .split(",")
            .map((c) => c.trim())
            .includes(target)
        ) {
          return item;
        }
      }
    }
    return null;
  }

  // Same "one section open at a time" accordion as renderGrouping() above, just driven by a
  // data-defined list of sections (PRECISE_SCOPE_GUIDANCE.sections) instead of three hardcoded
  // ones, since this guideline's examples are grouped by classification chapter rather than by
  // acceptable/not-acceptable. Reuses the exact same grouping-* markup/CSS -- including .code-chip
  // (already used for inline code references in GROUPING_GUIDANCE.singleChangeInstead) for each
  // example's classification code.
  function renderPreciseScope() {
    const g = PRECISE_SCOPE_GUIDANCE;

    const section = (sec) => {
      const isOpen = state.preciseScopeOpen === sec.key;
      return `
        <div class="grouping-section">
          <button type="button" class="grouping-section__title" data-precise-scope-toggle="${sec.key}">
            <span class="grouping-section__badge grouping-section__badge--alt">${sec.label}</span>
            <span class="grouping-section__count">${sec.items.length}</span>
          </button>
          ${
            isOpen
              ? `<ul class="grouping-list">${sec.items
                  .map(
                    (it) =>
                      `<li><span class="code-chip">${it.code}</span> ${escapePreciseScopeText(it.text)}</li>`
                  )
                  .join("")}</ul>`
              : ""
          }
        </div>
      `;
    };

    el.preciseScopeCol.innerHTML = `
      <div class="grouping-head">
        <h3>${g.title}</h3>
        <p>${g.source.docTitle}.</p>
        <p class="ref-line">Reference: ${referenceText("precisescope", `${g.source.docRef} (${g.source.docDate})`)}</p>
        <p class="ref-updated">Last updated in Variation Toolbox: ${lastUpdated("precisescope", g.lastUpdated)}</p>
      </div>
      <ul class="grouping-notes">${g.generalNotes.map((t) => `<li>${escapePreciseScopeText(t)}</li>`).join("")}</ul>
      ${g.sections.map(section).join("")}
      <p class="grouping-source">Source: ${g.source.docRef} (${g.source.docDate}) — ${g.source.docTitle}.</p>
    `;

    el.preciseScopeCol.querySelectorAll("[data-precise-scope-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.preciseScopeToggle;
        const opening = state.preciseScopeOpen !== key;
        state.preciseScopeOpen = opening ? key : null;
        renderPreciseScope();
        if (opening) {
          const reopened = el.preciseScopeCol.querySelector(`[data-precise-scope-toggle="${key}"]`);
          if (reopened) reopened.scrollIntoView({ block: "start" });
        }
      });
    });
  }

  // ==========================================================================================
  // Q&A on Variations (CMDh/132/2009) -- the third document in the Guidance branch, rendered
  // from the generated vcl-qa-data.js. Same accordion language as its two siblings; the extra
  // machinery here is what this particular document brings with it: withdrawn questions it
  // keeps in place, its own filter box, and the classification codes its answers cite.
  // ==========================================================================================

  // A code as it appears in an answer ("C.3.b", "Q.II.b.4", "Q.V.b.1.a"). Guarded against
  // "E.g" -- a sentence-initial "e.g." is not a chapter-E code, and it is the one string in the
  // document that matches the shape by accident.
  const QA_CODE_RE = /\b(?!E\.g\b)([EQCM](?:\.(?:[IVX]+|[a-z]|\d+|z))+)\b/g;

  // Splits "Q.II.b.4" into the entry it belongs to and, where the last part names one, that
  // entry's variant -- the same entry-code + "." + variant-id key findPreciseScopeWording()
  // builds. Returns null for a code this dataset has no entry for (the source cites a handful,
  // e.g. Q.I.z, that the Classification Guideline transcription doesn't carry), so those render
  // as plain text rather than as a link that would go nowhere.
  function qaResolveCode(code) {
    if (ENTRIES.some((e) => e.code === code)) return { code: code, variantId: null };
    const cut = code.lastIndexOf(".");
    if (cut > 0) {
      const parent = code.slice(0, cut);
      const vid = code.slice(cut + 1);
      const entry = ENTRIES.find((e) => e.code === parent);
      if (entry && entry.variants.some((v) => v.id === vid)) return { code: parent, variantId: vid };
    }
    return null;
  }

  function qaLinkifyCodes(escaped) {
    return escaped.replace(QA_CODE_RE, (match) => {
      const hit = qaResolveCode(match);
      if (!hit) return '<span class="code-chip code-chip--plain">' + match + "</span>";
      return (
        '<button type="button" class="code-chip code-chip--link" data-qa-code="' +
        hit.code +
        '" data-qa-variant="' +
        (hit.variantId == null ? "" : hit.variantId) +
        '" title="Open ' + match + ' in Classification">' + match + "</button>"
      );
    });
  }

  // escapePreciseScopeText() first, for the same reason it exists there: the source text carries
  // literal angle brackets, and unescaped they would be parsed as (content-swallowing) tags.
  function qaText(text) {
    return qaLinkifyCodes(escapePreciseScopeText(text));
  }

  function qaMatches(q, needle) {
    if (!needle) return true;
    const hay = (q.id + " " + q.q + " " + q.a.map((p) => p.text).join(" ")).toLowerCase();
    return needle.split(/\s+/).every((w) => hay.includes(w));
  }

  function qaVisibleQuestions() {
    const needle = state.qaQuery.trim().toLowerCase();
    return QA_DATA.questions.filter(
      (q) => (state.qaShowDeleted || !q.deleted) && qaMatches(q, needle)
    );
  }

  function renderQA() {
    if (!QA_DATA || !el.qaCol) return;
    const m = QA_DATA.meta;
    const visible = qaVisibleQuestions();
    const filtering = !!state.qaQuery.trim();
    const deletedCount = QA_DATA.questions.filter((q) => q.deleted).length;

    const questionRow = (q) => {
      const isOpen = state.qaOpenQuestion === q.id;
      const body = q.deleted
        ? '<div class="qa-a qa-a--deleted">This question was deleted from the guideline in ' + q.deleted + ".</div>"
        : '<div class="qa-a">' + qaAnswerHtml(q) + "</div>";
      return (
        '<div class="qa-item' + (q.deleted ? " qa-item--deleted" : "") + '">' +
        '<button type="button" class="qa-q' + (isOpen ? " qa-q--open" : "") + '" data-qa-toggle="' + q.id + '">' +
        '<span class="qa-no">' + q.id + "</span>" +
        '<span class="qa-title">' + escapePreciseScopeText(q.q) + "</span>" +
        (q.deleted ? '<span class="qa-flag">deleted</span>' : "") +
        "</button>" +
        (isOpen ? body : "") +
        "</div>"
      );
    };

    const chapterSection = (ch) => {
      const qs = visible.filter((q) => String(q.ch) === ch.key);
      if (filtering && qs.length === 0) return "";
      // While filtering, every chapter that still has a hit is open: the point of a filter is to
      // show what matched, not to make the user hunt for it behind five closed accordions.
      const isOpen = filtering || state.qaOpenChapter === ch.key;
      return (
        '<div class="grouping-section">' +
        '<button type="button" class="grouping-section__title" data-qa-chapter="' + ch.key + '">' +
        '<span class="grouping-section__badge grouping-section__badge--alt">' + ch.key + ". " + ch.title + "</span>" +
        '<span class="grouping-section__count">' + qs.length + "</span>" +
        "</button>" +
        (isOpen ? '<div class="qa-list">' + qs.map(questionRow).join("") + "</div>" : "") +
        "</div>"
      );
    };

    el.qaCol.innerHTML =
      '<div class="grouping-head">' +
      "<h3>Q&amp;A on Variations</h3>" +
      "<p>" + escapePreciseScopeText(m.docTitle) + ".</p>" +
      '<p class="ref-line">Reference: ' + referenceText("qa", m.docRef + " (" + m.docDate + ")") + "</p>" +
      '<p class="ref-updated">Last updated in Variation Toolbox: ' + lastUpdated("qa", m.lastUpdated) + "</p>" +
      "</div>" +
      '<div class="qa-controls">' +
      '<input type="text" id="vcl-qaSearch" class="qa-search" placeholder="Filter questions and answers…" autocomplete="off" value="' +
      escapePreciseScopeText(state.qaQuery) + '" />' +
      '<label class="qa-deleted-toggle"><input type="checkbox" id="vcl-qaShowDeleted"' +
      (state.qaShowDeleted ? " checked" : "") + " /> Show " + deletedCount + " deleted questions</label>" +
      "</div>" +
      (filtering
        ? '<p class="results-meta results-meta--detail">' + visible.length +
          (visible.length === 1 ? " question matches" : " questions match") + " your filter</p>"
        : "") +
      (filtering && visible.length === 0
        ? '<p class="classification-empty-hint">No matching question. Try a different code or keyword.</p>'
        : QA_DATA.chapters.map(chapterSection).join("")) +
      qaRevisionsHtml() +
      '<p class="grouping-source">Source: ' + m.docRef + " (" + m.docDate + ") &mdash; " +
      '<a href="' + m.url + '" target="_blank" rel="noopener noreferrer">hma.eu</a>. ' +
      "Reproduced for reference; the original document remains authoritative.</p>";

    el.qaCol.querySelectorAll("[data-qa-chapter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.qaChapter;
        state.qaOpenChapter = state.qaOpenChapter === key ? null : key;
        state.qaOpenQuestion = null;
        renderQA();
      });
    });
    el.qaCol.querySelectorAll("[data-qa-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.qaToggle;
        state.qaOpenQuestion = state.qaOpenQuestion === id ? null : id;
        renderQA();
        const again = el.qaCol.querySelector('[data-qa-toggle="' + id + '"]');
        if (again && state.qaOpenQuestion === id) again.scrollIntoView({ block: "nearest" });
      });
    });
    el.qaCol.querySelectorAll("[data-qa-code]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const variant = btn.dataset.qaVariant;
        if (!openEntryByCode(btn.dataset.qaCode, variant === "" ? null : variant)) return;
        renderBrowse();
        switchViewVisibility();
        renderDetail();
        jumpToTop();
      });
    });

    const search = el.qaCol.querySelector("#vcl-qaSearch");
    if (search) {
      search.addEventListener("input", () => {
        state.qaQuery = search.value;
        state.qaOpenQuestion = null;
        renderQA();
        // Re-focus and restore the caret: the input is rebuilt on every keystroke by the
        // innerHTML above, which would otherwise drop focus after the first character.
        const next = el.qaCol.querySelector("#vcl-qaSearch");
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
    }
    const showDeleted = el.qaCol.querySelector("#vcl-qaShowDeleted");
    if (showDeleted) {
      showDeleted.addEventListener("change", () => {
        state.qaShowDeleted = showDeleted.checked;
        state.qaOpenQuestion = null;
        renderQA();
      });
    }
  }

  function qaAnswerHtml(q) {
    let html = "";
    let list = [];
    const flushList = () => {
      if (list.length) html += "<ul class=\"qa-bullets\">" + list.join("") + "</ul>";
      list = [];
    };
    q.a.forEach((p) => {
      if (p.t === "li") {
        list.push("<li>" + qaText(p.text) + "</li>");
        return;
      }
      flushList();
      html += "<p>" + qaText(p.text) + "</p>";
    });
    flushList();
    return html;
  }

  // The source's own revision table. Shown as a table and nothing more: it describes each
  // revision in prose and never names the questions it touched, so it cannot drive per-question
  // "changed in Rev. N" badges the way REVISION_HISTORY does for the classification codes.
  function qaRevisionsHtml() {
    if (!QA_DATA.revisions.length) return "";
    return (
      '<div class="qa-revisions"><h4>Revision history of the source document</h4><table><tbody>' +
      QA_DATA.revisions
        .map(
          (r) =>
            "<tr><th>Rev. " + r.rev + "</th><td>" + escapePreciseScopeText(r.summary) +
            '</td><td class="qa-rev-date">' + r.date + "</td></tr>"
        )
        .join("") +
      "</tbody></table></div>"
    );
  }

  // ==========================================================================================
  // Art. 5 recommendations -- the fifth Classification chapter (see the nav row after E/Q/C/M).
  // Where the four guideline chapters classify a change against a written category, this is how
  // a change with no category gets classified: the CMDh issues a recommendation under Art. 5.
  //
  // Two facts shape the view. The live list is currently empty -- the recommendations in force
  // until 15 Jan 2026 were folded into the new guideline, so today there is a status notice
  // rather than a list, and it will fill again as the CMDh issues new ones. The 52 historical
  // recommendations are an archive in the OLD A/B/C nomenclature, so (unlike the Q&A) their
  // codes are shown as plain labels, not links into the current E/Q/C/M entries.
  // ==========================================================================================

  // Keeps the numbered sub-lists in a "conditions" cell readable: the source wraps them with
  // newlines and indentation, which collapse to one run without this.
  function art5Multiline(text) {
    return escapePreciseScopeText(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("<br>");
  }

  function art5Badge(rec) {
    if (rec.typeClean) {
      return '<span class="' + typeBadgeClass(rec.typeBadge) + '">' + rec.typeBadge + rec.typeStar + "</span>";
    }
    // Prose classifications ("No change necessary", "Article 61(3) notification", ...) are kept
    // verbatim, without a coloured type pill they are not.
    return '<span class="art5-prose-type">' + escapePreciseScopeText(rec.type) + "</span>";
  }

  function art5RecHtml(rec) {
    const cond = rec.conditions && rec.conditions.trim() && rec.conditions.trim() !== "N/A"
      ? '<div class="art5-rec__cond"><span class="art5-rec__cond-label">Conditions:</span> ' + art5Multiline(rec.conditions) + "</div>"
      : "";
    return (
      '<div class="art5-rec">' +
      '<div class="art5-rec__head">' +
      art5Badge(rec) +
      (rec.code && rec.code !== "N/A" ? '<span class="art5-rec__code">' + escapePreciseScopeText(rec.code) + "</span>" : "") +
      (rec.date ? '<span class="art5-rec__date">' + rec.date + "</span>" : "") +
      "</div>" +
      '<div class="art5-rec__change">' + escapePreciseScopeText(rec.change) + "</div>" +
      cond +
      "</div>"
    );
  }

  function art5Matches(rec, needle) {
    if (!needle) return true;
    const hay = (rec.code + " " + rec.change + " " + rec.conditions + " " + rec.type + " " + rec.group).toLowerCase();
    return needle.split(/\s+/).every((w) => hay.includes(w));
  }

  function renderArt5() {
    if (!ART5_DATA || !el.art5Col) return;
    const m = ART5_DATA.meta;
    const needle = state.art5Query.trim().toLowerCase();
    const filtering = !!needle;
    const hist = ART5_DATA.historical.filter((r) => art5Matches(r, needle));

    // Group the historical recs by their source section header, preserving first-seen order.
    const groups = [];
    const byKey = new Map();
    hist.forEach((r) => {
      const key = r.group || "Other";
      if (!byKey.has(key)) {
        byKey.set(key, { key: key, recs: [] });
        groups.push(byKey.get(key));
      }
      byKey.get(key).recs.push(r);
    });

    const currentBlock = ART5_DATA.current.length
      ? '<div class="art5-current">' + ART5_DATA.current.map(art5RecHtml).join("") + "</div>"
      : '<div class="art5-status">' +
        "<strong>No Art. 5 recommendations are currently outstanding</strong> (as of " + m.asOf + "). " +
        "The recommendations in force until then were incorporated into the classification guideline " +
        "effective 15 January 2026; new recommendations appear here as the CMDh issues them." +
        "</div>";

    const groupSection = (g) => {
      const open = filtering || state.art5OpenGroup === g.key;
      return (
        '<div class="grouping-section">' +
        '<button type="button" class="grouping-section__title" data-art5-group="' + escapeAttr(g.key) + '">' +
        '<span class="grouping-section__badge grouping-section__badge--alt">' + escapePreciseScopeText(g.key) + "</span>" +
        '<span class="grouping-section__count">' + g.recs.length + "</span>" +
        "</button>" +
        (open ? '<div class="art5-list">' + g.recs.map(art5RecHtml).join("") + "</div>" : "") +
        "</div>"
      );
    };

    const footnotes = ART5_DATA.footnotes.length
      ? '<div class="art5-footnotes">' + ART5_DATA.footnotes.map((f) => "<p>" + escapePreciseScopeText(f) + "</p>").join("") + "</div>"
      : "";

    el.art5Col.innerHTML =
      '<div class="grouping-head">' +
      "<h3>Art. 5 Recommendations</h3>" +
      "<p>" + escapePreciseScopeText(m.title) + ". Where the guideline has no category for a change, the CMDh classifies it under Article 5.</p>" +
      '<p class="ref-line">Reference: ' + referenceText("art5", m.docRef + " (" + m.docDate + ")") + "</p>" +
      '<p class="ref-updated">Last updated in Variation Toolbox: ' + lastUpdated("art5", m.lastUpdated) + "</p>" +
      "</div>" +
      currentBlock +
      '<div class="art5-archive-head"><h4>Historical recommendations (superseded)</h4>' +
      "<p>Issued 2010&ndash;2023 and coded in the previous A/B/C nomenclature; kept for reference against earlier submissions, not for filing today.</p></div>" +
      '<div class="qa-controls">' +
      '<input type="text" id="vcl-art5Search" class="qa-search" placeholder="Filter the archive…" autocomplete="off" value="' +
      escapeAttr(state.art5Query) + '" />' +
      "</div>" +
      (filtering
        ? '<p class="results-meta results-meta--detail">' + hist.length +
          (hist.length === 1 ? " recommendation matches" : " recommendations match") + " your filter</p>"
        : "") +
      (filtering && hist.length === 0
        ? '<p class="classification-empty-hint">No matching recommendation. Try a different code or keyword.</p>'
        : groups.map(groupSection).join("")) +
      footnotes +
      '<p class="grouping-source">Source: ' + m.docRef + " &mdash; " +
      '<a href="' + m.url + '" target="_blank" rel="noopener noreferrer">hma.eu</a>. ' +
      "Reproduced for reference; the original document remains authoritative.</p>";

    el.art5Col.querySelectorAll("[data-art5-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.art5Group;
        state.art5OpenGroup = state.art5OpenGroup === key ? null : key;
        renderArt5();
      });
    });

    const search = el.art5Col.querySelector("#vcl-art5Search");
    if (search) {
      search.addEventListener("input", () => {
        state.art5Query = search.value;
        renderArt5();
        const next = el.art5Col.querySelector("#vcl-art5Search");
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
    }
  }

  // ==========================================================================================
  // Timetables view: day-by-day procedure timetables for Type IA/IB/II variations, reproduced
  // from the CMDh Best Practice Guide (Chapters 3-5). Self-contained -- content only depends
  // on the tt* state fields above, so it re-renders itself on every internal interaction
  // (tab/variant/compare clicks) rather than going through the main renderBrowse() flow.
  // ==========================================================================================

  // Fixed regardless of the active variation type (IA/IB/II), so the roles read consistently
  // across every tab instead of a lane's dot changing color when you switch tabs. See the
  // --tt-rms block in vcl-style.css for why these three.
  function ttLaneColorVar(lane) {
    if (lane === "rms") return "var(--tt-rms)";
    if (lane === "cms") return "var(--cms)";
    return "var(--tt-mah)"; // mah
  }

  // Manually maintained: update whenever the timetables below are re-checked against the
  // current CMDh Best Practice Guide chapters (not the same as the guide's own revision date).
  const TT_LAST_UPDATED = "2026-07-03";
  const TT_REFERENCE = "CMDh Best Practice Guide, Chapters 3–5";

  const TT_IA = {
    key: "ia",
    variant: null,
    stopMax: 0, // "Do and Tell": no clock-stop exists, so the graphic gets no slider
    run1: { from: 0, to: 30 },
    // Every timetable exposes lanes1; only the ones that actually run a second phase (a
    // clock-stop was set) also carry run2/clockoff/lanes2. `!!data.run2` is the single test
    // for "is this a two-phase procedure" throughout -- see ttCurrentData().
    lanes1: {
      rms: {
        ranges: [{ from: 0, to: 30, label: "Checks completeness & eligibility", style: "active" }],
        points: [{ day: 30, kind: "decision", title: "Day 30 – Outcome", desc: "RMS informs the MAH on behalf of all CMS: “Acknowledgement of an acceptable Notification”, or non-acceptance with brief reasons." }]
      },
      cms: {
        ranges: [{ from: 0, to: 30, label: "Checks receipt & fee only", style: "waiting" }],
        points: []
      },
      mah: {
        ranges: [],
        points: [{ day: 0, kind: "submission", title: "Submission (“Do and Tell”)", desc: "MAH submits the notification simultaneously to RMS and CMS (Annex IV). The change has already been implemented at this point." }]
      }
    },
    badges: ["No clock-stop possible", "No content-based CMS assessment"],
    intro: "Type IA is a pure notification under the <b>“Do and Tell”</b> principle — the change is already implemented at the time of submission. RMS only performs a formal completeness check; there is <b>no clock-stop</b> and no requests for clarification. Regular submission is as an <b>“Annual Update”</b> (earliest 9, latest 12 months after first implementation), except for IAIN-flagged changes (immediate individual notification).",
    implementation: "National implementation by the competent authorities within 6 months."
  };

  // hasStop: whether the clock-stop slider is set above zero. Without one the RMS never issues
  // a "Notification with Grounds", so there is no amended notification and no second window --
  // the procedure simply ends at the day-30 outcome (a notification the RMS doesn't answer
  // within 30 days is deemed accepted).
  function ttBuildIB(hasStop) {
    // offset shifts numeric day/from/to values onto the absolute chart axis;
    // label text always uses the *local* (0..30) day number, prefixed per phase.
    const mk = (prefix, offset) => ({
      rms: {
        ranges: [{ from: 0 + offset, to: 30 + offset, label: "Assesses the change", style: "active" }],
        points: [
          { day: 20 + offset, kind: "report", title: prefix + "20 – RMS position to CMS", desc: "Only needed for certain change categories (product name in a CMS, pack size, C.z / C.1–C.3 / C.6b–C.7 / C.11): RMS shares its position with CMS." },
          { day: 30 + offset, kind: "decision", title: prefix + "30 – Outcome", desc: offset > 0
            ? "Final acceptance or rejection. If the MAH does not respond to the “Notification with Grounds” in time, the variation is automatically rejected."
            : hasStop
            ? "Acceptance (Notification) — or, if rejected: “Notification with Grounds”, clock-stop begins."
            : "Acceptance (Notification), and the end of the procedure: the RMS raised no grounds, so no amended notification is needed. If the RMS does not respond at all within the 30 days, the notification is deemed accepted." }
        ]
      },
      cms: {
        ranges: [{ from: 0 + offset, to: 27 + offset, label: "Comments (relevant categories only)", style: "waiting" }],
        points: [{ day: 27 + offset, kind: "comment", title: prefix + "27 – CMS comments due", desc: "For affected change categories and, where applicable, national translations of the product information." }]
      },
      mah: {
        ranges: [],
        points: offset === 0
          ? [{ day: 0 + offset, kind: "submission", title: "Day 0 – Submission", desc: "MAH submits simultaneously to RMS and CMS; RMS creates the CTS record and informs the MAH of the start date (Day 0)." }]
          : [{ day: 0 + offset, kind: "submission", title: "New Day 0 – Amended notification", desc: "MAH has submitted an amended notification within 30 days; RMS restarts the clock." }]
      }
    });
    return {
      key: "ib",
      variant: null,
      stopMax: 30,
      run1: { from: 0, to: 30 },
      lanes1: mk("Day ", 0),
      ...(hasStop ? {
        clockoff: { label: "Clock-stop", detail: "max. 30 days — MAH submits an amended notification" },
        run2: { from: 30, to: 60 }, // absolute axis; displayed as "New Day 0..30"
        lanes2: mk("New Day ", 30)
      } : {}),
      // Stop-independent on purpose: the badges (like the intro below) describe the procedure
      // type in general, and only the shell renders them -- a slider drag repaints the graphic
      // and the list, not the head, so anything stop-dependent up here would go stale.
      badges: ["Clock-stop only on rejection", "No further clock-stop after an amended notification"],
      intro: "Type IB is a notification with a 30-day RMS assessment window. If the RMS does not respond, the notification is deemed accepted. On rejection, the MAH receives a <b>“Notification with Grounds”</b> and the clock stops until an amended notification is submitted — after which a second, final 30-day window runs.",
      implementation: "National implementation by the competent authorities within 6 months."
    };
  }

  function ttBuildII(variant, d, hasStop) {
    const breakoutPoint = d.breakout ? [{ day: d.breakout, kind: "meeting", title: "Day " + d.breakout + " – possible break-out meeting", desc: "In case of disagreement between RMS and CMS, a break-out meeting may be arranged (optional)." }] : [];
    const common = {
      key: "ii",
      variant: variant,
      stopMax: d.mahDays + d.rmsDays,
      badges: variant === "30" ? ["Recommended for safety / urgent cases"] : variant === "90" ? ["For indication changes & complex groupings"] : ["Standard procedure"],
      intro: variant === "30"
        ? "The <b>reduced 30-day procedure</b> is intended for safety-related or otherwise urgent changes. RMS proposes it proactively; CMS may object."
        : variant === "60"
        ? "The <b>60-day procedure</b> is the default timetable for Type II variations, including most indication changes."
        : "The <b>90-day procedure</b> applies to changes to, or addition of, the therapeutic indication requiring a more comprehensive assessment, as well as complex groupings under Art. 7(2)(c).",
      implementation: "National implementation by the competent authorities within 2 months of the end of the procedure."
    };
    const submission = { day: 0, kind: "submission", title: "Day 0 – Submission", desc: "MAH submits simultaneously to RMS and CMS (" + variant + "-day procedure)." };
    const pvarPoint = { day: d.pvar, kind: "report", title: "Day " + d.pvar + " – RMS circulates PVAR", desc: "Preliminary Variation Assessment Report to CMS and, for information, to the MAH." };
    const cms1Point = { day: d.cms1, kind: "comment", title: "Day " + d.cms1 + " – CMS comments on PVAR", desc: "No comment by this date is treated as endorsement of the PVAR." };

    // Clock-stop set to zero: the PVAR was endorsed and the RMS raised no Request for
    // Supplementary Information, so the clock never stopped. There is no MAH response and no
    // second assessment -- the RMS goes straight to the FVAR and the procedure ends there, on
    // the day after the RSI would have been issued (day 60 for the standard 60-day procedure).
    // Rare in practice, since authorities almost always do ask, but it is the timetable the
    // guide describes when they don't.
    if (!hasStop) {
      return {
        ...common,
        run1: { from: 0, to: d.fvar },
        lanes1: {
          rms: {
            ranges: [{ from: 0, to: d.fvar, label: "Assesses, prepares PVAR & FVAR", style: "active" }],
            points: [pvarPoint, { day: d.fvar, kind: "decision", title: "Day " + d.fvar + " – FVAR, outcome", desc: "The PVAR was endorsed and no Request for Supplementary Information was needed, so the clock never stopped: the RMS circulates the Final Variation Assessment Report and the procedure ends here — acceptance, rejection, or, in case of PSRPH disagreement by a CMS, referral to the CMDh." }]
          },
          cms: {
            ranges: [{ from: 0, to: d.cms1, label: "Assesses the PVAR", style: "waiting" }],
            points: [cms1Point]
          },
          mah: { ranges: [], points: [submission] }
        }
      };
    }

    return {
      ...common,
      run1: { from: 0, to: d.rsi },
      clockoff: {
        label: "Clock-off",
        detail: "max. " + d.mahDays + " + " + d.rmsDays + " days — MAH responds to the RSI, RMS prepares the FVAR",
        // Positioned inside the (non-day-scaled) clock-off box itself, at the point where the
        // MAH's response budget ends and the RMS's FVAR-preparation budget begins.
        mahAction: {
          title: "Response to RSI",
          desc: "MAH submits the response to the Request for Supplementary Information within max. " + d.mahDays + " days of the clock-stop.",
          fraction: d.mahDays / (d.mahDays + d.rmsDays)
        }
      },
      run2: { from: d.fvar, to: d.outcome },
      lanes1: {
        rms: {
          ranges: [{ from: 0, to: d.rsi, label: "Assesses, prepares PVAR", style: "active" }],
          points: [
            pvarPoint,
            { day: d.rsi, kind: "stop", title: "Day " + d.rsi + " – RSI, clock-stop", desc: "If not endorsed: Request for Supplementary Information to the MAH (copy to CMS). The clock stops for up to " + (d.mahDays + d.rmsDays) + " days in total — up to " + d.mahDays + " days for the MAH to respond, then up to " + d.rmsDays + " days for the RMS (authorities) to prepare the FVAR." }
          ]
        },
        cms: {
          ranges: [{ from: 0, to: d.cms1, label: "Assesses the PVAR", style: "waiting" }],
          points: [cms1Point]
        },
        mah: { ranges: [], points: [submission] }
      },
      lanes2: {
        rms: {
          ranges: [{ from: d.fvar, to: d.outcome, label: "Finalises the assessment", style: "active" }],
          points: [{ day: d.fvar, kind: "report", title: "Day " + d.fvar + " – RMS circulates FVAR", desc: "Final Variation Assessment Report to CMS and MAH; the clock resumes." }, ...breakoutPoint, { day: d.outcome, kind: "decision", title: "Day " + d.outcome + " – Outcome", desc: "Acceptance, rejection, or — in case of PSRPH disagreement by a CMS — referral to the CMDh." }]
        },
        cms: {
          ranges: [{ from: d.fvar, to: d.cms2, label: "Assesses the FVAR", style: "waiting" }],
          points: [{ day: d.cms2, kind: "comment", title: "Day " + d.cms2 + " – CMS comments on FVAR", desc: "Comments are generally limited to points not adequately addressed in the PVAR, or PSRPH concerns." }]
        },
        mah: { ranges: [], points: [] }
      }
    };
  }

  // mahDays/rmsDays split the clock-off budget: mahDays is the deadline for the MAH's
  // response to the RSI, rmsDays is the RMS's subsequent time to prepare the FVAR.
  const TT_II_DAYS = {
    "30": { pvar: 15, cms1: 20, rsi: 21, mahDays: 10, rmsDays: 10, fvar: 22, breakout: null, cms2: 25, outcome: 30 },
    "60": { pvar: 40, cms1: 55, rsi: 59, mahDays: 60, rmsDays: 60, fvar: 60, breakout: 75, cms2: 80, outcome: 90 },
    "90": { pvar: 70, cms1: 85, rsi: 89, mahDays: 90, rmsDays: 60, fvar: 90, breakout: 105, cms2: 110, outcome: 120 }
  };

  // The longest clock-stop the active type allows -- the slider's range, and the only thing
  // about the timetable that depends on the type alone rather than on the slider.
  function ttStopMax() {
    if (state.ttType === "ia") return 0; // "Do and Tell": no clock-stop exists
    if (state.ttType === "ib") return 30;
    const d = TT_II_DAYS[state.ttIIVariant];
    return d.mahDays + d.rmsDays;
  }

  // The clock-stop the slider is currently set to, in real calendar days.
  function ttStopDays() {
    const max = ttStopMax();
    return max ? Math.round(state.ttStopFraction * max) : 0;
  }

  // The timetable *shape* follows the slider: with the clock-stop at zero the authority never
  // came back with questions, so there is no second assessment and the procedure ends at the
  // first outcome. Both the graphic and the milestone list are built from this, so they can
  // never disagree about what happens.
  function ttCurrentData() {
    if (state.ttType === "ia") return TT_IA;
    const hasStop = ttStopDays() > 0;
    if (state.ttType === "ib") return ttBuildIB(hasStop);
    return ttBuildII(state.ttIIVariant, TT_II_DAYS[state.ttIIVariant], hasStop);
  }

  // Stable identity for a milestone regardless of which array it currently lives in --
  // used both to number diagram dots to match the list below, and to re-find a milestone
  // (for highlighting) after a full re-render. day is null for the one milestone that sits
  // inside the (non-day-scaled) clock-off box rather than on the day axis.
  function ttMilestoneKey(m) {
    return m.lane + "|" + m.phase + "|" + (m.day == null ? "clockoff" : m.day);
  }

  function ttFlatMilestones(data) {
    const out = [];
    const collect = (laneSet, phase) => {
      ["rms", "cms", "mah"].forEach((lane) => {
        (laneSet[lane].points || []).forEach((p) => out.push({ ...p, lane, phase }));
      });
    };
    collect(data.lanes1, 1);
    if (data.run2) {
      // Phase 1.5 so this sorts after everything before the clock-stop and before everything
      // once the clock resumes, without needing a real day number on the (excluded) axis.
      if (data.clockoff && data.clockoff.mahAction) {
        out.push({ lane: "mah", phase: 1.5, day: null, kind: "response", title: data.clockoff.mahAction.title, desc: data.clockoff.mahAction.desc });
      }
      collect(data.lanes2, 2);
    }
    out.sort((a, b) => (a.phase - b.phase) || (a.day - b.day));
    return out;
  }

  // Long day label, for the axis anchors and the milestone list. An IB clock-stop restarts the
  // 30-day clock, so its phase-2 days are numbered from zero again ("New Day 12"); everywhere
  // else the guideline numbering just runs on.
  function ttDayLabel(data, day, phase) {
    if (day == null) return "Clock-off";
    return data.key === "ib" && phase === 2 ? "New Day " + (day - data.run1.to) : "Day " + day;
  }
  // Short form for the pin above a dot, where space is measured in pixels.
  function ttDayShort(data, day, phase) {
    if (day == null) return "";
    return data.key === "ib" && phase === 2 ? "new d" + (day - data.run1.to) : "d" + day;
  }

  // Projects the guide's day numbers onto a single linear calendar axis running Day 0 -> EOP.
  // The two don't coincide: the guide's numbering *excludes* the clock-stop (day 59 is followed
  // by day 60 whether the clock was off for zero days or 150), so phase-2 days have to be
  // pushed right by the stop's real length before they can share one axis with phase 1. offset2
  // is picked so phase 2 begins exactly where the hatched clock-stop block ends -- no gap, no
  // overlap -- which is what makes the slider read as "this is what the pause costs you".
  function ttAxis(data, stop) {
    const twoPhase = !!data.run2;
    const offset2 = twoPhase ? data.run1.to + stop - data.run2.from : 0;
    const cal = (day, phase) => (phase === 2 ? day + offset2 : day);
    const total = Math.max(twoPhase ? cal(data.run2.to, 2) : data.run1.to, 1);
    return {
      twoPhase, cal, total, stop,
      stopStart: data.run1.to,
      stopEnd: data.run1.to + stop,
      pct: (calDay) => (calDay / total) * 100
    };
  }

  function renderTimetables() {
    const root = el.timetablesCol;
    const data = ttCurrentData();

    const tabDef = [
      { key: "ia", label: "Type IA" },
      { key: "ib", label: "Type IB" },
      { key: "ii", label: "Type II" }
    ];

    root.innerHTML = `
      <div class="tt-head">
        <h3>Timetables for Variation Procedures</h3>
        <p>Day 0 to the End of Procedure, on a real calendar-day axis — drag the clock-stop slider to see what an authority pause actually costs. Day numbers stay as the guide numbers them (the clock-stop is not counted). Click any milestone to highlight it below.</p>
        <p class="ref-line">Reference: ${referenceText("timetables", TT_REFERENCE)}</p>
        <p class="ref-updated">Last updated in Variation Toolbox: ${lastUpdated("timetables", TT_LAST_UPDATED)}</p>
      </div>
      <div class="tt-tabs" role="tablist">
        ${tabDef.map((t) => `<button type="button" class="tt-tab tt-tab--${t.key}${state.ttType === t.key ? " tt-tab--active" : ""}" data-tt-type="${t.key}"><span class="tt-dot"></span>${t.label}</button>`).join("")}
      </div>
      <p class="tt-sub">${data.intro}</p>
      <div class="tt-controls">
        ${state.ttType === "ii" ? `
          <div class="tt-seg" data-tt-variant-seg>
            <button type="button" data-tt-variant="30" class="${state.ttIIVariant === "30" ? "tt-active" : ""}">30 days</button>
            <button type="button" data-tt-variant="60" class="${state.ttIIVariant === "60" ? "tt-active" : ""}">60 days</button>
            <button type="button" data-tt-variant="90" class="${state.ttIIVariant === "90" ? "tt-active" : ""}">90 days</button>
          </div>
          <div class="tt-spacer"></div>
          <button type="button" class="tt-btn" data-tt-compare-toggle>${state.ttCompare ? "Back to timetable" : "Compare 30 / 60 / 90 days"}</button>
        ` : `<div class="tt-spacer"></div>`}
        <button type="button" class="tt-btn" data-tt-svg>Export SVG</button>
      </div>
      <div class="tt-callouts">
        ${data.badges.map((b) => `<div class="tt-callout">${b}</div>`).join("")}
        <div class="tt-callout"><b>After completion:</b> ${data.implementation}</div>
      </div>
      ${state.ttCompare && state.ttType === "ii" ? `<div class="tt-stage" data-tt-compare-body></div>` : `
        <div class="tt-stage">
          <div class="tt-tl" data-tt-tl></div>
          <div data-tt-slider></div>
        </div>
        <div class="tt-legend">
          <div class="tt-item"><span class="tt-swatch" style="background:var(--tt-rms)"></span>RMS action</div>
          <div class="tt-item"><span class="tt-swatch" style="background:var(--cms)"></span>CMS action</div>
          <div class="tt-item"><span class="tt-swatch" style="background:var(--tt-mah)"></span>MAH action</div>
          <div class="tt-item"><span class="tt-swatch tt-dash"></span>Clock-off (not counted towards the deadline)</div>
        </div>
        <div class="tt-stage">
          <div class="tt-milestone-list" data-tt-milestones></div>
        </div>
      `}
      <p class="tt-source"><b>Source:</b> HMA / CMDh Best Practice Guides on Variations — Chapter 3 (CMDh/293/2013, Rev.28, June 2026), Chapter 4 (CMDh/294/2013, Rev.29, Oct. 2025), Chapter 5 (CMDh/295/2013, Rev.28, Oct. 2025), hma.eu. Own graphical rendering for illustrative purposes only, not legally binding — the original guides remain authoritative.</p>
    `;

    root.querySelectorAll("[data-tt-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.ttType = btn.dataset.ttType;
        state.ttCompare = false;
        renderTimetables();
      });
    });

    const variantSeg = root.querySelector("[data-tt-variant-seg]");
    if (variantSeg) {
      variantSeg.querySelectorAll("[data-tt-variant]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.ttIIVariant = btn.dataset.ttVariant;
          renderTimetables();
        });
      });
    }

    const compareToggle = root.querySelector("[data-tt-compare-toggle]");
    if (compareToggle) {
      compareToggle.addEventListener("click", () => {
        state.ttCompare = !state.ttCompare;
        renderTimetables();
      });
    }

    // Re-read the data *and* the clock-stop at click time, not now: the slider may have
    // reshaped the timetable since, and the export has to be of what is on screen.
    root.querySelector("[data-tt-svg]").addEventListener("click", () => ttExportSVG(ttCurrentData(), ttStopDays()));

    if (state.ttCompare && state.ttType === "ii") {
      ttRenderCompare(root.querySelector("[data-tt-compare-body]"));
    } else {
      ttRenderStage(root); // paints the graphic and the milestone list together
    }
  }

  // One dot on a lane: the numbered, clickable milestone marker, with its guideline day number
  // pinned above it. The number inside the dot matches the numbering of the list below, so the
  // graphic and the list can be read against each other.
  function ttBuildPin(key, lane, leftPct, p, numberMap, dayText) {
    const pin = document.createElement("div");
    pin.className = "tt-tl-pin";
    pin.style.left = Math.min(Math.max(leftPct, 0), 100) + "%";
    if (dayText) {
      const dn = document.createElement("span");
      dn.className = "tt-tl-dn";
      dn.textContent = dayText;
      pin.appendChild(dn);
    }
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "tt-point";
    dot.style.background = ttLaneColorVar(lane);
    dot.dataset.key = key;
    dot.textContent = numberMap.get(key) || "";
    dot.title = p.title + "\n\n" + p.desc;
    dot.addEventListener("click", () => ttHighlightMilestone(key));
    pin.appendChild(dot);
    return pin;
  }

  // A long clock-stop squeezes phase 2 into a narrow strip -- at the slider's maximum a 60-day
  // procedure's last 30 days occupy ~14% of the axis -- and the day numbers above the dots then
  // sit on top of each other. Lift every label that would land too close to its left-hand
  // neighbour onto a second row. The threshold is in axis-percent rather than pixels on
  // purpose: measuring would force a getBoundingClientRect() into the slider's repaint path,
  // and ~4% of the ~730px-wide detail column is about the width of a "d90" label anyway.
  function ttStaggerPins(pins) {
    pins.sort((a, b) => a.pct - b.pct);
    let lastPct = -100, raised = false;
    pins.forEach((p) => {
      raised = p.pct - lastPct < 4 ? !raised : false;
      if (raised) p.el.classList.add("tt-tl-pin--raised");
      lastPct = p.pct;
    });
  }

  // Paints one phase of one lane onto the shared axis: its activity bar(s) plus its milestones.
  // Appends {el, pct} for each milestone to `pins`, for ttStaggerPins() to sort out afterwards.
  function ttPaintLanePhase(trackEl, laneData, data, ax, lane, phase, numberMap, pins) {
    (laneData.ranges || []).forEach((r) => {
      const a = ax.pct(ax.cal(r.from, phase));
      const b = ax.pct(ax.cal(r.to, phase));
      const bar = document.createElement("div");
      bar.className = "tt-tl-bar " + (r.style === "active" ? "tt-active" : "tt-waiting");
      bar.style.left = a + "%";
      bar.style.width = Math.max(b - a, 0.6) + "%";
      // background-*color*, not the `background` shorthand: a "waiting" bar draws itself as
      // dashes via a background-image in the stylesheet, and the shorthand would reset that
      // image to none -- which is why the CMS lanes used to render as bare labels with no bar.
      bar.style.backgroundColor = r.style === "active" ? ttLaneColorVar(lane) : "transparent";
      bar.style.color = ttLaneColorVar(lane);
      trackEl.appendChild(bar);

      // Sibling of the bar, not a child: the bar is only 9px tall and clips, so a label inside
      // it would be cut off -- it has to be positioned against the track instead.
      const label = document.createElement("span");
      label.className = "tt-tl-barlabel";
      // A label on a bar in the right-hand third would run off the end of the axis (a long
      // clock-stop squeezes the closing phase into a narrow strip, but its label stays full
      // width), so anchor those to the bar's right edge and let them grow leftwards instead.
      if (a > 55) {
        label.style.right = (100 - b) + "%";
        label.style.textAlign = "right";
      } else {
        label.style.left = a + "%";
      }
      label.textContent = r.label;
      trackEl.appendChild(label);
    });

    (laneData.points || []).forEach((p) => {
      const key = ttMilestoneKey({ lane, phase, day: p.day });
      const pct = ax.pct(ax.cal(p.day, phase));
      const el = ttBuildPin(key, lane, pct, p, numberMap, ttDayShort(data, p.day, phase));
      trackEl.appendChild(el);
      pins.push({ el, pct });
    });
  }

  function ttRenderStage(root) {
    const tlEl = root.querySelector("[data-tt-tl]");
    const sliderHost = root.querySelector("[data-tt-slider]");
    const stopMax = ttStopMax();

    // The slider element is built once and kept across repaints; rebuilding the <input> under
    // the cursor is what makes a range control stutter mid-drag (same lesson as the Workload
    // timeline). Only the graphic, the milestone list and the slider's own label are redrawn.
    let sliderLabel = null;
    if (stopMax > 0) {
      sliderHost.className = "tt-tl-slider";
      sliderLabel = document.createElement("label");
      sliderLabel.setAttribute("for", "vcl-tt-clockstop");
      sliderHost.appendChild(sliderLabel);
      const input = document.createElement("input");
      input.type = "range";
      input.id = "vcl-tt-clockstop";
      input.min = "0";
      input.max = String(stopMax);
      input.step = "1";
      input.value = String(ttStopDays());
      let raf = 0;
      input.addEventListener("input", () => {
        state.ttStopFraction = parseInt(input.value, 10) / stopMax;
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; paint(); });
      });
      sliderHost.appendChild(input);
    }

    function paint() {
      // Rebuilt on every repaint, not captured once: dragging the slider to (or off) zero
      // changes which milestones the procedure even has -- see ttCurrentData().
      const data = ttCurrentData();
      const stop = ttStopDays();
      const ax = ttAxis(data, stop);
      const numberMap = new Map();
      ttFlatMilestones(data).forEach((m, i) => numberMap.set(ttMilestoneKey(m), i + 1));
      tlEl.innerHTML = "";

      // ---- Axis row: the two anchors the whole graphic is framed by, plus the clock-stop
      // bracket sitting over the hatched block below it.
      tlEl.appendChild(document.createElement("div")); // spacer under the lane-name column
      const axis = document.createElement("div");
      axis.className = "tt-tl-axis";
      const eopDay = ax.twoPhase ? data.run2.to : data.run1.to;
      const eopPhase = ax.twoPhase ? 2 : 1;
      const anchor = (leftPct, text, cls) => {
        const a = document.createElement("div");
        a.className = "tt-tl-anchor " + (cls || "");
        a.style.left = leftPct + "%";
        a.innerHTML = '<span class="t">' + text + '</span><span class="a">&#9660;</span>';
        axis.appendChild(a);
      };
      anchor(0, "Day 0", "start");
      anchor(100, "EOP &middot; " + ttDayLabel(data, eopDay, eopPhase).toLowerCase(), "eop");
      if (stop > 0) {
        const br = document.createElement("div");
        br.className = "tt-tl-stopbracket";
        br.style.left = ax.pct(ax.stopStart) + "%";
        br.style.width = (ax.pct(ax.stopEnd) - ax.pct(ax.stopStart)) + "%";
        br.innerHTML = '<span>Clock-stop &middot; ' + stop + ' d</span>';
        axis.appendChild(br);
      }
      tlEl.appendChild(axis);

      // ---- Lanes ----------------------------------------------------------------
      ["rms", "cms", "mah"].forEach((lane) => {
        const name = document.createElement("div");
        name.className = "tt-tl-name";
        name.textContent = lane.toUpperCase();
        tlEl.appendChild(name);

        const track = document.createElement("div");
        track.className = "tt-tl-track";

        // The clock-stop band runs the full height of every lane, so it reads as one vertical
        // pause across all three roles rather than a thing that only happens to the RMS.
        if (stop > 0) {
          const band = document.createElement("div");
          band.className = "tt-tl-stopband";
          band.style.left = ax.pct(ax.stopStart) + "%";
          band.style.width = (ax.pct(ax.stopEnd) - ax.pct(ax.stopStart)) + "%";
          track.appendChild(band);
        }

        const pins = [];
        ttPaintLanePhase(track, data.lanes1[lane], data, ax, lane, 1, numberMap, pins);
        if (ax.twoPhase) {
          ttPaintLanePhase(track, data.lanes2[lane], data, ax, lane, 2, numberMap, pins);
          // The MAH's response to the RSI is the one milestone with no day number of its own --
          // it happens inside the clock-stop, which the guide doesn't number. It's placed at the
          // point where the MAH's response budget ends and the RMS's FVAR time begins.
          if (lane === "mah" && stop > 0 && data.clockoff && data.clockoff.mahAction) {
            const key = ttMilestoneKey({ lane: "mah", phase: 1.5, day: null });
            const at = ax.stopStart + data.clockoff.mahAction.fraction * stop;
            track.appendChild(ttBuildPin(key, "mah", ax.pct(at), data.clockoff.mahAction, numberMap, ""));
          }
        }
        ttStaggerPins(pins);
        tlEl.appendChild(track);
      });

      // ---- Duration arrows ------------------------------------------------------
      tlEl.appendChild(document.createElement("div")); // spacer under the lane-name column
      const durRow = document.createElement("div");
      durRow.className = "tt-tl-durrow";
      const durArrow = (fromCal, toCal, label) => {
        if (toCal - fromCal <= 0) return;
        const d = document.createElement("div");
        d.className = "tt-tl-dur";
        d.style.left = ax.pct(fromCal) + "%";
        d.style.width = (ax.pct(toCal) - ax.pct(fromCal)) + "%";
        d.innerHTML = "<span>" + label + "</span>";
        durRow.appendChild(d);
      };
      if (ax.twoPhase) {
        durArrow(0, ax.stopStart, ax.stopStart + " d");
        if (stop > 0) durArrow(ax.stopStart, ax.stopEnd, stop + " d");
        durArrow(ax.stopEnd, ax.total, (ax.total - ax.stopEnd) + " d");
      } else {
        durArrow(0, ax.total, ax.total + " d");
      }
      tlEl.appendChild(durRow);

      // ---- Slider label (element kept, only its text refreshed) -------------------
      if (sliderLabel) {
        sliderLabel.innerHTML = 'Clock-stop: <strong>' + stop + ' d</strong> <span class="rng">range 0&ndash;' + stopMax + ' d</span>';
      }

      // ---- Running total ---------------------------------------------------------
      const totalEl = document.createElement("div");
      totalEl.className = "tt-tl-total";
      const months = ax.total >= 45 ? ' <span class="mo">&asymp; ' + (Math.round((ax.total / 30.44) * 10) / 10) + " months</span>" : "";
      totalEl.innerHTML = '<span class="n">Day 0 &rarr; EOP</span><span class="v">' + ax.total + " calendar days" + months + "</span>";
      tlEl.appendChild(document.createElement("div"));
      tlEl.appendChild(totalEl);

      // The list is part of the same picture, so it is rebuilt from the same `data` the graphic
      // was just drawn from -- at clock-stop zero the milestones that only exist because of an
      // RSI have to disappear from both, or the two would contradict each other.
      ttRenderMilestoneList(root, data);
    }

    tlEl.className = "tt-tl";
    paint();
  }

  function ttRenderMilestoneList(root, data) {
    const listEl = root.querySelector("[data-tt-milestones]");
    const list = ttFlatMilestones(data);
    listEl.innerHTML = "";
    list.forEach((m, idx) => {
      const key = ttMilestoneKey(m);
      const item = document.createElement("div");
      item.className = "tt-milestone-item";
      item.dataset.key = key;
      const num = document.createElement("div");
      num.className = "tt-num";
      num.style.background = ttLaneColorVar(m.lane);
      num.textContent = idx + 1;
      const body = document.createElement("div");
      body.className = "tt-body";
      const dayLabel = m.day == null ? "Clock-off" : (data.key === "ib" && m.phase === 2) ? "New Day " + (m.day - data.run1.to) : "Day " + m.day;
      body.innerHTML = '<div class="tt-day">' + dayLabel + '</div><div class="tt-title">' + m.title.replace(/^Day \d+ – |^New Day \d+ – /, "") + '<span class="tt-lane-chip" style="background:color-mix(in srgb, ' + ttLaneColorVar(m.lane) + ' 18%, transparent); color:' + ttLaneColorVar(m.lane) + '">' + m.lane.toUpperCase() + '</span></div><div class="tt-desc">' + m.desc + '</div>';
      item.appendChild(num);
      item.appendChild(body);
      item.addEventListener("click", () => ttHighlightMilestone(key));
      listEl.appendChild(item);
    });
  }

  function ttHighlightMilestone(key) {
    const root = el.timetablesCol;
    root.querySelectorAll(".tt-point").forEach((d) => d.classList.remove("tt-hovered"));
    root.querySelectorAll('.tt-point[data-key="' + key + '"]').forEach((d) => d.classList.add("tt-hovered"));
    root.querySelectorAll(".tt-milestone-item").forEach((it) => it.classList.remove("tt-active"));
    const itemEl = root.querySelector('.tt-milestone-item[data-key="' + key + '"]');
    if (itemEl) { itemEl.classList.add("tt-active"); itemEl.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }

  // The two ends of a variant's span are two scenarios of the same procedure, so both are
  // measured with the builders the single timetable already uses -- no day arithmetic is
  // re-derived here, or the comparison could drift away from the timetable it summarises.
  //   earliest: the PVAR is endorsed, no RSI is raised, the clock never stops (ends at the FVAR).
  //   latest:   an RSI is raised and the clock stops for the variant's full budget.
  function ttCompareRange(v) {
    const d = TT_II_DAYS[v];
    const stopMax = d.mahDays + d.rmsDays;
    const lateAx = ttAxis(ttBuildII(v, d, true), stopMax);
    return {
      v, d, stopMax,
      earliest: ttAxis(ttBuildII(v, d, false), 0).total,
      latest: lateAx.total,
      stopStart: lateAx.stopStart, // RSI -- where the first assessment ends and the clock stops
      stopEnd: lateAx.stopEnd      // clock resumes; the second assessment runs from here
    };
  }

  // Three variants against one calendar-day axis. Each row is drawn as its longest case -- the
  // two assessments with the full clock-stop between them -- and carries a ring at the day the
  // procedure would have ended instead, had the PVAR been endorsed and no RSI raised. Row =
  // span from that ring to the bar's end.
  //
  // Deliberately no clock-stop slider here: a single slider position would show one scenario,
  // and the point of this view is that the spans *overlap* -- a 60-day procedure that stops the
  // clock runs far longer than a 90-day one that doesn't, so "60-day is faster than 90-day" is
  // only true at one end of each span. Both ends have to be on screen at once for that to be
  // visible, and a screenshot of it has to mean one thing.
  //
  // The ring lands just inside the clock-stop band, which is correct rather than a rounding
  // artefact: the two scenarios only part company at the RSI, so the day the short one ends on
  // (the FVAR, one day later) is a day the long one spends with the clock stopped.
  function ttRenderCompare(container) {
    const rows = ["30", "60", "90"].map(ttCompareRange);
    const maxCal = Math.max(...rows.map((r) => r.latest));
    const pct = (day) => (day / maxCal) * 100;

    container.innerHTML = '<div class="tt-compare-head"><h4>Type II &mdash; earliest and latest End of Procedure</h4>'
      + "<p>All three on one calendar-day axis, Day 0 to EOP, each drawn as its longest case: the first assessment, "
      + "the full clock-stop, then the second assessment. The ring marks the earliest end &mdash; where the procedure "
      + "stops instead if the PVAR is endorsed and no RSI is raised. Day numbers are the guide&rsquo;s "
      + "(which do not count the clock-stop).</p></div>";

    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "tt-compare-row";

      const label = document.createElement("div");
      label.className = "tt-compare-label";
      label.innerHTML = r.v + "-day<small>EOP d" + r.earliest + " &ndash; d" + r.latest + "</small>";
      row.appendChild(label);

      const track = document.createElement("div");
      track.className = "tt-compare-track";

      const seg = (from, to, cls, inner) => {
        const b = document.createElement("div");
        b.className = "tt-compare-bar" + (cls ? " " + cls : "");
        b.style.left = pct(from) + "%";
        b.style.width = (pct(to) - pct(from)) + "%";
        if (inner) b.innerHTML = inner;
        track.appendChild(b);
      };
      seg(0, r.stopStart, "");                                                   // assessment 1
      seg(r.stopStart, r.stopEnd, "tt-compare-bar--stop", "<span>" + r.stopMax + " d</span>"); // clock stopped
      seg(r.stopEnd, r.latest, "");                                              // assessment 2

      const pin = (day, cls) => {
        const dot = document.createElement("div");
        dot.className = "tt-compare-point" + (cls ? " " + cls : "");
        dot.style.left = pct(day) + "%";
        track.appendChild(dot);
        const dl = document.createElement("div");
        // The longest row's latest EOP defines the axis, so its label sits exactly on the right
        // edge -- centring it there would hang half of it outside the stage, which clips.
        dl.className = "tt-compare-daylabel" + (pct(day) > 95 ? " tt-compare-daylabel--end" : "");
        dl.style.left = pct(day) + "%";
        dl.textContent = "d" + day;
        track.appendChild(dl);
      };
      pin(r.earliest, "tt-compare-point--early");
      pin(r.latest, "");

      row.appendChild(track);
      container.appendChild(row);
    });

    const legend = document.createElement("div");
    legend.className = "tt-compare-legend";
    legend.innerHTML = '<span class="k"><i class="s"></i>Assessment</span>'
      + '<span class="k"><i class="h"></i>Clock-stop (maximum)</span>'
      + '<span class="k"><i class="r"></i>Earliest EOP &mdash; PVAR endorsed, no RSI</span>';
    container.appendChild(legend);
  }

  // A take-away copy of the timetable currently on screen, for pasting into Word/PowerPoint.
  //
  // It draws what the view draws: one calendar-day axis from Day 0 to the EOP, with the
  // clock-stop hatched to scale between the two assessment phases. It used to lay itself out in
  // "grow units" -- a separate day scale per phase and a fixed-width clock-off box -- which was
  // the older on-screen figure. Once the view moved to a real calendar axis, the exported file
  // no longer showed what the user was looking at when they pressed the button, which is the one
  // thing an export has to get right. It takes `stop` for that reason: at the slider's zero the
  // procedure has no second phase at all (see ttCurrentData), so the drawing has to follow it.
  //
  // Colours are literals rather than var(--tt-rms) etc.: the file is standalone, and a CSS
  // variable would resolve to nothing outside this page. They mirror the --tt-rms/--cms/--tt-mah
  // block in vcl-style.css -- change them there and here together.
  function ttExportSVG(data, stop) {
    const W = 980, padX = 24, labelW = 44;
    const padTop = 38, axisH = 30, laneH = 62, durH = 30, totalH = 20, footH = 26;
    const laneOrder = ["rms", "cms", "mah"];
    const H = padTop + axisH + laneH * 3 + durH + totalH + footH;
    const trackX = padX + labelW;
    const trackW = W - padX * 2 - labelW;
    const lanesTop = padTop + axisH;

    const ax = ttAxis(data, stop);
    const xFor = (cal) => trackX + (cal / ax.total) * trackW;
    const LANE_COLOR = { rms: "#2C6E6E", cms: "#5C7F9B", mah: "#9C6B2E" };
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const MONO = "Consolas, monospace";

    // Same numbering the on-screen dots and the milestone list share, so an exported figure can
    // still be read against the list it was captured from.
    const numberMap = new Map();
    ttFlatMilestones(data).forEach((m, i) => numberMap.set(ttMilestoneKey(m), i + 1));

    let s = "";
    s += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial, Helvetica, sans-serif">';
    s += '<defs><pattern id="ttStop" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      + '<rect width="3" height="9" fill="#EEF0F2"/></pattern></defs>';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';

    const title = data.key === "ia" ? "Type IA" : data.key === "ib" ? "Type IB" : "Type II — " + data.variant + "-day procedure";
    s += '<text x="' + padX + '" y="20" font-size="15" font-weight="700" fill="#1A2332">' + esc(title) + ' — CMDh Best Practice Guide (MRP)</text>';
    s += '<text x="' + padX + '" y="32" font-size="9" fill="#8A93A3">Calendar days. Day numbers are the guide&#39;s, which do not count the clock-stop.</text>';

    // ---- Axis: the two anchors the figure is framed by, plus the clock-stop bracket ----
    const eopDay = ax.twoPhase ? data.run2.to : data.run1.to;
    const eopPhase = ax.twoPhase ? 2 : 1;
    s += '<text x="' + trackX + '" y="' + (padTop + 12) + '" font-size="10" font-weight="700" fill="#1A2332">Day 0</text>';
    s += '<text x="' + (trackX + trackW) + '" y="' + (padTop + 12) + '" font-size="10" font-weight="700" fill="#1A2332" text-anchor="end">EOP &#183; '
      + esc(ttDayLabel(data, eopDay, eopPhase).toLowerCase()) + '</text>';
    if (stop > 0) {
      const bx = xFor(ax.stopStart), bw = xFor(ax.stopEnd) - xFor(ax.stopStart);
      s += '<rect x="' + bx + '" y="' + (padTop + 16) + '" width="' + bw + '" height="10" fill="none" stroke="#E2E5EA"/>';
      const bl = "Clock-stop · " + stop + " d";
      s += '<rect x="' + (bx + bw / 2 - bl.length * 2.6) + '" y="' + (padTop + 16) + '" width="' + bl.length * 5.2 + '" height="10" fill="#FFFFFF"/>';
      s += '<text x="' + (bx + bw / 2) + '" y="' + (padTop + 24) + '" font-size="8.5" fill="#4A5568" text-anchor="middle" font-family="' + MONO + '">' + esc(bl) + '</text>';
    }

    // ---- The clock-stop band spans every lane, so it reads as one pause the whole procedure
    // sits inside rather than something that only happens to the RMS.
    if (stop > 0) {
      const bx = xFor(ax.stopStart), bw = xFor(ax.stopEnd) - xFor(ax.stopStart);
      s += '<rect x="' + bx + '" y="' + lanesTop + '" width="' + bw + '" height="' + laneH * 3 + '" fill="url(#ttStop)" stroke="#E2E5EA" stroke-dasharray="3 3"/>';
    }

    laneOrder.forEach((lane, li) => {
      const y = lanesTop + li * laneH;
      const cy = y + laneH / 2;
      const color = LANE_COLOR[lane];
      s += '<line x1="' + padX + '" y1="' + y + '" x2="' + (W - padX) + '" y2="' + y + '" stroke="#EEF0F2"/>';
      s += '<text x="' + padX + '" y="' + (cy + 4) + '" font-size="11" font-weight="700" fill="#4A5568">' + lane.toUpperCase() + '</text>';

      const emitPhase = (laneData, phase) => {
        (laneData.ranges || []).forEach((r) => {
          const a = xFor(ax.cal(r.from, phase));
          const b = xFor(ax.cal(r.to, phase));
          const w = Math.max(b - a, 4);
          if (r.style === "active") {
            s += '<rect x="' + a + '" y="' + (cy - 4.5) + '" width="' + w + '" height="9" rx="4.5" fill="' + color + '"/>';
          } else {
            s += '<rect x="' + a + '" y="' + (cy - 4.5) + '" width="' + w + '" height="9" rx="4.5" fill="none" stroke="' + color + '" stroke-dasharray="2 3" opacity="0.75"/>';
          }
          // Right-align a label whose bar sits in the axis's last third: a long clock-stop
          // squeezes the closing phase into a narrow strip, but the label keeps its full width
          // and would otherwise run off the edge of the drawing.
          const inLastThird = a > trackX + trackW * 0.55;
          s += '<text x="' + (inLastThird ? b : a) + '" y="' + (cy + 18) + '" font-size="8.5" fill="#4A5568"'
            + (inLastThird ? ' text-anchor="end"' : "") + '>' + esc(r.label) + '</text>';
        });
      };
      emitPhase(data.lanes1[lane], 1);
      if (ax.twoPhase) emitPhase(data.lanes2[lane], 2);

      // Milestones, collected first so colliding day labels can be lifted onto a second row --
      // the same rule (and the same 4%-of-axis threshold) as ttStaggerPins() uses on screen.
      const pins = [];
      (data.lanes1[lane].points || []).forEach((p) => pins.push({ p, phase: 1, cal: ax.cal(p.day, 1) }));
      if (ax.twoPhase) (data.lanes2[lane].points || []).forEach((p) => pins.push({ p, phase: 2, cal: ax.cal(p.day, 2) }));
      pins.sort((a, b) => a.cal - b.cal);
      let lastPct = -100, raised = false;
      pins.forEach((pin) => {
        const pct = ax.pct(pin.cal);
        raised = pct - lastPct < 4 ? !raised : false;
        lastPct = pct;
        const px = xFor(pin.cal);
        const key = ttMilestoneKey({ lane, phase: pin.phase, day: pin.p.day });
        s += '<circle cx="' + px + '" cy="' + cy + '" r="8" fill="' + color + '" stroke="#FFFFFF" stroke-width="2"/>';
        s += '<text x="' + px + '" y="' + (cy + 3) + '" font-size="8.5" font-weight="700" fill="#FFFFFF" text-anchor="middle">' + (numberMap.get(key) || "") + '</text>';
        s += '<text x="' + px + '" y="' + (cy - (raised ? 24 : 13)) + '" font-size="8" font-weight="700" fill="#4A5568" text-anchor="middle" font-family="' + MONO + '">'
          + esc(ttDayShort(data, pin.p.day, pin.phase)) + '</text>';
      });

      // The one milestone with no day number of its own: it happens inside the clock-stop,
      // which the guide does not number. Placed where the MAH's response budget ends.
      if (lane === "mah" && ax.twoPhase && stop > 0 && data.clockoff && data.clockoff.mahAction) {
        const px = xFor(ax.stopStart + data.clockoff.mahAction.fraction * stop);
        const key = ttMilestoneKey({ lane: "mah", phase: 1.5, day: null });
        s += '<circle cx="' + px + '" cy="' + cy + '" r="8" fill="' + color + '" stroke="#FFFFFF" stroke-width="2"/>';
        s += '<text x="' + px + '" y="' + (cy + 3) + '" font-size="8.5" font-weight="700" fill="#FFFFFF" text-anchor="middle">' + (numberMap.get(key) || "") + '</text>';
      }
    });

    // ---- Duration arrows ----
    const dy = lanesTop + laneH * 3 + 16;
    const durArrow = (fromCal, toCal, label) => {
      if (toCal - fromCal <= 0) return;
      const a = xFor(fromCal), b = xFor(toCal);
      s += '<line x1="' + a + '" y1="' + dy + '" x2="' + b + '" y2="' + dy + '" stroke="#E2E5EA"/>';
      s += '<line x1="' + a + '" y1="' + (dy - 3) + '" x2="' + a + '" y2="' + (dy + 3) + '" stroke="#E2E5EA"/>';
      s += '<line x1="' + b + '" y1="' + (dy - 3) + '" x2="' + b + '" y2="' + (dy + 3) + '" stroke="#E2E5EA"/>';
      const lw = String(label).length * 5.2;
      s += '<rect x="' + ((a + b) / 2 - lw / 2) + '" y="' + (dy - 5) + '" width="' + lw + '" height="10" fill="#FFFFFF"/>';
      s += '<text x="' + ((a + b) / 2) + '" y="' + (dy + 3) + '" font-size="8.5" fill="#4A5568" text-anchor="middle" font-family="' + MONO + '">' + esc(label) + '</text>';
    };
    if (ax.twoPhase) {
      durArrow(0, ax.stopStart, ax.stopStart + " d");
      if (stop > 0) durArrow(ax.stopStart, ax.stopEnd, stop + " d");
      durArrow(ax.stopEnd, ax.total, ax.total - ax.stopEnd + " d");
    } else {
      durArrow(0, ax.total, ax.total + " d");
    }

    // ---- Running total + source ----
    const months = ax.total >= 45 ? " (≈ " + Math.round((ax.total / 30.44) * 10) / 10 + " months)" : "";
    s += '<text x="' + trackX + '" y="' + (lanesTop + laneH * 3 + durH + 12) + '" font-size="10" fill="#1A2332">'
      + '<tspan fill="#4A5568">Day 0 &#8594; EOP: </tspan><tspan font-weight="700">' + ax.total + " calendar days" + esc(months) + '</tspan></text>';
    s += '<text x="' + padX + '" y="' + (H - 10) + '" font-size="8.5" fill="#8A93A3">Source: HMA/CMDh Best Practice Guide on Variations, Chapters 3–5 (hma.eu). Own rendering, not legally binding.</text>';

    s += '</svg>';

    const blob = new Blob([s], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    // Stop length is part of the filename: two exports of the same procedure at different
    // slider positions are different figures, and would otherwise overwrite each other.
    const base = data.key === "ii" ? "timetable_type-ii_" + data.variant + "d" : "timetable_type-" + data.key;
    a.href = url; a.download = base + (stop > 0 ? "_stop-" + stop + "d" : "") + ".svg";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Rebuilds the entire browse column: pinned Summary card, then the Classification card
  // (which expands into the chapter/section/subsection accordion, or the flat global search
  // results, while open), then the Grouping and Timetables cards. Only Classification ever
  // expands inline -- clicking Summary/Grouping/Timetables collapses it back down.
  function renderBrowse() {
    el.browseTree.innerHTML = "";
    visibleEntries = [];

    // Fee Calculator -- pinned "hero" nav at the very top (the most important destination),
    // above everything else. Opens the embedded calculator copy in the detail area. Only shown
    // when the calculator column is actually present on the page.
    if (el.calculatorCol) {
      const calcBtn = document.createElement("button");
      calcBtn.type = "button";
      calcBtn.className = "tab tab--calc" + (state.view === "calculator" ? " tab--active" : "");
      calcBtn.innerHTML = `
        <span class="tab--calc__row">
          <span class="tab--calc__euro">&euro;</span>
          <span class="tab__code">Variation Fee Calculator</span>
          <span class="tab--calc__chip">&euro; Fees</span>
        </span>
        <span class="tab__title">The classic calculator for variation fees w/o worksharing.</span>
      `;
      calcBtn.addEventListener("click", () => {
        state.view = "calculator";
        state.classifyOpen = false;
        state.guidanceOpen = false;
        renderBrowse();
        switchViewVisibility();
        fillCalcHead();
        jumpToTop();
      });
      el.browseTree.appendChild(calcBtn);

      const calcDivider = document.createElement("div");
      calcDivider.className = "tabs-divider tabs-divider--flush";
      el.browseTree.appendChild(calcDivider);
    }

    // Guided Workflow -- promoted to the #2 slot, right below the Fee Calculator: the two action
    // tools sit at the top, above the reference views. Self-contained (window.VCL_WORKFLOW).
    const workflowBtn = document.createElement("button");
    workflowBtn.type = "button";
    workflowBtn.className = "tab" + (state.view === "workflow" ? " tab--active" : "");
    workflowBtn.style.setProperty("--accent", "var(--workflow)");
    workflowBtn.style.setProperty("--tint", "var(--workflow-tint)");
    workflowBtn.style.setProperty("--tab-bg", "var(--workflow-bg)");
    workflowBtn.innerHTML = `
      <span class="tab__code">Guided Workflow</span>
      <span class="tab__title">Step by step from classification to fees with worksharing.</span>
    `;
    workflowBtn.addEventListener("click", () => {
      state.view = "workflow";
      state.classifyOpen = false;
      state.guidanceOpen = false;
      renderBrowse();
      switchViewVisibility();
      if (window.VCL_WORKFLOW) window.VCL_WORKFLOW.render(el.workflowCol);
      jumpToTop();
    });
    el.browseTree.appendChild(workflowBtn);
    const workflowDivider = document.createElement("div");
    workflowDivider.className = "tabs-divider tabs-divider--flush";
    el.browseTree.appendChild(workflowDivider);

    const totalQty = totalSelectedQty();
    // Summary only appears once there's actually something to summarize -- before the first
    // variation is selected, it would just be an empty page one click away for no reason.
    if (totalQty > 0) {
      const summaryBtn = document.createElement("button");
      summaryBtn.type = "button";
      summaryBtn.className = "tab" + (state.view === "summary" ? " tab--active" : "");
      summaryBtn.style.setProperty("--accent", "var(--plum)");
      summaryBtn.style.setProperty("--tint", "var(--plum-tint)");
      summaryBtn.style.setProperty("--tab-bg", "var(--plum-bg)");
      summaryBtn.innerHTML = `
        <span class="tab__code">Summary</span>
        <span class="tab__title">Selected variations for this application</span>
        <span class="tab__count">${totalQty} ${totalQty === 1 ? "item" : "items"}</span>
      `;
      summaryBtn.addEventListener("click", () => {
        state.view = "summary";
        state.classifyOpen = false;
        state.guidanceOpen = false;
        renderBrowse();
        switchViewVisibility();
        renderSummary();
        jumpToTop();
      });
      el.browseTree.appendChild(summaryBtn);

      const divider = document.createElement("div");
      divider.className = "tabs-divider tabs-divider--flush";
      el.browseTree.appendChild(divider);
    }

    const classifyBtn = document.createElement("button");
    classifyBtn.type = "button";
    classifyBtn.className = "tab" + (state.view === "browse" || state.view === "art5" ? " tab--active" : "");
    classifyBtn.style.setProperty("--accent", "var(--classify)");
    classifyBtn.style.setProperty("--tint", "var(--classify-tint)");
    classifyBtn.style.setProperty("--tab-bg", "var(--classify-bg)");
    classifyBtn.innerHTML = `
      <span class="tab__code">Classification of Variations</span>
      <span class="tab__title">Browse the Classification Guideline by chapter E, Q, C, M, Art. 5.</span>
    `;
    classifyBtn.addEventListener("click", () => {
      state.classifyOpen = !state.classifyOpen;
      state.guidanceOpen = false;
      state.guidanceHub = false;
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      el.detailCol.scrollTop = 0;
      jumpToTop();
    });
    el.browseTree.appendChild(classifyBtn);

    const q = normalize(state.query);
    if (state.classifyOpen) {
      const branch = document.createElement("div");
      branch.className = "classification-branch";
      el.browseTree.appendChild(branch);

      // A search query no longer replaces the chapter tree (it used to hide it entirely) --
      // the tree stays put so browsing is always one click away, and the matching entries just
      // take over the detail panel instead (see the visibleEntries override below). The
      // "N entries match your search" count now lives at the top of the detail area
      // (see renderDetail), not here in the tree.
      Object.values(CHAPTERS).forEach((chapter) => renderChapterBranch(branch, chapter));

      // Fifth chapter: Art. 5 recommendations. Not a CHAPTERS entry (it has no SECTIONS/ENTRIES
      // and its own dedicated view), so it is appended here as a chapter-styled row that switches
      // views the way the Guidance rows do, rather than expanding a branch in place.
      if (ART5_DATA) {
        const art5Wrap = document.createElement("div");
        art5Wrap.className = "chapter";
        const art5Row = document.createElement("button");
        art5Row.type = "button";
        art5Row.className = "chapter__head" + (state.view === "art5" ? " chapter__head--active" : "");
        // Stacked inside the code tile ("Art." over "5"): the single-letter chapters fit the
        // square as one glyph, but "Art. 5" on one line would need a much wider tile and throw
        // the title column out of alignment. --stack shrinks "Art." so it clears the tile edge.
        art5Row.innerHTML =
          '<span class="chapter__code chapter__code--stack">Art.<small>5</small></span>' +
          '<span class="chapter__title">Recommendations for unforeseen variations</span>';
        art5Row.addEventListener("click", () => {
          state.view = "art5";
          state.activeChapter = null;
          state.activeSection = null;
          state.guidanceOpen = false;
          renderBrowse();
          switchViewVisibility();
          renderArt5();
          jumpToTop();
        });
        art5Wrap.appendChild(art5Row);
        branch.appendChild(art5Wrap);
      }

      if (q) {
        // Overrides whatever the (still-rendered) chapter tree contributed above -- while
        // searching, the detail panel always reflects the search, not incidental tree state.
        visibleEntries = ENTRIES.filter((e) => entryMatchesQuery(e, q));
      }
    }

    const guidanceBtn = document.createElement("button");
    guidanceBtn.type = "button";
    guidanceBtn.className =
      "tab" + (state.view === "grouping" || state.view === "precisescope" || state.view === "qa" ? " tab--active" : "");
    guidanceBtn.style.setProperty("--accent", "var(--group)");
    guidanceBtn.style.setProperty("--tint", "var(--group-tint)");
    guidanceBtn.style.setProperty("--tab-bg", "var(--group-bg)");
    guidanceBtn.innerHTML = `
      <span class="tab__code">Guidance on Variations</span>
      <span class="tab__title">Procedural guidance and Q&amp;A on variations.</span>
    `;
    guidanceBtn.addEventListener("click", () => {
      state.guidanceOpen = !state.guidanceOpen;
      state.classifyOpen = false;
      // Like the Classification button: opening the branch also shows its overview in the
      // detail area (the three documents as cards); closing falls back to the welcome overview.
      state.guidanceHub = state.guidanceOpen;
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      jumpToTop();
    });
    el.browseTree.appendChild(guidanceBtn);

    // Sub-nav: same flat-card language as the Classification chapter rows (see
    // renderChapterBranch), just in the Guidance branch's own ("--group") color. Each row is a
    // separate guidance document; more will join this list over time.
    if (state.guidanceOpen) {
      const guidanceBranch = document.createElement("div");
      guidanceBranch.className = "classification-branch";
      el.browseTree.appendChild(guidanceBranch);

      const guidanceRow = (label, view) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "chapter__head chapter__head--group" + (state.view === view ? " chapter__head--active" : "");
        row.innerHTML = `<span class="chapter__solo-label">${label}</span>`;
        row.addEventListener("click", () => {
          state.view = view;
          state.classifyOpen = false;
          state.guidanceHub = false;
          renderBrowse();
          switchViewVisibility();
          // Its two siblings are static and rendered once at init; this one carries state
          // (open chapter/question, filter, deleted toggle) and so repaints on entry.
          if (view === "qa") renderQA();
          jumpToTop();
        });
        guidanceBranch.appendChild(row);
      };

      guidanceRow(GROUPING_GUIDANCE.title, "grouping");
      guidanceRow(PRECISE_SCOPE_GUIDANCE.title, "precisescope");
      if (QA_DATA) guidanceRow("Q&A on Variations", "qa");
    }

    const timetablesBtn = document.createElement("button");
    timetablesBtn.type = "button";
    timetablesBtn.className = "tab" + (state.view === "timetables" ? " tab--active" : "");
    timetablesBtn.style.setProperty("--accent", "var(--slate)");
    timetablesBtn.style.setProperty("--tint", "var(--slate-tint)");
    timetablesBtn.style.setProperty("--tab-bg", "var(--slate-bg)");
    timetablesBtn.innerHTML = `
      <span class="tab__code">Timetables for Variations</span>
      <span class="tab__title">A visual representation of the timelines of variations.</span>
    `;
    timetablesBtn.addEventListener("click", () => {
      state.view = "timetables";
      state.classifyOpen = false;
      state.guidanceOpen = false;
      renderBrowse();
      switchViewVisibility();
      renderTimetables();
      jumpToTop();
    });
    el.browseTree.appendChild(timetablesBtn);

    // Workload Planning: a separate, self-contained view whose rendering logic lives entirely
    // in assets/js/vcl-workload.js (see window.VCL_WORKLOAD) -- this block only wires it into
    // the shared nav, exactly like the timetablesBtn block above.
    const workloadBtn = document.createElement("button");
    workloadBtn.type = "button";
    workloadBtn.className = "tab" + (state.view === "workload" ? " tab--active" : "");
    workloadBtn.style.setProperty("--accent", "var(--workload)");
    workloadBtn.style.setProperty("--tint", "var(--workload-tint)");
    workloadBtn.style.setProperty("--tab-bg", "var(--workload-bg)");
    workloadBtn.innerHTML = `
      <span class="tab__code">Workload Planning</span>
      <span class="tab__title">Estimated RA workload from start to closure of variations.</span>
    `;
    workloadBtn.addEventListener("click", () => {
      state.view = "workload";
      state.classifyOpen = false;
      state.guidanceOpen = false;
      renderBrowse();
      switchViewVisibility();
      if (window.VCL_WORKLOAD) window.VCL_WORKLOAD.render(el.workloadCol);
      jumpToTop();
    });
    el.browseTree.appendChild(workloadBtn);
  }

  function conditionKey(entryCode, variantId) {
    return `${entryCode}|${variantId === null ? "_" : variantId}`;
  }

  // Selections use the same "entryCode|variantId" key shape as conditionKey, since a
  // selection always targets one specific variant (= one specific resulting type).
  function selectionKey(entryCode, variantId) {
    return conditionKey(entryCode, variantId);
  }

  function findEntryAndVariant(key) {
    const sep = key.lastIndexOf("|");
    const entryCode = key.slice(0, sep);
    const variantId = key.slice(sep + 1);
    const entry = ENTRIES.find((e) => e.code === entryCode);
    if (!entry) return null;
    const variant = entry.variants.find((v) => (v.id === null ? "_" : v.id) === variantId);
    if (!variant) return null;
    return { entry, variant };
  }

  function saveSelections() {
    localStorage.setItem(SELECTIONS_STORAGE_KEY, JSON.stringify(state.selections));
  }

  function getSelectionQty(entryCode, variantId) {
    const sel = state.selections[selectionKey(entryCode, variantId)];
    return sel ? sel.qty : 0;
  }

  function setSelectionQty(entryCode, variantId, qty) {
    const key = selectionKey(entryCode, variantId);
    qty = Math.max(0, Math.floor(qty));
    if (qty <= 0) {
      delete state.selections[key];
    } else {
      const existing = state.selections[key];
      const units = existing ? existing.units.slice(0, qty) : [];
      while (units.length < qty) units.push({ docs: {}, note: "" });
      state.selections[key] = { qty, units };
    }
    saveSelections();
    renderSelectionBar();
    renderBrowse();
  }

  function totalSelectedQty() {
    return Object.values(state.selections).reduce((sum, sel) => sum + sel.qty, 0);
  }

  function unitLineKey(key, unitIndex) {
    return `${key}#${unitIndex}`;
  }

  function splitLineKey(lineKey) {
    const idx = lineKey.lastIndexOf("#");
    return [lineKey.slice(0, idx), Number(lineKey.slice(idx + 1))];
  }

  function buildSummaryLineItems() {
    const items = [];
    Object.keys(state.selections).forEach((key) => {
      const sel = state.selections[key];
      const found = findEntryAndVariant(key);
      if (!sel || !found) return;
      for (let i = 0; i < sel.qty; i++) {
        items.push({ key, unitIndex: i, entry: found.entry, variant: found.variant });
      }
    });
    return items;
  }

  function removeUnit(key, unitIndex) {
    const sel = state.selections[key];
    if (!sel) return;
    sel.units.splice(unitIndex, 1);
    sel.qty = sel.units.length;
    if (sel.qty <= 0) delete state.selections[key];
    // Expanded-state keys for this selection may now point at shifted unit indices;
    // simplest safe fix is to drop all expanded flags for this key.
    Array.from(state.summaryExpandedUnits).forEach((lk) => {
      if (lk.indexOf(key + "#") === 0) state.summaryExpandedUnits.delete(lk);
    });
    saveSelections();
    renderSummary();
    renderSelectionBar();
    renderDetail();
    renderBrowse();
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderSelectionBar() {
    const keys = Object.keys(state.selections);
    const total = totalSelectedQty();
    el.appRoot.classList.toggle("has-selection", total > 0);

    if (total === 0) {
      el.selectionBar.classList.add("hidden");
      el.selectionList.classList.add("hidden");
      el.selectionList.innerHTML = "";
      return;
    }
    el.selectionBar.classList.remove("hidden");

    el.selectionCount.textContent = `${total} ${total === 1 ? "variation" : "variations"} selected — ${keys.length} ${
      keys.length === 1 ? "position" : "positions"
    }`;

    el.selectionChevron.innerHTML = state.selectionExpanded ? "▾" : "▸";
    el.selectionToggle.setAttribute("aria-expanded", String(state.selectionExpanded));
    el.selectionList.classList.toggle("hidden", !state.selectionExpanded);

    if (!state.selectionExpanded) return;

    el.selectionList.innerHTML = "";
    keys.forEach((key) => {
      const found = findEntryAndVariant(key);
      if (!found) return;
      const { entry, variant } = found;
      const qty = state.selections[key].qty;

      const chip = document.createElement("div");
      const eff = effectiveVariantType(entry, variant);
      chip.className = "selection-chip";
      chip.innerHTML = `
        <span class="mono selection-chip__code">${entry.code}</span>
        <span class="${eff.badgeClass}">${eff.label}</span>
        <span class="selection-chip__title">${entry.title}</span>
        <div class="qty-stepper" data-key="${key}">
          <button class="qty-stepper__minus" type="button">−</button>
          <span class="qty-stepper__value">${qty}</span>
          <button class="qty-stepper__plus" type="button">+</button>
        </div>
        <button class="selection-chip__remove" type="button" data-remove-key="${key}" title="Remove">&times;</button>
      `;
      el.selectionList.appendChild(chip);
    });

    el.selectionList.querySelectorAll(".qty-stepper").forEach((stepper) => {
      const key = stepper.getAttribute("data-key");
      const found = findEntryAndVariant(key);
      if (!found) return;
      stepper.querySelector(".qty-stepper__minus").addEventListener("click", () => {
        setSelectionQty(found.entry.code, found.variant.id, getSelectionQty(found.entry.code, found.variant.id) - 1);
        renderDetail();
      });
      stepper.querySelector(".qty-stepper__plus").addEventListener("click", () => {
        setSelectionQty(found.entry.code, found.variant.id, getSelectionQty(found.entry.code, found.variant.id) + 1);
        renderDetail();
      });
    });

    el.selectionList.querySelectorAll("[data-remove-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const found = findEntryAndVariant(btn.getAttribute("data-remove-key"));
        if (!found) return;
        setSelectionQty(found.entry.code, found.variant.id, 0);
        renderDetail();
      });
    });
  }

  el.selectionToggle.addEventListener("click", () => {
    state.selectionExpanded = !state.selectionExpanded;
    renderSelectionBar();
  });

  el.selectionClear.addEventListener("click", () => {
    state.selections = {};
    state.summaryExpandedUnits.clear();
    saveSelections();
    renderSelectionBar();
    renderDetail();
    renderBrowse();
    if (state.view === "summary") renderSummary();
  });

  el.selectionViewSummary.addEventListener("click", () => {
    state.view = "summary";
    renderBrowse();
    switchViewVisibility();
    renderSummary();
    jumpToTop();
  });

  el.summaryExpandAll.addEventListener("click", () => {
    buildSummaryLineItems().forEach((item) => state.summaryExpandedUnits.add(unitLineKey(item.key, item.unitIndex)));
    renderSummary();
  });

  el.summaryCollapseAll.addEventListener("click", () => {
    state.summaryExpandedUnits.clear();
    renderSummary();
  });

  el.summaryExportDocx.addEventListener("click", () => {
    exportSummaryToDocx();
  });

  el.summaryPrint.addEventListener("click", () => {
    // Print always shows every item's full detail, regardless of what's currently
    // expanded/collapsed on screen -- then restores the on-screen state afterwards.
    const previousExpanded = new Set(state.summaryExpandedUnits);
    buildSummaryLineItems().forEach((item) => state.summaryExpandedUnits.add(unitLineKey(item.key, item.unitIndex)));
    renderSummary();

    const restore = () => {
      state.summaryExpandedUnits = previousExpanded;
      renderSummary();
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);

    window.print();
  });

  // Bucket every selected unit by the type that currently, actually applies (so a variant
  // still defaulting to "IB (default)" is counted as IB, not as its listed IA/IAIN type) --
  // IAIN counts toward IA, since the Calculator only has three fee buckets.
  function totalsByBucket() {
    const totals = { IA: 0, IB: 0, II: 0 };
    buildSummaryLineItems().forEach((item) => {
      const label = effectiveVariantType(item.entry, item.variant).label;
      if (label.startsWith("IA")) totals.IA += 1;
      else if (label.startsWith("IB")) totals.IB += 1;
      else if (label.startsWith("II")) totals.II += 1;
    });
    return totals;
  }

  el.summaryExportCalculator.addEventListener("click", () => {
    const items = buildSummaryLineItems();
    if (items.length === 0) {
      window.alert("No variations selected yet -- nothing to export.");
      return;
    }
    // The Fee Calculator is now embedded in this Guide (see the nav hero), so the counts are
    // handed over in memory. The old build linked out to the retired standalone page and passed
    // them as ?ia=&ib=&ii= query params; when the calculator moved in here, the link became a
    // plain view switch and the counts silently stopped travelling with it -- the button looked
    // like it worked but the Variations step still showed 0/0/0.
    if (window.VCLCALC && window.VCLCALC.setGlobalCounts) {
      window.VCLCALC.setGlobalCounts(totalsByBucket());
    }
    goToDestination("calculator");
  });

  // Hand the selected variations over to the Guided Workflow (richer than the fee-only calculator
  // export): the first seeds Station A, the rest arrive pre-loaded in the grouping list with their
  // codes, and Grouping is pre-ticked when there is more than one -- see VCL_WORKFLOW.prefill.
  el.summaryExportWorkflow.addEventListener("click", () => {
    const items = buildSummaryLineItems();
    if (items.length === 0) {
      window.alert("No variations selected yet -- nothing to hand over.");
      return;
    }
    if (window.VCL_WORKFLOW && window.VCL_WORKFLOW.prefill) {
      window.VCL_WORKFLOW.prefill({
        variations: items.map((it) => ({
          code: it.entry.code,
          variantId: it.variant.id,
          type: effectiveVariantType(it.entry, it.variant).label,
        })),
      });
    }
    goToDestination("workflow");
  });

  async function exportSummaryToDocx() {
    const items = buildSummaryLineItems();
    if (items.length === 0) {
      window.alert("No variations selected yet -- nothing to export.");
      return;
    }
    if (!window.docx) {
      window.alert("The Word export library failed to load (no internet connection?). Please check your connection and try again.");
      return;
    }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

    const children = [
      new Paragraph({ text: "Summary of Variations", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Guideline ${CLASSIFICATION_META.guidelineRef}, applicable from ${CLASSIFICATION_META.applicableFrom}. Generated ${new Date().toLocaleDateString()}.`,
            italics: true,
            color: "5B6572",
          }),
        ],
        spacing: { after: 300 },
      }),
    ];

    items.forEach((item, idx) => {
      const eff = effectiveVariantType(item.entry, item.variant);
      const labelInfo = summaryLabelInfo(item.entry, item.variant);
      const unit = state.selections[item.key] && state.selections[item.key].units[item.unitIndex];
      const note = unit && unit.note && unit.note.trim();
      const pscope = findPreciseScopeWording(item.entry, item.variant);

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${idx + 1}. ${labelInfo.code} `, bold: true }),
            new TextRun({ text: `– `, bold: true }),
            new TextRun({ text: `Type ${eff.label}`, bold: true, italics: true }),
            new TextRun({ text: `:`, bold: true, italics: true }),
            new TextRun({ text: ` `, italics: true }),
            new TextRun({ text: item.entry.title }),
          ],
          spacing: { after: labelInfo.subtitle || note || pscope ? 40 : 200 },
        })
      );
      if (labelInfo.subtitle) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: labelInfo.subtitle })],
            indent: { left: 360 },
            spacing: { after: note || pscope ? 40 : 200 },
          })
        );
      }
      if (note) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "Note: ", bold: true, italics: true }), new TextRun({ text: note, italics: true })],
            indent: { left: 360 },
            spacing: { after: pscope ? 40 : 200 },
          })
        );
      }
      if (pscope) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "Precise scope wording:", bold: true })],
            indent: { left: 360 },
            spacing: { after: 40 },
          })
        );
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${pscope.code} `, bold: true }), new TextRun({ text: pscope.text })],
            indent: { left: 360 },
            spacing: { after: 200 },
          })
        );
      }
    });

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Summary-of-Variations.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function summaryConditionsHtml(entry, variant, checked) {
    return variant.conditions.length
      ? variant.conditions
          .map((cNum) => {
            const isChecked = checked.has(cNum);
            return `
              <label class="condition-row">
                <input type="checkbox" data-key="${conditionKey(entry.code, variant.id)}" data-cond="${cNum}" ${
              isChecked ? "checked" : ""
            } />
                <span>${entry.conditionsText[cNum]}</span>
              </label>
            `;
          })
          .join("")
      : `<p class="muted-text">No specific conditions listed for this variant.</p>`;
  }

  function unitDocsHtml(entry, variant, key, unitIndex) {
    if (!variant.documentation.length) {
      return variant.type === "II"
        ? `<p class="muted-text">No Annex-specific documentation list. Type II changes require a full variation application (assessment report, updated product information, etc.) rather than a standardised Annex checklist.</p>`
        : `<p class="muted-text">No specific documentation listed for this variant.</p>`;
    }
    const unit = state.selections[key].units[unitIndex];
    return variant.documentation
      .map((dNum) => {
        const docState = unit.docs[dNum] || { checked: false, note: "" };
        return `
          <div class="doc-check-item">
            <label class="doc-check-item__row">
              <input type="checkbox" data-doc-key="${key}" data-doc-unit="${unitIndex}" data-doc-num="${dNum}" ${
          docState.checked ? "checked" : ""
        } />
              <span>${dNum}. ${entry.documentationText[dNum]}</span>
            </label>
            <label class="doc-check-item__note">
              <span>Note:</span>
              <input type="text" data-note-key="${key}" data-note-unit="${unitIndex}" data-note-num="${dNum}" value="${escapeAttr(
          docState.note
        )}" placeholder="Optional remarks…" />
            </label>
          </div>
        `;
      })
      .join("");
  }

  function bindUnitDocInputs() {
    el.summaryList.querySelectorAll("input[data-doc-key]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.target.getAttribute("data-doc-key");
        const unitIndex = Number(ev.target.getAttribute("data-doc-unit"));
        const dNum = ev.target.getAttribute("data-doc-num");
        const sel = state.selections[key];
        if (!sel || !sel.units[unitIndex]) return;
        if (!sel.units[unitIndex].docs[dNum]) sel.units[unitIndex].docs[dNum] = { checked: false, note: "" };
        sel.units[unitIndex].docs[dNum].checked = ev.target.checked;
        saveSelections();
        renderSummary();
      });
    });

    el.summaryList.querySelectorAll("input[data-note-key]").forEach((input) => {
      input.addEventListener("input", (ev) => {
        const key = ev.target.getAttribute("data-note-key");
        const unitIndex = Number(ev.target.getAttribute("data-note-unit"));
        const dNum = ev.target.getAttribute("data-note-num");
        const sel = state.selections[key];
        if (!sel || !sel.units[unitIndex]) return;
        if (!sel.units[unitIndex].docs[dNum]) sel.units[unitIndex].docs[dNum] = { checked: false, note: "" };
        sel.units[unitIndex].docs[dNum].note = ev.target.value;
        saveSelections(); // no re-render here, so the input keeps focus/cursor while typing
      });
    });

    el.summaryList.querySelectorAll("textarea[data-note-line]").forEach((ta) => {
      ta.addEventListener("input", (ev) => {
        const [key, unitIndex] = splitLineKey(ev.target.getAttribute("data-note-line"));
        const sel = state.selections[key];
        if (!sel || !sel.units[unitIndex]) return;
        sel.units[unitIndex].note = ev.target.value;
        saveSelections(); // no re-render here, so the textarea keeps focus/cursor while typing
      });
    });
  }

  function renderSummary() {
    const items = buildSummaryLineItems();

    el.summaryCount.textContent = items.length
      ? `${items.length} ${items.length === 1 ? "item" : "items"} in this application`
      : "";

    if (items.length === 0) {
      el.summaryList.innerHTML = `<div class="empty-note">No variations selected yet. Browse the chapters on the left, open an entry, and use the +/− steppers next to each type (IA/IB/II) to add it here.</div>`;
      return;
    }

    el.summaryList.innerHTML = items
      .map((item, idx) => {
        const lineKey = unitLineKey(item.key, item.unitIndex);
        const isExpanded = state.summaryExpandedUnits.has(lineKey);
        const condKey = conditionKey(item.entry.code, item.variant.id);
        if (!state.checkedConditions[condKey]) state.checkedConditions[condKey] = new Set();
        const checked = state.checkedConditions[condKey];

        const unit = state.selections[item.key].units[item.unitIndex];
        const docCount = item.variant.documentation.length;
        const docsConfirmed = item.variant.documentation.filter((d) => unit.docs[d] && unit.docs[d].checked).length;
        const eff = effectiveVariantType(item.entry, item.variant);
        const labelInfo = summaryLabelInfo(item.entry, item.variant);
        const pscope = findPreciseScopeWording(item.entry, item.variant);

        return `
          <div class="summary-item">
            <div class="summary-item__row">
              <button class="summary-item__head" type="button" data-toggle-line="${lineKey}">
                <span class="summary-item__chevron">${isExpanded ? "▾" : "▸"}</span>
                <span class="summary-item__num">${idx + 1}.</span>
                <span class="mono summary-item__code">${labelInfo.code}</span>
                <span class="summary-item__typecol"><span class="${eff.badgeClass}">${eff.label}</span></span>
                <span class="summary-item__titles">
                  <span class="summary-item__title">${item.entry.title}</span>
                  ${labelInfo.subtitle ? `<span class="summary-item__subtitle">${labelInfo.subtitle}</span>` : ""}
                </span>
              </button>
              ${docCount ? `<span class="summary-item__doccount">${docsConfirmed}/${docCount} docs</span>` : ""}
              <button class="summary-item__remove" type="button" data-remove-line="${lineKey}" title="Remove this item">&times;</button>
            </div>
            ${
              isExpanded
                ? `
              <div class="summary-item__body">
                <div class="summary-item__section">
                  <h4>Conditions to be fulfilled</h4>
                  ${summaryConditionsHtml(item.entry, item.variant, checked)}
                </div>
                <div class="summary-item__section">
                  <h4>Documentation to be supplied</h4>
                  ${unitDocsHtml(item.entry, item.variant, item.key, item.unitIndex)}
                </div>
                <div class="summary-item__section">
                  <h4>Notes</h4>
                  <textarea class="summary-note" data-note-line="${lineKey}" placeholder="Optional justification or remarks for this item…">${escapeAttr(
              unit.note || ""
            )}</textarea>
                </div>
                ${
                  pscope
                    ? `
                <div class="summary-item__section">
                  <h4>Precise scope wording</h4>
                  <p class="precise-scope-wording"><span class="code-chip">${pscope.code}</span> ${escapePreciseScopeText(
                        pscope.text
                      )}</p>
                </div>
                `
                    : ""
                }
              </div>
            `
                : ""
            }
          </div>
        `;
      })
      .join("");

    el.summaryList.querySelectorAll("[data-toggle-line]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lk = btn.getAttribute("data-toggle-line");
        if (state.summaryExpandedUnits.has(lk)) state.summaryExpandedUnits.delete(lk);
        else state.summaryExpandedUnits.add(lk);
        renderSummary();
      });
    });

    el.summaryList.querySelectorAll("[data-remove-line]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [key, unitIndex] = splitLineKey(btn.getAttribute("data-remove-line"));
        removeUnit(key, unitIndex);
      });
    });

    el.summaryList.querySelectorAll("input[data-cond]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.target.getAttribute("data-key");
        const cond = Number(ev.target.getAttribute("data-cond"));
        if (!state.checkedConditions[key]) state.checkedConditions[key] = new Set();
        const set = state.checkedConditions[key];
        if (ev.target.checked) set.add(cond);
        else set.delete(cond);
        renderSummary();
      });
    });

    bindUnitDocInputs();
    alignSummaryColumns();
  }

  // Lines up the code and type-badge columns across all Summary rows so the description text
  // always starts at the same x position, based on the widest code / widest badge present.
  // The min-width goes on wrapper columns, not the badge pill itself, so the pill keeps its
  // normal compact shape and is simply left-aligned within the reserved column width.
  function alignSummaryColumns() {
    const codeEls = el.summaryList.querySelectorAll(".summary-item__code");
    const typeCols = el.summaryList.querySelectorAll(".summary-item__typecol");
    if (!codeEls.length) return;

    codeEls.forEach((e) => (e.style.minWidth = ""));
    typeCols.forEach((e) => (e.style.minWidth = ""));

    const maxCode = Math.max(...[...codeEls].map((e) => e.offsetWidth));
    const maxType = Math.max(...[...typeCols].map((e) => e.offsetWidth), 0);

    codeEls.forEach((e) => (e.style.minWidth = `${maxCode}px`));
    typeCols.forEach((e) => (e.style.minWidth = `${maxType}px`));
  }

  // Label shown for one variant: "(id) Label text" if labelled, "" otherwise -- shared between
  // the compact variant row (collapsed entry) and the full variant-block head (expanded entry).
  function variantLabelText(variant) {
    if (!variant.label) return "";
    return `${variant.id && !variant.label.trim().startsWith("(") ? `(${variant.id}) ` : ""}${variant.label}`;
  }

  // Full expanded content for ONE variant -- conditions to tick, documentation, precise scope
  // wording (where available) and quantity stepper. Unchanged in substance from the entry's
  // previous standalone detail page (which showed every variant expanded at once); now only the
  // single variant the user actually clicked renders this way, its siblings stay compact rows.
  function buildVariantFullHtml(entry, variant) {
    const key = conditionKey(entry.code, variant.id);
    if (!state.checkedConditions[key]) state.checkedConditions[key] = new Set();
    const checked = state.checkedConditions[key];
    const selQty = getSelectionQty(entry.code, variant.id);

    const conditionsHtml = variant.conditions.length
      ? variant.conditions
          .map((cNum) => {
            const isChecked = checked.has(cNum);
            return `
              <label class="condition-row">
                <input type="checkbox" data-key="${key}" data-cond="${cNum}" ${isChecked ? "checked" : ""} />
                <span>${entry.conditionsText[cNum]}</span>
              </label>
            `;
          })
          .join("")
      : `<p class="muted-text">No specific conditions listed for this variant.</p>`;

    const allMet = variant.conditions.length > 0 && variant.conditions.every((c) => checked.has(c));

    // Only Type IA (incl. IAIN) variants fall back to "Type IB by default" under Art. 3 when
    // their conditions aren't (yet) met -- so the live badge/warning only applies to those.
    let statusHtml = "";
    if (variant.conditions.length > 0) {
      if (allMet) {
        statusHtml = `<div class="status status--ok">All conditions met → currently qualifies as <span class="${typeBadgeClass(
          variant.type
        )}">${variant.type}</span></div>`;
      } else if (variant.type.startsWith("IA")) {
        statusHtml = `<div class="status status--warn">Not all conditions confirmed yet → currently defaults to <span class="badge type-ib">IB (default)</span>. First check whether another variant under this same code (often a specifically listed Type II variant for a more significant version of this change) fits instead. If none does, the Type IB by default fallback under Art. 3 of the Variations Regulation applies — unless the change may have a significant impact on quality, safety or efficacy, in which case Type II should be used. Tick all conditions above once confirmed to qualify for <span class="${typeBadgeClass(
          variant.type
        )}">${variant.type}</span> instead.</div>`;
      }
    }

    const docHtml = variant.documentation.length
      ? `<ol class="doc-list">${variant.documentation
          .map((dNum) => `<li>${entry.documentationText[dNum]}</li>`)
          .join("")}</ol>`
      : variant.type === "II"
      ? `<p class="muted-text">No Annex-specific documentation list. Type II changes require a full variation application (assessment report, updated product information, etc.) rather than a standardised Annex checklist.</p>`
      : `<p class="muted-text">No specific documentation listed for this variant.</p>`;

    // Newly surfaced here (previously only shown in the Summary view and the .docx export):
    // same lookup/escaping helpers, same markup, so it looks identical wherever it appears.
    const pscope = findPreciseScopeWording(entry, variant);
    const pscopeHtml = pscope
      ? `
        <div class="variant-block__section">
          <h4>Precise scope wording</h4>
          <p class="precise-scope-wording"><span class="code-chip">${pscope.code}</span> ${escapePreciseScopeText(pscope.text)}</p>
        </div>
      `
      : "";

    // Type IA (incl. IAIN) variants with conditions live-toggle between their listed type and
    // the "IB by default" fallback: whichever currently applies is shown at full strength, the
    // other is dimmed -- instead of only saying so in the status text below.
    const hasIbFallback = variant.type.startsWith("IA") && variant.conditions.length > 0;
    const ibFallbackBadge = hasIbFallback
      ? `<span class="badge type-ib${allMet ? " badge--dim" : ""}">IB (default)</span>`
      : "";
    const iaBadgeClass = `${typeBadgeClass(variant.type)}${hasIbFallback && !allMet ? " badge--dim" : ""}`;

    return `
      <div class="variant-block">
        <div class="variant-block__head">
          ${variant.label ? `<span class="variant-block__label">${variantLabelText(variant)}</span>` : ""}
          <div class="variant-block__head-right">
            <span class="${iaBadgeClass}">${variant.type}</span>
            ${ibFallbackBadge}
            <div class="qty-stepper" data-selection-key="${key}">
              <button class="qty-stepper__minus" type="button" ${selQty <= 0 ? "disabled" : ""}>−</button>
              <span class="qty-stepper__value">${selQty}</span>
              <button class="qty-stepper__plus" type="button">+</button>
            </div>
          </div>
        </div>
        <div class="variant-block__section">
          <h4>Conditions to be fulfilled</h4>
          ${conditionsHtml}
          ${statusHtml}
        </div>
        <div class="variant-block__section">
          <h4>Documentation to be supplied</h4>
          ${docHtml}
        </div>
        ${pscopeHtml}
        ${variant.note ? `<div class="note-block note-block--variant"><strong>Note:</strong> ${variant.note}</div>` : ""}      </div>
    `;
  }

  // Body for one entry: iterates its variants in order (preserving any variant.group
  // sub-headings), rendering each as a compact row -- except the single active variant
  // (activeVariantId, only meaningful when isEntryOpen), which gets buildVariantFullHtml()
  // instead. Chapter/section notes and the entry's own note appear once, only while this entry
  // has an active variant (mirrors the old "only shown once the entry is opened" behaviour).
  function buildEntryBodyHtml(entry, activeVariantId, isEntryOpen) {
    let rowsHtml = "";
    let lastGroup = undefined;
    entry.variants.forEach((variant) => {
      if (variant.group !== lastGroup) {
        if (variant.group) {
          rowsHtml += `<h4 class="variant-group-heading">${variant.group}</h4>`;
        }
        lastGroup = variant.group;
      }

      if (isEntryOpen && variant.id === activeVariantId) {
        rowsHtml += buildVariantFullHtml(entry, variant);
      } else {
        rowsHtml += `
          <button type="button" class="entry-variant-row" data-entry-code="${entry.code}" data-variant-id="${variant.id == null ? "" : variant.id}">
            <span class="entry-variant-row__label">${variantLabelText(variant)}</span>
            <span class="${typeBadgeClass(variant.type)}">${navBadgeLabel(variant.type)}</span>
          </button>
        `;
      }
    });

    const listHtml = `<div class="entry-variants">${rowsHtml}</div>`;
    if (!isEntryOpen) return listHtml;

    const chapterNote = CHAPTERS[entry.chapter].generalNote;
    const sectionMeta = entry.section && SECTIONS[entry.chapter] ? SECTIONS[entry.chapter][entry.section] : null;
    const sectionNote = sectionMeta ? sectionMeta.note : null;
    const revision = revisionForCode(entry.code);

    return `
      ${revision ? `<div class="change-callout"><strong>What changed:</strong> ${revision.summary} (Guideline ${revision.guidelineRef}, applicable from ${revision.date}.)</div>` : ""}
      ${chapterNote ? `<div class="note-block note-block--chapter"><strong>Chapter ${entry.chapter} — general note:</strong> ${chapterNote}</div>` : ""}
      ${sectionNote ? `<div class="note-block note-block--chapter"><strong>${entry.chapter}.${entry.section} — note:</strong> ${sectionNote}</div>` : ""}
      ${listHtml}
      ${entry.notes ? `<div class="note-block"><strong>Note:</strong> ${entry.notes}</div>` : ""}
    `;
  }

  // Breadcrumb shown above whatever the detail area is showing -- Chapter · Section · Subsection
  // heading, derived from the same navigation state that determined the scope. Skipped only
  // while search results are showing: they can span multiple chapters, so there is no single
  // path to draw. Shown from the chapter level down (a one-segment crumb still answers "where
  // am I", which is the question it exists for).
  function buildBreadcrumbSegments() {
    if (state.query || !state.activeChapter) return [];
    const chapter = CHAPTERS[state.activeChapter];
    if (!chapter) return [];
    const segments = [{ label: `${chapter.code} · ${chapter.title}`, level: "chapter" }];
    if (SECTIONS[chapter.code] && state.activeSection) {
      const sec = SECTIONS[chapter.code][state.activeSection];
      if (sec) segments.push({ label: `${chapter.code}.${state.activeSection} · ${sec.title}`, level: "section" });
    }
    if (visibleEntries.length) {
      const headings = new Set(visibleEntries.map((e) => subsectionHeading(e)).filter(Boolean));
      // Only add a 3rd segment when every visible entry shares exactly one *genuine* subsection
      // heading -- the coarse whole-section fallback (e.g. "Q.III — CEP/TSE/Monographs") would
      // just repeat the section segment above, and with more than one heading mixed together
      // (e.g. Q.V.a + Q.V.b both auto-expanded) no single heading could speak for the whole list.
      if (headings.size === 1 && isGenuineSubsectionHeading(visibleEntries[0])) {
        segments.push({ label: subsectionHeading(visibleEntries[0]), level: "heading" });
      }
    }
    return segments;
  }

  // Every segment but the last is a link back up to that level. The last one is where you are,
  // so it stays plain text -- a link that navigates to the page you are on is a dead control.
  function buildBreadcrumbHtml() {
    const segments = buildBreadcrumbSegments();
    if (!segments.length) return "";
    return `
      <div class="entry-breadcrumb">
        ${segments
          .map((seg, i) =>
            i === segments.length - 1
              ? `<span class="entry-breadcrumb__seg entry-breadcrumb__seg--current">${seg.label}</span>`
              : `<button type="button" class="entry-breadcrumb__seg entry-breadcrumb__seg--link" data-crumb="${seg.level}">${seg.label}</button>`
          )
          .join('<span class="entry-breadcrumb__sep">›</span>')}
      </div>
    `;
  }

  function wireBreadcrumb(container) {
    container.querySelectorAll("[data-crumb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Climbing to a level drops everything below it -- the same reset the nav rows do when
        // they are clicked, so arriving via the crumb leaves exactly the state arriving via the
        // tree would have left.
        if (btn.dataset.crumb === "chapter") state.activeSection = null;
        state.openHeading = null;
        state.forcedClosedHeadings.clear();
        state.activeVariant = null;
        renderBrowse();
        renderDetail();
        el.detailCol.scrollTop = 0;
      });
    });
  }

  // The entries the tree would list at the current level, or null where this level's children
  // are sections rather than entries.
  function currentScopeEntries() {
    if (!state.activeChapter) return null;
    const chapter = CHAPTERS[state.activeChapter];
    if (!chapter || chapter.status === "in-preparation") return null;
    if (SECTIONS[state.activeChapter]) {
      if (!state.activeSection) return null;
      return ENTRIES.filter((e) => e.chapter === state.activeChapter && e.section === state.activeSection);
    }
    return ENTRIES.filter((e) => e.chapter === state.activeChapter);
  }

  // What the tree opens *below* the current level, as cards for the detail area. Clicking a
  // chapter or a section used to leave the detail area showing the top-level overview -- the
  // six main destinations -- which had nothing to do with where the user had just navigated and
  // read as "you are back at the start". These cards mirror the rows the tree grew on the left
  // instead, so the two halves say the same thing. Levels whose children are entries (E, C, and
  // the autoExpandGroups sections) never reach here: their entries are already in scope.
  function buildLevelNav() {
    // Gated on classifyOpen for the same reason the tree itself is (see renderBrowse, which
    // builds the chapter rows -- and populates visibleEntries -- only while the branch is
    // open): with the branch collapsed those rows are gone from the nav, so filling the detail
    // area with a level from inside it would be describing navigation the user cannot see.
    // Collapsing the branch falls back to the overview, exactly as it did before these cards.
    if (state.query || !state.classifyOpen) return null;

    // Top of the branch: open, but no chapter picked yet -> the chapters. Same order the tree
    // builds them in (Object.values(CHAPTERS)), so the cards and the rows read as one list.
    if (!state.activeChapter) {
      const items = Object.values(CHAPTERS).map((chapter) => ({
        kind: "chapter",
        key: chapter.code,
        code: chapter.code,
        label: chapter.title,
        codes: ENTRIES.filter((e) => e.chapter === chapter.code).map((e) => e.code),
      }));
      // Fifth card mirrors the fifth nav row. Its count isn't an entry range, so it carries its
      // own foot text (current list size, or the historical archive size while that is empty).
      if (ART5_DATA) {
        items.push({
          kind: "art5",
          key: "art5",
          code: "Art. 5",
          label: "Recommendations for unforeseen variations",
          codes: [],
          footText: ART5_DATA.current.length
            ? ART5_DATA.current.length + " current"
            : ART5_DATA.historical.length + " historical",
        });
      }
      return items.length ? { items } : null;
    }

    const chapter = CHAPTERS[state.activeChapter];
    if (!chapter || chapter.status === "in-preparation") return null;

    // A chapter with an internal section structure (currently only Q), no section picked yet.
    if (SECTIONS[state.activeChapter] && !state.activeSection) {
      const items = Object.keys(SECTIONS[state.activeChapter]).map((secKey) => {
        const meta = SECTIONS[state.activeChapter][secKey];
        const codes = ENTRIES.filter((e) => e.chapter === state.activeChapter && e.section === secKey).map((e) => e.code);
        return { kind: "section", key: secKey, code: `${chapter.code}.${secKey}`, label: meta.title, codes };
      });
      return items.length ? { items } : null;
    }

    // Otherwise: the collapsible group headings in scope (Q.I/Q.II's subsections, M's
    // listGroups). defaultGroupOpen() headings are skipped for the same reason the tree skips
    // building a toggle for them -- they are already open, so their entries are showing.
    const matches = currentScopeEntries();
    if (!matches || !matches.length) return null;
    const byHeading = new Map();
    matches.forEach((e) => {
      const heading = subsectionHeading(e);
      if (!heading || defaultGroupOpen(e)) return;
      if (!byHeading.has(heading)) {
        byHeading.set(heading, { kind: "heading", key: heading, code: e.listGroup ? e.chapter : null, label: heading, codes: [] });
      }
      byHeading.get(heading).codes.push(e.code);
    });
    const items = [...byHeading.values()];
    return items.length ? { items } : null;
  }

  function levelCardsHtml(nav) {
    const cards = nav.items
      .map((it, i) => {
        const n = it.codes.length;
        // An item can carry its own foot text (Art. 5) instead of an entry range/count; such an
        // item is never "empty" even with no codes.
        const hasFoot = !!it.footText;
        const empty = n === 0 && !hasFoot;
        const range = n === 0 ? "in preparation" : n === 1 ? it.codes[0] : `${it.codes[0]} – ${it.codes[n - 1]}`;
        // Count sits in the foot next to the (short) code range rather than beside the title:
        // some section titles run long ("Changes to a marketing authorisation resulting from
        // other regulatory procedures"), and a badge next to them squeezed the title into a
        // six-line column of its own.
        const foot = hasFoot
          ? `<span class="level-card__range">${it.footText}</span>`
          : `<span class="level-card__range">${range}</span>${n === 0 ? "" : `<span class="level-card__count">${n} ${n === 1 ? "entry" : "entries"}</span>`}`;
        return `
          <button type="button" class="level-card${empty ? " level-card--empty" : ""}" data-level-idx="${i}"${empty ? " disabled" : ""}>
            <span class="level-card__top">
              ${it.code ? `<span class="level-card__code">${it.code}</span>` : ""}
              <span class="level-card__label">${it.label}</span>
            </span>
            <span class="level-card__foot">${foot}</span>
          </button>`;
      })
      .join("");
    return `<div class="level-cards">${cards}</div>`;
  }

  function wireLevelCards(container, nav) {
    container.querySelectorAll("[data-level-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = nav.items[parseInt(btn.dataset.levelIdx, 10)];
        if (!item) return;
        if (item.kind === "art5") {
          state.view = "art5";
          state.activeChapter = null;
          state.activeSection = null;
          renderBrowse();
          switchViewVisibility();
          renderArt5();
          jumpToTop();
          return;
        }
        if (item.kind === "chapter") {
          // Same reset the tree's own chapter head performs when it is clicked.
          state.activeChapter = item.key;
          state.activeSection = null;
          state.openHeading = null;
          state.forcedClosedHeadings.clear();
        } else if (item.kind === "section") {
          state.activeSection = item.key;
          state.openHeading = null;
          state.forcedClosedHeadings.clear();
        } else {
          // Same accordion rule the tree's own group toggles follow: opening one closes the rest.
          state.openHeading = item.key;
          state.forcedClosedHeadings.delete(item.key);
        }
        state.activeVariant = null;
        renderBrowse();
        renderDetail();
        el.detailCol.scrollTop = 0;
      });
    });
  }

  // Renders every entry currently "in scope" (visibleEntries, rebuilt by the preceding
  // renderBrowse() call) as a stacked list in the detail panel: each entry gets a blue summary
  // chip (.entry-summary, Classification's own identity color -- see CSS) followed by one row
  // per variant. Only the single variant the user has clicked into (state.activeVariant) shows
  // its full conditions/documentation/precise-scope content in place of its compact row -- every
  // other variant, including its own siblings under the same entry, stays compact. Clicking the
  // active entry's own chip collapses that variant back down. The list itself never scrolls out
  // of view when a variant expands -- the full content simply grows in its place.
  // Shared navigation used by both the top nav buttons and the first-load overview cards.
  function goToDestination(dest) {
    state.query = ""; el.search.value = "";
    state.classifyOpen = false;
    state.guidanceOpen = false;
    state.guidanceHub = dest === "guidance";
    if (dest === "calculator") state.view = "calculator";
    else if (dest === "classification") { state.view = "browse"; state.classifyOpen = true; }
    else if (dest === "guidance") { state.view = "browse"; state.guidanceOpen = true; }
    else if (dest === "grouping") { state.view = "grouping"; state.guidanceOpen = true; }
    else if (dest === "precisescope") { state.view = "precisescope"; state.guidanceOpen = true; }
    else if (dest === "qa") { state.view = "qa"; state.guidanceOpen = true; }
    else if (dest === "timetables") state.view = "timetables";
    else if (dest === "workload") state.view = "workload";
    else if (dest === "workflow") state.view = "workflow";
    else state.view = "browse";
    renderBrowse();
    switchViewVisibility();
    if (dest === "timetables") renderTimetables();
    else if (dest === "qa") renderQA();
    else if (dest === "workload") { if (window.VCL_WORKLOAD) window.VCL_WORKLOAD.render(el.workloadCol); }
    else if (dest === "workflow") { if (window.VCL_WORKFLOW) window.VCL_WORKFLOW.render(el.workflowCol); }
    else if (dest === "calculator") fillCalcHead();
    else renderDetail();
    jumpToTop();
  }

  // Minimal additive hook so the self-contained tools (e.g. the Guided Workflow) can hand the
  // user over to another view -- used for the Workflow -> Fee Calculator cross-link. Purely
  // additive; nothing existing depends on it.
  window.VCL_APP = { goTo: goToDestination };

  // First-load overview: the main destinations as cards in the detail area (each shares its
  // nav identity color).
  // Card texts mirror the left nav's tab__title lines word for word (user decision 2026-07-22:
  // nav and overview read identically). The three guidance documents no longer get cards of
  // their own -- they live behind the "Guidance on Variations" card (see guidanceHubHtml).
  const OVERVIEW_DESTINATIONS = [
    { dest: "calculator", label: "Variation Fee Calculator", color: "#8f6e2e", desc: "The classic calculator for variation fees w/o worksharing." },
    { dest: "workflow", label: "Guided Workflow", color: "var(--workflow)", desc: "Step by step from classification to fees with worksharing." },
    { dest: "classification", label: "Classification of Variations", color: "var(--classify)", desc: "Browse the Classification Guideline by chapter E, Q, C, M, Art. 5." },
    { dest: "guidance", label: "Guidance on Variations", color: "var(--group)", desc: "Procedural guidance and Q&amp;A on variations." },
    { dest: "timetables", label: "Timetables for Variations", color: "var(--slate)", desc: "A visual representation of the timelines of variations." },
    { dest: "workload", label: "Workload Planning", color: "var(--workload)", desc: "Estimated RA workload from start to closure of variations." },
  ];
  function overviewHtml() {
    const cards = OVERVIEW_DESTINATIONS.map((d) => `
      <button type="button" class="guide-overview__card" data-dest="${d.dest}" style="--card-accent: ${d.color}">
        <span class="guide-overview__title"><span class="guide-overview__dot"></span>${d.label}</span>
        <span class="guide-overview__desc">${d.desc}</span>
      </button>`).join("");
    return `
      <div class="guide-overview">
        <h3 class="guide-overview__heading">Welcome to the Variation Toolbox</h3>
        <p class="guide-overview__intro">Search a variation in the box on the left to classify it &mdash; or pick a tool below. Everything for variation applications in one place.</p>
        <div class="guide-overview__grid">${cards}</div>
      </div>`;
  }
  function wireOverviewCards(container) {
    container.querySelectorAll(".guide-overview__card[data-dest]").forEach((btn) => {
      btn.addEventListener("click", () => goToDestination(btn.getAttribute("data-dest")));
    });
  }

  // The Guidance hub: shown in the detail area when "Guidance on Variations" is opened (nav
  // button or overview card) -- its documents as cards, same language as the welcome overview,
  // all in the branch's own "--group" identity color. Clicking a card goes to the document.
  function guidanceHubHtml() {
    const docs = [
      { dest: "grouping", label: GROUPING_GUIDANCE.title, desc: "Which changes may be grouped into one submission." },
      { dest: "precisescope", label: PRECISE_SCOPE_GUIDANCE.title, desc: "Example wordings for the application form's scope field." },
    ];
    if (QA_DATA) docs.push({ dest: "qa", label: "Q&A on Variations", desc: "The CMDh questions and answers on submitting variations." });
    const cards = docs.map((d) => `
      <button type="button" class="guide-overview__card" data-dest="${d.dest}" style="--card-accent: var(--group)">
        <span class="guide-overview__title"><span class="guide-overview__dot"></span>${d.label}</span>
        <span class="guide-overview__desc">${d.desc}</span>
      </button>`).join("");
    return `
      <div class="guide-overview">
        <h3 class="guide-overview__heading" style="color: var(--group);">Guidance on Variations</h3>
        <p class="guide-overview__intro">Procedural guidance and Q&amp;A on variations &mdash; pick a document.</p>
        <div class="guide-overview__grid">${cards}</div>
      </div>`;
  }

  function renderDetail() {
    syncUrlToState();

    // Nothing in scope: either the user is standing on a chapter/section whose children are the
    // level below (-> show that level, see buildLevelNav) or they are nowhere in particular
    // (-> the first-load overview of the main destinations). Only the overview hides the
    // Classification-specific detail head, so it reads as a welcome rather than as
    // "Classification"; a level listing is Classification and keeps it.
    const levelNav = visibleEntries.length === 0 ? buildLevelNav() : null;
    const showOverview = visibleEntries.length === 0 && !state.query && !levelNav;
    if (el.detailHead) el.detailHead.classList.toggle("hidden", showOverview);

    if (visibleEntries.length === 0) {
      el.detail.classList.add("hidden");
      el.detailEmpty.classList.remove("hidden");
      if (state.query) {
        el.detailEmpty.innerHTML =
          `<p class="results-meta results-meta--detail">0 entries match your search</p>` +
          `<p class="classification-empty-hint">No matching entries. Try a different code or keyword.</p>`;
      } else if (levelNav) {
        el.detailEmpty.innerHTML = buildBreadcrumbHtml() + levelCardsHtml(levelNav);
        wireBreadcrumb(el.detailEmpty);
        wireLevelCards(el.detailEmpty, levelNav);
      } else {
        // Same empty-scope slot, two occupants: the Guidance hub while that branch is open,
        // otherwise the first-load welcome overview. Both wire their cards the same way.
        el.detailEmpty.innerHTML = state.guidanceHub ? guidanceHubHtml() : overviewHtml();
        wireOverviewCards(el.detailEmpty);
      }
      return;
    }
    el.detail.classList.remove("hidden");
    el.detailEmpty.classList.add("hidden");

    // While searching, the match count sits at the top of the detail area (moved here from
    // the browse tree) so results and their count are read together.
    const searchCountHtml = state.query
      ? `<p class="results-meta results-meta--detail">${visibleEntries.length} ${visibleEntries.length === 1 ? "entry" : "entries"} match your search</p>`
      : "";

    // Inline heading dividers (plain text, not a nav toggle) between entries only when the
    // visible list actually mixes more than one *genuine* subsection heading -- e.g. an
    // auto-expanded section with several subsections (Q.V.a + Q.V.b) shown together, or a
    // search spanning a few. A single shared heading is already conveyed by the breadcrumb (or,
    // for the toggle-driven case like Q.II, by the nav toggle itself), so it isn't repeated here.
    const distinctGenuineHeadings = new Set(
      visibleEntries.filter(isGenuineSubsectionHeading).map((e) => subsectionHeading(e))
    );
    const showInlineHeadings = distinctGenuineHeadings.size > 1;
    let lastInlineHeading = undefined;

    el.detail.innerHTML =
      searchCountHtml +
      buildBreadcrumbHtml() +
      visibleEntries
        .map((entry) => {
          const isEntryOpen = !!(state.activeVariant && state.activeVariant.code === entry.code);
          const revision = revisionForCode(entry.code);
          const accent = CHAPTERS[entry.chapter].accent;

          let headingHtml = "";
          if (showInlineHeadings) {
            const heading = subsectionHeading(entry);
            if (heading !== lastInlineHeading) {
              lastInlineHeading = heading;
              if (heading && isGenuineSubsectionHeading(entry)) {
                headingHtml = `<h4 class="entry-group-heading">${heading}</h4>`;
              }
            }
          }

          return `
            ${headingHtml}
            <div class="entry-card" style="--accent: ${accent}">
              <button type="button" class="entry-summary${isEntryOpen ? " entry-summary--active" : ""}" data-entry-code="${entry.code}">
                <span class="entry-summary__text"><span class="entry-summary__code">${entry.code}${revision ? `<span class="changed-dot" title="Changed in guideline ${revision.guidelineRef} (${revision.date})"></span>` : ""}</span> &mdash; <span class="entry-summary__title">${entry.title}</span></span>
                ${isEntryOpen && revision ? `<span class="changed-badge">↻ changed in Rev. ${revision.guidelineRef}</span>` : ""}
              </button>
              ${buildEntryBodyHtml(entry, isEntryOpen ? state.activeVariant.variantId : undefined, isEntryOpen)}
            </div>
          `;
        })
        .join("");

    wireBreadcrumb(el.detail);

    el.detail.querySelectorAll(".entry-summary[data-entry-code]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-entry-code");
        // Chip click only ever collapses -- there's no single "default" variant to expand to
        // here now that each variant is opened individually via its own row.
        if (state.activeVariant && state.activeVariant.code === code) state.activeVariant = null;
        renderDetail();
      });
    });

    el.detail.querySelectorAll(".entry-variant-row[data-entry-code]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-entry-code");
        const rawId = btn.getAttribute("data-variant-id");
        state.activeVariant = { code, variantId: rawId === "" ? null : rawId };
        renderDetail();
        const reopened = el.detail.querySelector(".entry-summary--active");
        if (reopened) reopened.scrollIntoView({ block: "nearest" });
      });
    });

    el.detail.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.target.getAttribute("data-key");
        const cond = Number(ev.target.getAttribute("data-cond"));
        const set = state.checkedConditions[key];
        if (ev.target.checked) set.add(cond);
        else set.delete(cond);
        renderDetail();
      });
    });

    el.detail.querySelectorAll(".qty-stepper[data-selection-key]").forEach((stepper) => {
      const found = findEntryAndVariant(stepper.getAttribute("data-selection-key"));
      if (!found) return;
      stepper.querySelector(".qty-stepper__minus").addEventListener("click", () => {
        setSelectionQty(found.entry.code, found.variant.id, getSelectionQty(found.entry.code, found.variant.id) - 1);
        renderDetail();
      });
      stepper.querySelector(".qty-stepper__plus").addEventListener("click", () => {
        setSelectionQty(found.entry.code, found.variant.id, getSelectionQty(found.entry.code, found.variant.id) + 1);
        renderDetail();
      });
    });
  }

  el.search.addEventListener("input", (ev) => {
    state.query = ev.target.value;
    if (state.query) {
      state.classifyOpen = true; // typing a query implies "show me matches"
      // Surface the matches in the detail area immediately, from any view, without
      // needing to click "Classification" first.
      state.view = "browse";
      state.guidanceOpen = false;
      switchViewVisibility();
    }
    renderBrowse();
    renderDetail();
  });

  // Keyboard navigation: Up/Down moves through the currently visible browse-column buttons
  // (chapter/section rows, group toggles, result cards, the pinned Summary/Grouping tabs) --
  // Enter/Space already activate a focused <button> natively, so no extra handling needed
  // for that part. Down from the search box jumps straight into the first result; Up from
  // the very first item jumps back out to the search box.
  function focusableInBrowseTree() {
    return Array.from(el.browseTree.querySelectorAll("button:not([disabled])"));
  }

  el.browseTree.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const items = focusableInBrowseTree();
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    ev.preventDefault();
    if (ev.key === "ArrowUp" && idx === 0) {
      el.search.focus();
      return;
    }
    const nextIdx = ev.key === "ArrowDown" ? Math.min(idx + 1, items.length - 1) : idx - 1;
    items[nextIdx].focus();
  });

  el.search.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown") return;
    const items = focusableInBrowseTree();
    if (items.length) {
      ev.preventDefault();
      items[0].focus();
    }
  });

  // ==========================================================================================
  // Feedback contact ("Suggest an improvement").
  //
  // The address arrives from PHP split into user/domain (see vcl_get_contact_parts) and is only
  // ever joined here, at runtime -- so the served HTML never contains a literal address for a
  // harvester to regex out. Exposed on window because vcl-workload.js needs the same link for
  // its methodology panel, and there is exactly one place that knows how to build it.
  // ==========================================================================================
  function contactAddress() {
    const c = (window.VCL_CONFIG && window.VCL_CONFIG.contact) || {};
    return c.user && c.domain ? c.user + "@" + c.domain : "";
  }

  // context names the tool the suggestion came from, so the subject line says which one.
  // Returns null when no address is configured -- callers append nothing rather than a dead link.
  function buildContactLink(label, context) {
    const mail = contactAddress();
    if (!mail) return null;
    const a = document.createElement("a");
    a.className = "vcl-contact-link";
    a.href = "mailto:" + mail + "?subject=" + encodeURIComponent("Variation Toolbox — suggestion" + (context ? " (" + context + ")" : ""));
    a.innerHTML = '<span class="ico">&#9993;</span>' + label;
    return a;
  }

  window.VCL_CONTACT = { link: buildContactLink, address: contactAddress };

  function fillContactSlots() {
    const slot = document.getElementById("vcl-contactSlot");
    if (!slot) return;
    const link = buildContactLink("Suggest an improvement", null);
    if (!link) return;
    slot.appendChild(document.createTextNode(" · "));
    slot.appendChild(link);
  }

  openEntryFromUrl();
  fillContactSlots();
  renderBrowse();
  switchViewVisibility();
  renderDetail();
  renderSelectionBar();
  renderSummary();
  renderGrouping();
  renderPreciseScope();
  renderTimetables();
  if (window.VCL_WORKLOAD) window.VCL_WORKLOAD.render(el.workloadCol);
})();
