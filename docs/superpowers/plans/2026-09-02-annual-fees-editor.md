# Jahresgebühren im Gebühren-Editor — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jahresgebühren lassen sich im Gebühren-Editor in wp-admin pflegen, mit demselben Overlay-Mechanismus wie die Variation-Gebühren.

**Architecture:** `assets/js/vcl-annual-data.js` bleibt unveränderte Baseline aus der Excel. Ein neuer Zweig `annual` in der Option `vcl_fee_overrides` speichert nur abweichende `base`/`addStrength`-Werte. Ein neues Mini-Modul `vcl-annual-overrides.js` legt sie zur Laufzeit idempotent über die Baseline, bevor `vcl-budget-engine.js` sie liest. Damit PHP die Struktur validieren kann, schreibt `convert-annual-fees.py` denselben Datenbestand zusätzlich als JSON.

**Tech Stack:** PHP (WordPress-Plugin), Vanilla JS (ES5-Stil, IIFE + Dual-Export), Python 3 (Konverter), Node (Unit-Tests ohne Framework), pytest (Konverter-Tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-02-annual-fees-editor-design.md` — bei Widerspruch gilt die Spec.
- Plugin-Wurzel: `D:\Claude\Variation Fee Calculator\variation-fee-calculator\`. Repo-Wurzel eine Ebene darüber. Alle Pfade unten sind relativ zur **Repo-Wurzel**.
- Editierbar sind ausschließlich `base` und `addStrength`. Labels, Rollen, Währung, `hasAnnual`, `turnoverBased`, `note`, `isDefault` sind fest.
- `addStrength` ist nur zulässig, wenn der ausgelieferte Tarif dort **nicht** `null` hat.
- `assets/js/vcl-annual-data.js` wird **nicht** von Hand editiert (Datei trägt „DO NOT EDIT BY HAND").
- Das Overlay ist sparse: ein Wert gleich dem ausgelieferten wird nicht gespeichert.
- JS im Stil der Nachbardateien: `"use strict"`, `var`, IIFE, Dual-Export (`module.exports` + `root.X`). Kein ES6+, kein Build-Schritt.
- Code-Kommentare und Commit-Messages auf Englisch, UI-Texte auf Deutsch.
- Commit-Messages nach Conventional Commits.
- `Version:`-Header in `variation-fee-calculator/variation-fee-calculator.php` und die Konstante `VFC_VERSION` werden mit der Änderung hochgezählt (Task 7).
- **PHP ist auf diesem Rechner nicht installiert.** PHP-Tasks werden nicht lokal ausgeführt, sondern in Task 7 auf dem NAS geprüft. Node- und Python-Tests laufen lokal.
- Tests werden aus der **Repo-Wurzel** gestartet: `node test/<datei>.js`, `python -m pytest tests/<datei>.py -v`.

## Dateien

**Neu:**
- `variation-fee-calculator/assets/data/annual-fees.json` — generiert (Task 1)
- `variation-fee-calculator/assets/js/vcl-annual-overrides.js` — Overlay-Modul (Task 2)
- `test/test-annual-overrides.js` — Node-Test dazu (Task 2)
- `tests/test_annual_fees_json.py` — pytest für den JSON-Export (Task 1)

**Geändert:**
- `variation-fee-calculator/convert-annual-fees.py` — schreibt zusätzlich JSON (Task 1)
- `variation-fee-calculator/includes/lookup.php` — Skript registrieren, `annual` mitdrucken (Task 3)
- `variation-fee-calculator/includes/fee-editor.php` — Struktur lesen, validieren, zählen, exportieren/importieren, Editor-Seite (Tasks 4, 6)
- `variation-fee-calculator/assets/js/vcl-fee-editor.js` — UI-Block, Zähler, Payload (Task 5)
- `variation-fee-calculator/assets/css/vcl-fee-editor.css` — Stile für den Block (Task 5)
- `variation-fee-calculator/variation-fee-calculator.php` — Version (Task 7)

---

### Task 1: Konverter schreibt die Struktur zusätzlich als JSON

PHP kann die generierte `.js` nicht lesen, braucht die Struktur aber zum Validieren. Derselbe Konverterlauf schreibt sie deshalb zusätzlich als JSON — ein Lauf, zwei Dateien, die nicht auseinanderlaufen können.

**Files:**
- Modify: `variation-fee-calculator/convert-annual-fees.py` (neue Funktion + Aufruf in `main()`)
- Create: `tests/test_annual_fees_json.py`
- Create (generiert): `variation-fee-calculator/assets/data/annual-fees.json`

**Interfaces:**
- Consumes: `build_countries(rows)` liefert `countries` als Liste von Dicts mit den Schlüsseln `cc`, `hasAnnual`, `turnoverBased`, `note`, `tariffs`; jeder Tarif hat `id`, `label`, `role`, `base`, `addStrength`, `ccy` und optional `isDefault`.
- Produces: `render_json(countries, fallback_fx, generated_date) -> str` sowie die Datei `assets/data/annual-fees.json` mit der Form `{"updated": "YYYY-MM-DD", "countries": [...], "fallbackFx": {...}}`.

- [ ] **Step 1: Test schreiben**

Neue Datei `tests/test_annual_fees_json.py`:

```python
"""The JSON twin of vcl-annual-data.js: same structure, readable from PHP."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "variation-fee-calculator"))

import importlib.util

spec = importlib.util.spec_from_file_location(
    "convert_annual_fees",
    Path(__file__).resolve().parents[1] / "variation-fee-calculator" / "convert-annual-fees.py",
)
caf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caf)


COUNTRIES = [
    {
        "cc": "AT",
        "hasAnnual": True,
        "turnoverBased": False,
        "note": "",
        "tariffs": [
            {"id": "rms", "label": "RMS", "role": "RMS", "base": 3965,
             "addStrength": 3965, "ccy": "EUR"},
        ],
    },
    {
        "cc": "IT",
        "hasAnnual": True,
        "turnoverBased": False,
        "note": "Annual fee per valid six-digit AIC",
        "tariffs": [
            {"id": "all", "label": "RMS/CMS/national", "role": None, "base": 1879,
             "addStrength": None, "ccy": "EUR", "isDefault": True},
        ],
    },
    {"cc": "DE", "hasAnnual": False, "turnoverBased": False, "note": "", "tariffs": []},
]


def parsed():
    return json.loads(caf.render_json(COUNTRIES, {"SEK": 11.0}, "2026-09-02"))


def test_carries_the_generated_date():
    assert parsed()["updated"] == "2026-09-02"


def test_keeps_every_country_including_those_without_a_fee():
    codes = [c["cc"] for c in parsed()["countries"]]
    assert codes == ["AT", "IT", "DE"]


def test_keeps_the_tariff_fields_php_validates_against():
    at = parsed()["countries"][0]
    assert at["tariffs"][0]["id"] == "rms"
    assert at["tariffs"][0]["base"] == 3965
    assert at["tariffs"][0]["addStrength"] == 3965
    assert at["tariffs"][0]["ccy"] == "EUR"


def test_keeps_null_addstrength_as_null():
    it = parsed()["countries"][1]
    assert it["tariffs"][0]["addStrength"] is None


def test_carries_the_fallback_fx():
    assert parsed()["fallbackFx"] == {"SEK": 11.0}


def test_is_valid_utf8_json_with_umlauts_intact():
    out = caf.render_json(
        [{"cc": "SE", "hasAnnual": True, "turnoverBased": False,
          "note": "Gebühr je Stärke", "tariffs": []}],
        {}, "2026-09-02",
    )
    assert "Gebühr je Stärke" in out
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `python -m pytest tests/test_annual_fees_json.py -v`
Expected: FAIL mit `AttributeError: module 'convert_annual_fees' has no attribute 'render_json'`

- [ ] **Step 3: `render_json()` implementieren**

In `variation-fee-calculator/convert-annual-fees.py` direkt **hinter** `render_js(...)` einfügen:

```python
def render_json(countries, fallback_fx, generated_date):
    """The same structure as render_js(), as JSON.

    PHP cannot read the generated .js, but the fee editor has to validate what is
    typed against the shipped tariffs -- which country codes exist, which tariff
    ids a country has, and whether a tariff scales with the number of strengths.
    Written by the same run as the .js so the two cannot drift apart.
    """
    payload = {
        "updated": generated_date,
        "countries": countries,
        "fallbackFx": fallback_fx,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `python -m pytest tests/test_annual_fees_json.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: In `main()` mitschreiben**

In `main()`, direkt **nach** der Zeile `output_path.write_text(js, encoding="utf-8")`, einfügen:

```python
    json_path = output_path.parent.parent / "data" / "annual-fees.json"
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(render_json(countries, fallback_fx, generated_date), encoding="utf-8")
```

Und in den abschließenden `print(...)`-Block als zusätzliche Zeile hinter `f"OK  {output_path}\n"`:

```python
        f"    + {json_path} (structure for the fee editor)\n"
```

- [ ] **Step 6: Konverter gegen die echte Excel laufen lassen**

Run (aus `variation-fee-calculator/`):

```bash
python convert-annual-fees.py "../Variation-Fee-Calculator-EU.xlsx"
```

Expected: Ausgabe endet mit `OK  assets/js/vcl-annual-data.js` plus der neuen `+ assets/data/annual-fees.json`-Zeile, und `33 countries`.

- [ ] **Step 7: Bestehende Annual-Tests prüfen (die .js darf sich nicht verändert haben)**

Run (aus der Repo-Wurzel):

```bash
git diff --stat variation-fee-calculator/assets/js/vcl-annual-data.js
```

Expected: **keine Ausgabe** (Datei unverändert — nur die JSON ist neu). Verändert sich die `.js` doch, hier stoppen und klären, statt weiterzumachen.

Run: `node test/test-annual-data.js`
Expected: `0 failures`

- [ ] **Step 8: Neue Datei in `build_zip.py` eintragen**

`build_zip.py` pflegt seine Dateiliste von Hand und bricht ab, sobald im Plugin-Ordner eine Datei liegt, die nicht in `FILES` steht. Ohne diesen Schritt lässt sich ab jetzt kein ZIP mehr bauen.

In `build_zip.py` in der Liste `FILES` direkt **vor** `"assets/js/vcl-annual-data.js",` einfügen:

```python
    "assets/data/annual-fees.json",
```

Prüfen:

```bash
python build_zip.py
```

Expected: Lauf endet mit `OK`, Dateizahl um 1 höher als zuvor, keine `ERROR unlisted files`-Zeile.

- [ ] **Step 9: Commit**

```bash
git add variation-fee-calculator/convert-annual-fees.py variation-fee-calculator/assets/data/annual-fees.json tests/test_annual_fees_json.py build_zip.py
git commit -m "feat(annual): emit the annual-fee structure as JSON for the fee editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Overlay-Modul `vcl-annual-overrides.js`

Legt die gespeicherten Beträge über die ausgelieferten. Muss idempotent sein, weil die Live-Vorschau des Editors dieselbe Kette mehrfach durchläuft.

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-annual-overrides.js`
- Create: `test/test-annual-overrides.js`

**Interfaces:**
- Consumes: `window.VCL_ANNUAL_DATA.COUNTRIES` (aus `vcl-annual-data.js`), `window.VCLCALC_OVERRIDES.annual` (aus PHP bzw. dem Editor).
- Produces: `window.VCL_ANNUAL_OVERRIDES` mit `apply() -> number` (Anzahl angewandter Werte) und `shipped() -> { <cc>: { <tariffId>: { base, addStrength } } }` (die ausgelieferten Werte, die der Editor zum Vergleich braucht).

- [ ] **Step 1: Test schreiben**

Neue Datei `test/test-annual-overrides.js`:

```js
// Node unit tests for the annual-fee overlay (vcl-annual-overrides.js).
// Run from the project root:  node test/test-annual-overrides.js
"use strict";
global.window = {};
require("../variation-fee-calculator/assets/js/vcl-annual-data.js");
var OV = require("../variation-fee-calculator/assets/js/vcl-annual-overrides.js");
var D = global.window.VCL_ANNUAL_DATA;

var failures = 0;
function ok(cond, msg) {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (!cond) failures++;
}
function byCc(cc) {
  return D.COUNTRIES.filter(function (c) { return c.cc === cc; })[0];
}
function tariff(cc, id) {
  return (byCc(cc).tariffs || []).filter(function (t) { return t.id === id; })[0];
}

console.log("Annual overlay tests\n");

// --- shipped snapshot
var shipped = OV.shipped();
ok(shipped.AT && shipped.AT.rms.base === 3965, "snapshot keeps the shipped AT RMS base");
ok(shipped.IT.all.addStrength === null, "snapshot keeps a null addStrength as null");

// --- a plain override
global.window.VCLCALC_OVERRIDES = { annual: { AT: { rms: { base: 4100 } } } };
var n = OV.apply();
ok(tariff("AT", "rms").base === 4100, "AT RMS base takes the override");
ok(tariff("AT", "rms").addStrength === 3965, "AT RMS addStrength stays shipped");
ok(n === 1, "apply() reports one applied value");

// --- idempotent: applying twice changes nothing further
OV.apply();
ok(tariff("AT", "rms").base === 4100, "second apply leaves the value where it was");

// --- removing the override restores the shipped amount
global.window.VCLCALC_OVERRIDES = { annual: {} };
OV.apply();
ok(tariff("AT", "rms").base === 3965, "AT RMS base returns to the shipped amount");

// --- no overrides at all is not an error
delete global.window.VCLCALC_OVERRIDES;
OV.apply();
ok(tariff("AT", "rms").base === 3965, "missing VCLCALC_OVERRIDES leaves the data alone");

// --- addStrength is refused where the shipped tariff does not scale
global.window.VCLCALC_OVERRIDES = { annual: { IT: { all: { base: 2000, addStrength: 500 } } } };
OV.apply();
ok(tariff("IT", "all").base === 2000, "IT base takes the override");
ok(tariff("IT", "all").addStrength === null, "IT addStrength stays null (structure is fixed)");

// --- garbage is ignored, not applied
global.window.VCLCALC_OVERRIDES = {
  annual: { AT: { rms: { base: "viel" } }, XX: { nope: { base: 1 } }, SE: { ghost: { base: 1 } } }
};
OV.apply();
ok(tariff("AT", "rms").base === 3965, "a non-numeric amount is ignored");
ok(tariff("SE", "all").base === 60000, "an unknown tariff id changes nothing");

// --- negative amounts are ignored
global.window.VCLCALC_OVERRIDES = { annual: { AT: { rms: { base: -5 } } } };
OV.apply();
ok(tariff("AT", "rms").base === 3965, "a negative amount is ignored");

console.log("\n" + (failures ? failures + " FAILURES" : "0 failures"));
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node test/test-annual-overrides.js`
Expected: FAIL — `Cannot find module '../variation-fee-calculator/assets/js/vcl-annual-overrides.js'`

- [ ] **Step 3: Modul implementieren**

Neue Datei `variation-fee-calculator/assets/js/vcl-annual-overrides.js`:

```js
// Lays the amounts typed in the fee editor over the shipped annual-fee data.
//
// Same discipline as applyOverrides() in vcl-calc-app.js: a snapshot of the
// shipped amounts is taken once, every run resets to it and re-applies the
// overlay, so running this twice gives the same result as running it once. The
// editor's live preview relies on that.
//
// Only `base` and `addStrength` are overridable, and `addStrength` only where the
// shipped tariff actually scales with the number of strengths -- a tariff with
// `addStrength: null` does not, and turning that into a number would change the
// structure rather than an amount. Labels, roles, currency and the set of tariffs
// themselves stay with the generated data file.
(function (root) {
  "use strict";

  var SHIPPED = null;

  function data() {
    return (root && root.VCL_ANNUAL_DATA) || null;
  }

  function takeSnapshot() {
    var out = {};
    var d = data();
    if (!d || !Array.isArray(d.COUNTRIES)) return out;
    d.COUNTRIES.forEach(function (c) {
      var byId = {};
      (c.tariffs || []).forEach(function (t) {
        byId[t.id] = { base: t.base, addStrength: t.addStrength };
      });
      out[c.cc] = byId;
    });
    return out;
  }

  function shipped() {
    if (!SHIPPED) SHIPPED = takeSnapshot();
    return SHIPPED;
  }

  function usable(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
  }

  function apply() {
    var d = data();
    if (!d || !Array.isArray(d.COUNTRIES)) return 0;

    var base = shipped();
    var ov = (root.VCLCALC_OVERRIDES && root.VCLCALC_OVERRIDES.annual) || {};
    var applied = 0;

    d.COUNTRIES.forEach(function (c) {
      var shippedTariffs = base[c.cc] || {};
      var edits = ov[c.cc] || {};
      (c.tariffs || []).forEach(function (t) {
        var was = shippedTariffs[t.id] || {};
        // Start from the shipped state every time, so this is idempotent.
        t.base = was.base;
        t.addStrength = was.addStrength;

        var e = edits[t.id];
        if (!e || typeof e !== "object") return;
        if (usable(e.base)) { t.base = e.base; applied++; }
        if (was.addStrength !== null && usable(e.addStrength)) {
          t.addStrength = e.addStrength;
          applied++;
        }
      });
    });

    return applied;
  }

  var api = { apply: apply, shipped: shipped };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_ANNUAL_OVERRIDES = api;

  // Applies whatever PHP printed before this file ran, so a page that only
  // includes the scripts already sees the live amounts.
  apply();
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node test/test-annual-overrides.js`
Expected: `0 failures`

- [ ] **Step 5: Bestehende Annual-Tests gegenprüfen**

Run: `node test/test-annual-data.js && node test/test-annual-fees.js`
Expected: beide `0 failures`

- [ ] **Step 6: Neue Datei in `build_zip.py` eintragen**

`build_zip.py` pflegt seine Dateiliste von Hand und bricht ab, sobald im Plugin-Ordner eine Datei liegt, die nicht in `FILES` steht. Ohne diesen Schritt lässt sich ab jetzt kein ZIP mehr bauen.

In `build_zip.py` in der Liste `FILES` direkt **nach** `"assets/js/vcl-annual-data.js",` einfügen:

```python
    "assets/js/vcl-annual-overrides.js",
```

Prüfen:

```bash
python build_zip.py
```

Expected: Lauf endet mit `OK`, Dateizahl um 1 höher als zuvor, keine `ERROR unlisted files`-Zeile.

- [ ] **Step 7: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-annual-overrides.js test/test-annual-overrides.js build_zip.py
git commit -m "feat(annual): add the idempotent annual-fee overlay module

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend-Verdrahtung in `lookup.php`

Ohne diesen Task erreicht das Overlay das Budget-Tool nie.

**Files:**
- Modify: `variation-fee-calculator/includes/lookup.php:241-259` (Registrierung) und `:319-332` (Inline-Overrides)

**Interfaces:**
- Consumes: `vcl_get_fee_overrides()` aus `fee-editor.php` (liefert nach Task 4 zusätzlich den Schlüssel `annual`).
- Produces: registriertes Skript-Handle `vcl-annual-overrides`; `window.VCLCALC_OVERRIDES.annual` im Frontend.

- [ ] **Step 1: Skript registrieren**

In `variation-fee-calculator/includes/lookup.php`, direkt **nach** dem `wp_register_script( 'vcl-annual-data', ... );`-Block (endet Zeile 248), einfügen:

```php
	// Lays the fee editor's annual amounts over the generated data above. Depends
	// on vcl-calc-data as well, because that is the handle window.VCLCALC_OVERRIDES
	// is printed after -- without it this could run before the overlay exists.
	$annual_ov_file = VFC_PLUGIN_DIR . 'assets/js/vcl-annual-overrides.js';
	wp_register_script(
		'vcl-annual-overrides',
		VFC_PLUGIN_URL . 'assets/js/vcl-annual-overrides.js',
		array( 'vcl-annual-data', 'vcl-calc-data' ),
		file_exists( $annual_ov_file ) ? filemtime( $annual_ov_file ) : VFC_VERSION,
		true
	);
```

- [ ] **Step 2: Abhängigkeiten umhängen**

In der `wp_register_script( 'vcl-budget-engine', ... )`-Registrierung (Zeile ~253-259) das Abhängigkeits-Array

```php
		array( 'vcl-annual-data' ),
```

ersetzen durch:

```php
		array( 'vcl-annual-data', 'vcl-annual-overrides' ),
```

In der `wp_register_script( 'vcl-budget', ... )`-Registrierung (Zeile ~264-270) im Abhängigkeits-Array `'vcl-annual-data'` ersetzen durch `'vcl-annual-data', 'vcl-annual-overrides'`, sodass es lautet:

```php
		array( 'vcl-data', 'vcl-calc-app', 'vcl-workload-hours', 'vcl-workload-hours-data', 'vcl-annual-data', 'vcl-annual-overrides', 'vcl-budget-engine', 'vcl-submission', 'vcl-sg-logic' ),
```

- [ ] **Step 3: `annual` mitdrucken**

In `variation-fee-calculator/includes/lookup.php` den Block ab Zeile 320 ersetzen. Alt:

```php
	if ( $vcl_fee_overrides['rows'] || $vcl_fee_overrides['points']
		|| $vcl_fee_overrides['countries'] || $vcl_fee_overrides['imprint'] ) {
		wp_add_inline_script(
			'vcl-calc-data',
			'window.VCLCALC_OVERRIDES = ' . wp_json_encode( array(
				'rows'      => (object) $vcl_fee_overrides['rows'],
				'points'    => (object) $vcl_fee_overrides['points'],
				'countries' => (object) $vcl_fee_overrides['countries'],
				'imprint'   => array_values( $vcl_fee_overrides['imprint'] ),
			) ) . ';',
			'after'
		);
	}
```

Neu:

```php
	if ( $vcl_fee_overrides['rows'] || $vcl_fee_overrides['points']
		|| $vcl_fee_overrides['countries'] || $vcl_fee_overrides['imprint']
		|| $vcl_fee_overrides['annual'] ) {
		wp_add_inline_script(
			'vcl-calc-data',
			'window.VCLCALC_OVERRIDES = ' . wp_json_encode( array(
				'rows'      => (object) $vcl_fee_overrides['rows'],
				'points'    => (object) $vcl_fee_overrides['points'],
				'countries' => (object) $vcl_fee_overrides['countries'],
				'imprint'   => array_values( $vcl_fee_overrides['imprint'] ),
				'annual'    => (object) $vcl_fee_overrides['annual'],
			) ) . ';',
			'after'
		);
	}
```

- [ ] **Step 4: Prüfen, dass keine Stelle vergessen wurde**

Run (aus der Repo-Wurzel):

```bash
grep -rn "VCLCALC_OVERRIDES = " variation-fee-calculator/includes/
```

Expected: genau zwei Treffer — `lookup.php` (gerade geändert) und `fee-editor.php:319` (wird in Task 6 geändert).

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/includes/lookup.php
git commit -m "feat(annual): ship the annual overlay to the front end

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: PHP — Struktur lesen, validieren, zählen

Der Server muss wissen, welche Tarife es gibt, sonst kann er nichts prüfen.

**Files:**
- Modify: `variation-fee-calculator/includes/fee-editor.php` — `vcl_get_fee_overrides()` (Zeile 64), `vcl_sanitize_fee_overrides()` (Zeile 85), `vcl_count_fee_overrides()` (Zeile 206), Export (Zeile 550), Import (Zeile 615), Save (Zeile 521)

**Interfaces:**
- Consumes: `variation-fee-calculator/assets/data/annual-fees.json` (Task 1).
- Produces: `vcl_annual_fee_structure() -> array( '<CC>' => array( '<tariffId>' => bool ) )`, wobei der bool sagt, ob der Tarif mit der Zahl der Stärken skaliert (`addStrength !== null`). `vcl_get_fee_overrides()` liefert zusätzlich `annual`. `vcl_sanitize_fee_overrides()` liefert zusätzlich `$clean['annual']`.

- [ ] **Step 1: Strukturleser hinzufügen**

In `variation-fee-calculator/includes/fee-editor.php` direkt **nach** `vcl_fee_editable_fields()` (endet Zeile 53) einfügen:

```php
/**
 * Which annual-fee tariffs the plugin ships, as
 * array( '<CC>' => array( '<tariffId>' => bool ) ) where the bool says whether
 * that tariff scales with the number of strengths (addStrength !== null).
 *
 * Read from assets/data/annual-fees.json, written by the same converter run as
 * assets/js/vcl-annual-data.js -- PHP cannot read the generated .js, and a second
 * hand-maintained list here would drift from it within a release or two.
 *
 * Cached per request only. The file changes with a plugin update, and a longer
 * cache would then validate against tariffs that no longer exist; reading a
 * ~30 KB file once per request is cheaper than getting that wrong.
 */
function vcl_annual_fee_structure() {
	static $structure = null;
	if ( $structure !== null ) {
		return $structure;
	}

	$structure = array();
	$path      = VFC_PLUGIN_DIR . 'assets/data/annual-fees.json';
	if ( ! file_exists( $path ) ) {
		return $structure;
	}

	$raw  = file_get_contents( $path );
	$data = json_decode( (string) $raw, true );
	if ( ! is_array( $data ) || empty( $data['countries'] ) || ! is_array( $data['countries'] ) ) {
		return $structure;
	}

	foreach ( $data['countries'] as $country ) {
		if ( ! is_array( $country ) || empty( $country['cc'] ) ) {
			continue;
		}
		$tariffs = array();
		if ( ! empty( $country['tariffs'] ) && is_array( $country['tariffs'] ) ) {
			foreach ( $country['tariffs'] as $tariff ) {
				if ( ! is_array( $tariff ) || ! isset( $tariff['id'] ) ) {
					continue;
				}
				$tariffs[ (string) $tariff['id'] ] =
					array_key_exists( 'addStrength', $tariff ) && $tariff['addStrength'] !== null;
			}
		}
		$structure[ (string) $country['cc'] ] = $tariffs;
	}

	return $structure;
}
```

- [ ] **Step 2: `annual` in die Standardform aufnehmen**

In `vcl_get_fee_overrides()` das Default-Array ergänzen — aus:

```php
	return wp_parse_args( $saved, array(
		'rows'      => array(),
		'points'    => array(),
		'countries' => array(),
		'imprint'   => array(),
		'updated'   => '',
		'by'        => '',
	) );
```

wird:

```php
	return wp_parse_args( $saved, array(
		'rows'      => array(),
		'points'    => array(),
		'countries' => array(),
		'imprint'   => array(),
		'annual'    => array(),
		'updated'   => '',
		'by'        => '',
	) );
```

Außerdem den Doc-Block darüber (Zeilen 55-63) um eine Zeile ergänzen, vor `'updated' => ...`:

```php
 *        'annual' => array( '<CC>' => array( '<tariffId>' => array( 'base' => float,
 *                                                                   'addStrength' => float ) ) ),
```

- [ ] **Step 3: Validierung ergänzen**

In `vcl_sanitize_fee_overrides()` die Initialisierung von `$clean` (Zeile 87) ändern zu:

```php
	$clean   = array( 'rows' => array(), 'points' => array(), 'countries' => array(), 'imprint' => array(), 'annual' => array() );
```

Und direkt **vor** `return array( $clean, $dropped );` (Zeile 202) einfügen:

```php
	// Annual maintenance fees. Only amounts are editable, and only for tariffs the
	// plugin actually ships: an unknown country or tariff id is a leftover from an
	// older build, and addStrength on a tariff that does not scale with strengths
	// would change the structure rather than a value.
	if ( isset( $payload['annual'] ) && is_array( $payload['annual'] ) ) {
		$structure = vcl_annual_fee_structure();
		foreach ( $payload['annual'] as $cc => $tariffs ) {
			$code = sanitize_text_field( (string) $cc );
			if ( ! isset( $structure[ $code ] ) || ! is_array( $tariffs ) ) {
				$dropped++;
				continue;
			}
			$cc_clean = array();
			foreach ( $tariffs as $tariff_id => $fields ) {
				$tid = sanitize_text_field( (string) $tariff_id );
				if ( ! isset( $structure[ $code ][ $tid ] ) || ! is_array( $fields ) ) {
					$dropped++;
					continue;
				}
				$entry = array();
				foreach ( array( 'base', 'addStrength' ) as $key ) {
					if ( ! isset( $fields[ $key ] ) ) {
						continue;
					}
					if ( 'addStrength' === $key && ! $structure[ $code ][ $tid ] ) {
						$dropped++;
						continue;
					}
					if ( ! is_numeric( $fields[ $key ] ) ) {
						$dropped++;
						continue;
					}
					$num = (float) $fields[ $key ];
					if ( ! is_finite( $num ) || $num < 0 ) {
						$dropped++;
						continue;
					}
					$entry[ $key ] = $num;
				}
				if ( $entry ) {
					$cc_clean[ $tid ] = $entry;
				}
			}
			if ( $cc_clean ) {
				$clean['annual'][ $code ] = $cc_clean;
			}
		}
	}
```

- [ ] **Step 4: Zähler ergänzen**

In `vcl_count_fee_overrides()` direkt **vor** `return $n;` einfügen:

```php
	// Annual fees count like any other maintained amount: an installation whose
	// only edit is a Danish annual fee still has something to export and to clear.
	if ( ! empty( $overrides['annual'] ) && is_array( $overrides['annual'] ) ) {
		foreach ( $overrides['annual'] as $tariffs ) {
			foreach ( (array) $tariffs as $fields ) {
				$n += count( (array) $fields );
			}
		}
	}
```

- [ ] **Step 5: Speichern, Export, Import ergänzen**

In `vcl_handle_save_fee_overrides()` (Zeile ~521) dem `update_option`-Array hinter `'imprint' => $clean['imprint'],` hinzufügen:

```php
		'annual'    => $clean['annual'],
```

In `vcl_handle_import_fee_overrides()` (Zeile ~615) dem `update_option`-Array an derselben Stelle dieselbe Zeile hinzufügen:

```php
		'annual'    => $clean['annual'],
```

In `vcl_handle_export_fee_overrides()` (Zeile ~550) dem `$payload`-Array hinter `'imprint' => array_values( $overrides['imprint'] ),` hinzufügen:

```php
		'annual'    => (object) $overrides['annual'],
```

`vcl_handle_clear_fee_overrides()` und `vcl_handle_undo_import()` arbeiten auf der ganzen Option und brauchen keine Änderung.

- [ ] **Step 6: Gegenprüfen, dass nichts vergessen wurde**

Run (aus der Repo-Wurzel):

```bash
grep -n "'imprint'" variation-fee-calculator/includes/fee-editor.php
```

Expected: An jeder Stelle, wo `'imprint'` in einem Array steht, das die gesamte Option beschreibt (Defaults, `$clean`, Save, Import, Export, Enqueue-Blöcke), steht jetzt auch `'annual'`. Die beiden Enqueue-Stellen (Zeilen ~320 und ~331) folgen in Task 6 — hier nur notieren, nicht ändern.

- [ ] **Step 7: Syntax-Check ohne PHP-Interpreter**

Da lokal kein PHP installiert ist, wird die Datei stattdessen auf ausgewogene Klammern geprüft:

```bash
node -e "var s=require('fs').readFileSync('variation-fee-calculator/includes/fee-editor.php','utf8');var b=0,p=0;for(var i=0;i<s.length;i++){var c=s[i];if(c==='{')b++;if(c==='}')b--;if(c==='(')p++;if(c===')')p--;}console.log('braces',b,'parens',p)"
```

Expected: `braces 0 parens 0`

Der echte Syntax-Check passiert in Task 7 beim Hochladen auf das NAS.

- [ ] **Step 8: Commit**

```bash
git add variation-fee-calculator/includes/fee-editor.php
git commit -m "feat(annual): validate, count and carry annual fees in the overrides option

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Editor-UI — der Block „Jahresgebühr"

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-fee-editor.js` — Kopf (Zeile ~59), `renderCountry()` (Zeile 578), `applyToEngine()` (Zeile 435), `editCount()` (Zeile 243), `countryEdited()` (Zeile 239), Submit-Handler (Zeile 1573); neue Funktionen `annualSection()`, `annualFor()`, `setAnnualEdit()`, `annualEditCount()`
- Modify: `variation-fee-calculator/assets/css/vcl-fee-editor.css`

**Interfaces:**
- Consumes: `window.VCL_ANNUAL_DATA.COUNTRIES` und `.FALLBACK_FX`; `window.VCL_ANNUAL_OVERRIDES.shipped()` (Task 2); `VCLFE_CONFIG.overrides.annual` (Task 6); die vorhandenen Helfer `fmt()`, `parseAmount()`, `nearlyEqual()`, `euro`, `applyToEngine()`, `renderCountry()`, `renderPicker()`.
- Produces: `annual`-Zweig im gespeicherten Payload; `window.VCLCALC_OVERRIDES.annual` in der Live-Vorschau.

- [ ] **Step 1: Zustand und Datenzugriff anlegen**

In `variation-fee-calculator/assets/js/vcl-fee-editor.js` direkt **nach** `var pointEdits = deepCopy(saved.points || {});` (Zeile 61) einfügen:

```js
  // Annual maintenance fees. Same sparse shape as `edits` above, one level
  // deeper: annualEdits[cc][tariffId] = { base, addStrength }. The structure --
  // which tariffs a country has, what they are called, in which currency -- stays
  // with vcl-annual-data.js; only the two amounts are editable here.
  var annualEdits = deepCopy(saved.annual || {});
  var savedAnnual = deepCopy(saved.annual || {});
```

Und direkt **nach** `var COUNTRIES = Object.keys(COUNTRY_NAMES)...` (endet Zeile ~156) einfügen:

```js
  // ---- annual fees -------------------------------------------------------
  var ANNUAL = (window.VCL_ANNUAL_DATA && window.VCL_ANNUAL_DATA.COUNTRIES) || [];
  var ANNUAL_FX = (window.VCL_ANNUAL_DATA && window.VCL_ANNUAL_DATA.FALLBACK_FX) || {};

  function annualFor(cc) {
    return ANNUAL.filter(function (c) { return c.cc === cc; })[0] || null;
  }

  /** The shipped amount of a tariff, i.e. what "unchanged" means here. */
  function shippedAnnual(cc, tariffId) {
    var all = (window.VCL_ANNUAL_OVERRIDES && window.VCL_ANNUAL_OVERRIDES.shipped()) || {};
    return (all[cc] && all[cc][tariffId]) || {};
  }

  function annualValue(cc, tariffId, key) {
    var edit = annualEdits[cc] && annualEdits[cc][tariffId];
    if (edit && typeof edit[key] === 'number') return edit[key];
    var was = shippedAnnual(cc, tariffId);
    return was[key] === undefined ? null : was[key];
  }

  function annualEdited(cc, tariffId, key) {
    var edit = annualEdits[cc] && annualEdits[cc][tariffId];
    return !!(edit && typeof edit[key] === 'number');
  }

  function setAnnualEdit(cc, tariffId, key, value) {
    var was = shippedAnnual(cc, tariffId);
    if (value === null || nearlyEqual(value, was[key] === undefined ? null : was[key])) {
      if (annualEdits[cc] && annualEdits[cc][tariffId]) {
        delete annualEdits[cc][tariffId][key];
        if (!Object.keys(annualEdits[cc][tariffId]).length) delete annualEdits[cc][tariffId];
        if (!Object.keys(annualEdits[cc]).length) delete annualEdits[cc];
      }
    } else {
      if (!annualEdits[cc]) annualEdits[cc] = {};
      if (!annualEdits[cc][tariffId]) annualEdits[cc][tariffId] = {};
      annualEdits[cc][tariffId][key] = value;
    }
    applyToEngine();
  }

  function annualEditCount(cc) {
    var n = 0;
    Object.keys(annualEdits).forEach(function (code) {
      if (cc && code !== cc) return;
      Object.keys(annualEdits[code]).forEach(function (tid) {
        n += Object.keys(annualEdits[code][tid]).length;
      });
    });
    return n;
  }

  /** Rough euro equivalent for a non-euro annual amount, using the fallback rates
   *  the converter lifted out of the workbook's 'Exchange rates' sheet. Shown as an
   *  orientation next to the field, never as the maintained value. */
  function annualEuroHint(amount, ccy) {
    if (!ccy || ccy === 'EUR' || amount === null || amount === undefined) return null;
    var rate = ANNUAL_FX[ccy];
    if (!rate) return null;
    return 'ca. ' + euro.format(amount / rate);
  }
```

- [ ] **Step 2: Zähler einbeziehen**

`countryEdited()` und `editCount()` (Zeilen 239-247) komplett ersetzen. Alt:

```js
  function countryEdited(cc) {
    if (pointEdits[cc] !== undefined) return true;
    return rowsFor(cc).some(function (r) { return edits[r.row] && Object.keys(edits[r.row]).length; });
  }
  function editCount() {
    var n = Object.keys(pointEdits).length;
    Object.keys(edits).forEach(function (k) { n += Object.keys(edits[k]).length; });
    return n;
  }
```

Neu:

```js
  function countryEdited(cc) {
    if (pointEdits[cc] !== undefined) return true;
    if (annualEditCount(cc) > 0) return true;
    return rowsFor(cc).some(function (r) { return edits[r.row] && Object.keys(edits[r.row]).length; });
  }
  function editCount() {
    var n = Object.keys(pointEdits).length;
    Object.keys(edits).forEach(function (k) { n += Object.keys(edits[k]).length; });
    return n + annualEditCount(null);
  }
```

- [ ] **Step 3: Live-Vorschau versorgen**

In `applyToEngine()` (Zeile 435) die erste Zeile ersetzen. Alt:

```js
    window.VCLCALC_OVERRIDES = { rows: edits, points: pointEdits, countries: countryOverrides };
```

Neu:

```js
    window.VCLCALC_OVERRIDES = {
      rows: edits, points: pointEdits, countries: countryOverrides, annual: annualEdits
    };
    if (window.VCL_ANNUAL_OVERRIDES) window.VCL_ANNUAL_OVERRIDES.apply();
```

- [ ] **Step 4: Den Block rendern**

In `renderCountry()` die Zeile `main.appendChild(rulesSection(rows));` (Zeile 605) ersetzen durch:

```js
    main.appendChild(annualSection(activeCc));
    main.appendChild(rulesSection(rows));
```

Und direkt **nach** der Funktion `renderCountry()` (endet Zeile 606) einfügen:

```js
  // ---- annual fees -------------------------------------------------------
  // Sits below the per-role tables of the one-off variation fees and above the
  // rules box. Same country, same page: the recurring fee of a registration is
  // maintained where its variation fees are, not on a screen of its own.
  //
  // Rendered even where there is nothing to type. A country without an annual fee
  // and a country whose annual fee nobody entered look identical if the block is
  // simply left out -- and that ambiguity is what let these fees be forgotten in
  // the first place.
  function annualSection(cc) {
    var entry = annualFor(cc);
    var sec = document.createElement('section');
    sec.className = 'vclfe-group vclfe-annual';

    var head = document.createElement('div');
    head.className = 'vclfe-group__head';
    var h = document.createElement('h3');
    h.textContent = 'Jahresgebühr';
    head.appendChild(h);
    var p = document.createElement('p');
    p.textContent = 'Wiederkehrende Gebühr je Zulassung — nicht die einmalige Variation-Gebühr oben.';
    head.appendChild(p);
    sec.appendChild(head);

    if (!entry) {
      sec.appendChild(annualNote('Für dieses Land liegen keine Jahresgebühr-Daten vor.'));
      return sec;
    }
    if (!entry.hasAnnual) {
      sec.appendChild(annualNote('Keine Jahresgebühr.'));
      return sec;
    }
    if (!entry.tariffs || !entry.tariffs.length) {
      sec.appendChild(annualNote(
        (entry.note ? entry.note + '. ' : '')
        + 'Umsatz- bzw. mengenabhängig — lässt sich nicht als fester Betrag pflegen.'));
      return sec;
    }

    var card = document.createElement('div');
    card.className = 'vclfe-card';
    var scroll = document.createElement('div');
    scroll.className = 'vclfe-scroll';
    var table = document.createElement('table');

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    htr.appendChild(th('Tarif'));
    [['Grundbetrag', 'base'], ['Je weitere Stärke', 'addStrength']].forEach(function (pair) {
      var cell = th('', 'num');
      var name = document.createElement('span');
      name.className = 'vclfe-th__label';
      name.textContent = pair[0];
      var unitEl = document.createElement('span');
      unitEl.className = 'vclfe-th__unit';
      unitEl.textContent = entry.tariffs[0].ccy || 'EUR';
      cell.appendChild(name);
      cell.appendChild(unitEl);
      htr.appendChild(cell);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    entry.tariffs.forEach(function (t) {
      tbody.appendChild(annualRow(cc, t));
    });
    table.appendChild(tbody);

    scroll.appendChild(table);
    card.appendChild(scroll);
    sec.appendChild(card);

    if (entry.note) {
      var note = document.createElement('p');
      note.className = 'vclfe-legend';
      note.textContent = entry.note;
      sec.appendChild(note);
    }
    return sec;
  }

  function annualNote(text) {
    var box = document.createElement('div');
    box.className = 'vclfe-card vclfe-annual__note';
    box.textContent = text;
    return box;
  }

  function annualRow(cc, tariff) {
    var tr = document.createElement('tr');

    var tdLabel = document.createElement('td');
    tdLabel.className = 'vclfe-type';
    tdLabel.textContent = tariff.label;
    tr.appendChild(tdLabel);

    tr.appendChild(annualCell(cc, tariff, 'base'));
    tr.appendChild(annualCell(cc, tariff, 'addStrength'));
    return tr;
  }

  function annualCell(cc, tariff, key) {
    var td = document.createElement('td');
    td.className = 'num';

    // A tariff whose shipped addStrength is null does not scale with the number
    // of strengths. Offering an input there would invite a number that changes the
    // structure rather than an amount -- so the cell stays closed.
    if (key === 'addStrength' && shippedAnnual(cc, tariff.id).addStrength === null) {
      var dash = document.createElement('span');
      dash.className = 'vclfe-empty';
      dash.textContent = '—';
      dash.title = 'Skaliert nicht mit der Zahl der Stärken.';
      td.appendChild(dash);
      return td;
    }

    var value = annualValue(cc, tariff.id, key);
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'vclfe-amount'
      + (value === 0 ? ' is-zero' : '')
      + (annualEdited(cc, tariff.id, key) ? ' is-edited' : '');
    inp.value = fmt(value);
    inp.setAttribute('aria-label', tariff.label + ' — Jahresgebühr, '
      + (key === 'base' ? 'Grundbetrag' : 'je weitere Stärke'));
    inp.addEventListener('change', function () {
      var v = parseAmount(String(inp.value).trim());
      if (v === undefined || v === null || v < 0) {
        inp.classList.add('is-bad');
        return;
      }
      inp.classList.remove('is-bad');
      setAnnualEdit(cc, tariff.id, key, v);
      renderCountry();
      renderPicker();
    });
    td.appendChild(inp);

    var hint = annualEuroHint(value, tariff.ccy);
    if (hint) {
      var eurEl = document.createElement('span');
      eurEl.className = 'vclfe-annual__eur';
      eurEl.textContent = hint;
      td.appendChild(eurEl);
    }
    return td;
  }
```

- [ ] **Step 5: Payload ergänzen**

Im Submit-Handler (Zeile 1573) dem `JSON.stringify({ ... })`-Objekt hinter `points: pointEdits,` hinzufügen:

```js
        annual: annualEdits,
```

- [ ] **Step 6: „Verwerfen" berücksichtigen**

Im Reset-Handler (Zeile ~1613) direkt **nach** der Zeile

```js
    pointEdits = deepCopy(saved.points || {});
```

einfügen:

```js
    annualEdits = deepCopy(savedAnnual);
```

- [ ] **Step 7: CSS ergänzen**

Ans Ende von `variation-fee-calculator/assets/css/vcl-fee-editor.css` anfügen:

```css
/* Annual maintenance fees: same card as the variation-fee tables, but only two
   amount columns, so the table is left-aligned rather than stretched. */
.vclfe-annual table { width: auto; min-width: 32rem; }

.vclfe-annual__note {
  padding: 0.9rem 1.1rem;
  color: #5b6470;
  font-style: italic;
}

.vclfe-annual__eur {
  display: block;
  margin-top: 0.2rem;
  color: #7a828c;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 8: Syntaxprüfung**

Run (aus der Repo-Wurzel):

```bash
node --check variation-fee-calculator/assets/js/vcl-fee-editor.js
```

Expected: keine Ausgabe (Exit 0)

- [ ] **Step 9: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-fee-editor.js variation-fee-calculator/assets/css/vcl-fee-editor.css
git commit -m "feat(annual): add the annual-fee block to the fee editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Editor-Seite mit den Annual-Daten versorgen

Der Editor lädt bisher nur Calculator-Daten. Ohne diesen Task ist `ANNUAL` in Task 5 leer und jedes Land zeigt „Für dieses Land liegen keine Jahresgebühr-Daten vor."

**Files:**
- Modify: `variation-fee-calculator/includes/fee-editor.php` — `vcl_fee_editor_assets()` (Zeilen 309-334)

**Interfaces:**
- Consumes: `vcl_get_fee_overrides()` mit `annual` (Task 4), die Dateien aus Tasks 1-2.
- Produces: `window.VCL_ANNUAL_DATA`, `window.VCL_ANNUAL_OVERRIDES`, `VCLCALC_OVERRIDES.annual` und `VCLFE_CONFIG.overrides.annual` auf der Editor-Seite.

- [ ] **Step 1: Skripte laden**

In `vcl_fee_editor_assets()` die drei `wp_enqueue_script`-Aufrufe (Zeilen 309-314) ersetzen durch:

```php
	wp_enqueue_script( 'vcl-calc-data', $url . 'js/vcl-calc-data.js',
		array(), $ver( 'js/vcl-calc-data.js' ), true );
	wp_enqueue_script( 'vcl-calc-app', $url . 'js/vcl-calc-app.js',
		array( 'vcl-calc-data' ), $ver( 'js/vcl-calc-app.js' ), true );
	// The annual fees are maintained on this page too, so the editor needs the
	// reference data and the overlay that lays the saved amounts over it.
	wp_enqueue_script( 'vcl-annual-data', $url . 'js/vcl-annual-data.js',
		array(), $ver( 'js/vcl-annual-data.js' ), true );
	wp_enqueue_script( 'vcl-annual-overrides', $url . 'js/vcl-annual-overrides.js',
		array( 'vcl-annual-data', 'vcl-calc-data' ), $ver( 'js/vcl-annual-overrides.js' ), true );
	wp_enqueue_script( 'vcl-fee-editor', $url . 'js/vcl-fee-editor.js',
		array( 'vcl-calc-app', 'vcl-annual-overrides' ), $ver( 'js/vcl-fee-editor.js' ), true );
```

- [ ] **Step 2: `annual` in beide Übergaben aufnehmen**

Im `wp_add_inline_script( 'vcl-calc-data', ... )`-Aufruf (Zeile ~319) dem Array hinter `'imprint' => array_values( $overrides['imprint'] ),` hinzufügen:

```php
			'annual'    => (object) $overrides['annual'],
```

Im `wp_localize_script( 'vcl-fee-editor', 'VCLFE_CONFIG', ... )`-Aufruf (Zeile ~326) dem inneren `'overrides'`-Array an derselben Stelle dieselbe Zeile hinzufügen:

```php
			'annual'    => (object) $overrides['annual'],
```

- [ ] **Step 3: Klammern prüfen**

```bash
node -e "var s=require('fs').readFileSync('variation-fee-calculator/includes/fee-editor.php','utf8');var b=0,p=0;for(var i=0;i<s.length;i++){var c=s[i];if(c==='{')b++;if(c==='}')b--;if(c==='(')p++;if(c===')')p--;}console.log('braces',b,'parens',p)"
```

Expected: `braces 0 parens 0`

- [ ] **Step 4: Commit**

```bash
git add variation-fee-calculator/includes/fee-editor.php
git commit -m "feat(annual): load the annual data and overlay on the editor page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Version, Abnahme auf dem NAS, gepflanzter Gegentest

Erst hier läuft überhaupt zum ersten Mal PHP. Ein „funktioniert" vor diesem Task wäre nicht belegt.

**Files:**
- Modify: `variation-fee-calculator/variation-fee-calculator.php` (Header `Version:` und `VFC_VERSION`)

**Interfaces:**
- Consumes: alles aus Tasks 1-6.
- Produces: eine ZIP-Datei zum Upload und eine belegte Abnahme.

- [ ] **Step 1: Version hochzählen**

Aktuelle Version ablesen:

```bash
grep -n "Version:\|VFC_VERSION" variation-fee-calculator/variation-fee-calculator.php | head -5
```

Beide Stellen auf die nächste Minor-Version setzen (Feature, nicht Bugfix): aus `1.18.x` wird `1.19.0`. Beide Werte müssen identisch sein.

- [ ] **Step 2: Gesamte Testsuite laufen lassen**

```bash
node test/test-annual-data.js && node test/test-annual-overrides.js && node test/test-annual-fees.js && node test/test-budget-engine.js
```

Expected: jeweils `0 failures`

```bash
python -m pytest tests/ -q
```

Expected: keine Fehler

- [ ] **Step 3: ZIP bauen**

```bash
python build_zip.py
```

Expected: ZIP im Repo-Wurzelverzeichnis, Ausgabe nennt die neue Versionsnummer. Anschließend prüfen, dass die neue Datendatei drin ist:

```bash
unzip -l variation-fee-calculator.zip | grep -E "annual-fees.json|vcl-annual-overrides.js"
```

Expected: beide Dateien gelistet, mit Vorwärts-Schrägstrichen im Pfad (siehe `feedback-powershell-zip-backslash-bug`).

- [ ] **Step 4: Auf das NAS hochladen**

Upload durch den Nutzer (Testumgebung NAS, nicht Ionos). Nach dem Upload in wp-admin die Seite „Toolbox-Gebühren" öffnen.

Expected: Die Seite lädt ohne PHP-Fehler, und unter den Rollen-Tabellen steht der Block „Jahresgebühr".

- [ ] **Step 5: Den gepflanzten Ausschlag erzeugen**

Dies ist die eigentliche Abnahme. Ein „sieht unverändert aus" beweist nichts, solange nicht gezeigt ist, dass die Kette überhaupt etwas durchlässt.

1. Im Editor Österreich wählen, im Block „Jahresgebühr" den RMS-Grundbetrag von `3.965` auf `9.999` setzen, speichern.
2. Expected: Meldung „Gebühren gespeichert.", der Zähler oben nennt einen Wert mehr, **0 verworfene Werte**.
3. Budget-Tool öffnen, eine Planzeile mit einem Produkt in AT als RMS anlegen.
4. Expected: In der Tabelle „Annual maintenance fees" steht **9.999**, nicht 3.965.

Zeigt Schritt 4 weiterhin 3.965, ist die Kette unterbrochen — dann hier stoppen und debuggen, nicht weitermachen.

- [ ] **Step 6: Zurücksetzen und Gegenprobe**

1. Im Editor das Feld wieder auf `3.965` setzen, speichern.
2. Expected: Der Zähler geht um denselben Wert zurück (das Overlay ist sparse — ein Wert gleich dem ausgelieferten wird nicht gespeichert).
3. Budget-Tool neu laden.
4. Expected: wieder `3.965`.

- [ ] **Step 7: Die übrigen Fälle durchgehen**

- Deutschland wählen → Block zeigt „Keine Jahresgebühr.", keine Eingabefelder.
- Belgien wählen → Block zeigt die Notiz zur mengenabhängigen Gebühr, keine Eingabefelder.
- Italien wählen → Spalte „Je weitere Stärke" zeigt `—` und lässt sich nicht befüllen.
- Schweden wählen → Grundbetrag `60.000` und „Je weitere Stärke" `30.000` in SEK, mit EUR-Näherung darunter.
- Einen AT-Wert ändern, **Export** klicken → in der heruntergeladenen JSON steht ein `annual`-Block mit AT.
- Diese Datei wieder **importieren** → derselbe Wert steht danach im Editor.
- „Alle gespeicherten Änderungen löschen" → der Block zeigt wieder die ausgelieferten Beträge.

- [ ] **Step 8: Commit**

```bash
git add variation-fee-calculator/variation-fee-calculator.php
git commit -m "chore(release): bump to 1.19.0 for the annual-fee editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Memory und Obsidian nachziehen**

Nach bestandener Abnahme `fee-data-excel-ablösung.md` im Memory um die Jahresgebühren ergänzen und die Obsidian-Dokumentation aktualisieren. Ionos-Upload bleibt Sache des Nutzers.

---

## Offene Punkte für den Reviewer

- **Deckt sich mit der Spec bis auf einen Punkt:** Die Spec schlägt für die JSON-Struktur einen Transient vor; der Plan nutzt einen Per-Request-Cache (`static`). Grund: Ein Transient überlebt ein Plugin-Update und würde dann gegen Tarife validieren, die es nicht mehr gibt. Ein Dateizugriff pro Request ist billiger als dieser Fehler.
- **Nicht angefasst:** `changedSinceLoad()` (Zeile 271) speist den Vorschlagstext der Änderungshistorie und betrachtet weiterhin nur `rows`. Eine geänderte Jahresgebühr erzeugt also keinen automatischen Vorschlagstext — sie lässt sich von Hand eintragen. Bewusst klein gehalten; falls gewünscht, eigener Folgetask.
- **Nicht angefasst:** `FALLBACK_FX`, die öffentliche Fee-data-Seite, jede Struktur-Bearbeitung (siehe Nicht-Ziele der Spec).
