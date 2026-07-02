# Variation Fee Calculator — Embedding & Maintenance Guide

## Files

- `index.html` — the application (structure + styling)
- `app.js` — calculation logic (mirrors the Excel formulas 1:1) and UI
- `data.js` — the fee data extracted from the Excel file (all 33
  countries, 415 rows, plus the change history from the "Imprint" sheet)
- `convert.py` — script to regenerate `data.js` from an updated Excel file

All three runtime files (`index.html`, `app.js`, `data.js`) must sit in
the **same directory** and be served over a web server (not opened via
`file://` — some browsers block loading `data.js`/`app.js` from the local
filesystem).

## How the calculator works (4 steps)

1. **Countries** — select one or more markets (e.g. 5 countries at once).
2. **Country details** — for each selected country, choose the procedure
   role (RMS / CMS / national / EMA — only the roles that actually exist
   for that country are offered) and the number of authorised strengths
   for that country. These can differ from country to country (e.g.
   Germany with only a 50 mg strength vs. Belgium with both 50 mg and
   100 mg, i.e. 2 strengths).
3. **Variations** — choose how many Type IA / IB / II variations are
   being filed. This applies the same way to every selected country.
   Where a selected type has more than one variant in a given country
   (e.g. "simple" vs "complex"), a **Special cases** section appears,
   letting you pick the right variant per country. Countries without
   that distinction automatically use their standard fee — no need to
   set anything for them.
4. **Result** — a list with one line per country (role, strengths, the
   number of variations of each filed type, chosen variant, fee), plus
   the combined total at the top. The total panel also shows **"Last
   updated"**, taken from the most recent entry in the Excel file's
   `Imprint` sheet (cell B2), and a **"View change history"** button that
   expands the full change log from that sheet (date + description for
   every past update), so users can see at a glance how current the fee
   data is and what has changed over time.

### How "special cases" are handled

The source fee table uses many different, country-specific special-case
labels (e.g. Spain's "full application" vs. "abbreviated application",
Germany's "administrative", Denmark's grouping variants). These aren't
consistent across countries, so there is no single global dropdown that
would make sense everywhere. Instead, the special-case picker is shown
**per country**, but only for the countries where a real choice exists
for the type you selected — this keeps the workflow as close to "select
once, applies everywhere" as the underlying data allows, without ever
showing a country an option that doesn't apply to it.

If you tick a type for which a country has no matching special-case row,
that country automatically falls back to its standard (non-special) row.

### Grouping / inclusion rules

Some countries fold one variation type into another when both are filed
in the same role (e.g. a Type IA submitted together with a Type II is
often already covered by the Type II fee). This is evaluated **per
country and per procedure role** — selecting an RMS item for one country
and a CMS item for another always calculates them independently, since
those represent separate procedures. Where an item is folded into
another, the result list shows it as "(included)" with an explanatory
note rather than a fee, mirroring the original table's logic.

## Embedding via iframe

```html
<iframe
  src="/path/to/variation-fee-calculator/index.html"
  style="width:100%; max-width:920px; height:1000px; border:0;"
  title="Variation Fee Calculator">
</iframe>
```

Adjust `height` as needed — step 2 (country details) grows with the
number of selected countries, and step 3 can grow further if many
special-case choices are shown; the change-history list on the result
screen is scrollable internally so it won't push the page height too far.
Let me know if you'd like automatic iframe-height resizing — that can be
added with a small `postMessage` script.

## Updating the fees from a new Excel file

Whenever the source Excel file is updated (new fees, new countries,
changed formulas, new change-log entries), regenerate `data.js` yourself
— no need to involve me:

```bash
pip install openpyxl
python3 convert.py path/to/Variation-Fee-Calculator-EU.xlsx
```

This overwrites `data.js` in the current directory. Then redeploy it
alongside the unchanged `index.html` and `app.js`.

The script will print a short summary, e.g.:

```
Reading path/to/Variation-Fee-Calculator-EU.xlsx …
  415 fee rows found.
  70 changelog entries found (most recent: 2026-05-11).
  18 cross-sheet reference(s) resolved (e.g. exchange rate).
Done: wrote data.js (240,662 bytes).
Countries: 33, rows: 415
```

The "Last updated" date and the "View change history" list on the result
screen are both generated automatically from the `Imprint` sheet's column
B (date) and column C (description), starting at row 2. As long as future
versions of the Excel file keep adding new entries at the top of that
sheet (most recent first, which is the existing convention), no further
changes are needed — re-running `convert.py` picks them up automatically.

**Two warnings the script may show, and what to do about them:**

- *"unknown cross-sheet formula references found"* — a formula points at
  a cell in another sheet that the script doesn't know how to resolve
  yet (currently only the exchange-rate anchor for Slovenia is handled
  automatically). The web calculator can't interpret those formulas as-is.
  Get in touch and I can add support for the new reference, or resolve it
  manually following the pattern already in the script
  (`KNOWN_SHEET_REFS`).
- *"new/unrecognised country codes without a stored display name"* — a
  new country was added to the Excel file. The calculator will still work
  (it shows the raw country code as a fallback), but for a proper English
  name, add it to the `COUNTRY_NAMES` dictionary near the top of
  `convert.py`.

Because `app.js` interprets the Excel formulas at runtime rather than
having them hard-coded, most future updates — new fee amounts, new
countries, new rows, new special-case variants — need **only a re-run of
`convert.py`**. The special-case picker in step 3 is generated
automatically from whatever variants exist in the data, so a newly added
special case (e.g. a new "expedited" variant for some country) will show
up in the picker without any code changes. Structural changes (e.g. the
sheet name changing, or columns being reordered) would need a small
adjustment to `convert.py` itself; the script's header comment documents
the assumptions it makes about the sheet layout.

## Validation

The calculation was checked against the original Excel file, both
exhaustively and with specific known examples:

- All 415 fee-table rows across all 33 countries were evaluated
  automatically with no formula errors.
- Specific combinations were compared against the values stored in the
  Excel file, including the country-specific special rules:
  - Germany, Type II RMS "simple" → €4,300.00 ✓
  - Germany, Type IA RMS "administrative" → €140.00 ✓
  - Belgium, Type II RMS "analytical", 2 strengths → €8,391.06 ✓
  - Italy, Type II RMS "reduced" → €14,678.00 ✓
  - Spain, Type II RMS "full application", fee cap logic → €4,386.33 ✓
  - A combined 5-country run (Germany, Belgium, France, Italy, Spain),
    each with its own role/strengths/special case, summed to the correct
    grand total.
- Cross-role combinations (e.g. one country's RMS item plus another
  country's CMS item) are calculated independently, as intended.
- The "Last updated" date and change-history list were checked against
  the `Imprint` sheet: 70 entries, most recent dated 11 May 2026,
  matching cell B2.

## Legal note in the tool

The footer deliberately states: "for internal guidance only, not legal
or regulatory advice." This should be kept, since fee tables can change
and the calculator is not a substitute for a binding confirmation from
the relevant authority.
