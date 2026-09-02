# Öffentliche Gebührenseite (Baustein E) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine öffentliche Seite im Fee Calculator, die je Land die geltenden Gebühren, ihre Herkunft und ihr Prüfdatum zeigt und eine Schnellrechnung mit denselben Sätzen anbietet.

**Architecture:** Die reine Logik (Metadaten je Land, Währung, Kursableitung, Zeilengruppierung) lebt in einem eigenständigen, mit `node --test` prüfbaren Modul `vcl-feedata.js` nach dem Vorbild von `vcl-sg-logic.js`. Die Darstellung kommt als neuer Schritt in `vcl-calc-app.js` dazu und nutzt dieselben Mount-Punkte (`contentEl.innerHTML`, `renderRail()`) wie die vier bestehenden Schritte. Gerechnet wird ausschließlich über `window.VCLCALC.computeFees`; es entsteht keine zweite Gebührenlogik.

**Tech Stack:** Vanilla JS (ES5-Stil in `vcl-*-logic`-Modulen, ES6 in der App), WordPress-PHP, Python 3.12 + openpyxl für `convert.py`, `node --test` und pytest für Tests.

## Global Constraints

- Sprache der Oberfläche: **Englisch**. Code-Kommentare und Commit-Messages Englisch, Antworten an den Nutzer Deutsch.
- **Version bei jeder Änderung hochzählen:** `Version:` in `variation-fee-calculator.php:5` **und** `VFC_VERSION` in `variation-fee-calculator.php:15`. Aktuell `1.12.0`; Ziel dieses Plans ist `1.13.0`.
- Kartenradius 12 px, innere Boxen 8 px, Felder 6 px, Chips und Tags `999px`.
- Alle CSS-Regeln bleiben unter `.vclcalc-app` gescopt. Keine Regel außerhalb dieses Selektors.
- `K` ist die **Gruppierungspauschale**, nicht „je weitere II". Spaltenüberschriften folgen der Excel-Kopfzeile: F = 1. Variation/1. Stärke, G = je weitere Stärke, H/I/J = je weitere IA/IB/II, K = Gruppierung.
- Nicht-Euro-Länder (`CC_TO_CURRENCY`: CZ, DK, HU, IS, NO, PL, SE, UK, RS, CH) zeigen die **Landeswährung als Voreinstellung**; der Euro-Wert ist die Ableitung.
- Kein `git commit` und kein `git push` ohne ausdrückliche Aufforderung des Nutzers. Die Commit-Schritte unten werden ausgeführt, wenn der Nutzer den Plan startet — er hat damit das Committen für diesen Plan freigegeben.
- Excel niemals mit openpyxl speichern (Zeichnungen gehen verloren); Lesen ist erlaubt.
- **Abweichung vom Spec, bewusst:** Der in E1 genannte Breadcrumb `Variation Toolbox › Fee Calculator › Fee data` entfällt. Die Seite lebt innerhalb der Toolbox, die ihre eigene Navigation oben trägt; ein zweiter Pfad daneben wäre doppelt. Statt des Breadcrumbs führt ein Button „Back to the calculator" zurück (Task 8, Step 2).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `variation-fee-calculator/convert.py` | Excel → `vcl-calc-data.js`. Erweiterung: Spalte C („comments") mitnehmen. |
| `variation-fee-calculator/assets/js/vcl-feedata.js` | **neu.** Reine Logik der Gebührenseite: Metadaten je Land zusammenführen, Währung bestimmen, Kurs ableiten, Zeilen nach Rolle gruppieren. Kein DOM, `module.exports` + `window`-Export wie `vcl-sg-logic.js`. |
| `tests/vcl-feedata.test.mjs` | **neu.** `node --test` für obiges Modul. |
| `variation-fee-calculator/assets/js/vcl-calc-app.js` | Neuer Schritt `feedata`: Chips, Kopfzeile, Tabellen, Klartext, Schnellrechnung, Währungspille. |
| `variation-fee-calculator/assets/css/vcl-calc-style.css` | Stile für die neue Seite. |
| `variation-fee-calculator/includes/fee-editor.php` | Overrides um einen `countries`-Zweig erweitern (`checked`, `source`). |
| `variation-fee-calculator/assets/js/vcl-fee-editor.js` | Drei Felder je Land im Editor. |
| `variation-fee-calculator/includes/lookup.php` | Den neuen Zweig ins Inline-Script `window.VCLCALC_OVERRIDES` aufnehmen. |
| `tests/test_convert_ha_comments.py` | **neu.** pytest für die Konverter-Erweiterung. |

---

### Task 1: `convert.py` nimmt die Quellenangabe mit

**Files:**
- Modify: `variation-fee-calculator/convert.py:348-384` (Funktion, die `HA fee websites` liest)
- Test: `tests/test_convert_ha_comments.py`

**Interfaces:**
- Produces: Jeder Eintrag in `HA_WEBSITES` trägt zusätzlich `"comments": <string|null>`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Neue Datei `tests/test_convert_ha_comments.py`:

```python
"""The HA sheet's comments column carries the source reference per country
(e.g. Italy: 'Elenco Tariffe aggiornato ad Luglio 2025'). It used to be
dropped on purpose; the public fee page needs it."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "Variation-Fee-Calculator-EU.xlsx"


def load_convert():
    path = ROOT / "variation-fee-calculator" / "convert.py"
    spec = importlib.util.spec_from_file_location("vcl_convert", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_ha_entries_carry_the_comments_column():
    convert = load_convert()
    entries = convert.load_ha_websites(XLSX)

    assert len(entries) == 33
    assert all("comments" in e for e in entries)

    italy = next(e for e in entries if e["cc"] == "IT")
    assert italy["comments"] == "Elenco Tariffe aggiornato ad Luglio 2025"


def test_every_country_has_a_source_reference():
    convert = load_convert()
    entries = convert.load_ha_websites(XLSX)
    missing = [e["cc"] for e in entries if not e["comments"]]
    assert missing == []
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd "D:/Claude/Variation Fee Calculator" && python -m pytest tests/test_convert_ha_comments.py -v`
Expected: FAIL — `KeyError: 'comments'` bzw. `assert 'comments' in e`.

Falls der Test stattdessen mit `AttributeError: module has no attribute 'load_ha_websites'` scheitert: den tatsächlichen Funktionsnamen mit `grep -n "def load_ha" variation-fee-calculator/convert.py` ermitteln und im Test einsetzen.

- [ ] **Step 3: Die Spalte mitnehmen**

In `variation-fee-calculator/convert.py` im Docstring der Funktion die Klammer `C = comments (intentionally excluded)` ersetzen durch `C = comments (source reference, shown on the public fee page)` und den Eintrag ergänzen:

```python
        entries.append({
            "cc": cc,
            "link_text": link_text,
            "link_url": link_url,
            "comments": ws_vals.cell(row=r, column=3).value,
            "updated_calc": fmt_date(ws_vals.cell(row=r, column=4).value),
            "checked_ha": fmt_date(ws_vals.cell(row=r, column=5).value),
            "payment": ws_vals.cell(row=r, column=6).value,
            "annual": ws_vals.cell(row=r, column=7).value,
        })
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd "D:/Claude/Variation Fee Calculator" && python -m pytest tests/test_convert_ha_comments.py -v`
Expected: PASS, 2 passed.

- [ ] **Step 5: Datendatei chirurgisch ergänzen — NICHT neu erzeugen**

**GEFAHR:** `python convert.py` über die ausgelieferte Datei laufen zu lassen ist zerstörend.
Die Datei wird seit Commit `856712f` von Hand mitgepflegt und trägt `POINT_VALUES`
(Slowenien-Punktwert), die `F_pt..V_pt`-Punktspalten und die `T/U/V`-Deckel-/Zuschlagsspalten,
die der Konverter alle nicht erzeugt. Erledigt in Commit `b3cc788`; dieser Schritt ist damit
abgeschlossen und dient nur noch der Dokumentation.

