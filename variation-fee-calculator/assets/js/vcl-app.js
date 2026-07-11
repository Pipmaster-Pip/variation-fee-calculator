(function () {
  "use strict";

  const { CLASSIFICATION_META, SECTIONS, CHAPTERS, ENTRIES, GROUPING_GUIDANCE, REVISION_HISTORY } = window.VCL_DATA;

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

  // Admin-editable via the "Variations Reference Guide" section on the plugin's settings page (see
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
    activeChapter: null, // no chapter expanded at first -- only E/Q/C/M show, all collapsed
    activeSection: null, // e.g. "I", "II" ... within a chapter that has SECTIONS (currently only Q)
    query: "",
    activeEntry: null,
    openHeading: null, // the one group heading explicitly opened by the user (accordion: closes all others)
    forcedClosedHeadings: new Set(), // default-open headings the user has explicitly closed
    checkedConditions: {}, // "E.1|a" -> Set of condition numbers checked
    selections: loadSelections(), // "E.1|a" -> { qty, units }
    selectionExpanded: false,
    view: "summary", // "browse" | "summary" -- the app opens on the Summary page
    summaryExpandedUnits: new Set(), // "E.1|a#0" -> that unit's long form is open in the Summary view
    groupingOpen: null, // "acceptable" | "notAcceptable" | "singleChangeInstead" | null -- at most one grouping-guidance section is ever expanded
    ttType: "ia", // "ia" | "ib" | "ii" -- active tab in the Timetables view
    ttIIVariant: "60", // "30" | "60" | "90" -- active Type II sub-procedure
    ttCompare: false, // Timetables view: showing the 30/60/90-day comparison instead of a single timetable
  };

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
    groupingCol: document.getElementById("vcl-groupingCol"),
    timetablesCol: document.getElementById("vcl-timetablesCol"),
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
    <p class="ref-updated">Last updated in Variations Reference Guide: ${lastUpdated("classification", CLASSIFICATION_META.lastUpdated)}</p>
  `;
  el.detailEmpty.innerHTML = `
    <p class="classification-empty-hint">Select an entry from the list to see its conditions, required documentation and procedure type. Tick off conditions as you confirm them to see whether the change qualifies for the listed type.</p>
  `;

  // The browse column (search + chapter/section/subsection accordion) stays on screen in every
  // view -- only the right-hand column switches between the entry detail, the Summary, and the
  // (static) Grouping guidance.
  function switchViewVisibility() {
    const isSummary = state.view === "summary";
    const isGrouping = state.view === "grouping";
    const isTimetables = state.view === "timetables";
    el.detailCol.classList.toggle("hidden", isSummary || isGrouping || isTimetables);
    el.summaryCol.classList.toggle("hidden", !isSummary);
    el.groupingCol.classList.toggle("hidden", !isGrouping);
    el.timetablesCol.classList.toggle("hidden", !isTimetables);
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
    if (state.activeEntry) {
      url.searchParams.set("code", state.activeEntry);
    } else {
      url.searchParams.delete("code");
    }
    if (url.toString() !== window.location.href) {
      window.history.replaceState(null, "", url.toString());
    }
  }

  function openEntryFromUrl() {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    const entry = ENTRIES.find((e) => e.code === code);
    if (!entry) return;
    state.classifyOpen = true;
    state.activeChapter = entry.chapter;
    state.activeSection = entry.section || null;
    state.activeEntry = entry.code;
    state.view = "browse";
    const heading = subsectionHeading(entry);
    if (heading) {
      state.openHeading = heading;
      state.forcedClosedHeadings.delete(heading);
    }
  }

  function makeEntryCard(entry) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "result-card" + (state.activeEntry === entry.code ? " result-card--active" : "");
    let types = [...new Set(entry.variants.map((v) => v.type))];
    if (!entry.code.endsWith(".z")) {
      types = [...new Set(types.map((t) => (t === "IB (unforeseen)" ? "IB" : t)))];
    }
    const revision = revisionForCode(entry.code);
    card.innerHTML = `
      <div class="result-card__head">
        <span class="mono result-card__code">${entry.code}${revision ? `<span class="changed-dot" title="Changed in guideline ${revision.guidelineRef} (${revision.date})"></span>` : ""}</span>
        <div class="result-card__badges">${types.map((t) => `<span class="${typeBadgeClass(t)}">${navBadgeLabel(t)}</span>`).join("")}</div>
      </div>
      <div class="result-card__title">${entry.title}</div>
    `;
    card.addEventListener("click", () => {
      state.activeEntry = entry.code;
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      el.detailCol.scrollTop = 0;
      jumpToTop();
    });
    return card;
  }

  // Renders `matches` into `container`, optionally grouped into collapsible subsection
  // headings (Q's Q.I.a/Q.I.b/... and M's flat listGroup headings) -- the same
  // accordion-of-at-most-one behaviour as the chapter/section levels, driven by
  // isHeadingOpen(). Ungrouped for the flat global-search list, where headings would mix
  // entries from unrelated chapters.
  function renderEntryGroup(container, matches, grouped) {
    if (matches.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-note";
      div.textContent = "No matching entries. Try a different code or keyword.";
      container.appendChild(div);
      return;
    }

    const list = document.createElement("div");
    list.className = "results-list";
    container.appendChild(list);

    let lastHeading = undefined;
    let currentGroupCards = null; // container for cards under the currently open group, or null when ungrouped

    matches.forEach((entry) => {
      const heading = grouped ? subsectionHeading(entry) : null;

      if (heading !== lastHeading) {
        lastHeading = heading;
        currentGroupCards = null;

        if (heading) {
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
            renderBrowse();
          });
          list.appendChild(toggle);

          if (isOpen) {
            const groupContainer = document.createElement("div");
            groupContainer.className = "group-cards";
            list.appendChild(groupContainer);
            currentGroupCards = groupContainer;
          }
        }
      }

      // Collapsed group (heading present but not open) -> skip rendering this entry's card.
      if (heading && !currentGroupCards) {
        return;
      }

      (currentGroupCards || list).appendChild(makeEntryCard(entry));
    });
  }

  // Global search overrides chapter/section browsing entirely: it replaces the whole
  // accordion with one flat, ungrouped list of matches from any chapter.
  function renderSearchResults(container, q) {
    const matches = ENTRIES.filter((e) => entryMatchesQuery(e, q));
    const meta = document.createElement("div");
    meta.className = "results-meta";
    meta.textContent = `${matches.length} ${matches.length === 1 ? "entry" : "entries"}`;
    container.appendChild(meta);
    renderEntryGroup(container, matches, false);
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
      state.activeEntry = null;
      state.openHeading = null;
      state.forcedClosedHeadings.clear();
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      el.detailCol.scrollTop = 0;
      jumpToTop();
    });
    container.appendChild(row);

    if (!isOpen) return;

    const body = document.createElement("div");
    body.className = "subsection-body";
    container.appendChild(body);

    if (!hasData) {
      const div = document.createElement("div");
      div.className = "empty-note";
      div.textContent = `${chapter.code}.${secKey} — ${secMeta.title} is in preparation and will be added in a later pass.`;
      body.appendChild(div);
      return;
    }

    const matches = ENTRIES.filter((e) => e.chapter === chapter.code && e.section === secKey);
    renderEntryGroup(body, matches, true);
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
      <span class="chapter__chevron">${isActive ? "▾" : "▸"}</span>
      <span class="chapter__code">${chapter.code}</span>
      <span class="chapter__title">${chapter.title}</span>
      ${chapter.status === "in-preparation" ? '<span class="tab__pill">in preparation</span>' : ""}
      ${chapter.status === "partial" ? '<span class="tab__pill tab__pill--partial">partial</span>' : ""}
    `;
    head.addEventListener("click", () => {
      // Clicking the already-open chapter collapses it back to just the top-level list.
      state.activeChapter = state.activeChapter === chapter.code ? null : chapter.code;
      state.activeEntry = null;
      state.activeSection = null;
      state.openHeading = null;
      state.forcedClosedHeadings.clear();
      state.view = "browse";
      renderBrowse();
      switchViewVisibility();
      renderDetail();
      el.detailCol.scrollTop = 0;
      jumpToTop();
    });
    wrap.appendChild(head);

    if (isActive) {
      const body = document.createElement("div");
      body.className = "chapter__body";
      wrap.appendChild(body);

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
        <p class="ref-updated">Last updated in Variations Reference Guide: ${lastUpdated("grouping", g.lastUpdated)}</p>
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

  // ==========================================================================================
  // Timetables view: day-by-day procedure timetables for Type IA/IB/II variations, reproduced
  // from the CMDh Best Practice Guide (Chapters 3-5). Self-contained -- content only depends
  // on the tt* state fields above, so it re-renders itself on every internal interaction
  // (tab/variant/compare clicks) rather than going through the main renderBrowse() flow.
  // ==========================================================================================

  // Fixed regardless of the active variation type (IA/IB/II): MAH is always red, RMS always
  // dark blue, CMS always the app's teal-green accent, so the roles read consistently across
  // every tab instead of MAH's dot changing color when you switch tabs.
  function ttLaneColorVar(lane) {
    if (lane === "rms") return "var(--tt-rms)";
    if (lane === "cms") return "var(--cms)";
    return "var(--ii)"; // mah
  }

  // Manually maintained: update whenever the timetables below are re-checked against the
  // current CMDh Best Practice Guide chapters (not the same as the guide's own revision date).
  const TT_LAST_UPDATED = "2026-07-03";
  const TT_REFERENCE = "CMDh Best Practice Guide, Chapters 3–5";

  const TT_IA = {
    key: "ia",
    variant: null,
    run1: { from: 0, to: 30 },
    lanes: {
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

  function ttBuildIB() {
    // offset shifts numeric day/from/to values onto the absolute chart axis;
    // label text always uses the *local* (0..30) day number, prefixed per phase.
    const mk = (prefix, offset) => ({
      rms: {
        ranges: [{ from: 0 + offset, to: 30 + offset, label: "Assesses the change", style: "active" }],
        points: [
          { day: 20 + offset, kind: "report", title: prefix + "20 – RMS position to CMS", desc: "Only needed for certain change categories (product name in a CMS, pack size, C.z / C.1–C.3 / C.6b–C.7 / C.11): RMS shares its position with CMS." },
          { day: 30 + offset, kind: "decision", title: prefix + "30 – Outcome", desc: offset === 0 ? "Acceptance (Notification) — or, if rejected: “Notification with Grounds”, clock-stop begins." : "Final acceptance or rejection. If the MAH does not respond to the “Notification with Grounds” in time, the variation is automatically rejected." }
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
      run1: { from: 0, to: 30 },
      clockoff: { label: "Clock-stop", detail: "max. 30 days — MAH submits an amended notification" },
      run2: { from: 30, to: 60 }, // absolute axis; displayed as "New Day 0..30"
      lanes1: mk("Day ", 0),
      lanes2: mk("New Day ", 30),
      badges: ["Clock-stop only on rejection", "No further clock-stop in phase 2"],
      intro: "Type IB is a notification with a 30-day RMS assessment window. If the RMS does not respond, the notification is deemed accepted. On rejection, the MAH receives a <b>“Notification with Grounds”</b> and the clock stops until an amended notification is submitted — after which a second, final 30-day window runs.",
      implementation: "National implementation by the competent authorities within 6 months."
    };
  }

  function ttBuildII(variant, d) {
    const breakoutPoint = d.breakout ? [{ day: d.breakout, kind: "meeting", title: "Day " + d.breakout + " – possible break-out meeting", desc: "In case of disagreement between RMS and CMS, a break-out meeting may be arranged (optional)." }] : [];
    return {
      key: "ii",
      variant: variant,
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
            { day: d.pvar, kind: "report", title: "Day " + d.pvar + " – RMS circulates PVAR", desc: "Preliminary Variation Assessment Report to CMS and, for information, to the MAH." },
            { day: d.rsi, kind: "stop", title: "Day " + d.rsi + " – RSI, clock-stop", desc: "If not endorsed: Request for Supplementary Information to the MAH (copy to CMS). The clock stops for up to " + (d.mahDays + d.rmsDays) + " days in total — up to " + d.mahDays + " days for the MAH to respond, then up to " + d.rmsDays + " days for the RMS (authorities) to prepare the FVAR." }
          ]
        },
        cms: {
          ranges: [{ from: 0, to: d.cms1, label: "Assesses the PVAR", style: "waiting" }],
          points: [{ day: d.cms1, kind: "comment", title: "Day " + d.cms1 + " – CMS comments on PVAR", desc: "No comment by this date is treated as endorsement of the PVAR." }]
        },
        mah: { ranges: [], points: [{ day: 0, kind: "submission", title: "Day 0 – Submission", desc: "MAH submits simultaneously to RMS and CMS (" + variant + "-day procedure)." }] }
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
      },
      badges: variant === "30" ? ["Recommended for safety / urgent cases"] : variant === "90" ? ["For indication changes & complex groupings"] : ["Standard procedure"],
      intro: variant === "30"
        ? "The <b>reduced 30-day procedure</b> is intended for safety-related or otherwise urgent changes. RMS proposes it proactively; CMS may object."
        : variant === "60"
        ? "The <b>60-day procedure</b> is the default timetable for Type II variations, including most indication changes."
        : "The <b>90-day procedure</b> applies to changes to, or addition of, the therapeutic indication requiring a more comprehensive assessment, as well as complex groupings under Art. 7(2)(c).",
      implementation: "National implementation by the competent authorities within 2 months of the end of the procedure."
    };
  }

  // mahDays/rmsDays split the clock-off budget: mahDays is the deadline for the MAH's
  // response to the RSI, rmsDays is the RMS's subsequent time to prepare the FVAR.
  const TT_II_DAYS = {
    "30": { pvar: 15, cms1: 20, rsi: 21, mahDays: 10, rmsDays: 10, fvar: 22, breakout: null, cms2: 25, outcome: 30 },
    "60": { pvar: 40, cms1: 55, rsi: 59, mahDays: 60, rmsDays: 60, fvar: 60, breakout: 75, cms2: 80, outcome: 90 },
    "90": { pvar: 70, cms1: 85, rsi: 89, mahDays: 90, rmsDays: 60, fvar: 90, breakout: 105, cms2: 110, outcome: 120 }
  };

  function ttCurrentData() {
    if (state.ttType === "ia") return TT_IA;
    if (state.ttType === "ib") return ttBuildIB();
    return ttBuildII(state.ttIIVariant, TT_II_DAYS[state.ttIIVariant]);
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
    if (data.key === "ia") {
      collect(data.lanes, 1);
    } else {
      collect(data.lanes1, 1);
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

  function ttGrowFor(from, to) { return Math.max(to - from, 1); }

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
        <p>Click any milestone to highlight it below. “Clock-off” periods do not count towards the deadline under the guide and are shown as a separate, non-scaled section.</p>
        <p class="ref-line">Reference: ${referenceText("timetables", TT_REFERENCE)}</p>
        <p class="ref-updated">Last updated in Variations Reference Guide: ${lastUpdated("timetables", TT_LAST_UPDATED)}</p>
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
          <div class="tt-ruler" data-tt-ruler></div>
          <div class="tt-lanes" data-tt-lanes></div>
        </div>
        <div class="tt-legend">
          <div class="tt-item"><span class="tt-swatch" style="background:var(--tt-rms)"></span>RMS action</div>
          <div class="tt-item"><span class="tt-swatch" style="background:var(--cms)"></span>CMS action</div>
          <div class="tt-item"><span class="tt-swatch" style="background:var(--ii)"></span>MAH action</div>
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

    root.querySelector("[data-tt-svg]").addEventListener("click", () => ttExportSVG(data));

    if (state.ttCompare && state.ttType === "ii") {
      ttRenderCompare(root.querySelector("[data-tt-compare-body]"));
    } else {
      ttRenderStage(root, data);
      ttRenderMilestoneList(root, data);
    }
  }

  function ttBuildRunSegment(laneData, run, lane, phase, grow, numberMap) {
    const seg = document.createElement("div");
    seg.className = "tt-track-run";
    seg.style.flex = grow + " " + grow + " 0%";
    seg.dataset.from = run.from;
    seg.dataset.to = run.to;
    seg.dataset.phase = phase;

    (laneData.ranges || []).forEach((r) => {
      const pctFrom = ((r.from - run.from) / (run.to - run.from)) * 100;
      const pctTo = ((r.to - run.from) / (run.to - run.from)) * 100;
      const bar = document.createElement("div");
      bar.className = "tt-range-bar " + (r.style === "active" ? "tt-active" : "tt-waiting");
      bar.style.left = pctFrom + "%";
      bar.style.width = Math.max(pctTo - pctFrom, 1.5) + "%";
      bar.style.background = r.style === "active" ? ttLaneColorVar(lane) : "transparent";
      bar.style.color = ttLaneColorVar(lane);
      seg.appendChild(bar);

      // Sibling of the bar, not a child -- see the .tt-range-label CSS comment for why.
      const label = document.createElement("span");
      label.className = "tt-range-label";
      label.style.left = pctFrom + "%";
      label.textContent = r.label;
      seg.appendChild(label);
    });

    (laneData.points || []).forEach((p) => {
      const pct = ((p.day - run.from) / (run.to - run.from)) * 100;
      const key = ttMilestoneKey({ lane, phase, day: p.day });
      const dot = document.createElement("div");
      dot.className = "tt-point" + (p.kind === "stop" ? " tt-stopkind" : "");
      dot.style.left = Math.min(Math.max(pct, 0), 100) + "%";
      dot.style.background = ttLaneColorVar(lane);
      dot.dataset.key = key;
      dot.textContent = numberMap.get(key) || "";
      dot.title = p.title + "\n\n" + p.desc;
      dot.addEventListener("click", () => ttHighlightMilestone(key));
      seg.appendChild(dot);
    });

    return seg;
  }

  function ttRenderStage(root, data) {
    const lanesEl = root.querySelector("[data-tt-lanes]");
    const rulerEl = root.querySelector("[data-tt-ruler]");
    lanesEl.innerHTML = "";
    rulerEl.innerHTML = "";

    const hasTwoPhases = data.key !== "ia";
    const g1 = ttGrowFor(data.run1.from, data.run1.to);
    const g2 = hasTwoPhases ? ttGrowFor(data.run2.from, data.run2.to) : 0;
    const clockoffGrow = hasTwoPhases ? Math.max(Math.round((g1 + g2) * 0.16), 6) : 0;
    const numberMap = new Map();
    ttFlatMilestones(data).forEach((m, i) => numberMap.set(ttMilestoneKey(m), i + 1));

    ["rms", "cms", "mah"].forEach((lane) => {
      const row = document.createElement("div");
      row.className = "tt-lane-row";
      const label = document.createElement("div");
      label.className = "tt-lane-label";
      label.textContent = lane === "rms" ? "RMS" : lane === "cms" ? "CMS" : "MAH";
      row.appendChild(label);

      const track = document.createElement("div");
      track.className = "tt-lane-track";

      const seg1 = ttBuildRunSegment(data.key !== "ia" ? data.lanes1[lane] : data.lanes[lane], data.run1, lane, 1, g1, numberMap);
      track.appendChild(seg1);

      if (hasTwoPhases) {
        const co = document.createElement("div");
        co.className = "tt-track-clockoff";
        co.style.flex = "0 0 " + clockoffGrow + "%";
        const wrap = document.createElement("div");
        wrap.className = "tt-clockoff-lane";
        if (lane === "rms") {
          const fill = document.createElement("div");
          fill.className = "tt-clockoff-fill";
          wrap.appendChild(fill);
          const txt = document.createElement("div");
          txt.className = "tt-clockoff-text";
          txt.textContent = data.clockoff.label;
          wrap.appendChild(txt);
        }
        if (lane === "mah" && data.clockoff.mahAction) {
          const key = ttMilestoneKey({ lane: "mah", phase: 1.5, day: null });
          const dot = document.createElement("div");
          dot.className = "tt-point";
          dot.style.left = (data.clockoff.mahAction.fraction * 100) + "%";
          dot.style.background = ttLaneColorVar("mah");
          dot.dataset.key = key;
          dot.textContent = numberMap.get(key) || "";
          dot.title = data.clockoff.mahAction.title + "\n\n" + data.clockoff.mahAction.desc;
          dot.addEventListener("click", () => ttHighlightMilestone(key));
          wrap.appendChild(dot);
        }
        co.appendChild(wrap);
        track.appendChild(co);

        const seg2 = ttBuildRunSegment(data.lanes2[lane], data.run2, lane, 2, g2, numberMap);
        track.appendChild(seg2);
      }

      row.appendChild(track);
      lanesEl.appendChild(row);
    });

    ttBuildRuler(root, data);
  }

  function ttBuildRuler(root, data) {
    const rulerEl = root.querySelector("[data-tt-ruler]");
    const laneRows = root.querySelectorAll(".tt-lane-row");
    if (!laneRows.length) return;
    const refTrack = laneRows[0].querySelector(".tt-lane-track");
    const trackRect = refTrack.getBoundingClientRect();

    rulerEl.innerHTML = "";
    const segs = Array.from(refTrack.children);
    segs.forEach((segEl) => {
      if (segEl.classList.contains("tt-track-run")) {
        const from = Number(segEl.dataset.from), to = Number(segEl.dataset.to);
        const phase = Number(segEl.dataset.phase);
        const r = segEl.getBoundingClientRect();
        // Rounded to whole pixels -- getBoundingClientRect() returns sub-pixel floats, and
        // positioning text at a fractional "left" makes the browser anti-alias it across two
        // pixel rows, reading as a blurry "Day 0" (most visible on the very first tick).
        const leftPx = Math.round(r.left - trackRect.left);
        const widthPx = Math.round(r.width);
        [from, to].forEach((day) => addTick(day, leftPx + (day === from ? 0 : widthPx), phase));
      }
    });

    function addTick(day, leftPx, phase) {
      const key = day + ":" + phase;
      if (rulerEl.querySelector('[data-key="' + key + '"]')) return;
      const t = document.createElement("div");
      t.className = "tt-tick";
      t.dataset.key = key;
      t.style.left = leftPx + "px";
      if (data.key === "ib" && phase === 2) {
        t.textContent = "New Day " + (day - data.run1.to);
      } else {
        t.textContent = "Day " + day;
      }
      rulerEl.appendChild(t);
    }

    // The first/last tick sit exactly at the ruler's own edges; centered on that point (the
    // default), half the label text would overflow past .tt-stage's clipping edge (see the
    // .tt-stage overflow:hidden comment) and get cut off -- e.g. "New Day 30" reading as just
    // "New Day". Nudge any tick whose rendered box overflows back into view.
    const rulerRect = rulerEl.getBoundingClientRect();
    Array.from(rulerEl.children).forEach((t) => {
      const r = t.getBoundingClientRect();
      const rightOverflow = Math.round(r.right - rulerRect.right);
      const leftOverflow = Math.round(rulerRect.left - r.left);
      if (rightOverflow > 0) t.style.transform = "translateX(calc(-50% - " + rightOverflow + "px))";
      else if (leftOverflow > 0) t.style.transform = "translateX(calc(-50% + " + leftOverflow + "px))";
    });
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

  // Real clock-off duration can't be shown on a linear day axis: the guide's own day-numbering
  // excludes it (day 21 is immediately followed by day 22, whether the clock was off for 20
  // days or 150), so on a true day scale it would always render as the same ~1-day sliver
  // regardless of variant. Instead: the "counted" evaluation days (before RSI, after FVAR)
  // share one linear day-per-pixel scale across all three rows, and the clock-off box gets its
  // own, separately-scaled width -- proportional to the *other* variants' clock-off length --
  // so a wider box really does mean "runs longer", which is the comparison being asked for.
  function ttRenderCompare(container) {
    const variants = ["30", "60", "90"];
    const maxCountedDay = 120; // 90-day's outcome -- shared scale for the day-axis portions
    const maxClockoffDays = Math.max(...variants.map((v) => TT_II_DAYS[v].mahDays + TT_II_DAYS[v].rmsDays)); // 150
    const clockoffBudgetFraction = 0.22; // share of track width reserved for the clock-off scale

    container.innerHTML = '<div style="font-family:\'IBM Plex Serif\',serif; font-weight:600; font-size:15px; margin-bottom:16px;">Type II — Timetable comparison</div><div style="font-size:12px; color:var(--muted); margin:-10px 0 18px;">Evaluation days share one scale across all three; the clock-off box is drawn to its own scale (wider = longer), since it isn\'t counted in the day numbering.</div>';

    const rows = variants.map((v) => {
      const d = TT_II_DAYS[v];
      const row = document.createElement("div");
      row.className = "tt-compare-row";
      const label = document.createElement("div");
      label.className = "tt-compare-label";
      label.innerHTML = v + "-day<small>Outcome: Day " + d.outcome + "</small>";
      row.appendChild(label);
      const track = document.createElement("div");
      track.className = "tt-compare-track";
      row.appendChild(track);
      container.appendChild(row);
      return { d, track };
    });

    const trackWidth = rows[0].track.getBoundingClientRect().width;
    const clockoffBudgetPx = trackWidth * clockoffBudgetFraction;
    const dayPx = (trackWidth - clockoffBudgetPx) / maxCountedDay;

    rows.forEach(({ d, track }) => {
      const clockoffDays = d.mahDays + d.rmsDays;
      const clockoffPx = Math.max((clockoffDays / maxClockoffDays) * clockoffBudgetPx, 14);
      const run1Px = d.rsi * dayPx;
      const run2Px = (d.outcome - d.fvar) * dayPx;

      const bar1 = document.createElement("div");
      bar1.className = "tt-compare-bar";
      bar1.style.left = "0px";
      bar1.style.width = run1Px + "px";
      bar1.style.background = "var(--ii)";
      bar1.style.opacity = "0.85";
      track.appendChild(bar1);

      const off = document.createElement("div");
      off.className = "tt-compare-clockoff";
      off.style.left = run1Px + "px";
      off.style.width = clockoffPx + "px";
      const offLabel = document.createElement("span");
      offLabel.textContent = "≤" + clockoffDays + "d";
      off.appendChild(offLabel);
      track.appendChild(off);

      const bar2 = document.createElement("div");
      bar2.className = "tt-compare-bar";
      bar2.style.left = (run1Px + clockoffPx) + "px";
      bar2.style.width = run2Px + "px";
      bar2.style.background = "var(--ii)";
      bar2.style.opacity = "0.85";
      track.appendChild(bar2);

      const points = [
        { x: 0, label: "0" },
        { x: d.pvar * dayPx, label: "PVAR " + d.pvar },
        { x: run1Px, label: "RSI " + d.rsi },
        { x: run1Px + clockoffPx, label: "FVAR " + d.fvar },
        { x: run1Px + clockoffPx + run2Px, label: "End " + d.outcome }
      ];
      const labelEls = [];
      points.forEach((pt) => {
        const dot = document.createElement("div");
        dot.className = "tt-compare-point";
        dot.style.left = pt.x + "px";
        dot.style.background = "var(--ii)";
        track.appendChild(dot);
        const dl = document.createElement("div");
        dl.className = "tt-compare-daylabel";
        dl.style.left = pt.x + "px";
        dl.textContent = pt.label;
        track.appendChild(dl);
        labelEls.push(dl);
      });
      ttLayoutRowLabels(labelEls);
    });
  }

  // Greedily assigns each label the lowest row (0, 1, 2, ...) in which it doesn't horizontally
  // overlap a label already placed in that row -- more robust than a fixed alternating pattern,
  // since which points actually collide depends on the (variant-specific) day numbers.
  function ttLayoutRowLabels(labelEls) {
    const placed = [];
    labelEls.forEach((lbl) => {
      const rect = lbl.getBoundingClientRect();
      let row = 0;
      while (placed.some((p) => p.row === row && rect.left < p.right + 4 && rect.right > p.left - 4)) row++;
      lbl.style.marginTop = (4 + row * 13) + "px"; // 4px matches the base gap the CSS rule would give row 0
      placed.push({ left: rect.left, right: rect.right, row });
    });
  }

  function ttExportSVG(data) {
    const W = 980, laneH = 74, rulerH = 34, padTop = 30, padBottom = 30, labelW = 54, padX = 24;
    const laneOrder = ["rms", "cms", "mah"];
    const H = padTop + rulerH + laneH * 3 + padBottom + 60;
    const trackW = W - labelW - padX * 2;

    const hasTwo = data.key !== "ia";
    const g1 = ttGrowFor(data.run1.from, data.run1.to);
    const g2 = hasTwo ? ttGrowFor(data.run2.from, data.run2.to) : 0;
    const clockoffFrac = hasTwo ? Math.max((g1 + g2) * 0.16, (g1 + g2) * 0.06 + 20) : 0;
    const totalUnits = g1 + g2 + clockoffFrac;
    const run1W = trackW * (g1 / totalUnits);
    const clockW = hasTwo ? trackW * (clockoffFrac / totalUnits) : 0;
    const run2W = hasTwo ? trackW * (g2 / totalUnits) : 0;
    const run1X = labelW + padX;
    const clockX = run1X + run1W;
    const run2X = clockX + clockW;

    function laneColor(lane) {
      if (lane === "rms") return "#2C4A73";
      if (lane === "cms") return "#1F5F5B";
      return "#B23A2E"; // mah -- fixed red regardless of the active variation type
    }

    let s = "";
    s += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial, Helvetica, sans-serif">';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';

    const title = (data.key === "ia" ? "Type IA" : data.key === "ib" ? "Type IB" : "Type II — " + data.variant + "-day procedure");
    s += '<text x="' + padX + '" y="20" font-size="15" font-weight="700" fill="#1A2332">' + title + ' — CMDh Best Practice Guide (MRP)</text>';

    function xForDay(day, run) {
      if (run === 1) return run1X + ((day - data.run1.from) / (data.run1.to - data.run1.from)) * run1W;
      return run2X + ((day - data.run2.from) / (data.run2.to - data.run2.from)) * run2W;
    }
    const tickDays1 = [data.run1.from, data.run1.to];
    tickDays1.forEach((day) => {
      const x = xForDay(day, 1);
      s += '<line x1="' + x + '" y1="' + (padTop + rulerH) + '" x2="' + x + '" y2="' + (padTop + rulerH + laneH * 3) + '" stroke="#E2E5EA"/>';
      s += '<text x="' + x + '" y="' + (padTop + rulerH - 6) + '" font-size="9.5" fill="#4A5568" text-anchor="middle" font-family="Consolas, monospace">Day ' + day + '</text>';
    });
    if (hasTwo) {
      const tickDays2 = [data.run2.from, data.run2.to];
      tickDays2.forEach((day) => {
        const x = xForDay(day, 2);
        s += '<line x1="' + x + '" y1="' + (padTop + rulerH) + '" x2="' + x + '" y2="' + (padTop + rulerH + laneH * 3) + '" stroke="#E2E5EA"/>';
        const lbl = (data.key === "ib" ? "New Day " + (day - data.run1.to) : "Day " + day);
        s += '<text x="' + x + '" y="' + (padTop + rulerH - 6) + '" font-size="9.5" fill="#4A5568" text-anchor="middle" font-family="Consolas, monospace">' + lbl + '</text>';
      });
      s += '<rect x="' + clockX + '" y="' + (padTop + rulerH) + '" width="' + clockW + '" height="' + (laneH * 3) + '" fill="#F3F1EC" stroke="#C7CDD6" stroke-dasharray="4 3"/>';
      s += '<text x="' + (clockX + clockW / 2) + '" y="' + (padTop + rulerH + laneH * 1.5) + '" font-size="10" fill="#4A5568" text-anchor="middle" font-family="Consolas, monospace">' + data.clockoff.label + '</text>';
      const words = data.clockoff.detail.match(/.{1,26}(\s|$)/g) || [data.clockoff.detail];
      words.forEach((w, i) => {
        s += '<text x="' + (clockX + clockW / 2) + '" y="' + (padTop + rulerH + laneH * 1.5 + 14 + i * 11) + '" font-size="8.5" fill="#4A5568" text-anchor="middle" font-family="Consolas, monospace">' + w.trim() + '</text>';
      });
    }

    laneOrder.forEach((lane, li) => {
      const y = padTop + rulerH + li * laneH;
      s += '<line x1="' + padX + '" y1="' + y + '" x2="' + (W - padX) + '" y2="' + y + '" stroke="#E2E5EA"/>';
      const laneName = lane === "rms" ? "RMS" : lane === "cms" ? "CMS" : "MAH";
      s += '<text x="' + padX + '" y="' + (y + laneH / 2 + 4) + '" font-size="12" font-weight="700" fill="#4A5568">' + laneName + '</text>';

      const emitLane = (laneData, run, runX, runW, phaseOffset) => {
        (laneData.ranges || []).forEach((r) => {
          const rx = runX + ((r.from - run.from) / (run.to - run.from)) * runW;
          const rw = Math.max(((r.to - r.from) / (run.to - run.from)) * runW, 6);
          if (r.style === "active") {
            s += '<rect x="' + rx + '" y="' + (y + laneH / 2 - 8) + '" width="' + rw + '" height="16" rx="8" fill="' + laneColor(lane) + '" opacity="0.85"/>';
          } else {
            s += '<rect x="' + rx + '" y="' + (y + laneH / 2 - 4) + '" width="' + rw + '" height="8" rx="4" fill="none" stroke="' + laneColor(lane) + '" stroke-dasharray="2 3" opacity="0.6"/>';
          }
          s += '<text x="' + rx + '" y="' + (y + laneH / 2 + 22) + '" font-size="8.5" fill="#4A5568">' + r.label + '</text>';
        });
        (laneData.points || []).forEach((p) => {
          const px = runX + ((p.day - run.from) / (run.to - run.from)) * runW;
          const py = y + laneH / 2;
          s += '<circle cx="' + px + '" cy="' + py + '" r="7" fill="' + laneColor(lane) + '" stroke="#FFFFFF" stroke-width="2"/>';
          const dayLbl = (phaseOffset === 2 && data.key === "ib") ? "New " + (p.day - data.run1.to) : "D" + p.day;
          s += '<text x="' + px + '" y="' + (py - 12) + '" font-size="8" fill="#1A2332" text-anchor="middle" font-family="Consolas, monospace">' + dayLbl + '</text>';
        });
      };

      if (data.key === "ia") {
        emitLane(data.lanes[lane], data.run1, run1X, run1W, 1);
      } else {
        emitLane(data.lanes1[lane], data.run1, run1X, run1W, 1);
        emitLane(data.lanes2[lane], data.run2, run2X, run2W, 2);
      }

      if (lane === "mah" && hasTwo && data.clockoff.mahAction) {
        const px = clockX + data.clockoff.mahAction.fraction * clockW;
        const py = y + laneH / 2;
        s += '<circle cx="' + px + '" cy="' + py + '" r="7" fill="' + laneColor("mah") + '" stroke="#FFFFFF" stroke-width="2"/>';
        s += '<text x="' + px + '" y="' + (py - 21) + '" font-size="8" fill="#1A2332" text-anchor="middle" font-family="Consolas, monospace">Response</text>';
        s += '<text x="' + px + '" y="' + (py - 12) + '" font-size="8" fill="#1A2332" text-anchor="middle" font-family="Consolas, monospace">to RSI</text>';
      }
    });

    const fy = padTop + rulerH + laneH * 3 + 26;
    s += '<text x="' + padX + '" y="' + fy + '" font-size="8.5" fill="#8A93A3">Source: HMA/CMDh Best Practice Guide on Variations, Chapters 3–5 (hma.eu). Own rendering, not legally binding.</text>';

    s += '</svg>';

    const blob = new Blob([s], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = data.key === "ii" ? "timetable_type-ii_" + data.variant + "d.svg" : "timetable_type-" + data.key + ".svg";
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Rebuilds the entire browse column: pinned Summary card, then the Classification card
  // (which expands into the chapter/section/subsection accordion, or the flat global search
  // results, while open), then the Grouping and Timetables cards. Only Classification ever
  // expands inline -- clicking Summary/Grouping/Timetables collapses it back down.
  function renderBrowse() {
    el.browseTree.innerHTML = "";

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
    classifyBtn.className = "tab" + (state.view === "browse" ? " tab--active" : "");
    classifyBtn.style.setProperty("--accent", "var(--classify)");
    classifyBtn.style.setProperty("--tint", "var(--classify-tint)");
    classifyBtn.style.setProperty("--tab-bg", "var(--classify-bg)");
    classifyBtn.innerHTML = `
      <span class="tab__code">Classification of Variations</span>
      <span class="tab__title">Browse by chapter E · Q · C · M</span>
    `;
    classifyBtn.addEventListener("click", () => {
      state.classifyOpen = !state.classifyOpen;
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
      if (q) {
        renderSearchResults(branch, q);
      } else {
        Object.values(CHAPTERS).forEach((chapter) => renderChapterBranch(branch, chapter));
      }
    }

    const groupingBtn = document.createElement("button");
    groupingBtn.type = "button";
    groupingBtn.className = "tab" + (state.view === "grouping" ? " tab--active" : "");
    groupingBtn.style.setProperty("--accent", "var(--group)");
    groupingBtn.style.setProperty("--tint", "var(--group-tint)");
    groupingBtn.style.setProperty("--tab-bg", "var(--group-bg)");
    groupingBtn.innerHTML = `
      <span class="tab__code">${GROUPING_GUIDANCE.title}</span>
      <span class="tab__title">${GROUPING_GUIDANCE.subtitle}</span>
    `;
    groupingBtn.addEventListener("click", () => {
      state.view = "grouping";
      state.classifyOpen = false;
      renderBrowse();
      switchViewVisibility();
      jumpToTop();
    });
    el.browseTree.appendChild(groupingBtn);

    const timetablesBtn = document.createElement("button");
    timetablesBtn.type = "button";
    timetablesBtn.className = "tab" + (state.view === "timetables" ? " tab--active" : "");
    timetablesBtn.style.setProperty("--accent", "var(--slate)");
    timetablesBtn.style.setProperty("--tint", "var(--slate-tint)");
    timetablesBtn.style.setProperty("--tab-bg", "var(--slate-bg)");
    timetablesBtn.innerHTML = `
      <span class="tab__code">Timetables for Variations</span>
      <span class="tab__title">Day-by-day procedure timetables (IA / IB / II)</span>
    `;
    timetablesBtn.addEventListener("click", () => {
      state.view = "timetables";
      state.classifyOpen = false;
      renderBrowse();
      switchViewVisibility();
      // Re-render only after switchViewVisibility() has removed .timetables-col's "hidden"
      // class: ttBuildRuler() positions the day-axis ticks via getBoundingClientRect(), which
      // returns all-zero rects for anything still display:none. The initial renderTimetables()
      // call at page load runs while this column is hidden (the app opens on Summary), so
      // every tick was frozen at left:0 -- looking like two overlapping, "blurry" labels --
      // until re-measured here on first actually becoming visible.
      renderTimetables();
      jumpToTop();
    });
    el.browseTree.appendChild(timetablesBtn);
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
    const calculatorUrl = window.VCL_CONFIG && window.VCL_CONFIG.calculatorUrl;
    if (!calculatorUrl) {
      window.alert(
        "The Fee Calculator link isn't configured for this page -- add calculator_url to the [variation_classification_lookup] shortcode."
      );
      return;
    }
    const totals = totalsByBucket();
    const url = new URL(calculatorUrl, window.location.href);
    url.searchParams.set("ia", totals.IA);
    url.searchParams.set("ib", totals.IB);
    url.searchParams.set("ii", totals.II);
    window.open(url.toString(), "_blank", "noopener");
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
          spacing: { after: labelInfo.subtitle || note ? 40 : 200 },
        })
      );
      if (labelInfo.subtitle) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: labelInfo.subtitle })],
            indent: { left: 360 },
            spacing: { after: note ? 40 : 200 },
          })
        );
      }
      if (note) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "Note: ", bold: true, italics: true }), new TextRun({ text: note, italics: true })],
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

  function renderDetail() {
    const entry = ENTRIES.find((e) => e.code === state.activeEntry);
    syncUrlToState();
    if (!entry) {
      el.detail.classList.add("hidden");
      el.detailEmpty.classList.remove("hidden");
      return;
    }
    el.detail.classList.remove("hidden");
    el.detailEmpty.classList.add("hidden");

    const accent = CHAPTERS[entry.chapter].accent;
    el.detail.style.setProperty("--accent", accent);

    let variantsHtml = "";
    let lastGroup = undefined;
    entry.variants.forEach((variant) => {
      if (variant.group !== lastGroup) {
        if (variant.group) {
          variantsHtml += `<h4 class="variant-group-heading">${variant.group}</h4>`;
        }
        lastGroup = variant.group;
      }

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

      // Type IA (incl. IAIN) variants with conditions live-toggle between their listed type and
      // the "IB by default" fallback: whichever currently applies is shown at full strength, the
      // other is dimmed -- instead of only saying so in the status text below.
      const hasIbFallback = variant.type.startsWith("IA") && variant.conditions.length > 0;
      const ibFallbackBadge = hasIbFallback
        ? `<span class="badge type-ib${allMet ? " badge--dim" : ""}">IB (default)</span>`
        : "";
      const iaBadgeClass = `${typeBadgeClass(variant.type)}${hasIbFallback && !allMet ? " badge--dim" : ""}`;

      variantsHtml += `
        <div class="variant-block">
          <div class="variant-block__head">
            ${variant.label ? `<span class="variant-block__label">${variant.id && !variant.label.trim().startsWith("(") ? `(${variant.id}) ` : ""}${variant.label}</span>` : ""}
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
          ${variant.note ? `<div class="note-block note-block--variant"><strong>Note:</strong> ${variant.note}</div>` : ""}        </div>
      `;
    });

    const chapterNote = CHAPTERS[entry.chapter].generalNote;
    const sectionMeta = entry.section && SECTIONS[entry.chapter] ? SECTIONS[entry.chapter][entry.section] : null;
    const sectionNote = sectionMeta ? sectionMeta.note : null;
    const revision = revisionForCode(entry.code);

    el.detail.innerHTML = `
      <div class="detail-head">
        <span class="mono detail-head__code">${entry.code}</span>
        <h3>${entry.title}</h3>
        ${revision ? `<span class="changed-badge">↻ changed in Rev. ${revision.guidelineRef}</span>` : ""}
      </div>
      ${revision ? `<div class="change-callout"><strong>What changed:</strong> ${revision.summary} (Guideline ${revision.guidelineRef}, applicable from ${revision.date}.)</div>` : ""}
      ${chapterNote ? `<div class="note-block note-block--chapter"><strong>Chapter ${entry.chapter} — general note:</strong> ${chapterNote}</div>` : ""}
      ${sectionNote ? `<div class="note-block note-block--chapter"><strong>${entry.chapter}.${entry.section} — note:</strong> ${sectionNote}</div>` : ""}
      ${variantsHtml}
      ${entry.notes ? `<div class="note-block"><strong>Note:</strong> ${entry.notes}</div>` : ""}
      <p class="source-note">Source: Guideline ${CLASSIFICATION_META.guidelineRef}, applicable from ${CLASSIFICATION_META.applicableFrom}.</p>
    `;

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
    if (state.query) state.classifyOpen = true; // typing a query implies "show me matches"
    renderBrowse();
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

  openEntryFromUrl();
  renderBrowse();
  switchViewVisibility();
  renderDetail();
  renderSelectionBar();
  renderSummary();
  renderGrouping();
  renderTimetables();
})();
