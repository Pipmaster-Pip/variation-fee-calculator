# Annual maintenance fees — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring annual maintenance fees to the Budget Planning tool as a second, registration-keyed plan surface, deduplicated per marketing authorisation, with an "Agency fees" dashboard box that shows one-off variations and recurring annual fees together.

**Architecture:** Reference data ships as a new pure data module (`vcl-annual-data.js`). All domain math (registration key, per-row fee with strengths/tariff/currency/proration, rollup, store migration) lives as pure, Node-tested functions added to the existing `vcl-budget-engine.js`. The view layer (`vcl-budget.js`) renders a second table, an auto-seed hook on variation-line save, a two-station "Add product" editor, and the combined dashboard box. No changes to `vcl-submission.js` or the variation pricing/hours engines.

**Tech Stack:** Vanilla ES5-style IIFE modules (dual-export `window` + `module.exports`), framework-less Node tests run via `node test/<file>.js`, WordPress enqueue in `includes/lookup.php`, packaging via `build_zip.py`.

**Spec:** `docs/superpowers/specs/2026-08-13-budget-annual-fees-design.md`

## Global Constraints

- **Source dir:** `D:\Claude\Variation Fee Calculator\variation-fee-calculator\` (the plugin). Repo root (where `test/`, `build_zip.py`, `.git` live) is `D:\Claude\Variation Fee Calculator\`.
- **Module style:** ES5 IIFE, dual-export: `if (typeof module !== "undefined" && module.exports) module.exports = api; if (root) root.VCL_X = api;` wrapped as `(function (root) { ... })(typeof window !== "undefined" ? window : this);`. No ES6 (`let/const/arrow/class`) in shipped `assets/js/*.js` — match surrounding code.
- **Engines are pure & DI'd:** functions in `vcl-budget-engine.js` never touch `window`; all data/engines are passed in as arguments (Node-testable).
- **Tests:** repo-root `test/`, framework-less, `console.log` PASS/FAIL with `eq`/`approx` helpers, exit non-zero on failure. Run: `node test/<file>.js` from repo root.
- **Language:** English UI copy, sentence case. Tool identity color `--budget: #7A3350`.
- **Currency:** amounts convert to € via an injected `fxByCurrency` map (`{ CZK: 25, SEK: 11.25, GBP: 0.8, ... }`, meaning 1 EUR = X local); `EUR` → factor 1. The UI builds this map from `window.VCLCALC_DATA.STATIC_FX_RATES` + `CC_TO_CURRENCY` (and the live rate getter when present); the engine never fetches rates.
- **Persistence:** localStorage key `vcl_budget_plan_v2` stays the physical key; the payload `version` bumps 2 → 3 and gains `annualLines: []`. Migration is purely additive.
- **Do NOT commit or push** unless the user explicitly asks (per project CLAUDE.md). The `git commit` steps below are the intended granularity; run them only once the user has approved committing, otherwise stage-and-hold.

---

## File Structure

- **Create** `variation-fee-calculator/assets/js/vcl-annual-data.js` — annual-fee reference dataset (48 country entries) + `updated` date. Dual-export `window.VCL_ANNUAL_DATA = { updated, COUNTRIES }`.
- **Create** `test/test-annual-data.js` — shape/spot-check tests for the dataset.
- **Create** `test/test-annual-fees.js` — pure-function tests for the new engine functions.
- **Modify** `variation-fee-calculator/assets/js/vcl-budget-engine.js` — add `registrationKey`, `seedAnnualRowsFromSubmission`, `prorationFactor`, `findAnnualCountry`, `computeAnnualRow`, `computeAnnualRollup`, `normalizeAnnualLine`; bump `defaultPlan`/`loadPlan`/`savePlan` to carry `annualLines`.
- **Modify** `variation-fee-calculator/assets/js/vcl-budget.js` — rename table heading; render the annual table + legend; auto-seed hook on line save; "Add product" two-station editor; "Agency fees" dashboard box; Excel export columns.
- **Modify** `variation-fee-calculator/assets/css/vcl-budget-style.css` — styles for the annual table origin icons, tariff selector, coverage row, and Agency-fees box (reuse existing tokens/classes).
- **Modify** `variation-fee-calculator/includes/lookup.php` — register `vcl-annual-data`; add it to `vcl-budget-engine` and `vcl-budget` dependency arrays; enqueue it.
- **Modify** `build_zip.py` — add `assets/js/vcl-annual-data.js` to `FILES`.

---

## Task 1: Annual-fee reference data module

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-annual-data.js`
- Test: `test/test-annual-data.js`
- Modify: `variation-fee-calculator/includes/lookup.php` (register + deps + enqueue)
- Modify: `build_zip.py` (FILES)

**Interfaces:**
- Produces: `window.VCL_ANNUAL_DATA = { updated: "2026-08-13", COUNTRIES: [ { cc, hasAnnual, turnoverBased, note, tariffs: [ { id, label, role, base, addStrength, ccy } ] } ] }`. `role` is `"RMS"|"CMS"|"national"` only where the fee genuinely splits by that role; otherwise `null`. `addStrength` is a number, or `null` when the country does not scale the fee by strength. `ccy` is an ISO code (`"EUR"`, `"CZK"`, `"DKK"`, `"HUF"`, `"ISK"`, `"PLN"`, `"SEK"`, `"GBP"`). `base`/`addStrength` are in `ccy` units.

- [ ] **Step 1: Write the failing test**

Create `test/test-annual-data.js`:

```javascript
// Node unit test for the annual-fee reference data (vcl-annual-data.js).
// Run from the project root:  node test/test-annual-data.js
"use strict";
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-annual-data.js");
var D = global.window.VCL_ANNUAL_DATA;

var failures = 0;
function ok(cond, msg) {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (!cond) failures++;
}
function byCc(cc) {
  return (D.COUNTRIES || []).filter(function (c) { return c.cc === cc; })[0];
}

console.log("Annual data tests\n");

ok(typeof D.updated === "string" && D.updated.length === 10, "carries an updated date");
ok(Array.isArray(D.COUNTRIES) && D.COUNTRIES.length >= 40, "has >=40 country entries");

var at = byCc("AT");
ok(at && at.hasAnnual === true, "AT has annual fee");
ok(at && at.tariffs.length === 3, "AT has 3 role tariffs (RMS/CMS/national)");
ok(at && at.tariffs.filter(function (t){return t.role==="RMS";})[0].base === 3965, "AT RMS base 3965 EUR");

var se = byCc("SE");
ok(se && se.tariffs[0].base === 60000 && se.tariffs[0].addStrength === 30000 && se.tariffs[0].ccy === "SEK",
   "SE base 60000 / addStrength 30000 SEK (differ)");

var it = byCc("IT");
ok(it && it.tariffs[0].addStrength === null, "IT does not scale by strength (addStrength null)");

var eu = byCc("EU");
ok(eu && eu.tariffs.length === 3, "EU has 3 legal-basis tariffs");
ok(eu && eu.tariffs.filter(function (t){return t.id==="biosimilar";})[0].base === 118100, "EU biosimilar 118100 EUR");

var de = byCc("DE");
ok(de && de.hasAnnual === false, "DE has no annual fee");

var be = byCc("BE");
ok(be && be.turnoverBased === true, "BE is turnover-based (uncomputable)");

var uk = byCc("UK");
ok(uk && uk.tariffs.filter(function (t){return t.id==="reduced";})[0].ccy === "GBP", "UK tariffs in GBP");

console.log("\n" + (failures ? failures + " FAILED" : "All passed"));
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-annual-data.js`
Expected: FAIL — `Cannot find module '../variation-fee-calculator/assets/js/vcl-annual-data.js'`.

- [ ] **Step 3: Create the data module**

Create `variation-fee-calculator/assets/js/vcl-annual-data.js`. Transcribe **all 48 rows** of the xlsx "Annual Fees" sheet into the shape below. The excerpt shows the required encodings (role split, `addStrength: null`, local currency, multi-tariff special cases, `hasAnnual:false`, `turnoverBased:true`); fill in the remaining countries the same way from the spec's data table.

```javascript
// Annual maintenance fee reference data. Source: the "Annual Fees" sheet of
// Variation-Fee-Calculator-EU.xlsx (never modified). One entry per country; `tariffs` holds one
// variant per row of the sheet. `role` is set only where the fee splits by RMS/CMS/national;
// `addStrength: null` means the fee does not scale with the number of strengths. Amounts are in
// `ccy` units (converted to EUR downstream via the shared FX rates). Dual-export like the other
// data modules.
(function (root) {
  "use strict";

  var COUNTRIES = [
    { cc: "AT", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 3965, addStrength: 3965, ccy: "EUR" },
      { id: "cms", label: "CMS", role: "CMS", base: 2052, addStrength: 2052, ccy: "EUR" },
      { id: "national", label: "national", role: "national", base: 1709, addStrength: 1709, ccy: "EUR" },
    ] },
    { cc: "BE", hasAnnual: true, turnoverBased: true, note: "Annual fee per packs sold", tariffs: [] },
    { cc: "BG", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 127.82, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "CH", hasAnnual: true, turnoverBased: true, note: "Annual sales fee on medicines", tariffs: [] },
    { cc: "CY", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "CZ", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 42795, addStrength: 42795, ccy: "CZK" },
      { id: "cmsnat", label: "CMS/national", role: "CMS", base: 21345, addStrength: 21345, ccy: "CZK" },
      { id: "cmsnat_nat", label: "CMS/national", role: "national", base: 21345, addStrength: 21345, ccy: "CZK" },
    ] },
    { cc: "DE", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    // ... DK, EE, EL, EU, ES, FI, FR, HR, HU, IE, IS, IT, LT, LU, LV, MT, NL, NO, PL, PT, RO, RS, SE, SI, SK, UK ...
    { cc: "EU", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "reference", label: "Reference / innovative", role: null, base: 232400, addStrength: null, ccy: "EUR" },
      { id: "art10", label: "Art. 10(1)/(3) & 10c", role: null, base: 60300, addStrength: null, ccy: "EUR", isDefault: true },
      { id: "biosimilar", label: "Art. 10(4) Biosimilar", role: null, base: 118100, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "IE", hasAnnual: true, turnoverBased: false, note: "w/o Annual Enforcement Fee", tariffs: [
      { id: "le10", label: "Annual fee \u2264 10 MAs", role: null, base: 865, addStrength: 865, ccy: "EUR", isDefault: true },
      { id: "eachadd", label: "Annual fee each add. MA", role: null, base: 1080, addStrength: 1080, ccy: "EUR" },
      { id: "dormant", label: "Dormant MA", role: null, base: 463, addStrength: 463, ccy: "EUR" },
    ] },
    { cc: "IT", hasAnnual: true, turnoverBased: false, note: "Annual fee per valid six-digit AIC", tariffs: [
      { id: "aic", label: "per AIC", role: null, base: 1879, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "SE", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 60000, addStrength: 30000, ccy: "SEK" },
    ] },
    { cc: "UK", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "standard", label: "POM \u2013 standard", role: null, base: 2908, addStrength: 2908, ccy: "GBP", isDefault: true },
      { id: "reduced", label: "POM \u2013 reduced", role: null, base: 1450, addStrength: 1450, ccy: "GBP" },
      { id: "newapi", label: "New API", role: null, base: 11627, addStrength: 11627, ccy: "GBP" },
    ] },
  ];

  var api = { updated: "2026-08-13", COUNTRIES: COUNTRIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_ANNUAL_DATA = api;
})(typeof window !== "undefined" ? window : this);
```

> Remaining countries to transcribe from the spec's data table, same shapes:
> DK (DKK 20116 flat, role null), EE (EUR: RMS 600 addStrength null, CMS/national 320 addStrength null), EL (turnoverBased), ES (EUR two age-based tariffs: `ref_le10` 1711.71, `generic_gt10` 855.85 isDefault, both addStrength = base), FI (EUR 1550 flat), FR (hasAnnual false), HR (EUR 318.54 flat), HU (HUF 364500, addStrength null), IS (ISK 42600 flat), LT (hasAnnual false), LU (EUR 100 flat), LV (EUR 850 flat), MT (EUR RMS 900 / CMS·national 275), NL (EUR RMS 2330 / CMS·national 1830), NO (hasAnnual false), PL (PLN RMS 2730 / CMS·national 2100), PT (hasAnnual false), RO (EUR 230 flat), RS (hasAnnual false), SI (EUR 348 flat), SK (hasAnnual false).

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-annual-data.js`
Expected: `All passed`.

- [ ] **Step 5: Register the script in WordPress**

In `variation-fee-calculator/includes/lookup.php`, add a `wp_register_script` for `vcl-annual-data` (no deps) alongside the other data modules, e.g. right before the `vcl-budget-engine` registration:

```php
	$annual_data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-annual-data.js';
	wp_register_script(
		'vcl-annual-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-annual-data.js',
		array(),
		file_exists( $annual_data_file ) ? filemtime( $annual_data_file ) : false,
		true
	);
```

Add `'vcl-annual-data'` to the dependency arrays of **both** `vcl-budget-engine` and `vcl-budget` (they read `VCL_ANNUAL_DATA` at init). And enqueue it in the render block next to `wp_enqueue_script( 'vcl-budget-engine' );`:

```php
	wp_enqueue_script( 'vcl-annual-data' );
```

- [ ] **Step 6: Add the file to the packager**

In `build_zip.py`, add to `FILES` (next to the other budget assets):

```python
    "assets/js/vcl-annual-data.js",
```

- [ ] **Step 7: Verify the packager still builds**

Run: `python build_zip.py`
Expected: `OK` with a file count one higher than before, no "missing/unlisted files" error.

- [ ] **Step 8: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-annual-data.js test/test-annual-data.js variation-fee-calculator/includes/lookup.php build_zip.py
git commit -m "feat(budget): annual-fee reference data module + wiring"
```

---

## Task 2: Registration key + seeding from a submission

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget-engine.js`
- Test: `test/test-annual-fees.js`

**Interfaces:**
- Consumes: a `submission` (the shape from `emptySubmission()` — `{ procedures: [{ kind, nat, rms, cms }], strengths: { default } }`) and a `product` string.
- Produces:
  - `registrationKey(product, kind, anchor)` → lowercase slug string, e.g. `"aspirin plus c|national|de"`. `anchor` is the country for `national`, the RMS for `mrpdcp`, `""` for `cp`.
  - `seedAnnualRowsFromSubmission(submission, product)` → array of annual-row objects `{ key, origin: "auto", product, procedure: { kind, rms, countries: [cc...] }, strengths, tariffPicks: {}, coverage: { mode: "full", fromQuarter: null } }`. One row per registration: one per national country, one per MRP/DCP registration (rms + cms, `countries` includes rms first), one for cp (`countries: []`, cc handled as `"EU"` downstream). `strengths` copied from `submission.strengths.default`.

- [ ] **Step 1: Write the failing test**

Create `test/test-annual-fees.js`:

```javascript
// Node unit tests for the annual-fee engine functions (vcl-budget-engine.js).
// Run from the project root:  node test/test-annual-fees.js
"use strict";
global.window = {};
var BUD = require("../variation-fee-calculator/assets/js/vcl-budget-engine.js");

var failures = 0;
function eq(actual, expected, msg) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS " : "  FAIL ") + msg +
    (ok ? "" : " \u2014 expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  if (!ok) failures++;
}
function approx(a, b, msg) {
  var ok = Math.abs(a - b) < 1e-6;
  console.log((ok ? "  PASS " : "  FAIL ") + msg + (ok ? "" : " \u2014 expected " + b + ", got " + a));
  if (!ok) failures++;
}

console.log("Annual-fee engine tests\n");

// --- registrationKey / seeding
eq(BUD.registrationKey("Aspirin Plus C", "national", "DE"), "aspirin plus c|national|de", "national key");
var natSub = { procedures: [{ kind: "national", nat: "DE", rms: null, cms: [] }], strengths: { default: 2 } };
var seededA = BUD.seedAnnualRowsFromSubmission(natSub, "Aspirin Plus C");
var seededB = BUD.seedAnnualRowsFromSubmission(natSub, "Aspirin Plus C");
eq(seededA.length, 1, "national submission seeds one row");
eq(seededA[0].key, seededB[0].key, "two national DE submissions share a key (dedup)");
eq(seededA[0].strengths, 2, "seed carries the strengths figure");

var mrpSub = { procedures: [{ kind: "mrpdcp", nat: null, rms: "DE", cms: ["NL", "CZ"] }], strengths: { default: 1 } };
var mrpRows = BUD.seedAnnualRowsFromSubmission(mrpSub, "Aspirin Plus C");
eq(mrpRows.length, 1, "mrpdcp seeds one registration row");
eq(mrpRows[0].procedure.countries, ["DE", "NL", "CZ"], "mrpdcp row lists rms first, then cms");
var natKey = BUD.registrationKey("Aspirin Plus C", "national", "DE");
eq(mrpRows[0].key !== natKey, true, "mrpdcp RMS-DE key differs from national DE key");

console.log("\n" + (failures ? failures + " FAILED" : "All passed"));
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-annual-fees.js`
Expected: FAIL — `BUD.registrationKey is not a function`.

- [ ] **Step 3: Implement the functions**

In `vcl-budget-engine.js`, add before the `var api = {` block:

```javascript
  function slug(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  // Dedup identity of an annual-fee row. anchor = country (national) | RMS (mrpdcp) | "" (cp).
  function registrationKey(product, kind, anchor) {
    return slug(product) + "|" + slug(kind) + "|" + slug(anchor);
  }

  // One annual row per marketing-authorisation registration inside a submission.
  function seedAnnualRowsFromSubmission(submission, product) {
    var sub = (submission && typeof submission === "object") ? submission : {};
    var procs = Array.isArray(sub.procedures) ? sub.procedures : [];
    var strengths = (sub.strengths && sub.strengths.default >= 1) ? Math.floor(sub.strengths.default) : 1;
    var rows = [];
    procs.forEach(function (p) {
      p = p || {};
      if (p.kind === "national") {
        if (!p.nat) return;
        rows.push(makeSeed(product, "national", p.nat, p.nat, [p.nat], strengths));
      } else if (p.kind === "mrpdcp") {
        if (!p.rms) return;
        var countries = [p.rms].concat(Array.isArray(p.cms) ? p.cms : []);
        rows.push(makeSeed(product, "mrpdcp", p.rms, p.rms, countries, strengths));
      } else if (p.kind === "cp") {
        rows.push(makeSeed(product, "cp", "", null, [], strengths));
      }
    });
    return rows;
  }

  function makeSeed(product, kind, anchor, rms, countries, strengths) {
    return {
      key: registrationKey(product, kind, anchor),
      origin: "auto",
      product: product || "",
      procedure: { kind: kind, rms: rms, countries: countries },
      strengths: strengths,
      tariffPicks: {},
      coverage: { mode: "full", fromQuarter: null },
    };
  }
```

Add `registrationKey: registrationKey,` and `seedAnnualRowsFromSubmission: seedAnnualRowsFromSubmission,` to the `api` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-annual-fees.js`
Expected: `All passed`.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget-engine.js test/test-annual-fees.js
git commit -m "feat(budget): registration key + annual-row seeding from a submission"
```

---

## Task 3: Per-registration fee — strengths, tariff, currency, proration

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget-engine.js`
- Test: `test/test-annual-fees.js` (extend)

**Interfaces:**
- Consumes: an annual row (Task 2 shape), the `COUNTRIES` array from `VCL_ANNUAL_DATA`, and `fxByCurrency` (`{ ccy: unitsPerEur }`, `EUR` implied 1).
- Produces:
  - `prorationFactor(coverage)` → `1` for `{mode:"full"}`; `(5 - n)/4` for `{mode:"partial", fromQuarter:"Q"+n}` (Q1→1, Q2→0.75, Q3→0.5, Q4→0.25); `1` for anything malformed.
  - `findAnnualCountry(countries, cc)` → the country entry or `null`.
  - `computeAnnualRow(row, countries, fxByCurrency)` → `{ total, byCountry: [{ cc, role, tariffId, amountLocal, ccy, amountEur, status }], computable, needsPick: [cc...] }`. `status` ∈ `"ok" | "no-annual" | "turnover" | "needs-pick"`. `total` is the €-sum after proration; `byCountry` amounts are also post-proration.

- [ ] **Step 1: Write the failing test (extend test-annual-fees.js)**

Append before the final summary lines in `test/test-annual-fees.js`:

```javascript
// --- computeAnnualRow
require("../variation-fee-calculator/assets/js/vcl-annual-data.js");
var CC = global.window.VCL_ANNUAL_DATA.COUNTRIES;
var FX = { CZK: 25, SEK: 11.25, GBP: 0.8, DKK: 7.45, HUF: 390, ISK: 150, PLN: 4.3 };

function row(over) {
  var base = { key: "k", origin: "auto", product: "P", strengths: 1,
    procedure: { kind: "national", rms: null, countries: ["AT"] },
    tariffPicks: {}, coverage: { mode: "full", fromQuarter: null } };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

approx(BUD.prorationFactor({ mode: "full" }), 1, "proration full = 1");
approx(BUD.prorationFactor({ mode: "partial", fromQuarter: "Q3" }), 0.5, "proration Q3 = 0.5");

// AT national, 2 strengths: 1709 + 1*1709 = 3418 EUR
approx(BUD.computeAnnualRow(row({ strengths: 2, procedure: { kind: "national", rms: null, countries: ["AT"] } }), CC, FX).total,
  3418, "AT national 2 strengths = 3418 EUR");

// mrpdcp RMS AT + CMS AT-role: use role split. RMS AT (3965) + CMS NL (1830), 1 strength
approx(BUD.computeAnnualRow(row({ procedure: { kind: "mrpdcp", rms: "AT", countries: ["AT", "NL"] } }), CC, FX).total,
  3965 + 1830, "mrpdcp RMS AT + CMS NL, 1 strength");

// SE, 2 strengths: 60000 + 30000 = 90000 SEK / 11.25 = 8000 EUR
approx(BUD.computeAnnualRow(row({ strengths: 2, procedure: { kind: "national", rms: null, countries: ["SE"] } }), CC, FX).total,
  8000, "SE 2 strengths = 8000 EUR via FX");

// IT, 3 strengths, addStrength null => 1879 (no scaling)
approx(BUD.computeAnnualRow(row({ strengths: 3, procedure: { kind: "national", rms: null, countries: ["IT"] } }), CC, FX).total,
  1879, "IT does not scale by strengths");

// UK reduced pick, 1 strength: 1450 GBP / 0.8 = 1812.5 EUR
approx(BUD.computeAnnualRow(row({ procedure: { kind: "national", rms: null, countries: ["UK"] }, tariffPicks: { UK: "reduced" } }), CC, FX).total,
  1812.5, "UK reduced pick converted via GBP");

// DE => no annual fee
var deRes = BUD.computeAnnualRow(row({ procedure: { kind: "national", rms: null, countries: ["DE"] } }), CC, FX);
approx(deRes.total, 0, "DE contributes 0");
eq(deRes.byCountry[0].status, "no-annual", "DE flagged no-annual");

// BE => turnover-based, uncomputable
var beRes = BUD.computeAnnualRow(row({ procedure: { kind: "national", rms: null, countries: ["BE"] } }), CC, FX);
eq(beRes.byCountry[0].status, "turnover", "BE flagged turnover");

// EU multi-tariff without a pick => needs-pick, uses default (art10 60300)
var euRes = BUD.computeAnnualRow(row({ procedure: { kind: "cp", rms: null, countries: ["EU"] } }), CC, FX);
eq(euRes.needsPick.indexOf("EU") !== -1, true, "EU without pick flags needs-pick");
approx(euRes.total, 60300, "EU falls back to the default tariff");

// AT national 2 strengths prorated Q3 = 3418 * 0.5 = 1709
approx(BUD.computeAnnualRow(row({ strengths: 2, procedure: { kind: "national", rms: null, countries: ["AT"] }, coverage: { mode: "partial", fromQuarter: "Q3" } }), CC, FX).total,
  1709, "AT prorated Q3 halves the fee");
```

> Note: the `cp` branch uses cc `"EU"`; `computeAnnualRow` must map a `cp` procedure to the single `"EU"` country entry.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-annual-fees.js`
Expected: FAIL — `BUD.prorationFactor is not a function`.

- [ ] **Step 3: Implement the functions**

In `vcl-budget-engine.js`, add:

```javascript
  function prorationFactor(coverage) {
    coverage = coverage || {};
    if (coverage.mode !== "partial") return 1;
    var n = parseInt(String(coverage.fromQuarter || "").replace(/[^0-9]/g, ""), 10);
    if (!(n >= 1 && n <= 4)) return 1;
    return (5 - n) / 4;
  }

  function findAnnualCountry(countries, cc) {
    var list = countries || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].cc === cc) return list[i];
    return null;
  }

  // Picks the tariff for one country: explicit pick > role match > sole tariff > default/first (needs-pick).
  function pickTariff(entry, role, pickedId) {
    var ts = entry.tariffs || [];
    var byId = null, byRole = null, def = null, i;
    for (i = 0; i < ts.length; i++) {
      if (pickedId && ts[i].id === pickedId) byId = ts[i];
      if (role && ts[i].role === role) byRole = ts[i];
      if (ts[i].isDefault) def = ts[i];
    }
    if (byId) return { tariff: byId, needsPick: false };
    if (byRole) return { tariff: byRole, needsPick: false };
    if (ts.length === 1) return { tariff: ts[0], needsPick: false };
    return { tariff: def || ts[0] || null, needsPick: ts.length > 1 };
  }

  function computeAnnualRow(row, countries, fxByCurrency) {
    row = row || {};
    var proc = row.procedure || {};
    var strengths = (row.strengths >= 1) ? Math.floor(row.strengths) : 1;
    var factor = prorationFactor(row.coverage);
    var fx = fxByCurrency || {};
    var ccs = proc.kind === "cp" ? ["EU"] : (Array.isArray(proc.countries) ? proc.countries : []);
    var out = { total: 0, byCountry: [], computable: true, needsPick: [] };
    ccs.forEach(function (cc) {
      var entry = findAnnualCountry(countries, cc);
      if (!entry || entry.hasAnnual === false) {
        out.byCountry.push({ cc: cc, role: null, tariffId: null, amountLocal: 0, ccy: "EUR", amountEur: 0, status: "no-annual" });
        return;
      }
      if (entry.turnoverBased) {
        out.computable = false;
        out.byCountry.push({ cc: cc, role: null, tariffId: null, amountLocal: 0, ccy: entry.tariffs[0] ? entry.tariffs[0].ccy : "EUR", amountEur: 0, status: "turnover" });
        return;
      }
      var role = null;
      if (proc.kind === "mrpdcp") role = (cc === proc.rms) ? "RMS" : "CMS";
      else if (proc.kind === "national") role = "national";
      var picked = pickTariff(entry, role, (row.tariffPicks || {})[cc]);
      var t = picked.tariff;
      if (!t) { out.byCountry.push({ cc: cc, role: role, tariffId: null, amountLocal: 0, ccy: "EUR", amountEur: 0, status: "no-annual" }); return; }
      var addUnit = (typeof t.addStrength === "number") ? t.addStrength : 0;
      var local = (t.base + Math.max(0, strengths - 1) * addUnit) * factor;
      var rate = t.ccy === "EUR" ? 1 : (fx[t.ccy] || null);
      var eur = rate ? local / rate : 0;
      if (picked.needsPick && out.needsPick.indexOf(cc) === -1) out.needsPick.push(cc);
      out.byCountry.push({ cc: cc, role: role, tariffId: t.id, amountLocal: local, ccy: t.ccy, amountEur: eur,
        status: picked.needsPick ? "needs-pick" : "ok" });
      out.total += eur;
    });
    return out;
  }
```

Add `prorationFactor`, `findAnnualCountry`, `computeAnnualRow` to the `api` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-annual-fees.js`
Expected: `All passed`.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget-engine.js test/test-annual-fees.js
git commit -m "feat(budget): annual-row fee math (strengths, tariff, currency, proration)"
```

---

## Task 4: Annual rollup + store migration to v3

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget-engine.js`
- Test: `test/test-annual-fees.js` (extend)

**Interfaces:**
- Consumes: `annualLines` array (persisted rows), `COUNTRIES`, `fxByCurrency`.
- Produces:
  - `normalizeAnnualLine(raw, fallbackId)` → a valid annual row (never throws; recovers malformed input to a safe empty national row with `origin:"manual"`).
  - `computeAnnualRollup(annualLines, countries, fxByCurrency)` → `{ totalEur, byMarket: [{key,value}], byProduct: [{key,value}] }` (byMarket/byProduct sorted desc, reusing `sortDesc`).
  - `defaultPlan()` now returns `{ version: 3, hoursPerHead: 1500, lines: [], annualLines: [] }`; `loadPlan` adds `annualLines: []` when absent and normalizes each; `savePlan` persists `annualLines`.

- [ ] **Step 1: Write the failing test (extend)**

Append to `test/test-annual-fees.js` before the summary:

```javascript
// --- rollup + migration
var lines = [
  row({ product: "Aspirin", procedure: { kind: "national", rms: null, countries: ["AT"] }, strengths: 1 }),
  row({ product: "Aspirin", procedure: { kind: "national", rms: null, countries: ["NL"] }, strengths: 1 }),
];
var rollup = BUD.computeAnnualRollup(lines, CC, FX);
approx(rollup.totalEur, 1709 + 1830, "rollup sums AT national + NL national");
eq(rollup.byMarket[0].key, "AT", "byMarket sorted, AT first (1709 > 1830? no)"); // adjust expectation below

// migration: a v2 plan (no annualLines) gains an empty array
var store = (function () { var m = {}; return { getItem: function (k){return m[k]||null;}, setItem: function (k,v){m[k]=v;} }; })();
store.setItem("vcl_budget_plan_v2", JSON.stringify({ version: 2, hoursPerHead: 1500, lines: [] }));
var loaded = BUD.loadPlan(store);
eq(Array.isArray(loaded.annualLines), true, "loadPlan adds annualLines to a v2 plan");
eq(loaded.annualLines.length, 0, "migrated annualLines is empty");
```

> Fix the `byMarket` assertion to the true order once you see the numbers: NL 1830 > AT 1709, so `byMarket[0].key === "NL"`. Correct the expectation before committing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-annual-fees.js`
Expected: FAIL — `BUD.computeAnnualRollup is not a function`.

- [ ] **Step 3: Implement**

In `vcl-budget-engine.js`:

```javascript
  function normalizeAnnualLine(raw, fallbackId) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var proc = (raw.procedure && typeof raw.procedure === "object") ? raw.procedure : {};
    var kind = (proc.kind === "mrpdcp" || proc.kind === "cp") ? proc.kind : "national";
    var countries = Array.isArray(proc.countries) ? proc.countries.filter(function (c) { return typeof c === "string"; }) : [];
    var product = typeof raw.product === "string" ? raw.product : "";
    var anchor = kind === "national" ? (countries[0] || "") : (kind === "mrpdcp" ? (proc.rms || "") : "");
    return {
      id: (typeof raw.id === "string" && raw.id) || fallbackId || ("annual-" + Date.now() + "-" + Math.floor(Math.random() * 1e5)),
      key: typeof raw.key === "string" && raw.key ? raw.key : registrationKey(product, kind, anchor),
      origin: raw.origin === "auto" ? "auto" : "manual",
      product: product,
      procedure: { kind: kind, rms: proc.rms || null, countries: countries },
      strengths: (typeof raw.strengths === "number" && raw.strengths >= 1) ? Math.floor(raw.strengths) : 1,
      tariffPicks: (raw.tariffPicks && typeof raw.tariffPicks === "object") ? raw.tariffPicks : {},
      coverage: (raw.coverage && raw.coverage.mode === "partial")
        ? { mode: "partial", fromQuarter: raw.coverage.fromQuarter || null }
        : { mode: "full", fromQuarter: null },
    };
  }

  function computeAnnualRollup(annualLines, countries, fxByCurrency) {
    var totalEur = 0, byMarket = {}, byProduct = {};
    (annualLines || []).forEach(function (row) {
      var res = computeAnnualRow(row, countries, fxByCurrency);
      totalEur += res.total;
      var product = row.product || "(unnamed product)";
      byProduct[product] = (byProduct[product] || 0) + res.total;
      res.byCountry.forEach(function (c) { byMarket[c.cc] = (byMarket[c.cc] || 0) + c.amountEur; });
    });
    return { totalEur: totalEur, byMarket: sortDesc(byMarket), byProduct: sortDesc(byProduct) };
  }
```

Update `defaultPlan`:

```javascript
  function defaultPlan() { return { version: 3, hoursPerHead: 1500, lines: [], annualLines: [] }; }
```

In `loadPlan`, after each `return`/`parsed` path that builds a plan, ensure `annualLines` exists and is normalized. Concretely, replace the two `return { version: 2, ... }` / `parsed` constructions so they carry annual lines. The simplest robust edit: at the end of `loadPlan`, before every successful return, funnel through a helper:

```javascript
  function withAnnual(plan, rawAnnual) {
    plan.version = 3;
    var arr = Array.isArray(rawAnnual) ? rawAnnual : [];
    plan.annualLines = arr.map(function (a, i) { return normalizeAnnualLine(a, "annual-recovered-" + i); });
    return plan;
  }
```

Then: the v1-migration branch → `return withAnnual({ version: 3, hoursPerHead: ..., lines: ... }, []);`; the old-v1-key branch likewise `[]`; the main parsed branch → `parsed = withAnnual(parsed, parsed.annualLines); return parsed;`. The `defaultPlan()` early returns already include `annualLines: []`.

Update `savePlan` callers are external (the view passes the object); no change needed in `savePlan` itself since it serializes whatever it's given. Add the three new functions to `api`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-annual-fees.js`
Expected: `All passed` (after correcting the `byMarket[0]` expectation to `"NL"`).

- [ ] **Step 5: Run the whole test suite (no regressions)**

Run: `node test/test-budget-engine.js && node test/test-submission.js && node test/test-additive-workload.js && node test/test-timeline.js && node test/test-annual-data.js && node test/test-annual-fees.js`
Expected: every file prints `All passed`.

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget-engine.js test/test-annual-fees.js
git commit -m "feat(budget): annual rollup + plan store migration v2->v3"
```

---

## Task 5: Render the two stacked tables

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css`

**Interfaces:**
- Consumes: `state.annualLines` (added here), `BUD.computeAnnualRow`, `VCL_ANNUAL_DATA.COUNTRIES`, an `fxByCurrency` built in the view.
- Produces: a rendered "Plan lines — Annual maintenance fees" section below the renamed "Plan lines — Variations" section, and an `fxByCurrency()` helper in the view.

> UI tasks are DOM-coupled and not Node-testable (see the spec and `test-budget-engine.js` header). Each UI task is verified in the browser harness `test/manual/budget-harness.html` with the text/JS browser tools, per project convention. Steps below use browser verification instead of unit tests.

- [ ] **Step 1: Load annual lines into view state**

In `vcl-budget.js`, where `plan` is loaded (`var plan = BUD.loadPlan(window.localStorage);`) and `state` is built (around line 130-132), add `annualLines: plan.annualLines || []` to `state`. In `saveState()` (line ~178), change the persisted object to include annual lines:

```javascript
    var ok = BUD.savePlan(window.localStorage, { version: 3, hoursPerHead: state.hoursPerHead, lines: state.lines, annualLines: state.annualLines });
```

- [ ] **Step 2: Add the FX helper**

Add near `fmtEUR` (line ~238) a helper that builds `{ ccy: unitsPerEur }` from the calculator's shipped rates, tolerant of absence under Node/tests:

```javascript
  // 1 EUR = X local units, keyed by ISO currency. Reuses the calculator's static FX table (and its
  // live-rate getter when present). EUR is implied (factor 1). Missing rate => that row shows local
  // only and contributes 0 to the EUR total (mirrors the engine).
  function fxByCurrency() {
    var out = {};
    var D = window.VCLCALC_DATA || {};
    var ccToCcy = D.CC_TO_CURRENCY || {};
    var staticFx = D.STATIC_FX_RATES || {};
    Object.keys(ccToCcy).forEach(function (cc) {
      var ccy = ccToCcy[cc];
      if (ccy && ccy !== "EUR" && staticFx[cc] && !out[ccy]) out[ccy] = staticFx[cc];
    });
    return out;
  }
```

> If `STATIC_FX_RATES` turns out to be keyed by currency rather than cc, adjust this mapping accordingly — confirm the shape in `vcl-calc-data.js` during implementation.

- [ ] **Step 3: Rename the variations heading**

Find the existing "Plan lines" heading render in `vcl-budget.js` (the `renderBrowse`/table section) and change its text to `"Plan lines — Variations"`. Leave the table body unchanged.

- [ ] **Step 4: Render the annual table**

Add a `renderAnnualTable()` that builds the second section: heading `"Plan lines — Annual maintenance fees"`, an `"+ Add product"` button (class `vcl-bud-btn` in `--budget`), a table with columns `[origin] · Product · registration | Markets | Str. | Special case / tariff | Annual fee | actions`, a footer `"Total annual (recurring / yr)"`, and the origin legend. For each row call `BUD.computeAnnualRow(row, window.VCL_ANNUAL_DATA.COUNTRIES, fxByCurrency())`. Render:
- origin icon: `🔗`/`link` glyph for `origin==="auto"`, `📌`/`pin` for `"manual"` (reuse the inline-SVG `ICON` pattern already in the file for row actions).
- product cell: `product` + muted `· MRP/DCP` / `· national` / `· CP` from `row.procedure.kind`.
- markets: country chips (reuse `.vcl-bud-cc-chip`), RMS highlighted; overflow `+N`.
- tariff cell: for each cc with `status==="needs-pick"` or a country having >1 tariff, a `<select>`; else muted `"auto"`.
- annual fee: `fmtEUR(res.total)`; if `!res.computable`, append a muted `"+ turnover-based"` note.
Call `renderAnnualTable()` right after the variations table is appended in the main render (`renderBrowse`, near line 540).

- [ ] **Step 5: Style the new section**

In `vcl-budget-style.css`, add rules for `.vcl-bud-annual` (section spacing), `.vcl-bud-annual__origin` (22px icon chip, `--budget` tint for auto / neutral for manual), `.vcl-bud-annual__track` (muted qualifier), and the tariff `<select>` (reuse the editor chip styling). Reuse existing table classes so the two tables look identical.

- [ ] **Step 6: Verify in the browser harness**

Seed `localStorage` with a v3 plan containing two manual annual rows (one AT national, one EU cp) via the harness console, reload `test/manual/budget-harness.html`, and confirm: both tables render with identical styling, the annual totals match hand-computed values, the origin legend shows, and no console errors. Capture the DOM via the read_page tool (screenshots are unreliable here).

- [ ] **Step 7: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): render Variations + Annual maintenance fees tables"
```

---

## Task 6: Auto-seed annual rows on variation-line save

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`

**Interfaces:**
- Consumes: `BUD.seedAnnualRowsFromSubmission`, `state.annualLines`, `state.lines`.
- Produces: on committing a variation line, any missing registration is appended to `state.annualLines`; existing keys are left untouched (no duplicates).

- [ ] **Step 1: Add the seeding helper**

In `vcl-budget.js`, add:

```javascript
  // After a variation line is saved, ensure each of its registrations exists once in the annual
  // table. Never duplicates (keyed by registrationKey); auto rows can later be edited/removed.
  function seedAnnualForLine(line) {
    if (!line || !line.product) return;
    var existing = {};
    state.annualLines.forEach(function (a) { existing[a.key] = true; });
    var seeds = BUD.seedAnnualRowsFromSubmission(line.submission, line.product);
    seeds.forEach(function (s) {
      if (!existing[s.key]) {
        s.id = "annual-" + Date.now() + "-" + Math.floor(Math.random() * 1e5);
        state.annualLines.push(s);
        existing[s.key] = true;
      }
    });
  }
```

- [ ] **Step 2: Call it from the variation-line commit path**

Find where a variation line is committed (the add/edit path that pushes/updates `state.lines` then calls `saveState()` — around lines 1477/1484). After the line is written to `state.lines` and before `saveState()`, call `seedAnnualForLine(line)` with the just-saved line object.

- [ ] **Step 3: Verify in the browser harness**

In `test/manual/budget-harness.html`: create a variation line "Aspirin Plus C" with a national DE procedure, save → one auto annual row appears (`· national`, 🔗). Add a *second* national DE line for the same product → **no** new annual row (same key). Add an MRP/DCP line (RMS DE) for the same product → a **separate** auto annual row (`· MRP/DCP`). Confirm counts via read_page.

- [ ] **Step 4: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget.js
git commit -m "feat(budget): auto-seed annual rows on variation-line save (dedup by key)"
```

---

## Task 7: "Add product" two-station editor

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css`

**Interfaces:**
- Consumes: the annual-row shape, `BUD.registrationKey`, `state.annualLines`.
- Produces: a takeover editor with Station A (Product) and Station B (Registration) that appends a `origin:"manual"` annual row (or opens the colliding row if the key already exists).

- [ ] **Step 1: Editor state + open/close**

Add an `annualEditor` state (`null` when closed, else `{ station: "A"|"B", draft: <annual row> }`) and open it from the "+ Add product" button (Task 5). The takeover replaces the dashboard like the existing line editor. `draft` defaults to `{ origin:"manual", product:"", procedure:{kind:"national", rms:null, countries:[]}, strengths:1, tariffPicks:{}, coverage:{mode:"full",fromQuarter:null} }`.

- [ ] **Step 2: Station stepper (A · B)**

Render a two-dot stepper in `--budget` (reuse the `vcl-bud-station`/`vcl-wf-station` dot+label pattern): `A Product`, `B Registration`. Forward gating: B reachable only when Station A's Product field is non-empty.

- [ ] **Step 3: Station A — Product**

Fields: Product (text) · Number of strengths (integer input, min 1) with the MRP/DCP skew warning copy verbatim: `"In MRP/DCP registrations, this single strengths figure is applied to every market — regardless of the strengths approved per CMS. May slightly skew the total."` · Budget year (select) · **Coverage this budget** (select: `Full year` → `coverage={mode:"full"}`; `Rest of year · from Q1..Q4` → `coverage={mode:"partial",fromQuarter:"Q"+n}`). Show a live line beneath: `"Prorated: <n> of 12 months → <pct>% of the full annual fee counts"` using `BUD.prorationFactor`.

- [ ] **Step 4: Station B — Registration**

Fields: Procedure kind chips (National / MRP/DCP / CP) · Markets — for national a single country picker (sets `procedure.countries=[cc]`); for MRP/DCP an RMS picker + CMS chips (`countries=[rms, ...cms]`); for CP a fixed `EU` chip (`countries=[]`, priced as EU). Per country with >1 tariff, a `<select>` writing `draft.tariffPicks[cc]`. Live fee preview via `BUD.computeAnnualRow(draft, COUNTRIES, fxByCurrency())`.

- [ ] **Step 5: Save with collision check**

On "Save product": recompute `draft.key` from `registrationKey(product, kind, anchor)` (anchor = national country / mrpdcp rms / ""). If a row with that key already exists in `state.annualLines`, prompt to open the existing row instead of adding a duplicate; otherwise assign an `id`, push to `state.annualLines`, `saveState()`, close the editor, re-render. "Cancel" (✕) discards.

- [ ] **Step 6: Style the editor**

Reuse the existing takeover/station/chip CSS; add only the coverage row and the strengths-warning styling (`--budget` amber-tint note).

- [ ] **Step 7: Verify in the browser harness**

Add a manual product with no variation (e.g. "Vitamin D3 forte", MRP/DCP RMS AT + CMS NL, 1 strength, Full year): a 📌 row appears with the correct total. Try adding a product whose key collides with an existing auto row → the collision prompt appears, no duplicate. Switch Coverage to "from Q3" → total halves. Confirm via read_page.

- [ ] **Step 8: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): Add product editor (Station A Product + B Registration)"
```

---

## Task 8: "Agency fees" dashboard box + rollup wiring + Excel export

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js`
- Modify: `variation-fee-calculator/assets/css/vcl-budget-style.css`

**Interfaces:**
- Consumes: `BUD.computeRollup` (variations, existing), `BUD.computeAnnualRollup` (annual), `state`.
- Produces: the combined "Agency fees" card replacing the standalone "Variation fees" tile; annual spend folded into the By-market/By-product panels; Excel export gains annual rows and a combined-total row.

- [ ] **Step 1: Compute the annual rollup in the render path**

In the main render (where `rollup` for variations is computed, ~line 540), also compute `var annualRollup = BUD.computeAnnualRollup(state.annualLines, window.VCL_ANNUAL_DATA.COUNTRIES, fxByCurrency());`.

- [ ] **Step 2: Replace the "Variation fees" tile with the "Agency fees" box (Proposal 2)**

In `renderRollupTiles(rollup)` (line ~253), replace the first tile with a card titled `"Agency fees · <year>"` containing three stacked rows and a divider:
- `Variations` → `fmtEUR(rollup.totals.fee)`
- `Annual fee` → `fmtEUR(annualRollup.totalEur) + " /yr"`
- divider, then `Total this year` → `fmtEUR(rollup.totals.fee + annualRollup.totalEur)` (bold).
Keep the "Annual RA hours" and "FTE required" tiles unchanged. Pass `annualRollup` into `renderRollupTiles` (add the parameter).

Row labels must read exactly **"Variations"**, **"Annual fee"**, **"Total this year"** (per spec). The `<year>` is the plan's budget year (reuse the header year logic already in the file).

- [ ] **Step 3: Fold annual spend into By-market / By-product**

Where the By-market / By-product panels render from `rollup.byMarket`/`byProduct`, merge in `annualRollup.byMarket`/`byProduct` (sum values by key, re-sort desc). Keep it a single combined view (agency spend by market/product), matching the spec.

- [ ] **Step 4: Extend the Excel export**

In the export builder (~line 1504): rename the variation sheet's fee header to make clear it is one-off; add an **Annual maintenance fees** sheet (Product, Registration/track, Markets, Strengths, Special case, Annual fee EUR, Coverage) built from `state.annualLines` via `computeAnnualRow`; and in the rollup sheet add rows `["Annual fees (EUR/yr)", annualRollup.totalEur]` and `["Total agency spend this year (EUR)", rollup.totals.fee + annualRollup.totalEur]`. Reuse the existing SheetJS code path.

- [ ] **Step 5: Style the Agency-fees box**

In `vcl-budget-style.css`, add `.vcl-bud-agency` (card, `--budget` border), row layout (`space-between`, mono values), and the `Total this year` divider/emphasis.

- [ ] **Step 6: Verify in the browser harness**

With both a variation line and an annual row present: the Agency-fees box shows Variations, Annual fee `/yr`, and Total this year = their sum; By-market/By-product include annual spend; Excel export contains the new sheet and rollup rows. Confirm the numbers against the engine tests' hand values via read_page + the exported file.

- [ ] **Step 7: Rebuild the ZIP and run the full suite**

Run: `python build_zip.py`
Then: `node test/test-annual-data.js && node test/test-annual-fees.js && node test/test-budget-engine.js && node test/test-submission.js`
Expected: `OK` from the packager and `All passed` from every test file.

- [ ] **Step 8: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/css/vcl-budget-style.css
git commit -m "feat(budget): Agency fees dashboard box + annual rollup + Excel export"
```

---

## Self-Review

**Spec coverage:**
- Two separate tables + rename → Task 5. ✓
- Registration-keyed dedup (national per-country, MRP/DCP per-RMS, CP) → Tasks 2, 6. ✓
- Two origins (auto-seed / manual Add product), no global switch → Tasks 6, 7. ✓
- Reference data module (48 rows, role split, addStrength null, local currency, multi-tariff, no-annual, turnover) → Task 1. ✓
- Strengths (one global figure), tariff pick, currency conversion, proration → Task 3. ✓
- Rollup + store migration v2→v3 → Task 4. ✓
- "Agency fees" box (Proposal 2, labels "Variations"/"Annual fee"/"Total this year"), By-market/product, Excel → Task 8. ✓
- Add-product editor (Station A Product incl. coverage/proration + strengths warning, Station B Registration) → Task 7. ✓
- Testing (pure funcs in Node; UI via browser harness) → tests in Tasks 1–4, harness checks in 5–8. ✓
- Wiring (lookup.php register + deps + enqueue, build_zip FILES) → Task 1. ✓

**Placeholder scan:** No "TBD/TODO". The remaining-countries list in Task 1 Step 3 is an explicit transcription instruction with exact figures in the spec's data table, not a placeholder. UI tasks intentionally use browser-harness verification (documented reason) instead of unit tests.

**Type consistency:** `registrationKey(product, kind, anchor)`, `seedAnnualRowsFromSubmission(submission, product)`, `computeAnnualRow(row, countries, fxByCurrency)`, `computeAnnualRollup(annualLines, countries, fxByCurrency)`, `prorationFactor(coverage)`, `normalizeAnnualLine(raw, fallbackId)` — names and signatures match across Tasks 2–8 and the view calls. Annual-row shape (`{id,key,origin,product,procedure:{kind,rms,countries},strengths,tariffPicks,coverage}`) is identical in seeding, normalization, computation, and the editor. Persisted payload `{version:3, hoursPerHead, lines, annualLines}` matches between `saveState` (Task 5), `defaultPlan`/`loadPlan` (Task 4).

**Open confirmation for the implementer:** verify the exact key shape of `STATIC_FX_RATES` / `CC_TO_CURRENCY` in `vcl-calc-data.js` (Task 5 Step 2) and the precise variation-line commit call sites in `vcl-budget.js` (Task 6 Step 2) before editing — both are noted inline.