Run: `cd "D:/Claude/Variation Fee Calculator/variation-fee-calculator" && python convert.py`
Danach: `git diff --stat assets/js/vcl-calc-data.js`

Expected: Genau eine Datei geändert. Zur Kontrolle:
`grep -o '"cc":"IT","link_text":"AIFA"[^}]*' assets/js/vcl-calc-data.js`
muss `"comments":"Elenco Tariffe aggiornato ad Luglio 2025"` enthalten.

**Wichtig:** Es dürfen sich **keine Beträge** ändern. Prüfen mit:
`git diff assets/js/vcl-calc-data.js | grep -E '^[-+].*"F":' | head`
Expected: keine Ausgabe.

- [ ] **Step 6: Commit**

```bash
git add tests/test_convert_ha_comments.py variation-fee-calculator/convert.py variation-fee-calculator/assets/js/vcl-calc-data.js
git commit -m "feat: carry the HA sheet's source reference into HA_WEBSITES"
```

---

### Task 2: Reines Logikmodul `vcl-feedata.js`

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-feedata.js`
- Test: `tests/vcl-feedata.test.mjs`

**Interfaces:**
- Consumes: `HA_WEBSITES` mit `comments` aus Task 1.
- Produces:
  - `countryMeta(cc, haEntries, ccToCurrency, overrides)` → `{cc, currency, checked, edited, source, linkText, linkUrl, payment}`; `currency` ist `null` für Euro-Länder.
  - `deriveRate(rows)` → `number|null`. Kurs aus dem ersten Paar `F`/`F_lc` (oder `K`/`K_lc`), auf 5 Nachkommastellen gerundet.
  - `groupByRole(rows)` → `[{role, rows}]` in der Reihenfolge `RMS`, `CMS`, `national`, danach alles Übrige alphabetisch.
  - `chipList(countryNames, rows)` → `[{cc, name, n}]`, alphabetisch nach `name`, nur Länder mit mindestens einer Zeile.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Neue Datei `tests/vcl-feedata.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const F = require("../variation-fee-calculator/assets/js/vcl-feedata.js");

const HA = [
  { cc: "IT", link_text: "AIFA", link_url: "https://www.aifa.gov.it/tariffe",
    comments: "Elenco Tariffe aggiornato ad Luglio 2025",
    updated_calc: "2026-05-11", checked_ha: "2026-05-11", payment: "proof of payment" },
  { cc: "DK", link_text: "DKMA", link_url: "https://x/dk", comments: "Takstbekendtgorelse 2026",
    updated_calc: "2026-01-09", checked_ha: "2026-05-11", payment: "invoice" }
];
const CUR = { DK: "DKK", NO: "NOK" };

test("countryMeta: euro country has no currency", () => {
  const m = F.countryMeta("IT", HA, CUR, null);
  assert.equal(m.currency, null);
  assert.equal(m.checked, "2026-05-11");
  assert.equal(m.source, "Elenco Tariffe aggiornato ad Luglio 2025");
  assert.equal(m.linkText, "AIFA");
  assert.equal(m.payment, "proof of payment");
});

test("countryMeta: non-euro country reports its currency", () => {
  assert.equal(F.countryMeta("DK", HA, CUR, null).currency, "DKK");
});

test("countryMeta: an override wins over the shipped value", () => {
  const ov = { countries: { IT: { checked: "2026-08-30", source: "Nuovo decreto" } } };
  const m = F.countryMeta("IT", HA, CUR, ov);
  assert.equal(m.checked, "2026-08-30");
  assert.equal(m.source, "Nuovo decreto");
  assert.equal(m.linkText, "AIFA", "an override must not disturb the shipped link");
});

test("countryMeta: an unknown country yields empty fields, never a throw", () => {
  const m = F.countryMeta("ZZ", HA, CUR, null);
  assert.equal(m.checked, "");
  assert.equal(m.source, "");
  assert.equal(m.linkUrl, "");
});

test("deriveRate: reads the rate off a local-currency row", () => {
  const rows = [{ F: 1054.1116911542383, F_lc: 7879 }];
  assert.equal(F.deriveRate(rows), 7.47454);
});

test("deriveRate: falls back to the grouping column when F is empty", () => {
  const rows = [{ F: null, F_lc: null, K: 1342.1561728213376, K_lc: 10032 }];
  assert.equal(F.deriveRate(rows), 7.47454);
});

test("deriveRate: a euro-only country has no rate", () => {
  assert.equal(F.deriveRate([{ F: 1055, F_lc: null }]), null);
});

test("groupByRole: RMS, CMS, national — in that order", () => {
  const rows = [
    { role: "national", type: "IA" }, { role: "CMS", type: "IA" }, { role: "RMS", type: "IA" }
  ];
  assert.deepEqual(F.groupByRole(rows).map(g => g.role), ["RMS", "CMS", "national"]);
});

test("groupByRole: an unexpected role is kept, sorted after the three known ones", () => {
  const rows = [{ role: "worksharing" }, { role: "RMS" }];
  assert.deepEqual(F.groupByRole(rows).map(g => g.role), ["RMS", "worksharing"]);
});

