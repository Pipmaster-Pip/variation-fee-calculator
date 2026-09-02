# How-to-Use Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "How to use" button to the Variation Toolbox header that opens a wizard-style modal with Quick Start / Further Information guidance for each of the 6 tools, opening directly on whichever tool the user is currently viewing.

**Architecture:** A new self-contained module (`vcl-guide.js` + `vcl-guide-style.css`) owns the 6 tools' static content and the modal's render/open/close logic, following the same "feature module rendered into a container by `vcl-app.js`" pattern already used by `vcl-workflow.js` and the Budget/Calculator modules. `vcl-app.js` gains one small mapping function (`guideToolForView()`, mirroring the existing `usageToolForView()`) that reads the same `state.view` it already tracks, plus a click handler that calls `window.VCL_GUIDE.open(id)`. No existing rendering logic is touched.

**Tech Stack:** Vanilla JS (IIFE modules, no build step), plain CSS custom properties, PHP/WordPress shortcode template (`includes/lookup.php`).

## Global Constraints

- Source of truth is `D:\Claude\Variation Fee Calculator\variation-fee-calculator\` — this plan's line numbers were read from that tree; re-check them if the files have moved.
- No automated test framework exists for the frontend JS in this codebase (vanilla JS, no bundler, no test runner) — verification steps in this plan are manual browser checks, not automated tests. This mirrors the existing codebase convention; do not introduce a test framework as part of this feature.
- New tool IDs must match the existing `dest` values in `OVERVIEW_DESTINATIONS` (`vcl-app.js:3372`) exactly: `calculator`, `workflow`, `budget`, `classification`, `guidance`, `timetables`. Do not invent new IDs.
- Tool colors must reuse the existing CSS custom properties (`--workflow`, `--budget`, `--classify`, `--group`, `--slate`) and the literal calculator hex `#8f6e2e` — do not redefine these.
- Guide content (English) is finalized in the Obsidian note `D:\Claude\The Pudel Brain\Projects\Variation-Toolbox\How-to-Guide – Inhalte.md` — copy it verbatim into `vcl-guide.js`, do not paraphrase.
- Every new/changed shipped file must be added to `FILES` in `D:\Claude\Variation Fee Calculator\build_zip.py` (Task 5) — the deploy ZIP silently omits anything not listed there.
- Follow the codebase's own per-module `el(tag, cls, html)` DOM helper pattern (see `vcl-workflow.js:505-510`) rather than importing a shared utility — this codebase duplicates that helper per file by convention.

---

### Task 1: Header button wrapper (make room for a second button)

**Files:**
- Modify: `includes/lookup.php:362-366`
- Modify: `assets/css/vcl-style.css:110-129`

**Interfaces:**
- Produces: a `.app-header__actions` wrapper `<div>` that any future header button can be added to; `#vcl-guideBtn` id for Task 4 to attach its click handler to.

Today only the "Start" button sits in the header, positioned via `position:absolute` directly on `.app-header__home`. Adding a second button needs a shared positioning wrapper first, otherwise both buttons will stack on top of each other.

- [ ] **Step 1: Wrap the Start button in a new `.app-header__actions` div and add the (still inert) How-to-use button**

In `includes/lookup.php`, replace:

```php
	<header class="app-header">
	  <button type="button" class="app-header__home" id="vcl-homeBtn" aria-label="Back to start" title="Back to start">
	    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>
	    <span>Start</span>
	  </button>
	  <h1>Variation Toolbox</h1>
```

with:

```php
	<header class="app-header">
	  <div class="app-header__actions">
	    <button type="button" class="app-header__guide" id="vcl-guideBtn" aria-label="How to use this toolbox" title="How to use this toolbox">
	      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.7-2.4 3.4"/><path d="M12 17h.01"/></svg>
	      <span>How to use</span>
	    </button>
	    <button type="button" class="app-header__home" id="vcl-homeBtn" aria-label="Back to start" title="Back to start">
	      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>
	      <span>Start</span>
	    </button>
	  </div>
	  <h1>Variation Toolbox</h1>
```

