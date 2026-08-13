# Budget Planning — Annual maintenance fees

**Date:** 2026-08-13
**Status:** Approved for planning (design agreed in brainstorming)
**Tool:** Variation Toolbox → Budget Planning (`vcl-budget.js`, `vcl-budget-engine.js`)
**Related specs:** `2026-08-05-budget-planning-design.md`, `2026-08-05-budget-submission-model-design.md`
**Related memory:** `budget-submission-model`, `budget-planung`, `working-instructions-variation-toolbox`

## Why

The Budget Planning tool today prices **one-off variation fees** and RA effort for the coming
year. It ignores **annual maintenance fees** — the recurring per-marketing-authorisation charges
most agencies levy every year to keep a MA alive (agency "annual fee" / "maintenance fee").
For an RA department's yearly budget these are often the *larger* line item, so the plan is
incomplete without them. This adds them as a second, decoupled planning surface inside the same
tool, and a combined "money" box on the dashboard.

Annual fees were explicitly deferred in the original Budget Planning spec (see its *Out of scope*);
this spec undefers them.

## Core model (the decisions that shaped everything else)

1. **A one-off variation and a recurring annual fee are different objects.** A variation is an
   *event* (can happen many times per product per year); an annual fee is a *state per marketing
   authorisation* (charged once per MA per year). One cannot be derived 1:1 from the other. They
   therefore live in **two separate tables**, not one.

2. **The annual-fee unit is a marketing authorisation (a "registration"), not a product.** The same
   product name can hold several independent MAs with separate authorisation numbers — e.g. a
   national DE MA *and* an MRP/DCP registration where DE is RMS are two different authorisations,
   each paying its own annual fee. Deduplication is therefore keyed on the **registration**, never
   on the product name.

3. **Registration key** (the dedup identity of an annual-fee row):

   | Procedure | Key | Example |
   |---|---|---|
   | national | `product` + `national` + `country` | `aspirin-plus-c · national · DE` |
   | MRP/DCP | `product` + `mrpdcp` + `RMS` (anchors the family) | `aspirin-plus-c · mrpdcp · DE` |
   | CP | `product` + `cp` | `adalimumab-bio · cp` |

   Same key ⇒ one annual row. Different key ⇒ a separate annual row. So two national DE variation
   lines collapse into one annual row, while the MRP/DCP registration of the same product stays a
   distinct row.

4. **Two origins, one table.** An annual row can be created:
   - **auto (🔗):** on saving a *variation* plan line, if its registration key is not yet present in
     the annual table, one row is seeded (markets pre-filled from the procedure). If the key already
     exists, nothing happens — no duplicate.
   - **manual (📌):** via a dedicated **"Add product"** editor, for MAs that pay an annual fee but
     have **no** variation planned this year.

   Because both flows write the *same* registration-keyed object, there is no drift and no double
   count. A row carries an `origin` marker for the table's provenance icon; an auto row may be
   edited or deleted like any other (e.g. a divested MA).

5. **No global on/off switch.** An empty annual table already means "no annual fees" (exactly like
   an empty variations table means €0). The CMC-style toggle idea was dropped as redundant.

## Data

### Annual-fee reference data — new file `assets/js/vcl-annual-data.js`

Source of truth: the **"Annual Fees"** sheet of `Variation-Fee-Calculator-EU.xlsx` (48 rows). It is
**not** part of the existing fee tables in `vcl-calc-data.js` (those price variations), so it ships
as its own data module, dual-exported (`window.VCL_ANNUAL_DATA` + `module.exports`) like the other
data files. One entry per **country × tariff variant**:

