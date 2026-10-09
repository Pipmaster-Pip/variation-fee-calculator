# EMA Post-Authorisation Procedural Advice — Guidance document

**Date:** 2026-10-09
**Status:** Approved design, ready for implementation plan

## 1. Summary

Add a fourth reference document to the Toolbox's **Guidance** branch (alongside
Grouping, Precise scope, and the CMDh Q&A): the **EMA post-authorisation
procedural advice for users of the centralised procedure**
(`EMEA-H-19984/03 Rev. 119`, 5 October 2026, 302 pages, 24 numbered chapters —
chapter 9 is absent in the source).

The document is built **exactly like the CMDh Q&A**: a machine-generated data
module, an optional-by-design enqueue, and a dedicated render function + view in
`vcl-app.js`. The one structural difference that drives the design: the EMA
source marks a **revision date per question** (`Rev. <Month Year>`) and flags
new questions (`NEW <Month Year>`) — data the CMDh Q&A never carried. We use it.

## 2. Source structure (verified against the PDF)

- Document header: `EMEA-H-19984/03 Rev. 119`, dated `5 October 2026`.
- 24 top-level chapters, numbered `1.`…`24.` (no chapter 9).
- **Variable nesting depth.** The second level is *either* a leaf question
  (e.g. `1.1` — title + `Rev.` marker + answer) *or* a sub-section group
  (e.g. `13.15 Scientific advice for safety studies` — intro prose + its own
  `Rev.` marker + child questions `13.15.1`…`13.15.25`).
- Per-question markers:
  - `Rev. <Month Year>` on revised items (e.g. `Rev. Oct 2026`, `Rev. Jul 2013`).
  - `NEW <Month Year>` on new items (e.g. `NEW Feb 2014`).
  - 3rd-level questions rarely carry their own marker (only 2 cases observed,
    e.g. `7.3.2`); the date normally sits on the 2nd-level item / sub-section.
- Markers may wrap across two lines in the extracted text (e.g. `Rev.` at the
  end of one line, `2025` on the next) — an extraction concern, not a model one.
- Answers are paragraphs plus bullet lists (`•`, with `–` sub-bullets).

## 3. Data model — `window.VCL_PAM_DATA`

Generated file `assets/js/vcl-pam-data.js` (GENERATED, DO NOT EDIT BY HAND),
mirroring the `vcl-qa-data.js` conventions.

```js
window.VCL_PAM_DATA = {
  meta: {
    docRef:   "EMEA-H-19984/03 Rev. 119",
    docDate:  "October 2026",
    docTitle: "European Medicines Agency post-authorisation procedural advice for users of the centralised procedure",
    url:      "<EMA source URL>",
    lastUpdated: "2026-10-09"
  },
  chapters: [
    { key: "13", title: "Post Authorisation Safety Study (PASS)" },
    // …24 chapters, no chapter 9
  ],
  nodes: [ /* recursive, see below */ ]
};
```

**Recursive node (Variant 1 — recursive nodes):**

```js
{
  id: "13.15",            // full dotted id
  ch: 13,                 // owning chapter key as number
  title: "Scientific advice for safety studies",
  rev: {                  // null when the item carries no marker
    type: "rev",          // "rev" | "new"
    date: "Mar 2025",     // display string, verbatim month+year
    sort: "2025-03"       // normalised YYYY-MM for sorting/filtering
  },
  a: [ { t: "p", text: "…" }, { t: "li", text: "…" } ],  // answer or sub-section intro
  children: [ /* …nodes, omitted for leaf questions */ ]
}
```

- Leaf question (`1.1`): has `a[]`, no `children`.
- Sub-section group (`13.15`): has `a[]` (the intro prose) **and** `children[]`.
- Child question (`13.15.1`): has `a[]`, `rev` usually `null`, no `children`.
- Month normalisation: `"Jul"`/`"July"` collapse to one form in `date`; `sort`
  is always `YYYY-MM`. `NEW`/`Rev.` distinguished by `rev.type`.