- [ ] **Step 2: Move the absolute positioning from `.app-header__home` to the new wrapper, and share the visual button style between both buttons**

In `assets/css/vcl-style.css`, replace:

```css
/* Home button: sits top-right of the masthead, returns to the welcome overview (start page). */
.vcl-app .app-header__home {
  position: absolute;
  top: 24px;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: color .12s, border-color .12s;
}
.vcl-app .app-header__home:hover { color: var(--ink); border-color: var(--ink); }
.vcl-app .app-header__home svg { flex-shrink: 0; }
```

with:

```css
/* Header action buttons ("How to use", "Start"): sit top-right of the masthead as a row. */
.vcl-app .app-header__actions {
  position: absolute;
  top: 24px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.vcl-app .app-header__home,
.vcl-app .app-header__guide {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: color .12s, border-color .12s;
}
.vcl-app .app-header__home:hover,
.vcl-app .app-header__guide:hover { color: var(--ink); border-color: var(--ink); }
.vcl-app .app-header__home svg,
.vcl-app .app-header__guide svg { flex-shrink: 0; }
```

- [ ] **Step 3: Manual verification**

Open the toolbox page in a browser (or `preview_start` against the local WP/NAS test environment). Confirm:
- Two buttons now sit top-right of the header, "How to use" on the left, "Start" on the right, same visual style, no overlap.
- Clicking "Start" still works exactly as before (returns to the welcome overview).
- Clicking "How to use" does nothing yet (no JS wired up) — expected at this stage.

- [ ] **Step 4: Commit**

```bash
git add includes/lookup.php assets/css/vcl-style.css
git commit -m "feat: add How-to-use header button alongside Start"
```

---

### Task 2: Guide content + modal module (`vcl-guide.js`)

**Files:**
- Create: `assets/js/vcl-guide.js`