```js
{
  cc: "AT",
  hasAnnual: true,                 // false → country levies no annual fee (CY, DE, FR, LT, NO, PT, RS, SK)
  tariffs: [                       // ≥1 variant; >1 ⇒ user must pick (the "special case" selector)
    { id: "rms",      label: "RMS",      role: "RMS",           base: 3965, addStrength: 3965, ccy: "EUR" },
    { id: "cms",      label: "CMS",      role: "CMS",           base: 2052, addStrength: 2052, ccy: "EUR" },
    { id: "national", label: "national", role: "national",      base: 1709, addStrength: 1709, ccy: "EUR" },
  ],
  turnoverBased: false,            // true → not computable (BE, CH, EL): show note, contribute 0
  note: "",                        // free text from the Comments column (e.g. IT "per valid six-digit AIC")
}
```

Key shapes across the 48 rows the data module must represent faithfully:

- **Role-split rates** (base differs by RMS / CMS / national): AT, CZ, EE, MT, NL, PL. Single flat
  rate for RMS/CMS/national: BG, DK, FI, HR, HU, IS, LU, LV, RO, SE, SI.
- **`addStrength` differs from `base`**: SE (base 60 000 SEK, additional 30 000 SEK). Most others:
  `addStrength == base`. Some have **no** additional-strength charge (`addStrength: null`):
  BG, EE, EU, HU, IT — strength count does not scale the fee.
- **Legal-basis / product-type tariffs** (multi-variant "special case"):
  - **EU (centralised, via EMA):** `Reference/innovative` 232 400 €, `Art. 10(1)/(3) & 10c`
    60 300 € (default), `Art. 10(4) Biosimilar` 118 100 €.
  - **ES:** `Reference 8(3) ≤ 10 yrs` 1 711,71 €, `Generic & 8(3) > 10 yrs` 855,85 €.
  - **IE:** `Annual fee ≤ 10 MAs` 865 €, `Annual fee each add. MA` 1 080 €, `Dormant MA` 463 €.
  - **UK:** `POM – standard` 2 908 GBP, `POM – reduced` 1 450 GBP, `New API` 11 627 GBP.
- **Local currencies** (need FX): CZK (CZ), DKK (DK), HUF (HU), ISK (IS), PLN (PL), SEK (SE),
  GBP (UK). Converted to € for totals via the exchange rates already shipped for the calculator.
- **Turnover-based, not computable**: BE, CH, EL — surfaced with the note, contribute 0 to the total.
- **No annual fee**: CY, DE, FR, LT, NO, PT, RS, SK — row stays visible showing €0.

> Extraction is a build/authoring step done from the xlsx; the xlsx itself is never modified.
> Figures above are captured at authoring time — the module carries an `updated` date like the
> other data files.

### Annual-fee plan row (persisted)

```js
{
  id,
  key,                       // registration key (dedup identity) — see Core model §3
  origin: "auto" | "manual", // provenance for the table icon
  product: "",
  procedure: { kind: "national" | "mrpdcp" | "cp", rms: null, countries: [] }, // countries: ["AT","NL",…]
  strengths: 1,              // one global figure for the whole registration (not per CMS)
  tariffPicks: { AT: "rms", IE: "le10", … },  // chosen tariff id per country where >1 variant exists
  coverage: { mode: "full" | "partial", fromQuarter: null }, // proration — see Proration
}
```

Persistence extends the existing Budget store. The plan payload gains an `annualLines` array
alongside the current `lines` (variations). Bump the stored `version` and migrate v2 → v3 by
defaulting `annualLines: []` (no annual data existed before, so migration is purely additive).

## Fee computation — new pure functions in `vcl-budget-engine.js`

Kept in the existing engine module (pure, DOM-free, dual-exported, Node-testable), mirroring
`computeLineResult`:

