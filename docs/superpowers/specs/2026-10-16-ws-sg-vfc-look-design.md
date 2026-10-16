# Worksharing / Super-Grouping — VFC-look redesign

Date: 2026-10-16
Area: Fee Calculator — Worksharing / Super-Grouping flow (`vcl-ws.js`), its shared
input editor (`vcl-proc-editor.js`), styles (`vcl-ws-style.css`); plus small touches on the
classic calculator (`vcl-calc-app.js`) and the shell toggle (`vcl-app.js`).

Source of requirements: `VFC-WS-SG-Korrekturen.docx` (9 annotated screenshots, read in
session). Supersedes nothing — extends `2026-10-15-vfc-worksharing-supergrouping-design.md`.

## Goal

Bring the WS/SG wizard visually in line with the classic Variation Fee Calculator (VFC) and
reorder its stations so the flow reads procedures → strengths → variations → fees. The fee
**engine is untouched**: every station keeps writing the same canonical Submission draft
(`variations` / `procedures` / `strengths` / `specials` / `lead`), which
`VCL_SUBMISSION.computeSubmissionFees` already consumes. Budget Planning, which shares the
input editor, must not change.

## Chosen approach — Hybrid

- **Stations 1 (Procedures) + 2 (Strengths):** keep the shared `vcl-proc-editor.js`; add
  small, flag-guarded tweaks and restyle via `vcl-ws-style.css`. Budget keeps its current
  look because the new behaviour is gated behind editor flags that only the WS flow sets.
- **Station 3 (Variations):** a **new** WS-specific renderer in the VFC model (Type IA/IB/II
  count steppers + per-country Special Cases), because the shared editor's variation model
  (classification-code search) is a different UI. It writes the same draft.
- **Station 4 (Fees):** restyle the existing `renderFees` to the VFC result layout and add
  Print + Excel export.
- **Classic VFC:** three in-place fixes (button spacing, toggle-jump bug, country station).

Rejected: "all WS-own" (needless duplication of the procedures editor) and "inflate the shared
editor" (balloons it and raises Budget regression risk, especially for the different variations
model).

## Station reorder

`vcl-ws.js` `STATIONS` / `STATION_ORDER` change from `A Variations · B Procedures · C
Strengths · D Fees` to:

| # | key | label | renderer |
|---|-----|-------|----------|
| 1 | B | Procedures | `procEditor.renderProcedures` (tweaked) |
| 2 | C | Strengths | `procEditor.renderStrengths` (sensitivity made type-independent) |
| 3 | A | Variations | **new** `renderVariationsVFC` in the WS layer |
| 4 | D | Fees | `renderFees` (restyled) |

Keep the existing key letters (A/B/C/D) bound to their current `submission` sub-objects to
avoid churn in the gating code; only the **order** and **labels** change. `stationComplete`
gating is re-sequenced:

- Station 1 (Procedures): unchanged rule — at least two procedures, each resolved, plus a lead.
- Station 2 (Strengths): always reachable once Procedures is complete (unchanged).
- Station 3 (Variations): the existing "every variation carries a type" rule.
- Fees unchanged.

### Mode-derivation dependency (must verify)

`autoMode` derives `sub.mode` from the variation mix (`normalizeModeEnablement`: all-IA →
Super-Grouping, else Worksharing). With Variations now **after** Procedures, the user sets
procedures before any variation exists. `normalizeModeEnablement` already runs on every render
regardless of station, and with no variations `allVariationsAreIA` is vacuously true → mode
would default to `superGrouping` while on the Procedures station. The Procedures station's
allowed-procedure-kinds (`computeAllowedProcedureKinds`) depend on `sgActive`. **Decision:**
while no variation type is set yet, treat the mode as Worksharing (the least-restrictive
procedure rules) so the user is never blocked from a procedure combination they will legitimately
have once the all-IA case resolves at Station 3. Implementation: guard the all-IA branch in
`normalizeModeEnablement` so it only forces `superGrouping` when at least one variation type is
actually present. Re-run the Procedures gating + SG procedure-kind tests after this change.