test("chipList: alphabetical, counts rows, skips countries without rows", () => {
  const names = { IT: "Italy", AT: "Austria", ZZ: "Nowhere" };
  const rows = [{ cc: "IT" }, { cc: "IT" }, { cc: "AT" }];
  assert.deepEqual(F.chipList(names, rows), [
    { cc: "AT", name: "Austria", n: 1 },
    { cc: "IT", name: "Italy", n: 2 }
  ]);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd "D:/Claude/Variation Fee Calculator" && node --test tests/vcl-feedata.test.mjs`
Expected: FAIL — `Cannot find module '.../vcl-feedata.js'`.

- [ ] **Step 3: Das Modul schreiben**

Neue Datei `variation-fee-calculator/assets/js/vcl-feedata.js`:

```javascript
'use strict';
/**
 * Pure helpers for the public fee-data page. No DOM, no globals of its own, so
 * it can be unit-tested with node --test like vcl-sg-logic.js. Everything that
 * needs the fee engine goes through window.VCLCALC instead of living here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.VCL_FEEDATA = api; }
}(typeof window !== 'undefined' ? window : null, function () {

  var ROLE_ORDER = ['RMS', 'CMS', 'national'];

  /** The metadata strip above a country's tables: dates, source, authority,
   *  payment method. Overrides win over the shipped HA_WEBSITES entry, but only
   *  for the two fields the editor actually maintains. */
  function countryMeta(cc, haEntries, ccToCurrency, overrides) {
    var entry = null;
    for (var i = 0; i < (haEntries || []).length; i++) {
      if (haEntries[i].cc === cc) { entry = haEntries[i]; break; }
    }
    var ov = (overrides && overrides.countries && overrides.countries[cc]) || {};
    return {
      cc: cc,
      currency: (ccToCurrency && ccToCurrency[cc]) || null,
      checked: ov.checked || (entry && entry.checked_ha) || '',
      edited: ov.updated || (entry && entry.updated_calc) || '',
      source: ov.source || (entry && entry.comments) || '',
      linkText: (entry && entry.link_text) || '',
      linkUrl: (entry && entry.link_url) || '',
      payment: (entry && entry.payment) || ''
    };
  }

  /** The euro amounts are derived from the local ones, so the rate can be read
   *  back off any row that carries both. Five decimals is what the source data
   *  actually resolves to (Denmark: 7.47454 across every row). */
  function deriveRate(rows) {
    var pairs = [['F', 'F_lc'], ['K', 'K_lc'], ['H', 'H_lc'], ['I', 'I_lc'], ['J', 'J_lc']];
    for (var i = 0; i < (rows || []).length; i++) {
      for (var p = 0; p < pairs.length; p++) {
        var eur = rows[i][pairs[p][0]], lc = rows[i][pairs[p][1]];
        if (typeof eur === 'number' && eur > 0 && typeof lc === 'number' && lc > 0) {
          return Math.round((lc / eur) * 100000) / 100000;
        }
      }
    }
    return null;
  }

  /** One section per procedure role, in the order the calculator uses. */
  function groupByRole(rows) {
    var byRole = {};
    (rows || []).forEach(function (r) {
      if (!byRole[r.role]) { byRole[r.role] = []; }
      byRole[r.role].push(r);
    });
    var known = ROLE_ORDER.filter(function (r) { return byRole[r]; });
    var extra = Object.keys(byRole).filter(function (r) {
      return ROLE_ORDER.indexOf(r) === -1;
    }).sort();
    return known.concat(extra).map(function (role) {
      return { role: role, rows: byRole[role] };
    });
  }

  /** The country chips: only countries that actually have fee rows, with the
   *  number of rows behind the name — same rule as the fee editor's picker. */
  function chipList(countryNames, rows) {
    var counts = {};
    (rows || []).forEach(function (r) { counts[r.cc] = (counts[r.cc] || 0) + 1; });
    return Object.keys(countryNames)
      .filter(function (cc) { return counts[cc] > 0; })
      .map(function (cc) { return { cc: cc, name: countryNames[cc], n: counts[cc] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'en'); });
  }

  return {
    countryMeta: countryMeta,
    deriveRate: deriveRate,
    groupByRole: groupByRole,
    chipList: chipList
  };
}));
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd "D:/Claude/Variation Fee Calculator" && node --test tests/vcl-feedata.test.mjs`
Expected: PASS, `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-feedata.js tests/vcl-feedata.test.mjs
git commit -m "feat: add pure helpers for the public fee-data page"
```

---

### Task 3: Prüfdatum und Quelle im Overlay speichern (PHP)

**Files:**
- Modify: `variation-fee-calculator/includes/fee-editor.php:56-120` (`vcl_get_fee_overrides`, `vcl_sanitize_fee_overrides`)
- Modify: `variation-fee-calculator/includes/lookup.php:319-326` (Inline-Script)

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces: `vcl_fee_overrides` trägt zusätzlich `'countries' => array( '<CC>' => array( 'checked' => 'YYYY-MM-DD', 'source' => string, 'updated' => 'YYYY-MM-DD' ) )`. Dasselbe erscheint als `window.VCLCALC_OVERRIDES.countries`.

- [ ] **Step 1: Den Default-Zweig ergänzen**

In `includes/fee-editor.php`, Funktion `vcl_get_fee_overrides()`:

```php
	return wp_parse_args( $saved, array(
		'rows'      => array(),
		'points'    => array(),
		'countries' => array(),
		'updated'   => '',
		'by'        => '',
	) );
```

Und den Kommentarblock darüber (Zeile 53-54) auf den neuen Zweig erweitern:

```php
 * array( 'rows' => array( '<rowNo>' => array( '<field>' => float ) ),
 *        'points' => array( '<cc>' => float ),
 *        'countries' => array( '<CC>' => array( 'checked' => 'Y-m-d',
 *                                               'source' => string,
 *                                               'updated' => 'Y-m-d' ) ),
 *        'updated' => ..., 'by' => ... ).
```

- [ ] **Step 2: Die Sanitisierung ergänzen**

In `vcl_sanitize_fee_overrides()` das leere Ergebnis um den Zweig erweitern:

```php
	$clean = array( 'rows' => array(), 'points' => array(), 'countries' => array() );
```

und nach dem `points`-Block einfügen:

```php
	// Per-country provenance: a checked date the user maintains by hand, the
	// free-text source reference, and an edited date we stamp on save. Anything
	// that is not a date or a string is dropped, like everywhere else here.
	if ( isset( $payload['countries'] ) && is_array( $payload['countries'] ) ) {
		foreach ( $payload['countries'] as $cc => $fields ) {
			if ( ! is_array( $fields ) ) {
				$dropped++;
				continue;
			}
			$code  = sanitize_text_field( (string) $cc );
			$entry = array();

			foreach ( array( 'checked', 'updated' ) as $key ) {
				if ( empty( $fields[ $key ] ) ) {
					continue;
				}
				$date = sanitize_text_field( (string) $fields[ $key ] );
				if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) {
					$entry[ $key ] = $date;
				} else {
					$dropped++;
				}
			}
			if ( ! empty( $fields['source'] ) ) {
				$entry['source'] = sanitize_text_field( (string) $fields['source'] );
			}
			if ( $entry ) {
				$clean['countries'][ $code ] = $entry;
			}
		}
	}
```

- [ ] **Step 3: Den Zweig ans Frontend durchreichen**

In `includes/lookup.php` die beiden Stellen, die `rows` und `points` in das Inline-Script schreiben (Zeilen 322-326 und die Parallelstelle in `fee-editor.php:186` und `:191`), jeweils um `countries` ergänzen. Beispiel `lookup.php`:

```php
			array(
				'rows'      => (object) $vcl_fee_overrides['rows'],
				'points'    => (object) $vcl_fee_overrides['points'],
				'countries' => (object) $vcl_fee_overrides['countries'],
			)