- `computeAnnualRow(row, annualData, fx)` → `{ total, byCountry: [{cc, role, tariffId, amountLocal,
  ccy, amountEur, note}], computable, uncomputableCountries }`.
  - Per country: pick the tariff (the country's only tariff, or `tariffPicks[cc]`), then
    `amount = base + max(0, strengths - 1) * (addStrength ?? 0)`; MRP/DCP uses the RMS rate for the
    RMS country and the CMS rate for each CMS country. Convert to € via `fx`.
  - `hasAnnual:false` → 0 with a "no annual fee" flag. `turnoverBased:true` → 0 with an
    "uncomputable" flag so the UI can show the note instead of a number.
  - Apply **proration** last (see below).
- `computeAnnualRollup(annualLines, annualData, fx)` → `{ totalEur, byMarket, byProduct }`, summing
  `computeAnnualRow` results (each registration counted once — dedup already happened at row level).
- `registrationKey(procedure, product)` → the dedup string; used by both the auto-seed path and any
  manual add to detect collisions.
- `seedAnnualFromSubmission(submission, product, existingKeys)` → an annual row (or `null` if the
  key already exists, or if the procedure yields no annual-eligible market).

### Proration

A registration's annual fee is charged for the whole calendar year. When the budget covers only
part of a year (e.g. mid-2026 planning the remainder of 2026), the counted amount is reduced
pro-rata:

- `coverage.mode === "full"` → factor **1.0** (the normal case for a next-year budget like 2027).
- `coverage.mode === "partial"` with `fromQuarter = Qn` → factor = `(5 - n) / 4`
  (Q1→100 %, Q2→75 %, Q3→50 %, Q4→25 %). Quarter-granular matches the tool's existing
  quarter-level planning; no exact dates.

Proration is a per-row field (defaulting to full) so a plan can mix a full-year new registration
with a part-year one, though in practice a whole budget usually shares one horizon.

## UI

### Two stacked tables

The existing **"Plan lines"** heading becomes **"Plan lines — Variations"** (unchanged content).
Directly below, in the identical table design, a second section **"Plan lines — Annual maintenance
fees"** with its own **"+ Add product"** button. Columns:

`[origin icon] · Product · registration | Markets | Str. | Special case / tariff | Annual fee | ⋯`

- **Product · registration**: product name + a muted track qualifier (`· MRP/DCP`, `· national`,
  `· CP`) so the same product can legitimately appear on several rows. Auto rows that absorbed
  several variation lines show a "N variation lines merged" sub-note.
- **Markets**: country chips, RMS highlighted; overflow collapses to `+N`.
- **Str.**: the single global strengths figure.
- **Special case / tariff**: a select shown only where the country/registration has >1 tariff
  variant (EU legal basis, IE MA-count, UK POM class, ES age); otherwise a muted "auto" label.
- **Annual fee**: per-row total, in local currency where applicable with the € equivalent feeding
  the total; €0 rows (no-annual countries) stay visible, greyed.
- **Origin icon**: 🔗 auto (from a variation line) · 📌 manual (Add product). Legend beneath the table.
- **Total annual (recurring / yr)** footer row, in €.

### Dashboard "Agency fees" box (chosen: Proposal 2)

The top tile area gains a combined **"Agency fees · <year>"** card (replacing the standalone
"Variation fees" tile) that stacks three rows, with RA hours and FTE remaining as their own tiles:

```
Agency fees · 2027
  Variations                       € …
  Annual fee                       € …/yr
  ─────────────────────────────────────
  Total this year                  € …
```

- Row labels are exactly **"Variations"** and **"Annual fee"** (per decision), **"Total this year"**
  for the sum.
- The total is framed as spend **in the budget year** (one-off variations planned that year +
  annual fees due that year, prorated) — the only honest way to add a one-off and a recurring
  figure. The `/yr` suffix on the annual row keeps the distinction visible.
- `computeAnnualRollup` also feeds the existing **By market / By product** panels so annual spend
  appears there alongside variation spend.

### "Add product" editor (manual annual row)

A takeover editor mirroring the variation "New line" flow, but **two stations** (no Variations, no
RA tasks):

- **Station A — Product**: Product (text) · Number of strengths (with the same "MRP/DCP applies one
  strengths figure to every market — may slightly skew the total" warning) · Budget year ·
  **Coverage this budget** (Full year → 100 %; Rest of year · from Qn → prorated, with a live
  "n of 12 months → x %" line).
- **Station B — Registration**: Procedure kind (national / MRP/DCP / CP) · Markets (RMS + CMS chips,
  reusing the workflow's country pickers) · the special-case / tariff selector per country where
  applicable. Completing B computes the registration key; if it collides with an existing row the
  editor offers to open that row instead of creating a duplicate.

Auto-seeded rows skip the editor entirely; they are created silently on variation-line save and can
be opened later in this same editor to adjust strengths, tariff picks, or coverage.

## Architecture & wiring

No changes to `vcl-submission.js` or the variation pricing/hours engines — annual fees are a
parallel concern.

- **New** `assets/js/vcl-annual-data.js` — reference data (dual-export). Registered in
  `includes/lookup.php` and added to `build_zip.py`'s `FILES`.
- **`vcl-budget-engine.js`** — add the pure `computeAnnualRow` / `computeAnnualRollup` /
  `registrationKey` / `seedAnnualFromSubmission` functions and the v2→v3 store migration. This is
  where the domain math lives (Node-testable).
- **`vcl-budget.js`** — render the second table, the "Agency fees" box, and the Add-product
  takeover editor; wire the auto-seed hook into the existing variation-line save; currency display.
- **`vcl-budget-style.css`** — reuse `--budget` (#7A3350) tokens and the existing table/chip/station
  styles; add only what the new rows/box need.
- **`includes/lookup.php`** — register `vcl-annual-data` and add it to `vcl-budget-engine` /
  `vcl-budget` dependency arrays (both read it at init, like `vcl-submission`).
- **FX**: reuse the exchange rates already shipped for the calculator; no new rate source.

## Testing

`test/test-annual-fees.js` (repo-root Node test, framework-less, root-relative requires — same
style as `test/test-submission.js` / `test/test-budget-rollup.js`). Pure-function coverage:

- Registration key: two national DE lines → one key; national DE vs MRP/DCP-RMS-DE → two keys;
  CP → single key.
- `computeAnnualRow`: single flat-rate country; role-split country (RMS vs CMS); strengths scaling
  (`addStrength == base`, `addStrength != base` → SE, `addStrength == null` → no scaling);
  multi-tariff pick (EU biosimilar, IE ≤10, UK reduced); local-currency → € conversion;
  `hasAnnual:false` → 0; `turnoverBased:true` → 0 + uncomputable flag.
- Proration factors Q1–Q4 and full-year.
- `computeAnnualRollup`: dedup (same key counted once), by-market / by-product sums, mixed
  currencies.
- Store migration v2 → v3 adds empty `annualLines` without touching existing variation lines.

Manual acceptance in real Chrome via the existing `test/manual/budget-harness.html` (in-app browser
screenshot tool is unreliable for this project): auto-seed on variation save, no duplicate on
re-save, manual Add product for a no-variation MA, tariff picker, proration, currency totals, and
the Agency-fees box math.

## Out of scope

- Editing agency annual-fee **amounts** in the UI (they come from the shipped data module, like the
  variation fee tables).
- Multi-year projection of recurring fees (each budget covers one horizon).
- Exact strength-per-CMS in MRP/DCP (one global strengths figure by design; warned in the editor).
- Turnover/sales-based fees (BE, CH, EL) as computed numbers — shown as notes only.

## Model-selection note (for the plan / subagents)

- **Sonnet** — the engine math (`computeAnnualRow`/rollup, registration key, proration, FX), the
  auto-seed wiring, and the store migration: business logic, well-specified.
- **Opus** — only if a genuine domain edge case surfaces during acceptance (e.g. an MRP/DCP tariff
  interaction the data model didn't anticipate).
- **Haiku** — the data-module transcription from the xlsx and the table/box/editor layout scaffolding.
