# Guided Workflow — RA-Hours Transparency Box & Product Information — Design

**Date:** 2026-07-31
**Status:** Approved (design), ready for implementation plan
**Related:** [[guided-workflow]], [[super-grouping-annual-update]], `2026-07-31-sg-au-workload-factors-design.md`

## Motivation

The Guided Workflow already shows a live RA-hours figure through the same engine
(`window.VCL_WORKLOAD.raHours` / `.schedule`) as the standalone **Workload Planning**
tool. Two things the Workload tool does that the Workflow does not:

1. **Transparency** — the Workload tool's "How this estimate is built" section
   (formula, factor tables, add-on hours, Excel workbook link) explains where the
   number comes from. The Workflow only ever shows one rounded figure with no
   breakdown.
2. **Product Information (PI)** — the Workload tool adds PI hours (SmPC, Package
   leaflet, Labelling, Mock-ups; type-dependent) behind a "PI management in RA"
   gate. The shared `raHoursFor(opts)` API has **no PI parameter at all**, so the
   Workflow systematically under-reports RA hours for any change that touches the
   product information.

This design brings both into the Guided Workflow **additively** — the green
Workflow base design is unchanged, only extended. The user's driving goal is
simplification (avoid duplicate data entry across the two tools), but for now the
decision is to **keep both tools**: this change only extends the Workflow; a later
decision may retire or restructure the standalone Workload tool.

## Scope

**In scope:**
- A collapsible "How the RA hours are calculated" box in the Guided Workflow.
- A Product Information block in Station A (Identify).
- Wiring PI hours into the shared RA-hours engine so the Workflow's figure is correct.

**Out of scope (explicitly):**
- Any change to the standalone Workload Planning tool (`vcl-workload.js`) — untouched.
- Removing or merging the Workload nav tab (deferred — revisit later).
- Field-level "pop-up" factor/hours pills in the Workflow (rejected by the user as
  visually too busy; the transparency lives only in the collapsible box).
- Changing the factor VALUES — they stay single-source in `F` (`vcl-workload.js`),
  per the standing SCOPE note.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Transparency UI | Collapsible box, NOT inline pills |
| Box title | **"How the RA hours are calculated"** |
| Box position | Full-width bar directly **below** the live preview |
| Box availability | On **every** station (A–D) |
| Box expansion | Accordion, expands **downward** (no overlay, no scrim/dimming) |
| Box colour | Workload identity pink (`--workload #7A3350`, bg `--workload-bg #F5E9EE`) — deliberately distinct from the green live preview |
| PI location | Station A (Identify), **after** the variation(s) input |
| PI UI | Heading + structure like the Workload tool, buttons restyled as green `.wf-opt` chips |
| PI gate | Toggle "Product information managed in RA", **default OFF** (→ 0 RA hours) |
| PI deliverables | SmPC · Package leaflet · Labelling · Mock-ups (shown only when gate ON) |
| Everything else | Workflow base design unchanged |

## Component 1 — "How the RA hours are calculated" box

**What it does:** Renders the Workload tool's methodology content, adapted to the
Workflow's current state, in a collapsible bar under the live preview.

**Placement & DOM:** New element rendered right after the `.vcl-wf-live` block in the
Workflow's render loop, so it appears on every station (the live preview is already
always docked). Own class prefix, e.g. `.vcl-wf-meth`.

**Look (reusing existing tokens):**
- Collapsed: a full-width bar, `--workload-bg` background, `--workload` text, an
  italic "ⓘ" info badge, the title, and a chevron that rotates on open.
- Expanded: a white panel below the bar, top border in a muted workload tint.
- Colours come from the workload CSS variables already defined in
  `vcl-workload-style.css`; the box does not introduce a new palette.

**Content (case-adaptive):** mirrors the Workload tool's `buildMethodology()` output —
- Formula line (`base × procedure × substance × submission + add-ons + product information`).
- Factor tables: base hours per type, × procedure, × active substance, × submission
  type, + add-on hours, + product information hours.
- A "This case" block that resolves the tables against the current Workflow state
  (type, substance, procedure, submission mode, PI selection) down to the final
  RA-hours figure — the same number the live preview shows.
- Excel workbook download link + provenance (`F_META.lastChecked`), as in the
  Workload tool.

