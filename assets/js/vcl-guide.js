// ============================================================================
// How-to-use guide: a wizard-style modal covering all 6 Toolbox tools.
// Self-contained (no dependency on any other vcl-*.js module) so it can be
// registered/enqueued independently. vcl-app.js is the only caller, via
// window.VCL_GUIDE.open(toolId, triggerEl) -- see guideToolForView() there
// for how toolId is derived from the current view.
// ============================================================================
(function () {
  // Tool ids match OVERVIEW_DESTINATIONS' `dest` values in vcl-app.js exactly,
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
        "Live exchange rates are retrieved via the Frankfurt API (ECB reference rates), fetched once a day and cached in the browser – covering CZK, DKK, HUF, ISK, NOK, PLN, SEK, GBP and CHF.",
        "RSD (Serbia) is not published by the ECB/Frankfurt – a static rate from the Excel source file is used instead, and also serves as a fallback should the live retrieval for a currency fail.",
        "Change history, update status and link to authority websites are displayed in the boxes on the bottom of the toolbox.",
        "The current Excel spreadsheet can be downloaded via the link in the header.",
      ],
    },
    {
      id: "workflow", color: "var(--workflow)", name: "Guided Workflow",
      tagline: "Step by step from classification, through the calculation of RA hours to fees.",
      quick: [
        "<b>A – Variations</b>: please select one or more variations via classification code or directly if no classification code is required.",
        "<b>B – Procedures</b>: please select the procedure (national, MRP/DCP, CP) for which variations should be submitted. If Worksharing applies, please select the Worksharing RMS and add any further procedures. If only Type IA variations have been selected in station A, please check “Supergrouping” and select the RMS and any further procedures. If only one procedure is involved, please tick ‘Annual Update’.",
        "<b>C – RA tasks</b>: This is where the hours spent in RA on processing variations are recorded. If CMC, PI management and compilation and submission are handled within RA, please tick the relevant boxes.",
        "<b>D – Date &amp; Timeline</b>: please enter the desired submission date. You can use the slider to adjust the duration of the clock stop. In case of an Annual Update please enter the implementation date of the first variation, and then your preferred submission date (9–12 months).",
        "<b>E – Fees</b>: please select number of strengths (default for all countries). Some countries charge variation fees per strength, in this case set a different number for any that differ from the default strengths. Special cases for each country could be selected here. Export summary, classification codes and precise scopes to .docx for use in the cover letter and/or eAF.",
      ],
      further: [
        "The Guided Workflow uses exactly the same engine for calculation of variation fees as the Variation Fee Calculator with the addition that Worksharing, Annual Update and Supergrouping could be calculated here.",
        "The live preview at the bottom allows you to check your entries and timelines at any time.",
        "A previous stage can be edited without losing the work done in subsequent stages.",
        "The boxes (“How the RA hours are calculated” and “RA-hours references”) at the bottom of the page show directly on the page (no download required) how the number of RA hours was calculated.",
        "The expected RA-hours value is calculated using the PERT formula: Expected value = (Min + 4 × “mode” + Max) / 6. The “mode” lies at 1/3 of the range: mode = Min + (Max − Min) / 3. The displayed range in hours is rounded up; the expected value itself is based on the exact (not rounded) subtotals – therefore, checking the figures against the displayed limits will not yield exactly the same value.",
      ],
    },
    {
      id: "budget", color: "var(--budget)", name: "Budget Planning",
      tagline: "Plan next year's fees and RA effort across your portfolio.",
      quick: [
        "Below the header is the ‘Add a variation line’ button, which can be used to add a new entry (plan line) to the budget plan with 4 sections: A - Product (name, number of strengths, year, quarter, probability), B - Variations, C - Procedures, D - RA tasks. If you do not wish to provide the original name of your product, please feel free to use a placeholder.",
        "Probability (100% certain / 75% / 50% / 25%) estimates the likelihood of a variation being submitted. It only affects the “Expected value” figure shown when you expand a line’s detail (fee × probability) — it does not change the dashboard totals (FTE, total fee, breakdowns), which always use the full value regardless of probability.",
        "The table shows Product, Mode, Variations, Procedures, Year/Quarter and Probability, sorted by most recent quarter by default. By clicking on a plan line details will be available.",
        "The ‘FTE required’ dashboard tile converts the total RA-hours into full-time equivalents.",
        "Plan lines for annual maintenance fees are added automatically based on the plan lines in the variations table. If no variations are planned for a product, please add the product manually to calculate the corresponding annual maintenance fees.",
      ],
      further: [
        "In the breakdown by product/market in the dashboard can be switched between combined view / variations only / annual fees only.",
        "The plan is automatically saved in the browser (local storage) – no need to save it manually, but it remains linked to your device.",
        "“Export to Excel” downloads the entire plan as an .xlsx file.",
        "The “hours per head” figure can be freely edited to convert hours into FTEs for your own team size.",
      ],
    },
    {
      id: "classification", color: "var(--classify)", name: "Classification of Variations",
      tagline: "Browse the Classification Guideline by chapter E, Q, C, M, Art. 5.",
      quick: [
        "Browse the links by chapter (E, Q, C, M or Article 5), or search by code/keyword at the top.",
        "Select the relevant entry to view the conditions, required documentation and resulting procedure type.",
        "Tick off the conditions – for many Type IA variants, the variation automatically becomes Type IB if not all conditions are met.",
      ],
      further: [
        "The chapters follow the structure of the EU Variation Classification Guideline (E/Q/C/M + Article 5 recommendations) exactly.",
        "Use the search box to jump directly to a specific code or keyword (e.g. ‘shape’, ‘leaflet’).",
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
        "For Type II: Select a process variant (30 days – reduced, 60 days – standard, 90 days – for a more comprehensive assessment or complex grouping). 30/60/90 days procedures could be compared.",
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
        '<summary>⚡ Quick Start</summary>' +
        '<ul class="vcl-guide-section__body">' + tool.quick.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>" +
      "</details>" +
      '<details class="vcl-guide-section">' +
        '<summary>📖 Further Information</summary>' +
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
          '<button type="button" class="vcl-guide-close" aria-label="Close">✕</button>' +
        "</div>" +
        '<div class="vcl-guide-body">' +
          '<div class="vcl-guide-stepper"></div>' +
          '<div class="vcl-guide-content"></div>' +
        "</div>" +
        '<div class="vcl-guide-nav">' +
          '<button type="button" class="vcl-guide-prev">← Previous</button>' +
          '<button type="button" class="vcl-guide-next">Next →</button>' +
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
