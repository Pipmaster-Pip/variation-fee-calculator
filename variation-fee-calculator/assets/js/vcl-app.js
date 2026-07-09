(function () {
  "use strict";

  const { CLASSIFICATION_META, SECTIONS, CHAPTERS, ENTRIES } = window.VCL_DATA;

  const SELECTIONS_STORAGE_KEY = "variationLookupSelections";

  // Selection shape: state.selections["E.1|a"] = { qty: number, units: [unit, unit, ...] }
  // unit = { docs: { [docNum]: { checked: bool, note: string } } } -- one entry per physical
  // instance of that variant/type in the application (e.g. 3x the same code for 3 different sites).
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
          units = Array.from({ length: Math.max(0, qty) }, () => ({ docs: {} }));
        } else if (v && typeof v === "object" && Array.isArray(v.units)) {
          units = v.units.map((u) => ({ docs: (u && u.docs) || {} }));
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
  };

  const el = {
    appRoot: document.getElementById("vcl-app"),
    browseTree: document.getElementById("vcl-browseTree"),
    search: document.getElementById("vcl-searchInput"),
    detail: document.getElementById("vcl-detailPanel"),
    detailEmpty: document.getElementById("vcl-detailEmpty"),
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
    guidelineRef: document.getElementById("vcl-guidelineRef"),
    applicableFrom: document.getElementById("vcl-applicableFrom"),
  };

  if (!el.appRoot) return; // Shortcode markup not on this page -- nothing to do.

  el.guidelineRef.textContent = CLASSIFICATION_META.guidelineRef;
  el.applicableFrom.textContent = CLASSIFICATION_META.applicableFrom;

  // The browse column (search + chapter/section/subsection accordion) stays on screen in both
  // views -- only the right-hand column switches between the entry detail and the Summary.
  function switchViewVisibility() {
    const isSummary = state.view === "summary";
    el.detailCol.classList.toggle("hidden", isSummary);
    el.summaryCol.classList.toggle("hidden", !isSummary);
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

  function makeEntryCard(entry) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "result-card" + (state.activeEntry === entry.code ? " result-card--active" : "");
    card.style.setProperty("--accent", CHAPTERS[entry.chapter].accent);
    let types = [...new Set(entry.variants.map((v) => v.type))];
    if (!entry.code.endsWith(".z")) {
      types = [...new Set(types.map((t) => (t === "IB (unforeseen)" ? "IB" : t)))];
    }
    card.innerHTML = `
      <div class="result-card__head">
        <span class="mono result-card__code">${entry.code}</span>
        <div class="result-card__badges">${types.map((t) => `<span class="${typeBadgeClass(t)}">${t}</span>`).join("")}</div>
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

          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "group-toggle" + (isOpen ? " group-toggle--open" : "");
          toggle.innerHTML = `
            <span class="group-toggle__chevron">${isOpen ? "▾" : "▸"}</span>
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
    head.style.setProperty("--accent", chapter.accent);
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

  // Rebuilds the entire browse column: pinned Summary button, then either the flat global
  // search results (query active) or the chapter/section/subsection accordion (browsing).
  function renderBrowse() {
    el.browseTree.innerHTML = "";

    const totalQty = totalSelectedQty();
    const summaryBtn = document.createElement("button");
    summaryBtn.type = "button";
    summaryBtn.className = "tab tab--summary" + (state.view === "summary" ? " tab--active" : "");
    summaryBtn.style.setProperty("--accent", "#A8651A");
    summaryBtn.innerHTML = `
      <span class="tab__code">★ Summary</span>
      <span class="tab__title">Selected variations for this application</span>
      ${totalQty > 0 ? `<span class="tab__count">${totalQty} ${totalQty === 1 ? "item" : "items"}</span>` : ""}
    `;
    summaryBtn.addEventListener("click", () => {
      state.view = "summary";
      renderBrowse();
      switchViewVisibility();
      renderSummary();
      jumpToTop();
    });
    el.browseTree.appendChild(summaryBtn);

    const divider = document.createElement("div");
    divider.className = "tabs-divider";
    el.browseTree.appendChild(divider);

    const q = normalize(state.query);
    if (q) {
      renderSearchResults(el.browseTree, q);
      return;
    }

    Object.values(CHAPTERS).forEach((chapter) => renderChapterBranch(el.browseTree, chapter));
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
      while (units.length < qty) units.push({ docs: {} });
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
          spacing: { after: labelInfo.subtitle ? 40 : 200 },
        })
      );
      if (labelInfo.subtitle) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: labelInfo.subtitle })],
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

    el.detail.innerHTML = `
      <div class="detail-head">
        <span class="mono detail-head__code">${entry.code}</span>
        <h3>${entry.title}</h3>
      </div>
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
    renderBrowse();
  });

  renderBrowse();
  switchViewVisibility();
  renderDetail();
  renderSelectionBar();
  renderSummary();
})();