## Station 1 — Procedures

Screenshots: current = image1, target = image2.

1. **Heading:** "Worksharing / Super-Grouping Procedures" (the auto-mode heading already names
   the derived mode; broaden it to the slash form so it reads the same before a mode is derived).
2. **Lead field first:** move the "Worksharing/Super-Grouping RMS (lead)" select to the **top**
   of the station, above Procedure 1. Today the lead is rendered after the base procedure
   (`renderProcedures` step 3). A new flag `leadFirst` (WS only) reorders it.
3. **Procedure 1 as a boxed card:** today the first procedure renders inline
   (`procedureBody(host, sub.procedures[0])`) and only additional procedures use the boxed
   `renderProcedureRow`. Under a flag `boxFirstProcedure` (WS only), render procedure 0 with the
   same boxed card (titled "Procedure 1", no remove button on the first). Budget keeps the inline
   first procedure.
4. **Add procedure → light-blue box:** the boxed procedure cards (including the "+ Add
   procedure" affordance's resulting card) are styled light blue in `vcl-ws-style.css`. Button
   label and behaviour unchanged.
5. **CMS "Select all ⇄ Reset" toggle:** in `cmsChips`, after the CMS grid, add one button that
   selects every eligible CMS (all `countriesByRole("CMS")` except the RMS), and once all are
   selected flips to "Reset" (clears `p.cms`). Added behind a flag `cmsSelectAll` (WS only) so
   Budget's CMS grid is unchanged. Toggle label derives from whether every eligible CMS is
   currently on.

## Station 2 — Strengths

Screenshot: image3.

1. **Brown box:** restyle `.vclws-strbox` to the VFC light-brown fill (same family the classic
   calculator's "Country details" box uses). CSS only in `vcl-ws-style.css`.
2. **Type-independent sensitivity:** `strengthsSensitiveCountries` currently returns `[]` when no
   variation types are set (it probes `fee(2)` vs `fee(1)` with the current `feeCounts`). Because
   Strengths now precedes Variations, probe with a **representative type** (fall back to a Type II
   tally when the real tally is empty) so a country that charges per strength for any type still
   shows its own stepper. This keeps the "only sensitive countries get a stepper, the rest fold
   into one muted row" UX independent of station order. No change to how overrides are stored.

## Station 3 — Variations (new VFC renderer)

Screenshot: image4 (classic VFC variations step is the exact target).

New function `renderVariationsVFC(host)` in `vcl-ws.js` (not the shared editor), mirroring the
classic calculator's `renderStepVariations` (`vcl-calc-app.js:1382`) but writing the Submission
draft:

1. **Type count steppers:** three boxes Type IA / IB / II, each a number stepper. These map to
   code-less variation entries in `sub.variations` (the same representation the shared editor's
   `addCodeless` / `codelessCount` already use), so `feeCounts` and the engine see them
   unchanged. No classification-code search (per the docx: "exactly like VFC without a possible
   classification").
2. **Special cases** (kept, VFC style — decided this session): a panel listing only the
   countries that publish non-standard fee categories for the active types, each with a
   per-type variant `<select>`. This is **new** in the WS flow, which until now relied on the
   engine's auto-defaults. Wiring:
   - Candidate countries/roles come from the procedures + lead (`procPricedCountries` / the
     lead), deduped.
   - For a **non-lead** country, options come from `VCL_SUBMISSION.wsOptionsFor(sub, cc, role)`
     (role via `wsPricingRole`, i.e. an MRP/DCP RMS prices as CMS) and the pick is stored in
     `sub.specials.ws[cc + "|" + role]`.
   - For the **lead**, options come from `leadOptionsFor` and the pick is stored in
     `sub.specials.lead`.
   - A country/role with no non-standard option is omitted (parity with the classic
     `specialOptionsFor` filter). The stored value defaults to `defaultSpecial` (so the current
     auto-default — e.g. DK → "quality, simple (Q)" — is preserved and now visible/editable).
   - Follow the exact option-filtering the engine uses (`wsOptionsFor` excludes super-grouping
     variants; `leadOptionsFor` prefers SG variants in an SG) so the picker and the price can
     never disagree.
3. Reuse the classic calculator's visual classes where they are not appState-coupled; otherwise
   add equivalents to `vcl-ws-style.css`.

## Station 4 — Fees

Screenshots: current = image5, target = image6.

1. Restyle `renderFees` to the classic VFC result **visual design** (card shells, table columns,
   highlighted total row, currency toggle, Print/Excel), but keep the **per-procedure grouping**
   that `renderFees` already uses — in BOTH the Overview and the Details, with procedure
   sub-headings ("Procedure 1 · National", …). It is deliberately NOT grouped by country: the
   only difference from the VFC result is the grouping dimension (procedure, not country);
   everything else looks identical to the VFC. Headings stay "Fees by procedure" /
   "Details — fees by procedure".
2. **Print + Excel export:** add both buttons (image6 top-right). Reuse the classic
   calculator's print/export implementation (`vcl-calc-app.js` around lines 2245–2360) rather
   than re-implementing, driven from the `computeSubmissionFees` `details` breakdown. If that
   code is appState-coupled, extract a small shared export helper that takes rows.
3. Keep the existing EUR / Local-currency toggle.

## Classic VFC touches

1. **Button spacing** (image7): more gap between "Fee data — country details" and "⇄
   Worksharing / Super-Grouping" in `.calc-head-actions` (`vcl-app.js:228`). CSS only.
2. **Toggle-jump bug** (image7/8): clicking "⇄ Worksharing / Super-Grouping" jumps to the
   classic VFC's country-selection step instead of showing the WS flow in place. Root-cause in
   `applyWsMode` / the scroll call (`vcl-app.js:209–254`) during the build (systematic-debugging);
   fix is to enter the WS flow without the classic step re-rendering/scrolling.
3. **Country station** (image9, `renderStepCountries` `vcl-calc-app.js:1182`): remove the
   search `<input>`; move the "Select all" / "Reset" buttons to the **top-right** of the country
   box, on the heading row. This is the classic calculator's own country step, not the WS flow.

## Data model

No schema change. The Submission draft fields already exist:
`variations[{code,variantId,type,query}]`, `procedures`, `lead`,
`strengths{default,overrides}`, `specials{line:{},ws:{},lead:null}`. The new Special-Cases
picker is the first WS UI to write `specials.ws` / `specials.lead`; the shapes are already
initialised in `freshState` (empty sub-objects), so no migration.

## Testing

- Node harness parity: a WS/SG submission priced before and after the reorder yields identical
  `computeSubmissionFees` totals (the engine is unchanged; this guards the renderers).
- Special-cases picker: selecting DK "quality, simple (Q)" vs standard changes the DK line as the
  engine's `wsSpecialFor` path dictates; lead vs non-lead storage keys resolve correctly.
- Strengths sensitivity shows the right countries with no variation types set (type-independent
  probe) and still matches the old behaviour once types are set.
- Budget regression: Budget's Procedures/Strengths/Variations stations render byte-identically to
  today (flags off) — diff the harness output.
- Mode derivation: Procedures-station gating and SG procedure-kind rules behave with variations
  empty (treated as Worksharing) and once all-IA is set (Super-Grouping).
- Manual (real Chrome, per project convention): the four stations against image2/3/4/6; the
  classic button spacing, toggle no longer jumps, country station layout.

## Out of scope

- Any change to the fee engine, admin/process fees, IT per-product logic, or country fee data.
- Budget Planning's appearance or behaviour.
- The Guided Workflow.