## 4. Display — Variant C (badge + filter/sort)

Rendered by a new `renderPAM()` into `#vcl-pamCol`, structured like `renderQA()`.

- **Per-node badge at the title**, colour-separated:
  - `Rev. <Month Year>` — subdued blue (`#E6F1FB` bg / `#0C447C` text).
  - `NEW <Month Year>` — green (`#EAF3DE` bg / `#3B6D11` text).
- **Filter/control bar** at the top:
  - Full-text filter over titles + answers (like the Q&A search).
  - Sort: "most recently changed first".
  - Filter: "recently revised only (last 12 months)".
  - Filter: "NEW only".
- **Every dated node is its own hit (option A):** chapter-level questions
  (`1.1`), sub-sections (`13.15`), and the rare dated 3rd-level questions
  (`7.3.2`) all participate in sort/filter. A matched sub-section expands to
  show its children.
- **Rendering:** nested accordion — chapter → optional sub-section (intro +
  badge) → questions. When sorting/filtering, all dated nodes are walked into a
  flat list; the tree is flattened for ranking but sub-sections still render
  their children when expanded.
- Source attribution line at the bottom (link to EMA), matching the Q&A view's
  "Reproduced for reference; the original document remains authoritative."

## 5. Extraction — `extract_pam.py`

Re-runnable Python script producing `vcl-pam-data.js`, following the
`extract_qa.py` pattern. Uses PyMuPDF (already available) for text extraction.

- Detect headings by dotted numbering (`N.`, `N.M.`, `N.M.K.`) at line start.
- Parse inline markers `Rev./NEW <Month Year>` from the heading tail, joining a
  marker that wraps onto the following line before parsing.
- Build the recursive node tree from the id depth.
- Reconstruct paragraphs and bullet lists (`•` items, `–` sub-items) from the
  PDF's leading/coordinates, as `extract_qa.py` does.
- Strip running header/footer (`Page n/302`, the EMA address block, the
  repeated document-title banner).
- Verify every emitted title and answer paragraph appears verbatim in the PDF.
- Emit the same "GENERATED FILE, DO NOT EDIT BY HAND — re-run the script against
  a new revision" banner as `vcl-qa-data.js`.

## 6. Integration points (minimal, mirroring the Q&A)

- `includes/lookup.php`: register `vcl-pam-data` (optional-by-design, versioned
  by `filemtime`) and add it to the `vcl-app` dependency array — exactly as
  `vcl-qa-data` is wired.
- `assets/js/vcl-app.js`:
  - `const PAM_DATA = window.VCL_PAM_DATA || null;`
  - `el.pamCol = document.getElementById("vcl-pamCol");`
  - new view key `"pam"` in the view-visibility toggles (`renderView`).
  - `renderPAM()` plus its event wiring (chapter/sub-section/question toggles,
    search input, sort/filter controls).
  - a Guidance-hub card and a sub-nav entry for the new document.
  - include `"pam"` in `usageToolForView`/`usageViewForView` → `"guidance"`.
- `includes/admin.php`: add `pam` keys for `lastUpdated` and `referenceText`
  (admin-editable, exactly like the `qa` keys).
- `assets/css/vcl-style.css`: badge classes (`--rev`/`--new`) and the
  sub-section nesting indentation.

## 7. Out of scope (YAGNI)

- **No classification-code chips.** The EMA PAM does not cross-reference the
  Classification Guideline in the chip-linkable way the Grouping/Precise-scope/
  Q&A views do.
- **No "deleted questions" toggle.** The EMA source marks only `NEW`/`Rev.`,
  never deletions, so there is no deleted state to model.
- **No hyperlink reconstruction.** The integrated (print) version of the source
  has already stripped the inline hyperlinks.

## 8. Open items for the plan

- Exact placement of the new card/sub-nav entry in the Guidance hub ordering.
- Final EMA source URL for `meta.url`.
- Whether the 12-month "recently revised" window is a fixed constant or derived
  from `meta.docDate`.