**Interfaces:**
- Produces: `window.VCL_GUIDE = { open(toolId, triggerEl) }` — Task 4 calls this from `vcl-app.js`. `toolId` must be one of `'calculator' | 'workflow' | 'budget' | 'classification' | 'guidance' | 'timetables'`; an unknown or missing id falls back to the first tool. `triggerEl` (optional) is the element focus returns to on close.
- Consumes: nothing from other modules — fully self-contained (matches Global Constraints: reuses only the existing `--workflow`/`--budget`/`--classify`/`--group`/`--slate` CSS vars and the literal `#8f6e2e`, not any other module's JS).

This module owns the 6 tools' content (copied verbatim from the Obsidian note) and builds/opens/closes the modal. It renders into the `#vcl-guideModal` container that Task 4 adds to `includes/lookup.php`.

- [ ] **Step 1: Create `assets/js/vcl-guide.js`**

```js
// ============================================================================
// How-to-use guide: a wizard-style modal covering all 6 Toolbox tools.
// Self-contained (no dependency on any other vcl-*.js module) so it can be
// registered/enqueued independently. vcl-app.js is the only caller, via
// window.VCL_GUIDE.open(toolId, triggerEl) -- see guideToolForView() there
// for how toolId is derived from the current view.
// ============================================================================
(function () {
  \ Tool ids match OVERVIEW_DESTINATIONS' `dest` values in vcl-app.js exactly,
  // and the colors reuse the same CSS custom properties that module already
  // defines for those cards -- do not invent new ids or colors here.
  const TOOLS = [
    {
      id: "calculator", color: "#8f6e2e", name: "Variation Fee Calculator",
      tagline: "The classic calculator for variation fees.",
      quick: [
        "<b>1. Countries</b>: please select the countries in which the variations are to be submitted.",
        "<b>2. Country details</b>: please set procedure role (RMS / CMS / National / Centralised-EMA) and the number of authorised strengths for each country.",
        "<b>3. Variations</b>: please enter how many Type IA/IB/II variations are being filed (same for all selected countries). Country specific special cases are selected here.",
        "<b>4. Result</b>: please view results per country, including export to Excel.",
      ],
      further: [
        "Worksharing, Annual-Update and Super-Grouping are not calculated here, please use the Guided Workflow instead.",
        "It is displayed when a grouping fee or a cap fee applies.",
        "In the results, you can switch between Euro and the national currency.",
        "Live exchange rates are retrieved via the Frankfurt API (ECB reference rates), fetched once a day and cached in the browser \u2013 covering CZK, DKK, HUF, ISK, NOK, PLN, SEK, GBP and CHF.",
        "RSD (Serbia) is not published by the ECB/Frankfurt \u2013 a static rate from the Excel source file is used instead, and also serves as a fallback should the live retrieval for a currency fail.",
        "Change history, update status and link to authority websites are displayed in the boxes on the bottom of the toolbox.",
        "The current Excel spreadsheet can be downloaded via the link in the header.",
      ],
    },
    {
      id: "workflow", color: "var(--workflow)", name: "Guided Workflow",
      tagline: "Step by step from classification, through the calculation of RA hours to fees.",
      quick: [
        "<b>A \u2013 Variations</b>: please select one or more variations via classification code or directly if no classification code is required.",
        "<b>B \u2013 Procedures</b>: please select the procedure (national, MRP/DCP, CP) for which variations should be submitted. If Worksharing applies, please select the Worksharing RMS and add any further procedures. If only Type IA variations have been selected in station A, please check \u201cSupergrouping\u201d and select the RMS and any further procedures. If only one procedure is involved, please tick \u2018Annual Update\u2019.",
        "<b>C \u2013 RA tasks</b>: This is where the hours spent in RA on processing variations are recorded. If CMC, PI management and compilation and submission are handled within RA, please tick the relevant boxes.",
        "<b>D \u2013 Date &amp; Timeline</b>: please enter the desired submission date. You can use the slider to adjust the duration of the clock stop. In case of an Annual Update please enter the implementation date of the first variation, and then your preferred submission date (9\u201312 months).",
        "<b>E \u2013 Fees</b>: please select number of strengths (default for all countries). Some countries charge variation fees per strength, in this case set a different number for any that differ from the default strengths. Special cases for each country could be selected here. Export summary, classification codes and precise scopes to .docx for use in the cover letter and/or eAF.",
      ],
      further: [
        "The Guided Workflow uses exactly the same engine for calculation of variation fees as the Variation Fee Calculator with the addition that Worksharing, Annual Update and Supergrouping could be calculated here.",
        "The live preview at the bottom allows you to check your entries and timelines at any time.",
        "A previous stage can be edited without losing the work done in subsequent stages.",
        "The boxes (\u201cHow the RA hours are calculated\u201d and \u201cRA-hours references\u201d) at the bottom of the page show directly on the page (no download required) how the number of RA hours was calculated.",
        "The expected RA-hours value is calculated using the PERT formula: Expected value = (Min + 4 \u00d7 \u201cmode\u201d + Max) / 6. The \u201cmode\u201d lies at 1/3 of the range: mode = Min + (Max \u2212 Min) / 3. The displayed range in hours is rounded up; the expected value itself is based on the exact (not rounded) subtotals \u2013 therefore, checking the figures against the displayed limits will not yield exactly the same value.",
      ],
    },
    {
      id: "budget", color: "var(--budget)", name: "Budget Planning",
      tagline: "Plan next year's fees and RA effort across your portfolio.",
      quick: [
        "Below the header is the \u2018Add a variation line\u2019 button, which can be used to add a new entry (plan line) to the budget plan with 4 sections: A - Product (name, number of strengths, year, quarter, probability), B - Variations, C - Procedures, D - RA tasks. If you do not wish to provide the original name of your product, please feel free to use a placeholder.",
        "Probability (100% certain / 75% / 50% / 25%) estimates the likelihood of a variation being submitted. It only affects the \u201cExpected value\u201d figure shown when you expand a line\u2019s detail (fee \u00d7 probability) \u2014 it does not change the dashboard totals (FTE, total fee, breakdowns), which always use the full value regardless of probability.",
        "The table shows Product, Mode, Variations, Procedures, Year/Quarter and Probability, sorted by most recent quarter by default. By clicking on a plan line details will be available.",
        "The \u2018FTE required\u2019 dashboard tile converts the total RA-hours into full-time equivalents.",
        "Plan lines for annual maintenance fees are added automatically based on the plan lines in the variations table. If no variations are planned for a product, please add the product manually to calculate the corresponding annual maintenance fees.",
      ],
      further: [
        "In the breakdown by product/market in the dashboard can be switched between combined view / variations only / annual fees only.",
        "The plan is automatically saved in the browser (local storage) \u2013 no need to save it manually, but it remains linked to your device.",
        "\u201cExport to Excel\u201d downloads the entire plan as an .xlsx file.",
        "The \u201chours per head\u201d figure can be freely edited to convert hours into FTEs for your own team size.",
      ],
    },
    {
      id: "classification", color: "var(--classify)", name: "Classification of Variations",
      tagline: "Browse the Classification Guideline by chapter E, Q, C, M, Art. 5.",
      quick: [
        "Browse the links by chapter (E, Q, C, M or Article 5), or search by code/keyword at the top.",
        "Select the relevant entry to view the conditions, required documentation and resulting procedure type.",
        "Tick off the conditions \u2013 for many Type IA variants, the variation automatically becomes Type IB if not all conditions are met.",
      ],
      further: [
        "The chapters follow the structure of the EU Variation Classification Guideline (E/Q/C/M + Article 5 recommendations) exactly.",
        "Use the search box to jump directly to a specific code or keyword (e.g. \u2018shape\u2019, \u2018leaflet\u2019).",
        "Your selection remains stored in the browser until it is cleared.",
        "Selecting a variation by quantity adds it to the current summary which collects all your entries from several chapters at once.",
        "Variations added to the summary can be exported directly to the Variation Fee Calculator, Guided Workflow or Budget Planning.",
      ],
    },
    {
      id: "guidance", color: "var(--group)", name: "Guidance on Variations",
      tagline: "Procedural guidance and Q&A on variations.",
      quick: [
        "Open the relevant sub-topic: Grouping, Precise Scope or Q&A.",
        "Use in conjunction with Classification if a case is ambiguous.",
      ],
      further: [
        "Guidance and Q&amp;A documents will be updated as soon as new versions are published.",
      ],
    },
    {
      id: "timetables", color: "var(--slate)", name: "Timetables for Variations",
      tagline: "A visual representation of the timelines of variations.",
      quick: [
        "Select the procedure type using the tabs at the top (Type IA/IB/II).",
        "For Type II: Select a process variant (30 days \u2013 reduced, 60 days \u2013 standard, 90 days \u2013 for a more comprehensive assessment or complex grouping). 30/60/90 days procedures could be compared.",
        "Drag the clock-stop slider to see by how much an RSI request extends the deadline.",
        "Click on a milestone to highlight it in the list below.",
      ],
      further: [
        "Export the timeline as SVG (the file name includes the procedure type and the clock-stop duration, so that different slider positions do not overwrite one another).",
      ],
    },
  ];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var built = false;
  var container = null;
  var index = 0;
  var lastTrigger = null;

  function sectionHtml(tool) {
    return (
      '<details class="vcl-guide-section" open>' +
        '<summary>\u26a1 Quick Start</summary>' +
        '<ul class="vcl-guide-section__body">' + tool.quick.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>" +
      "</details>" +
      '<details class="vcl-guide-section">' +
        '<summary>\ud83d\udcd6 Further Information</summary>' +
        '<ul class="vcl-guide-section__body">' + tool.further.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>" +
      "</details>"
    );
  }

  function renderStepper() {
    var stepper = container.querySelector(".vcl-guide-stepper");
    stepper.innerHTML = TOOLS.map(function (t, i) {
      return '<button type="button" class="vcl-guide-dot' + (i === index ? " is-current" : "") + '" style="--tc:' + t.color + '" data-i="' + i + '" aria-label="' + t.name + '"></button>';
    }).join("") + '<span class="vcl-guide-counter">' + (index + 1) + " / " + TOOLS.length + "</span>";
    Array.prototype.forEach.call(stepper.querySelectorAll(".vcl-guide-dot"), function (d) {
      d.addEventListener("click", function () { index = Number(d.dataset.i); renderPage(); });
    });
  }

  function renderPage() {
    renderStepper();
    var tool = TOOLS[index];
    var content = container.querySelector(".vcl-guide-content");
    content.innerHTML =
      '<div class="vcl-guide-page-head">' +
        '<span class="vcl-guide-dot-lg" style="--tc:' + tool.color + '"></span>' +
        "<h3 style=\"color:" + tool.color + "\">" + tool.name + "</h3>" +
      "</div>" +
      '<p class="vcl-guide-tagline">' + tool.tagline + "</p>" +
      sectionHtml(tool);
    container.querySelector(".vcl-guide-prev").disabled = index === 0;
    container.querySelector(".vcl-guide-next").disabled = index === TOOLS.length - 1;
  }

  function close() {
    container.classList.add("hidden");
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
  }

  function build() {
    container.innerHTML =
      '<div class="vcl-guide-shell" role="dialog" aria-modal="true" aria-labelledby="vcl-guideTitle">' +
        '<div class="vcl-guide-head">' +
          '<h2 id="vcl-guideTitle">How to use the Variation Toolbox</h2>' +
          '<button type="button" class="vcl-guide-close" aria-label="Close">\u2715</button>' +
        "</div>" +
        '<div class="vcl-guide-body">' +
          '<div class="vcl-guide-stepper"></div>' +
          '<div class="vcl-guide-content"></div>' +
        "</div>" +
        '<div class="vcl-guide-nav">' +
          '<button type="button" class="vcl-guide-prev">\u2190 Previous</button>' +
          '<button type="button" class="vcl-guide-next">Next \u2192</button>' +
        "</div>" +
      "</div>";

    container.querySelector(".vcl-guide-close").addEventListener("click", close);
    container.addEventListener("click", function (e) { if (e.target === container) close(); });
    container.querySelector(".vcl-guide-prev").addEventListener("click", function () {
      if (index > 0) { index--; renderPage(); }
    });
    container.querySelector(".vcl-guide-next").addEventListener("click", function () {
      if (index < TOOLS.length - 1) { index++; renderPage(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !container.classList.contains("hidden")) close();
    });
    built = true;
  }

  function open(toolId, triggerEl) {
    container = container || document.getElementById("vcl-guideModal");
    if (!container) return; // container missing (Task 4 not wired up yet) -- fail quietly
    if (!built) build();
    var found = TOOLS.findIndex(function (t) { return t.id === toolId; });
    index = found >= 0 ? found : 0;
    lastTrigger = triggerEl || null;
    renderPage();
    container.classList.remove("hidden");
    container.querySelector(".vcl-guide-close").focus();
  }

  window.VCL_GUIDE = { open: open };
})();
```

- [ ] **Step 2: Manual verification (standalone, before wiring)**

This module does nothing until `#vcl-guideModal` exists (Task 4) and something calls `open()`. Verify only that the file has no syntax errors: load the page with the browser console open after Task 4's registration is in place (or temporarily add `<script src=".../vcl-guide.js"></script>` and run `window.VCL_GUIDE.open('workflow')` in the console) — confirm no console errors and that `window.VCL_GUIDE` is defined.

- [ ] **Step 3: Commit**

```bash
git add assets/js/vcl-guide.js
git commit -m "feat: add How-to-use guide content and modal module"
```

---

### Task 3: Guide modal styles (`vcl-guide-style.css`)

**Files:**
- Create: `assets/css/vcl-guide-style.css`

**Interfaces:**
- Consumes: the shared `--ink`, `--muted`, `--ink-faint`, `--border`, `--border-soft`, `--panel`, `--paper` custom properties already defined on `.vcl-app` (`vcl-style.css:19-32`) — do not redefine them here.
- Produces: the visual styling for every class `vcl-guide.js` renders (`#vcl-guideModal`, `.vcl-guide-shell`, `.vcl-guide-head`, `.vcl-guide-close`, `.vcl-guide-body`, `.vcl-guide-stepper`, `.vcl-guide-dot`, `.vcl-guide-counter`, `.vcl-guide-content`, `.vcl-guide-page-head`, `.vcl-guide-dot-lg`, `.vcl-guide-tagline`, `.vcl-guide-section`, `.vcl-guide-section__body`, `.vcl-guide-nav`, `.vcl-guide-prev`, `.vcl-guide-next`).

The dot-plus-colored-title pattern mirrors the existing `.guide-overview__dot`/`.guide-overview__title` styling (`vcl-workload-style.css:547-548`) so the modal reads as the same design language as the rest of the toolbox, not a bolted-on component. `position: fixed` on the overlay is safe here — the codebase deliberately avoids `transform` on `.vcl-app` for exactly this reason (see the comment at `vcl-style.css:79-81`), the same way the existing Selection bar uses `position: fixed`.

- [ ] **Step 1: Create `assets/css/vcl-guide-style.css`**

```css
/* ============================================================================
 * How-to-use guide modal. Reuses .vcl-app's own --ink/--muted/--border/--panel
 * tokens (vcl-style.css) so it reads as part of the toolbox, not a bolted-on
 * component. position:fixed is safe here for the same reason the Selection
 * bar uses it -- .vcl-app deliberately carries no transform (vcl-style.css
 * comment above .vcl-app's own position:relative rule).
 * ============================================================================ */

#vcl-guideModal.hidden { display: none; }

#vcl-guideModal {
  position: fixed;
  inset: 0;
  background: rgba(26, 35, 50, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3vh 20px;
  z-index: 1000;
}

.vcl-app .vcl-guide-shell {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 100%;
  max-width: 640px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(20, 30, 40, 0.25);
  font-family: "IBM Plex Sans", -apple-system, sans-serif;
  color: var(--ink);
}

.vcl-app .vcl-guide-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.vcl-app .vcl-guide-head h2 { margin: 0; font-size: 17px; font-weight: 600; font-family: "IBM Plex Serif", serif; }
.vcl-app .vcl-guide-close {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--paper);
  color: var(--muted);
  font-size: 15px;
  cursor: pointer;
}
.vcl-app .vcl-guide-close:hover { color: var(--ink); }

.vcl-app .vcl-guide-body { padding: 20px 22px; overflow-y: auto; }

.vcl-app .vcl-guide-stepper { display: flex; align-items: center; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.vcl-app .vcl-guide-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); border: none; padding: 0; cursor: pointer; }
.vcl-app .vcl-guide-dot.is-current { background: var(--tc, var(--accent)); width: 20px; border-radius: 5px; }
.vcl-app .vcl-guide-counter { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: var(--ink-faint); margin-left: 4px; }

.vcl-app .vcl-guide-page-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.vcl-app .vcl-guide-dot-lg { width: 10px; height: 10px; border-radius: 50%; background: var(--tc, var(--accent)); flex-shrink: 0; }
.vcl-app .vcl-guide-page-head h3 { margin: 0; font-size: 16px; font-family: "IBM Plex Serif", serif; }
.vcl-app .vcl-guide-tagline { color: var(--muted); font-size: 13px; line-height: 1.5; margin: 0 0 16px; }

.vcl-app .vcl-guide-section {
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-bottom: 8px;
  background: var(--paper);
}
.vcl-app .vcl-guide-section summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.vcl-app .vcl-guide-section summary::-webkit-details-marker { display: none; }
.vcl-app .vcl-guide-section summary::after { content: "+"; margin-left: auto; color: var(--ink-faint); font-weight: 400; }
.vcl-app .vcl-guide-section[open] summary::after { content: "\2013"; }
.vcl-app .vcl-guide-section__body { padding: 0 14px 14px 34px; margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
.vcl-app .vcl-guide-section__body li { margin-bottom: 5px; }

.vcl-app .vcl-guide-nav {
  display: flex;
  justify-content: space-between;
  padding: 14px 22px;
  border-top: 1px solid var(--border);
  flex: none;
}
.vcl-app .vcl-guide-nav button {
  font: inherit;
  font-weight: 600;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
.vcl-app .vcl-guide-nav button:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 2: Manual verification**

With the container still empty/unwired, open the browser dev tools and confirm the stylesheet loads with no CSS parse errors (Network tab, 200 response; no red warnings in the Elements > Styles panel for `#vcl-guideModal`).

- [ ] **Step 3: Commit**

```bash
git add assets/css/vcl-guide-style.css
git commit -m "feat: add How-to-use guide modal styles"
```

---

### Task 4: Wire it all together

**Files:**
- Modify: `includes/lookup.php` (asset registration/enqueue block, and the template around the Selection bar)
- Modify: `assets/js/vcl-app.js` (new `guideToolForView()` + click handler, near `usageToolForView()` and the existing `homeBtn` handler)

**Interfaces:**
- Consumes: `window.VCL_GUIDE.open(toolId, triggerEl)` from Task 2.
- Produces: nothing further downstream — this is the final integration task.

- [ ] **Step 1: Register and enqueue the two new assets**

In `includes/lookup.php`, find the `vcl-workflow-style` registration block (around line 161-169) and add the guide style registration right after it:

```php
	$guide_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-guide-style.css';
	$guide_style_ver  = file_exists( $guide_style_file ) ? filemtime( $guide_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-guide-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-guide-style.css',
		array( 'vcl-style' ),
		$guide_style_ver
	);
```

Find the `vcl-workflow` script registration block (around line 209-218) and add the guide script registration right after it. It has no dependencies (self-contained per Global Constraints):

```php
	$guide_app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-guide.js';
	$guide_app_ver  = file_exists( $guide_app_file ) ? filemtime( $guide_app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-guide',
		VFC_PLUGIN_URL . 'assets/js/vcl-guide.js',
		array(),
		$guide_app_ver,
		true
	);
```

- [ ] **Step 2: Enqueue both**

In `includes/lookup.php`, find the `wp_enqueue_style( 'vcl-workflow-style' );` / `wp_enqueue_script( 'vcl-workflow' );` lines (around line 320-329) and add next to them:

```php
	wp_enqueue_style( 'vcl-guide-style' );
```
(next to the other `wp_enqueue_style` calls)

```php
	wp_enqueue_script( 'vcl-guide' );
```
(next to the other `wp_enqueue_script` calls, and before `wp_enqueue_script( 'vcl-app' );` is not required — order doesn't matter here since `vcl-guide.js` declares no dependencies and only exposes a global that `vcl-app.js` calls lazily, on click, well after page load)

- [ ] **Step 3: Add the empty modal container to the template**

In `includes/lookup.php`, find the Selection bar block (around line 458-470) and add the guide container as its sibling, right after it closes and before the final `.vcl-app` closing `</div>` (around line 472):

```php
	  <div class="selection-bar__list hidden" id="vcl-selectionList"></div>
	</div>

	<div class="hidden" id="vcl-guideModal"></div>

	</div>
	<?php
```

(The existing `<div class="selection-bar__list hidden" id="vcl-selectionList"></div>`, its closing `</div>`, and the final `</div>` + `<?php` are already there — this step only inserts the new `<div class="hidden" id="vcl-guideModal"></div>` line between them.)

- [ ] **Step 4: Add `guideToolForView()` next to the existing `usageToolForView()`**

In `assets/js/vcl-app.js`, find `usageToolForView()` (around line 201-210) and add this new function directly after it:

```js
  // Maps state.view to the guide's tool id (see vcl-guide.js's TOOLS array) so the "How to
  // use" button opens on whichever tool the visitor is currently looking at, instead of
  // always starting at the first tool. Deliberately mirrors usageToolForView() above --
  // same state, same view buckets, different id vocabulary (OVERVIEW_DESTINATIONS' `dest`
  // values, not the usage-tracker's short names).
  function guideToolForView() {
    if (state.view === "timetables") return "timetables";
    if (state.view === "calculator") return "calculator";
    if (state.view === "workflow") return "workflow";
    if (state.view === "budget") return "budget";
    if (state.view === "grouping" || state.view === "precisescope" || state.view === "qa" || state.guidanceHub) {
      return "guidance";
    }
    return "classification";
  }
```

- [ ] **Step 5: Wire the button's click handler**

In `assets/js/vcl-app.js`, find the existing `homeBtn` wiring (around line 3646-3647):

```js
	const homeBtn = document.getElementById("vcl-homeBtn");
	if (homeBtn) homeBtn.addEventListener("click", () => goToDestination("home"));
```

Add the guide button's handler directly after it:

```js
	const guideBtn = document.getElementById("vcl-guideBtn");
	if (guideBtn) guideBtn.addEventListener("click", () => {
	  if (window.VCL_GUIDE) window.VCL_GUIDE.open(guideToolForView(), guideBtn);
	});
```

- [ ] **Step 6: Manual verification — full walkthrough**

Open the toolbox in a browser and check every one of these (this replaces automated tests, per the Global Constraints note — there is no test runner for this frontend):

1. On first load (Welcome/overview screen, nothing selected): click "How to use" → modal opens on **Classification of Variations** (the `guideToolForView()` fallback).
2. Click "Start" to return, then open **Guided Workflow** (top nav or an overview card) → click "How to use" → modal opens directly on **Guided Workflow**, not Classification.
3. Repeat for **Budget Planning**, **Variation Fee Calculator**, and **Timetables for Variations** — each must open the modal on the matching tool.
4. Open **Guidance on Variations**, then open one of its sub-pages (Grouping, Precise Scope, or Q&A) → click "How to use" → modal still opens on **Guidance on Variations** (not Classification).
5. Inside the modal: Prev/Next buttons step through all 6 tools in order; Prev is disabled on tool 1, Next is disabled on tool 6; clicking a stepper dot jumps directly to that tool.
6. Click a "Quick Start"/"Further Information" `<summary>` — it expands/collapses; Quick Start starts open, Further Information starts closed.
7. Close the modal three ways and confirm each works: the × button, clicking the dimmed backdrop, and pressing Escape.
8. After closing, keyboard focus returns to the "How to use" button (tab order isn't broken).
9. Resize the browser to a narrow (mobile) width — the modal stays within the viewport and remains scrollable, no horizontal overflow.

- [ ] **Step 7: Commit**

```bash
git add includes/lookup.php assets/js/vcl-app.js
git commit -m "feat: wire How-to-use button to open the guide on the current tool"
```

---

### Task 5: Deploy packaging

**Files:**
- Modify: `build_zip.py`

**Interfaces:**
- Produces: an updated `FILES` list so the two new shipped files are actually included the next time `python build_zip.py` is run. No code interface — this is packaging only.

Per the project's own working-instructions memory: a new shipped file that isn't added to `FILES` here is silently missing from every future deploy ZIP, even though it works perfectly in local/NAS testing (where the raw files are already on disk).

- [ ] **Step 1: Add the two new files to `FILES`**

In `build_zip.py`, find the `vcl-workflow-style.css` / `vcl-workflow.js` entries (around lines 37 and 54) and add the guide files as neighbors:

```python
    "assets/css/vcl-guide-style.css",
```
(next to `"assets/css/vcl-workflow-style.css",`)

```python
    "assets/js/vcl-guide.js",
```
(next to `"assets/js/vcl-workflow.js",`)

- [ ] **Step 2: Verify the ZIP actually contains them**

```bash
python build_zip.py
```

Then confirm both paths are listed:

```bash
python -c "import zipfile; z = zipfile.ZipFile('variation-fee-calculator.zip'); [print(n) for n in z.namelist() if 'vcl-guide' in n]"
```

Expected output: both `variation-fee-calculator/assets/css/vcl-guide-style.css` and `variation-fee-calculator/assets/js/vcl-guide.js` printed.

- [ ] **Step 3: Commit**

```bash
git add build_zip.py
git commit -m "chore: include How-to-use guide files in the deploy ZIP"
```

---

## Post-plan note (not a task)

This plan does **not** deploy anything — per this project's own convention, production is the Ionos-hosted WordPress site and deploys only happen via a manual ZIP upload the user performs themselves (see the `working-instructions` memory). After Task 5, hand the built `variation-fee-calculator.zip` back to the user for their own NAS test / Ionos upload decision — do not upload or deploy it yourself.