```

Die Bedingung eine Zeile darüber muss den neuen Zweig mitprüfen:

```php
	if ( $vcl_fee_overrides['rows'] || $vcl_fee_overrides['points'] || $vcl_fee_overrides['countries'] ) {
```

- [ ] **Step 4: Prüfen, dass nichts kaputt ist**

Run: `cd "D:/Claude/Variation Fee Calculator/variation-fee-calculator" && php -l includes/fee-editor.php && php -l includes/lookup.php`
Expected: zweimal `No syntax errors detected`.

Falls `php` nicht im Pfad ist: die beiden Dateien stattdessen im Editor auf Klammerpaare prüfen und diesen Schritt überspringen; Task 4 deckt den Fehlerfall im Browser auf.

Danach das Plugin im NAS-WordPress laden und `Einstellungen → Gebühren-Editor` öffnen. Expected: Seite lädt wie zuvor, keine PHP-Notice, bestehende Overrides unverändert sichtbar.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/includes/fee-editor.php variation-fee-calculator/includes/lookup.php
git commit -m "feat: store per-country checked date and source in the fee overrides"
```

---

### Task 4: Die drei Felder im Gebühren-Editor

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-fee-editor.js:283-345` (unterhalb des Chip-Pickers)
- Modify: `variation-fee-calculator/assets/css/vcl-fee-editor.css`

**Interfaces:**
- Consumes: `window.VCLCALC_OVERRIDES.countries` aus Task 3.
- Produces: Der Speicher-Payload des Editors enthält `countries[<CC>] = {checked, source}`; `updated` setzt der Editor beim Speichern auf das heutige Datum.

- [ ] **Step 1: Den Block rendern**

In `assets/js/vcl-fee-editor.js` nach `renderPicker()` eine Funktion ergänzen und im selben Zug aus `renderPicker` heraus aufrufen (direkt nach `pickerPills(host)`):

```javascript
  // Provenance for the active country: the date the user checked the amounts
  // against the authority's schedule, and the reference they checked against.
  // Both feed the public fee page's header.
  function renderProvenance(host) {
    var meta = document.createElement('div');
    meta.className = 'vclfe-prov';

    var saved = (countryOverrides[activeCc] || {});

    function field(key, label, type, placeholder) {
      var wrap = document.createElement('label');
      wrap.className = 'vclfe-prov__f';
      var span = document.createElement('span');
      span.textContent = label;
      var input = document.createElement('input');
      input.type = type;
      input.value = saved[key] || '';
      if (placeholder) { input.placeholder = placeholder; }
      input.addEventListener('input', function () {
        if (!countryOverrides[activeCc]) { countryOverrides[activeCc] = {}; }
        if (input.value) { countryOverrides[activeCc][key] = input.value; }
        else { delete countryOverrides[activeCc][key]; }
        markDirty();
      });
      wrap.appendChild(span);
      wrap.appendChild(input);
      meta.appendChild(wrap);
    }

    field('checked', 'Zuletzt gegen die Gebührenordnung geprüft', 'date', '');
    field('source', 'Quelle (Fundstelle der Gebührenordnung)', 'text',
          'z. B. Elenco Tariffe aggiornato ad Luglio 2025');

    var note = document.createElement('p');
    note.className = 'vclfe-prov__note';
    note.textContent = 'Das Änderungsdatum wird beim Speichern automatisch gesetzt. '
      + 'Behördenlink und Zahlungsweise stammen aus der Excel und sind hier nicht änderbar.';
    meta.appendChild(note);

    host.appendChild(meta);
  }
```

Oben im Modul, bei den übrigen `var`-Deklarationen des Editors, den Zustand anlegen:

```javascript
  var countryOverrides = (window.VCLCALC_OVERRIDES && window.VCLCALC_OVERRIDES.countries)
    ? JSON.parse(JSON.stringify(window.VCLCALC_OVERRIDES.countries))
    : {};
```

**Hinweis für den Umsetzenden:** `markDirty()` ist der im Editor bereits vorhandene Aufruf, der den Speichern-Button aktiviert. Den tatsächlichen Namen mit
`grep -n "function markDirty\|dirty" assets/js/vcl-fee-editor.js | head` ermitteln und einsetzen; die Funktion existiert, weil der Editor sonst nicht wüsste, wann er speichern darf.

- [ ] **Step 2: Die Felder mitspeichern**

Die Stelle finden, die den Payload zusammenbaut:
`grep -n "rows:\|points:" assets/js/vcl-fee-editor.js | head`

Dort den Zweig ergänzen und das Änderungsdatum stempeln:

```javascript
      countries: (function () {
        var out = {};
        Object.keys(countryOverrides).forEach(function (cc) {
          var e = countryOverrides[cc];
          if (!e || (!e.checked && !e.source)) { return; }
          out[cc] = {
            checked: e.checked || '',
            source: e.source || '',
            updated: new Date().toISOString().slice(0, 10)
          };
        });
        return out;
      }())
```

- [ ] **Step 3: Stile ergänzen**

Ans Ende von `assets/css/vcl-fee-editor.css`:

```css
/* ---- per-country provenance ------------------------------------------- */
.vclfe-prov{
  display:flex; flex-wrap:wrap; gap:14px 22px; align-items:flex-end;
  margin-top:14px; padding-top:13px; border-top:1px solid var(--line);
}
.vclfe-prov__f{display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:var(--ink-soft)}
.vclfe-prov__f input{
  min-height:0; padding:6px 10px;
  font-family:var(--sans); font-size:13px;
  border:1px solid var(--line-strong); border-radius:6px;
  background:var(--paper); color:var(--ink); box-shadow:none;
}
.vclfe-prov__f input[type="text"]{min-width:320px}
.vclfe-prov__f input:hover{border-color:var(--accent)}
.vclfe-prov__note{flex:1 1 100%; margin:0; font-size:11.5px; color:var(--ink-faint)}
```

- [ ] **Step 4: Im Browser prüfen**

Plugin auf das NAS-WordPress laden, `Einstellungen → Gebühren-Editor` öffnen.

Expected:
1. Unter den Länder-Chips stehen zwei Felder und der Hinweistext.
2. Ein Datum bei Italien eintragen, speichern, Seite neu laden — der Wert steht noch da.
3. Ein anderes Land anklicken — die Felder zeigen dessen Werte, nicht die von Italien.
4. In der Datenbank: `wp option get vcl_fee_overrides --format=json` enthält
   `"countries":{"IT":{"checked":"…","source":"…","updated":"…"}}`.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-fee-editor.js variation-fee-calculator/assets/css/vcl-fee-editor.css
git commit -m "feat: maintain checked date and source per country in the fee editor"
```

---

### Task 5: Die Seite — Chips, Kopfzeile, Tabellen

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-calc-app.js` (neue Render-Funktion, Router bei `:2139`, Datenimport bei `:13`)
- Modify: `variation-fee-calculator/assets/css/vcl-calc-style.css` (ans Ende)
- Modify: `variation-fee-calculator/includes/lookup.php` (`vcl-feedata.js` einreihen)

**Interfaces:**
- Consumes: `VCL_FEEDATA.countryMeta / groupByRole / chipList` aus Task 2, `window.VCLCALC_OVERRIDES.countries` aus Task 3.
- Produces: `appState.step === 'feedata'` und `appState.feeDataCc`; Funktion `renderStepFeeData()`.

- [ ] **Step 1: Das Skript einreihen**

In `includes/lookup.php` die Stelle finden, die `vcl-calc-app` registriert
(`grep -n "vcl-calc-app\|vcl-calc-data" includes/lookup.php`), und `vcl-feedata` **vor** `vcl-calc-app` registrieren sowie als dessen Abhängigkeit eintragen:

```php
	wp_register_script(
		'vcl-feedata',
		VFC_URL . 'assets/js/vcl-feedata.js',
		array(),
		VFC_VERSION,
		true
	);
```

und in der `wp_register_script`-Zeile für `vcl-calc-app` das Abhängigkeits-Array um `'vcl-feedata'` erweitern.

- [ ] **Step 2: Zustand und Router**

In `assets/js/vcl-calc-app.js` bei den `appState`-Feldern ergänzen:

```javascript
  feeDataCc: null,          // which country the public fee-data page shows
  feeDataCur: 'local',      // 'local' or 'eur' -- only meaningful for non-euro countries
  feeDataOpen: false,       // is the quick-calculation box unfolded
  feeDataSearch: '',
```

und `render()` (`:2139`) erweitern:

```javascript
function render() {
  renderRail();
  if (appState.step === 'feedata') renderStepFeeData();
  else if (appState.step === 0) renderStepCountries();
  else if (appState.step === 1) renderStepCountryDetails();
  else if (appState.step === 2) renderStepVariations();
  else if (appState.step === 3) renderStepResult();
}
```

- [ ] **Step 3: Die Seite rendern**

Neue Funktion in `assets/js/vcl-calc-app.js`, direkt vor `render()`:

```javascript
// ---- Public fee-data page: one country at a time, amounts and provenance open ----
// Reached from the calculator; the exact entry point is still to be decided, so the
// page is addressed only through appState.step === 'feedata'.
const FEE_COLS = [
  { key: 'F', label: '1st variation' },
  { key: 'H', label: 'Each further IA' },
  { key: 'I', label: 'Each further IB' },
  { key: 'J', label: 'Each further II' },
  { key: 'G', label: 'Each further strength' },
  { key: 'K', label: 'Grouping fee' }
];
const ROLE_CAPTION = {
  RMS: 'Reference Member State',
  CMS: 'Concerned Member State',
  national: 'Purely national marketing authorisation'
};

function feeDataOverrides() {
  return (typeof window !== 'undefined' && window.VCLCALC_OVERRIDES) || null;
}

function renderStepFeeData() {
  const cc = appState.feeDataCc || 'IT';
  const rows = FEE_ROWS.filter(r => r.cc === cc);
  const meta = VCL_FEEDATA.countryMeta(cc, HA_WEBSITES, CC_TO_CURRENCY, feeDataOverrides());
  const rate = meta.currency ? VCL_FEEDATA.deriveRate(rows) : null;
  const local = !!meta.currency && appState.feeDataCur === 'local';

  const fmt = (v) => {
    if (v === null || v === undefined) return '&ndash;';
    if (v === 0) return '0';
    if (!meta.currency) return v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
    return local
      ? v.toLocaleString('de-DE', { maximumFractionDigits: 0 })
      : (v / rate).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const cell = (row, key) => {
    const raw = meta.currency ? row[key + '_lc'] : row[key];
    const cls = (raw === null || raw === undefined) ? 'fd-num fd-dash'
      : (raw === 0 ? 'fd-num fd-zero' : 'fd-num');
    return `<td class="${cls}">${fmt(raw)}</td>`;
  };

  const chips = VCL_FEEDATA.chipList(COUNTRY_NAMES, FEE_ROWS);
  const q = appState.feeDataSearch.trim().toLowerCase();
  const shown = chips.filter(c => !q || c.name.toLowerCase().includes(q) || c.cc.toLowerCase().includes(q));

  const anySpecial = rows.some(r => r.special && r.special !== 'standard');

  const tables = VCL_FEEDATA.groupByRole(rows).map(g => `
    <div class="fd-group">
      <div class="fd-grouphead">
        <h2>${g.role === 'national' ? 'National procedure' : 'As ' + escapeHtml(g.role)}</h2>
        <p>${escapeHtml(ROLE_CAPTION[g.role] || '')}</p>
      </div>
      <div class="fd-card"><div class="fd-scroll">
        <table class="fd-tbl">
          <thead><tr>
            <th>Procedure</th>
            ${anySpecial ? '<th>Special case</th>' : ''}
            <th>Fee code</th>
            ${FEE_COLS.map(c => `<th class="fd-num">${c.label}${
              meta.currency ? `<span class="fd-cur">${escapeHtml(local ? meta.currency : 'EUR')}</span>` : ''
            }</th>`).join('')}
          </tr></thead>
          <tbody>
            ${g.rows.map(r => `
              <tr>
                <td><span class="fd-tname">Type ${escapeHtml(r.type)}</span></td>
                ${anySpecial ? `<td class="fd-sc">${escapeHtml(r.special || 'standard')}</td>` : ''}
                <td class="fd-code">${escapeHtml(String(r.fee_code || '&ndash;'))}</td>
                ${FEE_COLS.map(c => cell(r, c.key)).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    </div>`).join('');

  contentEl.innerHTML = `
    <div class="fd-picker">
      <div class="fd-pillbar">
        <input type="search" class="fd-search" id="fd-search" placeholder="Find a country"
               aria-label="Find a country" value="${escapeHtml(appState.feeDataSearch)}">
        <span class="fd-pillcount">${q ? `${shown.length} of ${chips.length}` : `${chips.length} countries`}</span>
      </div>
      <div class="fd-pills">
        ${shown.length ? shown.map(c => `
          <button type="button" class="fd-pill${c.cc === cc ? ' is-active' : ''}" data-fdcc="${escapeHtml(c.cc)}">
            ${escapeHtml(c.name)}<span class="n">${c.n}</span>
          </button>`).join('') : '<p class="fd-pillnone">No country with that name.</p>'}
      </div>
    </div>

    <header class="fd-masthead">
      <div>
        <h1>${escapeHtml(COUNTRY_NAMES[cc] || cc)}</h1>
        <p class="fd-meta">
          <span class="fd-code">${escapeHtml(cc)}</span><span class="fd-dot">&middot;</span>
          <span>Currency ${escapeHtml(meta.currency || 'EUR')}</span><span class="fd-dot">&middot;</span>
          <span>${rows.length} fee row${rows.length === 1 ? '' : 's'}</span>
          ${meta.checked ? `<span class="fd-dot">&middot;</span><span><span class="fd-lbl">Checked</span> <b>${escapeHtml(formatImprintDate(meta.checked))}</b></span>` : ''}
          ${meta.edited ? `<span class="fd-dot">&middot;</span><span><span class="fd-lbl">Last edited</span> <b>${escapeHtml(formatImprintDate(meta.edited))}</b></span>` : ''}
          ${meta.linkText ? `<span class="fd-dot">&middot;</span><span><span class="fd-lbl">Authority</span> ${
            meta.linkUrl
              ? `<a href="${escapeHtml(meta.linkUrl)}" target="_blank" rel="noopener">${escapeHtml(meta.linkText)}</a>`
              : escapeHtml(meta.linkText)
          }</span>` : ''}
          ${meta.payment ? `<span class="fd-dot">&middot;</span><span><span class="fd-lbl">Payment</span> ${escapeHtml(meta.payment)}</span>` : ''}
        </p>
        ${meta.source ? `<p class="fd-src">Source: <b>${escapeHtml(meta.source)}</b></p>` : ''}
        ${(meta.currency && rate) ? `<p class="fd-src fd-fx">Published in <b>${escapeHtml(meta.currency)}</b> by the authority &mdash; euro amounts are converted at <b>1 EUR = ${rate.toLocaleString('de-DE', { minimumFractionDigits: 5, maximumFractionDigits: 5 })} ${escapeHtml(meta.currency)}</b>.</p>` : ''}
      </div>
      <div class="fd-headright" id="fd-headright"></div>
    </header>

    <div id="fd-body">${tables}</div>
  `;

  contentEl.querySelectorAll('[data-fdcc]').forEach((b) => {
    b.addEventListener('click', () => {
      appState.feeDataCc = b.getAttribute('data-fdcc');
      appState.feeDataCur = 'local';
      render();
    });
  });
  const searchEl = document.getElementById('fd-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      appState.feeDataSearch = searchEl.value;
      render();
      const again = document.getElementById('fd-search');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
  }
}
```

- [ ] **Step 4: Stile ergänzen**

Ans Ende von `assets/css/vcl-calc-style.css`:

```css
/* ---- Public fee-data page ------------------------------------------------
   One country at a time: chips first, then the country's provenance, then one
   table per procedure role. Cards follow the calculator's own 12px panels. */
.vclcalc-app .fd-picker{
  padding:14px 15px 15px; margin-bottom:20px;
  background:var(--panel); border:1px solid var(--line);
  border-radius:12px; box-shadow:var(--shadow);
}
.vclcalc-app .fd-pillbar{display:flex; align-items:center; gap:12px; margin-bottom:12px}
.vclcalc-app input.fd-search{
  flex:0 1 240px; padding:6px 11px; font-family:var(--sans); font-size:13px;
  border:1px solid var(--line-strong); border-radius:6px;
  background:var(--paper); color:var(--ink);
}
.vclcalc-app input.fd-search:hover{border-color:var(--accent)}
.vclcalc-app .fd-pillcount{font-size:11px; color:var(--ink-faint); font-variant-numeric:tabular-nums}
.vclcalc-app .fd-pills{display:flex; flex-wrap:wrap; gap:6px}
.vclcalc-app .fd-pill{
  display:inline-flex; align-items:center; gap:7px; cursor:pointer;
  font:inherit; font-family:var(--sans); font-size:12.5px;
  padding:5px 10px; border-radius:999px;
  border:1px solid var(--line); background:var(--paper); color:var(--ink-soft);
}
.vclcalc-app .fd-pill:hover{border-color:var(--line-strong); color:var(--ink)}
.vclcalc-app .fd-pill:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.vclcalc-app .fd-pill .n{font-size:10.5px; color:var(--ink-faint); font-variant-numeric:tabular-nums}
.vclcalc-app .fd-pill.is-active{background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600}
.vclcalc-app .fd-pill.is-active .n{color:rgba(255,255,255,.78)}
.vclcalc-app .fd-pillnone{margin:2px 0; font-size:13px; color:var(--ink-faint)}

.vclcalc-app .fd-masthead{
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap;
  padding-bottom:14px; border-bottom:1px solid var(--line-strong);
}
.vclcalc-app .fd-masthead h1{
  font-family:var(--serif); font-weight:600; font-size:27px; margin:0; letter-spacing:-.01em;
}
.vclcalc-app .fd-meta{
  margin:7px 0 0; font-size:12.5px; color:var(--ink-soft);
  display:flex; gap:8px; flex-wrap:wrap; align-items:center;
}
.vclcalc-app .fd-dot{color:var(--line-strong)}
.vclcalc-app .fd-meta .fd-lbl{color:var(--ink-faint)}
.vclcalc-app .fd-meta b{font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums}
.vclcalc-app .fd-meta a{color:var(--accent-deep); text-underline-offset:2px}
.vclcalc-app .fd-src{margin:8px 0 0; font-size:12px; color:var(--ink-faint)}
.vclcalc-app .fd-src b{font-weight:500; color:var(--ink-soft)}
.vclcalc-app .fd-fx b{font-variant-numeric:tabular-nums; color:var(--ink)}
.vclcalc-app .fd-headright{display:flex; gap:8px; align-items:center}

.vclcalc-app .fd-group{margin:24px 0}
.vclcalc-app .fd-grouphead{
  display:flex; align-items:baseline; gap:10px; margin:0 0 10px; padding-bottom:7px;
  border-bottom:1px solid var(--accent-soft);
}
.vclcalc-app .fd-grouphead h2{font-family:var(--serif); font-size:18px; font-weight:600; margin:0}
.vclcalc-app .fd-grouphead p{margin:0; font-size:12.5px; color:var(--ink-soft)}
.vclcalc-app .fd-card{
  background:var(--panel); border:1px solid var(--line);
  border-radius:12px; box-shadow:var(--shadow); overflow:hidden;
}
.vclcalc-app .fd-scroll{overflow-x:auto}
.vclcalc-app .fd-tbl{border-collapse:collapse; width:100%; min-width:700px; font-size:13.5px}
.vclcalc-app .fd-tbl th{
  text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em;
  font-weight:600; color:var(--ink-faint); padding:9px; white-space:nowrap;
  border-bottom:1px solid var(--line); background:#fbfcfd; vertical-align:bottom;
}
.vclcalc-app .fd-tbl th.fd-num, .vclcalc-app .fd-tbl td.fd-num{text-align:right}
.vclcalc-app .fd-tbl td{
  padding:0 9px; height:44px; vertical-align:middle; border-bottom:1px solid var(--line);
}
.vclcalc-app .fd-tbl tbody tr:last-child td{border-bottom:none}
.vclcalc-app .fd-tbl td.fd-num{font-variant-numeric:tabular-nums; color:var(--ink)}
.vclcalc-app .fd-tbl td.fd-zero, .vclcalc-app .fd-tbl td.fd-dash{color:var(--ink-faint)}
.vclcalc-app .fd-tname{font-weight:600; white-space:nowrap}
.vclcalc-app .fd-sc{font-size:12px; color:var(--ink-soft)}
.vclcalc-app .fd-tbl td.fd-code, .vclcalc-app .fd-code{font-size:11.5px; color:var(--ink-soft); white-space:nowrap}
.vclcalc-app .fd-cur{
  display:block; margin-top:2px; font-size:9.5px; letter-spacing:.06em;
  color:var(--accent); text-transform:none;
}
```

- [ ] **Step 5: Im Browser prüfen**

Die Seite ist erst ab Task 8 verlinkt. Für diesen Schritt den Startzustand vorübergehend umstellen: in `assets/js/vcl-calc-app.js` bei der `appState`-Initialisierung `step: 0` auf `step: 'feedata'` ändern, Plugin aufs NAS laden, prüfen — und die Zeile danach **wieder zurückstellen**, bevor committet wird.

Kontrolle vor dem Commit: `git diff variation-fee-calculator/assets/js/vcl-calc-app.js | grep "step:"` darf keine Ausgabe liefern.

Expected:
1. Chips oben, Italien aktiv, 12 hinter dem Namen.
2. Kopfzeile: `IT · Currency EUR · 12 fee rows · Checked 11 May 2026 · Last edited 11 May 2026 · Authority AIFA · Payment proof of payment`, darunter `Source: Elenco Tariffe aggiornato ad Luglio 2025`.
3. Drei Abschnitte RMS / CMS / national, Typ IA RMS zeigt `1.055` in der Spalte `1st variation`.
4. Dänemark anklicken: Spalte `Special case` erscheint, Beträge in DKK (`7.879`), Kurszeile `1 EUR = 7,47454 DKK`.
5. Suche „ital" filtert auf einen Chip.

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-calc-app.js variation-fee-calculator/assets/css/vcl-calc-style.css variation-fee-calculator/includes/lookup.php
git commit -m "feat: add the public fee-data page with country chips and per-role tables"
```

---

### Task 6: Währungspille für Nicht-Euro-Länder

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-calc-app.js` (in `renderStepFeeData`, Bereich `fd-headright`)
- Modify: `variation-fee-calculator/assets/css/vcl-calc-style.css`

**Interfaces:**
- Consumes: `meta.currency` und `appState.feeDataCur` aus Task 5.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Die Pille rendern**

In `renderStepFeeData()` den leeren `fd-headright`-Container füllen. Dazu die Zeile

```javascript
      <div class="fd-headright" id="fd-headright"></div>
```

ersetzen durch:

```javascript
      <div class="fd-headright" id="fd-headright">
        ${meta.currency ? `
        <div class="fd-curtoggle" role="group" aria-label="Currency">
          <button type="button" class="fd-curbtn${local ? ' on' : ''}" data-fdcur="local">${escapeHtml(meta.currency)}</button>
          <button type="button" class="fd-curbtn${local ? '' : ' on'}" data-fdcur="eur">EUR</button>
        </div>` : ''}
      </div>
```

- [ ] **Step 2: Verdrahten**

Zu den Event-Bindungen am Ende von `renderStepFeeData()` ergänzen:

```javascript
  contentEl.querySelectorAll('[data-fdcur]').forEach((b) => {
    b.addEventListener('click', () => {
      appState.feeDataCur = b.getAttribute('data-fdcur');
      render();
    });
  });
```

- [ ] **Step 3: Stile ergänzen**

Ans Ende von `assets/css/vcl-calc-style.css`:

```css
/* The same pill the result view uses, reused for one country's own amounts.
   Local currency leads: it is what the authority publishes, the euro value is
   derived from it. */
.vclcalc-app .fd-curtoggle{
  display:inline-flex; gap:4px; padding:3px; background:var(--paper); border-radius:999px;
}
.vclcalc-app .fd-curbtn{
  font:inherit; font-family:var(--sans); font-size:12px; font-weight:600; cursor:pointer;
  padding:5px 13px; border-radius:999px; border:1px solid transparent;
  background:transparent; color:var(--ink-faint);
}
.vclcalc-app .fd-curbtn:hover{color:var(--ink)}
.vclcalc-app .fd-curbtn:focus-visible{outline:2px solid var(--accent); outline-offset:1px}
.vclcalc-app .fd-curbtn.on{background:var(--panel); border-color:var(--line); color:var(--accent-deep)}
```

- [ ] **Step 4: Im Browser prüfen**

Expected:
1. Italien: **keine** Pille.
2. Dänemark: Pille `DKK | EUR`, DKK aktiv.
3. Auf EUR schalten: Typ IA RMS zeigt `1.054,11` statt `7.879`; die Spaltenköpfe tragen `EUR` statt `DKK`.
4. Land wechseln und zurück: die Pille steht wieder auf der Landeswährung.
5. `7879 / 7,47454 = 1054,11` — die angezeigte Zahl muss dazu passen.

- [ ] **Step 5: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-calc-app.js variation-fee-calculator/assets/css/vcl-calc-style.css
git commit -m "feat: add the currency pill to the public fee-data page"
```

---

### Task 7: Schnellrechnung und Klartext

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-calc-app.js` (in `renderStepFeeData`)
- Modify: `variation-fee-calculator/assets/css/vcl-calc-style.css`

**Interfaces:**
- Consumes: `window.VCLCALC.computeFees` (`vcl-calc-app.js:661`), `appState.feeDataOpen`.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Den Button und die Box rendern**

In `renderStepFeeData()` in `fd-headright` **vor** der Währungspille einfügen:

```javascript
        <button type="button" class="btn fd-openbtn" id="fd-open" aria-expanded="${appState.feeDataOpen ? 'true' : 'false'}">
          <span class="fd-caret">&#9654;</span> Quick calculation
        </button>
```

Und direkt nach der `</header>`-Zeile, vor `<div id="fd-body">`:

```javascript
    <div class="fd-calc" id="fd-calc"${appState.feeDataOpen ? '' : ' hidden'}>
      <div class="fd-calchead">
        <h3>Quick calculation &mdash; ${escapeHtml(COUNTRY_NAMES[cc] || cc)}</h3>
        <div class="fd-roles" role="group" aria-label="Procedure role">
          ${VCL_FEEDATA.groupByRole(rows).map((g, i) => `
            <button type="button" class="fd-rolebtn${i === 0 ? ' on' : ''}" data-fdrole="${escapeHtml(g.role)}">
              ${g.role === 'national' ? 'National' : escapeHtml(g.role)}
            </button>`).join('')}
        </div>
      </div>
      <div class="fd-calcgrid">
        <div class="fd-fields">
          <label>Strengths<input type="text" inputmode="numeric" id="fd-L" value="1"></label>
          <label>Type IA variations<input type="text" inputmode="numeric" id="fd-IA" value="0"></label>
          <label>Type IB variations<input type="text" inputmode="numeric" id="fd-IB" value="0"></label>
          <label>Type II variations<input type="text" inputmode="numeric" id="fd-II" value="1"></label>
        </div>
        <div class="fd-out" id="fd-out"></div>
      </div>
    </div>
```

- [ ] **Step 2: Rechnen über die Engine**

Am Ende von `renderStepFeeData()` ergänzen:

```javascript
  // The quick calculation goes through the same engine as every other tool, so
  // caps, grouping fees, special cases and editor overrides all apply for free.
  let fdRole = (VCL_FEEDATA.groupByRole(rows)[0] || {}).role || 'RMS';

  function fdNum(id) {
    const el = document.getElementById(id);
    const v = parseInt(el ? el.value : '0', 10);
    return (isNaN(v) || v < 0) ? 0 : v;
  }

  function fdRender() {
    const out = document.getElementById('fd-out');
    if (!out) return;
    const counts = { IA: fdNum('fd-IA'), IB: fdNum('fd-IB'), II: fdNum('fd-II') };
    if (!counts.IA && !counts.IB && !counts.II) {
      out.innerHTML = '<p class="fd-hint">No variation selected.</p>';
      return;
    }
    const res = window.VCLCALC.computeFees({
      countries: [{ cc, role: fdRole, strengths: Math.max(1, fdNum('fd-L')) }],
      counts
    });
    const cr = res.countries[0];
    const showLocal = !!meta.currency && appState.feeDataCur === 'local';
    const amount = showLocal && cr.totalLocal != null ? cr.totalLocal : cr.total;
    const unit = showLocal && cr.totalLocal != null ? (meta.currency || '') : 'EUR';
    out.innerHTML = `
      <div class="fd-lines">
        ${['II', 'IB', 'IA'].filter(t => counts[t] > 0).map(t =>
          `<div class="fd-line"><span>${counts[t]}&times; Type ${t}</span></div>`).join('')}
      </div>
      <div class="fd-total">
        <span class="fd-total-l">Total fee</span>
        <span class="fd-total-r">${amount.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${escapeHtml(unit)}</span>
      </div>
      ${cr.mechanic && cr.mechanic !== 'none' ? `<p class="fd-hint">A ${escapeHtml(cr.mechanic)} applies to this combination.</p>` : ''}`;
  }

  const openBtn = document.getElementById('fd-open');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      appState.feeDataOpen = !appState.feeDataOpen;
      render();
    });
  }
  ['fd-L', 'fd-IA', 'fd-IB', 'fd-II'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', fdRender);
  });
  contentEl.querySelectorAll('[data-fdrole]').forEach((b) => {
    b.addEventListener('click', () => {
      fdRole = b.getAttribute('data-fdrole');
      contentEl.querySelectorAll('[data-fdrole]').forEach(x => x.classList.toggle('on', x === b));
      fdRender();
    });
  });
  if (appState.feeDataOpen) fdRender();
```

**Hinweis:** `cr.mechanic` und `cr.totalLocal` stammen aus `computeCountryResult`. Falls `mechanic` dort anders heißt, mit
`grep -n "mechanic" assets/js/vcl-calc-app.js | head` den Namen prüfen und einsetzen; wenn es das Feld nicht gibt, die letzte Zeile des Templates ersatzlos streichen.

- [ ] **Step 3: Klartext unter die erste Tabelle**

In der Template-Literal-Kette der Tabellen (Task 5, Step 3) hinter `</div></div>` der **ersten** Gruppe einfügen — dazu `.map(g => ...)` um den Index erweitern (`.map((g, gi) => ...)`) und vor dem schließenden `</div>` der Gruppe ergänzen:

```javascript
      ${gi === 0 ? `
      <div class="fd-plain">
        <h3>In plain words</h3>
        <p class="fd-sentence">
          The leading variation costs <b>${fmt(meta.currency ? g.rows[g.rows.length - 1].F_lc : g.rows[g.rows.length - 1].F)}</b>.
          Every additional strength raises each rate by
          <b>${fmt(meta.currency ? g.rows[0].G_lc : g.rows[0].G)}</b>.
        </p>
      </div>` : ''}
```

- [ ] **Step 4: Stile ergänzen**

Ans Ende von `assets/css/vcl-calc-style.css`:

```css
/* ---- quick calculation on the fee-data page ---- */
.vclcalc-app .fd-openbtn{
  display:inline-flex; align-items:center; gap:8px;
  border-color:var(--accent); color:var(--accent-deep); background:var(--accent-soft);
}
.vclcalc-app .fd-openbtn .fd-caret{font-size:9px; transition:transform .15s ease}
.vclcalc-app .fd-openbtn[aria-expanded="true"] .fd-caret{transform:rotate(90deg)}
@media (prefers-reduced-motion:reduce){ .vclcalc-app .fd-openbtn .fd-caret{transition:none} }
.vclcalc-app .fd-calc{
  margin-top:22px; padding:15px 17px 16px;
  background:var(--panel); border:1px solid var(--line);
  border-radius:12px; box-shadow:var(--shadow);
}
.vclcalc-app .fd-calchead{
  display:flex; align-items:baseline; justify-content:space-between;
  gap:12px; flex-wrap:wrap; margin-bottom:12px;
}
.vclcalc-app .fd-calchead h3{
  margin:0; font-size:10px; font-weight:600; letter-spacing:.08em;
  text-transform:uppercase; color:var(--ink-faint);
}
.vclcalc-app .fd-roles{display:inline-flex; gap:4px; padding:3px; background:var(--paper); border-radius:999px}
.vclcalc-app .fd-rolebtn{
  font:inherit; font-size:11.5px; font-weight:600; cursor:pointer;
  padding:4px 11px; border-radius:999px; border:1px solid transparent;
  background:transparent; color:var(--ink-faint);
}
.vclcalc-app .fd-rolebtn.on{background:var(--panel); border-color:var(--line); color:var(--accent-deep)}
.vclcalc-app .fd-calcgrid{
  display:grid; grid-template-columns:minmax(280px,1.1fr) minmax(240px,1fr);
  gap:22px; align-items:start;
}
@media (max-width:820px){ .vclcalc-app .fd-calcgrid{grid-template-columns:1fr} }
.vclcalc-app .fd-fields{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px}
.vclcalc-app .fd-fields label{display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:var(--ink-soft)}
.vclcalc-app .fd-fields input{
  width:100%; padding:6px 9px; text-align:right;
  font-family:var(--sans); font-size:13px; font-variant-numeric:tabular-nums;
  border:1px solid var(--line-strong); border-radius:6px;
  background:var(--paper); color:var(--ink);
}
.vclcalc-app .fd-line{display:flex; justify-content:space-between; font-size:12.5px; color:var(--ink-soft); padding:3px 0}
.vclcalc-app .fd-total{
  display:flex; justify-content:space-between; align-items:baseline; gap:12px;
  margin-top:10px; padding-top:10px; border-top:1px solid var(--line-strong);
}
.vclcalc-app .fd-total-l{font-size:12.5px; font-weight:600}
.vclcalc-app .fd-total-r{
  font-size:20px; font-weight:600; color:var(--accent-deep); font-variant-numeric:tabular-nums;
}
.vclcalc-app .fd-hint{margin:10px 0 0; font-size:11.5px; color:var(--ink-faint)}
.vclcalc-app .fd-plain{padding:16px 18px 18px; border-top:1px solid var(--line); background:var(--paper)}
.vclcalc-app .fd-plain h3{
  margin:0 0 8px; font-size:10px; font-weight:600; letter-spacing:.08em;
  text-transform:uppercase; color:var(--ink-faint);
}
.vclcalc-app .fd-sentence{margin:0; font-size:13.5px; line-height:1.65; color:var(--ink-soft); max-width:70ch}
.vclcalc-app .fd-sentence b{color:var(--ink); font-variant-numeric:tabular-nums}
```

- [ ] **Step 5: Gegen den Rechner prüfen**

Expected:
1. Der Button klappt die Box auf und wieder zu; der Pfeil dreht sich.
2. Italien, RMS, 3 Stärken, 1 IA, 2 IB, 1 II → **35.304 €**. Dieselbe Eingabe im Fee Calculator muss denselben Wert liefern.
3. Dänemark mit einem Deckel-/Gruppierungsfall: der Hinweis unter der Summe erscheint.
4. Ein Override im Gebühren-Editor (z. B. Italien Zeile 254 auf 9.999) schlägt in der Schnellrechnung durch.

- [ ] **Step 6: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-calc-app.js variation-fee-calculator/assets/css/vcl-calc-style.css
git commit -m "feat: add the quick calculation and plain-words block to the fee-data page"
```

---

### Task 8: Einstieg im Calculator, Version, ZIP

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-calc-app.js:768-785` (`calcInfoPanelsHtml`)
- Modify: `variation-fee-calculator/variation-fee-calculator.php:5` und `:15`

**Interfaces:**
- Consumes: `appState.step = 'feedata'` aus Task 5.

- [ ] **Step 1: Den Einstieg setzen**

**Der genaue Ort ist mit dem Nutzer noch abzustimmen** (Beschluss vom 2026-09-01: vorerst nur im Calculator, wo genau wird noch erörtert). Bis dahin tritt die Seite an die Stelle des heutigen HA-Panels, das dieselben Angaben als Liste zeigt und damit überflüssig wird.

In `calcInfoPanelsHtml()` den HA-Block ersetzen durch:

```javascript
    ${(typeof HA_WEBSITES !== 'undefined' && HA_WEBSITES.length > 0) ? `
    <div class="panel" style="margin-bottom:18px;">
      <button class="btn ghost" id="vclcalc-openFeeData" style="padding-left:0;">🔗 Fee data by country &mdash; amounts, sources and check dates</button>
    </div>
    ` : ''}
```

und in `wireCalcInfoPanels()` den bisherigen `haWebsitesBtn`-Block ersetzen durch:

```javascript
  const feeDataBtn = document.getElementById('vclcalc-openFeeData');
  if (feeDataBtn) {
    feeDataBtn.addEventListener('click', () => {
      appState.feeDataCc = appState.selectedCountries[0] || 'IT';
      appState.step = 'feedata';
      render();
      if (window.VCL_APP && window.VCL_APP.scrollToTop) window.VCL_APP.scrollToTop();
    });
  }
```

`renderHaWebsitesList()` wird **gelöscht** (Nutzerentscheidung 2026-09-01): sie hat nach diesem Umbau
keinen Aufrufer mehr, und die Historie bewahrt sie auf (Commit `c390999`). Die Funktion steht in
`vcl-calc-app.js` bei `renderHaWebsitesList` — mit `grep -n "renderHaWebsitesList" assets/js/vcl-calc-app.js`
alle Vorkommen finden und restlos entfernen, Definition wie Aufrufe.

- [ ] **Step 2: Zurück aus der Seite**

In `renderStepFeeData()` in `fd-headright` als **erstes** Element ergänzen:

```javascript
        <button type="button" class="btn" id="fd-back">Back to the calculator</button>
```

und verdrahten:

```javascript
  const backBtn = document.getElementById('fd-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      appState.step = 0;
      render();
      if (window.VCL_APP && window.VCL_APP.scrollToTop) window.VCL_APP.scrollToTop();
    });
  }
```

- [ ] **Step 3: Version hochzählen**

In `variation-fee-calculator/variation-fee-calculator.php`:

```php
 * Version: 1.13.0
```

```php
define( 'VFC_VERSION', '1.13.0' );
```

- [ ] **Step 4: Alle Tests laufen lassen**

```bash
cd "D:/Claude/Variation Fee Calculator"
python -m pytest tests/ -q
node --test tests/vcl-feedata.test.mjs tests/vcl-usage.test.mjs
node tests/vcl-sg-logic.test.js
node tests/vcl-workload-hours.test.js
```

Expected: pytest ohne Fehlschlag; `# fail 0` bei den `node --test`-Läufen; die beiden `node`-Skripte melden `failed: 0`.

- [ ] **Step 5: ZIP bauen und prüfen**

```bash
cd "D:/Claude/Variation Fee Calculator"
python build_zip.py
unzip -l variation-fee-calculator.zip | head -20
```

Expected: alle Pfade mit `/` als Trenner (**niemals** `\` — sonst ist das ZIP für WordPress unbrauchbar), `variation-fee-calculator/assets/js/vcl-feedata.js` ist enthalten.

- [ ] **Step 6: Auf dem NAS abnehmen**

Expected, im echten Chrome (nicht im In-App-Browser):
1. Fee Calculator öffnen, Button „Fee data by country" anklicken → die Seite erscheint.
2. „Back to the calculator" führt zurück auf Schritt 0, die Länderauswahl steht noch.
3. Helles und dunkles Thema, und auf Handybreite: keine waagerechte Scrollleiste am Seitenkörper; die Tabellen scrollen in ihrem eigenen Container.
4. Slowenien anklicken (Punktwert-Land): die Beträge stimmen mit dem Fee Calculator überein.

- [ ] **Step 7: Commit**

```bash
git add variation-fee-calculator/assets/js/vcl-calc-app.js variation-fee-calculator/variation-fee-calculator.php
git commit -m "feat: reach the fee-data page from the calculator; bump to 1.13.0"
```

---

## Nach dem Plan

- **Nicht automatisch deployen.** Ionos ist die Produktion, das NAS die Testumgebung; der Upload erfolgt durch den Nutzer.
- Memory nachziehen: `[[fee-data-excel-ablösung]]` um Baustein E ergänzen, `[[toolbox-offene-brainstormings]]` auflösen oder auf den verbleibenden offenen Punkt kürzen (Ort des Einstiegs im Calculator).
- Weiterhin offen und ausdrücklich **nicht** Teil dieses Plans: der genaue Ort des Einstiegs, und ob `renderHaWebsitesList()` endgültig entfällt.