**Interaction:** click toggles open/closed. Pure local UI state (e.g.
`state.methodOpen`), no engine involvement. No overlay, no page dimming; the content
below simply reflows down.

**State persistence:** open/closed state is remembered across station changes within
a session (a single boolean in the Workflow's `state`), so re-opening isn't needed on
every station switch.

## Component 2 — Product Information in Station A

**What it does:** Lets the user declare whether RA prepares the product information
for this change and which documents it touches, feeding PI hours into the RA estimate.

**Placement:** In Station A (Identify), a new block **after** the variation input and
the active-substance picker. Rationale: whether a change touches SmPC/Leaflet/
Labelling is a property of the *variation itself*, known at classification time and
independent of procedure/countries — so it belongs with "what is the change", not
with "how/where is it submitted".

**UI:**
- Section heading "Product information" (`.vcl-wf-flabel`).
- Gate toggle "Product information managed in RA" — a switch control, **default OFF**.
  When off, a hint explains another department prepares PI and it adds no RA hours.
- When on, reveal the four deliverable chips (SmPC · Package leaflet · Labelling ·
  Mock-ups) as toggleable `.vcl-wf-opt` chips (green Workflow style), plus a short
  prompt ("Which documents does this change touch?").

**State (new fields on the Workflow `state`):**
- `piInRA` (boolean, default `false`) — the gate.
- `piDocs` — `{ smpc, leaflet, labelling, mockups }` booleans, default all `false`.

**Hours model:** PI hours are per selected deliverable, and per the Workload tool the
per-deliverable hours are **type-dependent** (Type IA 1 h · IB 2 h · II 4 h, from the
workbook `Faktoren` H63:J66; source-of-truth values stay in `F.productInfo`).

## Component 3 — Wiring PI into the shared engine

The shared `raHoursFor(opts)` in `vcl-workload.js` currently has no PI input. It gains
PI parameters so **both** the Workflow (via `raEffort()`) and any future caller get a
correct figure. The standalone Workload tool already computes PI its own way and is not
touched; the goal is that the shared API can *also* account for PI when asked.

- `raHoursFor` accepts PI inputs (e.g. `productInfo: { smpc, leaflet, labelling,
  mockups }` and the effective type) and adds the type-dependent per-deliverable
  hours, reading the values from `F.productInfo` (single source of truth, unchanged).
- `raEffort()` in `vcl-workflow.js` passes the new Station-A PI state through, gated by
  `piInRA` (when the gate is off, it passes no PI so hours are unaffected).
- The methodology box's "This case" block and the live preview both read the same
  computed figure, so they can never diverge.

**Consistency note:** factor VALUES are not duplicated — the box and `raEffort` read
`F`; only pure display/mapping logic is added on the Workflow side.

## Open question (flagged for confirmation)

**PI type for grouped, mixed-type variations.** When several variations are grouped
with different types, which type drives the PI per-deliverable hours (IA 1 h / IB 2 h /
II 4 h)?

- **Proposed default:** the **highest** type (`primaryType()`), consistent with how the
  Workflow already derives timeline and RA hours for a group.
- **Status:** user is still checking the domain rule. The implementation should route
  the PI type through a single helper so that, if the rule turns out to be "per
  variation" instead of "highest type", only that helper changes. Confirm before
  finalising the plan.

## Files touched (anticipated)

- `variation-fee-calculator/assets/js/vcl-workflow.js` — Station A PI block, methodology
  box render + toggle state, `raEffort()` passes PI through, new `state` fields.
- `variation-fee-calculator/assets/js/vcl-workload.js` — `raHoursFor` gains PI inputs
  (additive; standalone tool behaviour unchanged).
- `variation-fee-calculator/assets/css/vcl-workflow-style.css` — `.vcl-wf-meth*` box
  styles and the PI gate switch (reusing workload colour tokens).

No new plugin files are anticipated, so `build_zip.py`'s FILES list is unaffected;
confirm during planning.

## Success criteria

- The Workflow's RA-hours figure includes PI hours when the gate is on, and is
  unchanged when off (default).
- The "How the RA hours are calculated" box is present on every station, expands
  downward, and its "This case" total equals the live-preview figure.
- No field-level pills; the green Workflow base design is visually unchanged apart from
  the two additions.
- The standalone Workload tool is byte-for-byte unchanged.
- Factor values remain single-source in `F`.
