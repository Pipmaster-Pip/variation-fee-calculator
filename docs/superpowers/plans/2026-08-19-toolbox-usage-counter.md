# Variation Toolbox – Nutzungszähler: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonym zählen, wie oft jedes der sechs Toolbox-Tools genutzt (gestartet, abgeschlossen, aus der Classification übergeben) wird, sichtbar als WP-Dashboard-Widget — nach dem Vorbild des Regenwald-Quiz-Spielzählers.

**Architecture:** Öffentlicher REST-Endpoint `POST /wp-json/vfc/v1/count` schreibt Integer-Zähler in `wp_options`. Ein schlankes Frontend-Modul (`vcl-usage.js`) feuert je Ereignis höchstens einen POST pro Seitenladung (In-Memory-Dedup). Ein Dashboard-Widget zeigt die Summen; ein Reset über `admin-post.php` setzt sie zurück. Keine DB-Tabelle, kein externes Analytics.

**Tech Stack:** PHP (WordPress Plugin API: REST, Options, Dashboard, admin-post), Vanilla JS (kein Build-Step), Node 24 (nur für den JS-Unit-Test), `build_zip.py` (Deploy-Paket).

## Global Constraints

Verbindlich für **alle** Tasks (verbatim aus dem Spec):

- Jede Zählung erfolgt **höchstens einmal pro Sitzung** (Seitenladung) je Tool und Ereignistyp — In-Memory-`Set`/Objekt im Browser.
- Options-Prefix `vfc_usage_`, **immer** `update_option( $name, $value, false )` (kein Autoload).
- Count-Endpoint: `permission_callback => __return_true`, **kein Nonce** (anonyme, evtl. gecachte Seiten). Aktion nur „+1" auf whitelisted Zähler.
- `start` gilt für alle sechs Tools; `finish` und `handoff` **nur** für `calculator | workflow | budget` — jede andere Kombination → HTTP 400.
- Tool-Keys (exakt): `classification`, `guidance`, `timelines`, `calculator`, `workflow`, `budget`.
- Reset nur über `admin-post.php` mit `check_admin_referer` + `current_user_can( 'manage_options' )`.
- Kein IP, kein Timestamp, keine personenbezogenen Daten — nur aggregierte Integer.
- Zählen darf das Tool **nie** stören: alle `fetch`-Fehler still verschlucken.
- Die drei neuen Plugin-Dateien müssen in `build_zip.py` → `FILES` aufgenommen werden, sonst schlägt der Build fehl.
- Test-Dateien liegen im **Repo-Root** (`D:\Claude\Variation Fee Calculator\tests\`), **nie** im Plugin-Ordner (sonst bricht `build_zip.py` mit „unlisted files").
- **Commits/Push nur auf ausdrückliche Freigabe des Users** (Projektregel). Die Commit-Steps unten zeigen die vorgesehene Conventional-Commit-Message; nicht eigenständig committen/pushen.
- Kein lokaler PHP-Interpreter und keine lokale WordPress-Instanz vorhanden → die PHP/REST-Seite wird per Browser-DevTools (und optional curl) gegen die **deployte** NAS-Instanz verifiziert; der JS-Kern lokal per Node.

**Pfade:**
- Plugin-Root: `D:\Claude\Variation Fee Calculator\variation-fee-calculator\`
- Repo-Root: `D:\Claude\Variation Fee Calculator\` (enthält `build_zip.py`, `tests\`, `docs\`)

---

## Task 1: Frontend-Zählmodul `vcl-usage.js` (Node-TDD)

Das isolierte Zähl-Client-Modul. Läuft im Browser (`window.VCL_USAGE`) und unter Node (`module.exports`), damit die Dedup-/Payload-Logik lokal testbar ist.

**Files:**
- Create: `variation-fee-calculator/assets/js/vcl-usage.js`
- Test: `tests/vcl-usage.test.mjs` (im Repo-Root, außerhalb des Plugins!)

**Interfaces:**
- Produces: `window.VCL_USAGE.track(tool, event)` — feuert höchstens einen `POST` an `window.VCL_CONFIG.countUrl` pro `tool:event` pro Seitenladung. Liest `countUrl` und `fetch` bei **jedem** Aufruf frisch (nicht beim Laden), damit ein früher Aufruf ohne gesetzte Config später erneut versuchen kann.
- Consumes: `window.VCL_CONFIG.countUrl` (in Task 3 gesetzt).

- [ ] **Step 1: Failing test schreiben** — `tests/vcl-usage.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import usage from "../variation-fee-calculator/assets/js/vcl-usage.js";

// Helper: install a counting fetch mock + config on globalThis, return the calls array.
function install(countUrl) {
  const calls = [];
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(); };
  globalThis.VCL_CONFIG = countUrl ? { countUrl } : {};
  return calls;
}

test("fires exactly one POST with the right JSON body for a fresh key", () => {
  const calls = install("http://x/count");
  usage.track("timelines", "start");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://x/count");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { tool: "timelines", event: "start" });
});

test("dedups: the same key never fires twice", () => {
  const calls = install("http://x/count");
  usage.track("calculator", "finish");
  usage.track("calculator", "finish");
  assert.equal(calls.length, 1);
});

test("no countUrl -> no fetch, and the key stays retryable", () => {
  const calls = install(null);            // config without countUrl
  usage.track("budget", "handoff");
  assert.equal(calls.length, 0);
  const calls2 = install("http://x/count"); // now configured
  usage.track("budget", "handoff");         // same key must still fire
  assert.equal(calls2.length, 1);
});

test("a throwing fetch never propagates to the caller", () => {
  install("http://x/count");
  globalThis.fetch = () => { throw new Error("boom"); };
  assert.doesNotThrow(() => usage.track("workflow", "finish"));
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd "D:/Claude/Variation Fee Calculator" && node --test tests/vcl-usage.test.mjs`
Expected: FAIL — `Cannot find module .../vcl-usage.js`.

- [ ] **Step 3: Minimal-Implementierung** — `variation-fee-calculator/assets/js/vcl-usage.js`

```js
// Anonymous usage-counter client for the Variation Toolbox. Fires at most one POST
// per tool+event per page load (in-memory dedup); every failure is swallowed so
// counting can never disturb the tool. No IP, no timestamp -- see
// includes/usage-counter.php for the endpoint and the GDPR rationale.
(function (root) {
  "use strict";

  var counted = Object.create(null); // "tool:event" -> true, for this page load only

  function track(tool, event) {
    var key = tool + ":" + event;
    if (counted[key]) return;

    // Read config + fetch fresh on every call: an early call before VCL_CONFIG is
    // set must not permanently mark the key as done.
    var cfg = root.VCL_CONFIG || {};
    var url = cfg.countUrl;
    if (!url || typeof root.fetch !== "function") return;

    counted[key] = true; // mark only once we actually attempt the request
    try {
      root.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool, event: event }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {
      /* never let counting throw into the caller */
    }
  }

  var api = { track: track };
  root.VCL_USAGE = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `cd "D:/Claude/Variation Fee Calculator" && node --test tests/vcl-usage.test.mjs`
Expected: PASS — `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit** (nur nach User-Freigabe)

```bash
git add variation-fee-calculator/assets/js/vcl-usage.js tests/vcl-usage.test.mjs
git commit -m "feat: add anonymous usage-counter client (vcl-usage.js)"
```

---

## Task 2: REST-Endpoint + Optionsname-Logik `includes/usage-counter.php`

Der öffentliche Zähl-Endpoint samt reiner, per Code-Review/curl prüfbarer Mapping-Funktion.

**Files:**
- Create: `variation-fee-calculator/includes/usage-counter.php`
- Modify: `variation-fee-calculator/variation-fee-calculator.php` (ein `require_once`)

**Interfaces:**
- Produces:
  - `vfc_usage_option_name( string $tool, string $event ): ?string` — validierter Optionsname oder `null`. Pure (keine WP-Aufrufe).
  - REST-Route `POST /wp-json/vfc/v1/count` mit Params `tool`, `event` → `{ ok: true }` / 200, oder `WP_Error` 400.
  - Konstanten-Listen `vfc_usage_start_tools()` / `vfc_usage_result_tools()` (auch von Task 6 genutzt).

- [ ] **Step 1: Endpoint-Datei schreiben** — `variation-fee-calculator/includes/usage-counter.php`

```php
<?php
/**
 * Anonymous usage counter for the Variation Toolbox. A public REST endpoint
 * increments per-tool integer counters (started / finished / handoff). No IP,
 * no timestamp, no personal data -- GDPR-uncritical by design. Mirrors the
 * proven Regenwald-Quiz counter.
 *
 * @package Variation_Fee_Calculator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tools that accept a 'start' event (all six).
 *
 * @return string[]
 */
function vfc_usage_start_tools() {
	return array( 'classification', 'guidance', 'timelines', 'calculator', 'workflow', 'budget' );
}

/**
 * Tools that additionally accept 'finish' and 'handoff' (the three run-through tools).
 *
 * @return string[]
 */
function vfc_usage_result_tools() {
	return array( 'calculator', 'workflow', 'budget' );
}

/**
 * Maps a tool+event pair to its wp_options counter name, or null if the pair is
 * not allowed. Pure -- no WordPress calls -- so it stays trivially reviewable.
 *
 * @param string $tool  Tool key.
 * @param string $event 'start' | 'finish' | 'handoff'.
 * @return string|null  Option name, or null when the pair is invalid.
 */
function vfc_usage_option_name( $tool, $event ) {
	if ( 'start' === $event ) {
		if ( ! in_array( $tool, vfc_usage_start_tools(), true ) ) {
			return null;
		}
		return 'vfc_usage_' . $tool . '_started';
	}
	if ( 'finish' === $event || 'handoff' === $event ) {
		if ( ! in_array( $tool, vfc_usage_result_tools(), true ) ) {
			return null;
		}
		$suffix = ( 'finish' === $event ) ? '_finished' : '_handoff';
		return 'vfc_usage_' . $tool . $suffix;
	}
	return null;
}

/**
 * Registers POST /wp-json/vfc/v1/count. Open + nonce-free on purpose: anonymous,
 * possibly cached pages must be able to count, and the action only ever adds 1 to
 * a whitelisted counter.
 */
function vfc_usage_register_count_route() {
	register_rest_route(
		'vfc/v1',
		'/count',
		array(
			'methods'             => 'POST',
			'callback'            => 'vfc_usage_count_callback',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'vfc_usage_register_count_route' );

/**
 * Handles a count request: validates tool+event against the whitelist and
 * increments the matching integer option.
 *
 * @param WP_REST_Request $request Request object.
 * @return WP_REST_Response|WP_Error
 */
function vfc_usage_count_callback( $request ) {
	$tool  = (string) $request->get_param( 'tool' );
	$event = (string) $request->get_param( 'event' );

	$option = vfc_usage_option_name( $tool, $event );
	if ( null === $option ) {
		return new WP_Error( 'vfc_bad_count', 'Invalid tool/event.', array( 'status' => 400 ) );
	}

	$value = (int) get_option( $option, 0 ) + 1;
	update_option( $option, $value, false );

	return new WP_REST_Response( array( 'ok' => true ), 200 );
}
```

- [ ] **Step 2: `require_once` einfügen** — `variation-fee-calculator/variation-fee-calculator.php`

Direkt nach der bestehenden Zeile `require_once VFC_PLUGIN_DIR . 'includes/lookup.php';` ergänzen:

```php
require_once VFC_PLUGIN_DIR . 'includes/usage-counter.php';
```

- [ ] **Step 3: Reine Mapping-Logik gegen die Spec prüfen (Review-Gate, kein Runner)**

Prüfe per Durchsicht die Wahrheitstabelle von `vfc_usage_option_name`:

| tool | event | erwartet |
|---|---|---|
| `classification` | `start` | `vfc_usage_classification_started` |
| `guidance` | `finish` | `null` (nur start erlaubt) |
| `calculator` | `finish` | `vfc_usage_calculator_finished` |
| `budget` | `handoff` | `vfc_usage_budget_handoff` |
| `timelines` | `handoff` | `null` (kein Result-Tool) |
| `calculator` | `nonsense` | `null` |

Expected: alle Zeilen stimmen mit dem Code überein. (Die vollständige Laufzeit-Verifikation erfolgt per curl in Task 7.)

- [ ] **Step 4: Commit** (nur nach User-Freigabe)

```bash
git add variation-fee-calculator/includes/usage-counter.php variation-fee-calculator/variation-fee-calculator.php
git commit -m "feat: add public vfc/v1/count REST endpoint for usage counters"
```

---

## Task 3: Enqueue + Config in `lookup.php`

`vcl-usage.js` ausliefern und dem Frontend die Endpoint-URL bekannt machen.

**Files:**
- Modify: `variation-fee-calculator/includes/lookup.php` (register ~`:88`, enqueue ~`:314`, localize ~`:322`)

**Interfaces:**
- Consumes: `assets/js/vcl-usage.js` (Task 1), REST-Route (Task 2).
- Produces: `window.VCL_CONFIG.countUrl` im Frontend; geladenes `vcl-usage`-Script vor `vcl-app`.

- [ ] **Step 1: Script registrieren** — im Block bei `vcl_register_assets` (dort, wo `wp_register_script( 'vcl-app', ... )` steht, ~`lookup.php:88`), davor oder daneben:

```php
wp_register_script(
	'vcl-usage',
	VFC_PLUGIN_URL . 'assets/js/vcl-usage.js',
	array(),
	VFC_VERSION,
	true
);
```

- [ ] **Step 2: Script enqueuen** — in `vcl_enqueue`, direkt vor `wp_enqueue_script( 'vcl-app' );` (~`lookup.php:314`):

```php
wp_enqueue_script( 'vcl-usage' );
```

- [ ] **Step 3: `countUrl` in den bestehenden Localize aufnehmen** — im `wp_localize_script( 'vcl-app', 'VCL_CONFIG', array( ... ) )`-Aufruf (~`lookup.php:322`) einen Eintrag ergänzen:

```php
'countUrl' => rest_url( 'vfc/v1/count' ),
```

- [ ] **Step 4: Verifikation (nach Deploy in Task 7)** — im Browser auf der Toolbox-Seite DevTools-Konsole:

Run (Browser-Konsole): `window.VCL_CONFIG.countUrl`
Expected: endet auf `/wp-json/vfc/v1/count`. Im Network-/Sources-Tab ist `vcl-usage.js` geladen.

- [ ] **Step 5: Commit** (nur nach User-Freigabe)

```bash
git add variation-fee-calculator/includes/lookup.php
git commit -m "feat: enqueue vcl-usage.js and expose countUrl via VCL_CONFIG"
```

---

## Task 4: `start`-Zählpunkt in `vcl-app.js` (`render()`)

Ein einziger, robuster Startpunkt — bildet den aktuellen View auf den Tool-Key ab und zählt einmal pro Sitzung.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-app.js` (Helper nahe `render()`; Aufruf in `render()` ~`:194`–`:202`)

**Interfaces:**
- Consumes: `window.VCL_USAGE.track` (Task 1), `state.view`, `state.guidanceHub`.
- Produces: `usageToolForView()` (interner Helper).

- [ ] **Step 1: Mapping-Helper einfügen** — im selben Scope wie `render()` (z. B. direkt vor `render()`):

```js
// Maps the current view/guidance state onto the six usage-counter tool keys.
// browse/summary/art5 default to "classification" (the app's landing view), so
// "classification started" is effectively the per-session baseline -- intended.
function usageToolForView() {
  if (state.view === "timetables") return "timelines";
  if (state.view === "calculator") return "calculator";
  if (state.view === "workflow") return "workflow";
  if (state.view === "budget") return "budget";
  if (state.view === "grouping" || state.view === "precisescope" || state.view === "qa" || state.guidanceHub) {
    return "guidance";
  }
  return "classification";
}
```

- [ ] **Step 2: Zählaufruf in `render()`** — an den Anfang von `render()` (nach der Ermittlung von `state.view`, vor/neben den `const isSummary = ...`-Zeilen ~`:194`):

```js
if (window.VCL_USAGE) window.VCL_USAGE.track(usageToolForView(), "start");
```

- [ ] **Step 3: Verifikation (nach Deploy in Task 7)** — Browser mit offenem Network-Tab (Filter `count`):
  - Seite laden → genau **ein** POST `count` mit Body `{"tool":"classification","event":"start"}`.
  - Auf „Timelines" wechseln → ein POST `{"tool":"timelines","event":"start"}`.
  - Erneut zwischen Classification/Timelines hin- und herwechseln → **keine** weiteren `count`-Requests (Dedup).
  Expected: jeder Tool-Key feuert `start` genau einmal pro Seitenladung.

- [ ] **Step 4: Commit** (nur nach User-Freigabe)

```bash
git add variation-fee-calculator/assets/js/vcl-app.js
git commit -m "feat: count tool 'start' once per session in render()"
```

---

## Task 5: `finish`- und `handoff`-Zählpunkte

Die drei Abschluss-Signale (Calculator/Workflow/Budget) und die drei Übergaben aus der Classification.

**Files:**
- Modify: `variation-fee-calculator/assets/js/vcl-calc-app.js` (Result-Rendering, nahe `appState.results`)
- Modify: `variation-fee-calculator/assets/js/vcl-workflow.js` (Rendern von Station `E`)
- Modify: `variation-fee-calculator/assets/js/vcl-budget.js` (Commit einer neuen Planzeile)
- Modify: `variation-fee-calculator/assets/js/vcl-app.js` (drei Export-Button-Listener)

**Interfaces:**
- Consumes: `window.VCL_USAGE.track` (Task 1).

- [ ] **Step 1: Calculator-`finish`** — in `vcl-calc-app.js` an der Stelle, an der der Ergebnis-Step nach erfolgreicher Berechnung gerendert wird (die Funktion, die `appState.results` anzeigt; `results` wurde via `computeFees` gesetzt und ist nicht `null`). Unmittelbar nach dem Setzen/Vorliegen gültiger `appState.results`:

```js
if (appState.results && window.VCL_USAGE) window.VCL_USAGE.track("calculator", "finish");
```

Finde die genaue Stelle per Suche nach `appState.results` (Zuweisung des `computeFees(...)`-Rückgabewerts bzw. der Result-Render-Funktion). Der Dedup sorgt dafür, dass mehrfaches Neurechnen in derselben Sitzung nur einmal zählt.

- [ ] **Step 2: Workflow-`finish`** — in `vcl-workflow.js` in `rerender()` (bzw. der zentralen Render-Funktion), wenn die letzte Station gerendert wird:

```js
if (state.station === "E" && window.VCL_USAGE) window.VCL_USAGE.track("workflow", "finish");
```

(Station `E` = „Fees", die Abschluss-/Export-Station laut `STATIONS`.)

- [ ] **Step 3: Budget-`finish`** — in `vcl-budget.js` im Handler des „+ Add line"-Buttons (`vcl-budget.js:1791`; der Nicht-Edit-Zweig, in dem `modalState.editingId` leer ist), unmittelbar nachdem die neue Planzeile erfolgreich in den Budget-State übernommen wurde:

```js
if (window.VCL_USAGE) window.VCL_USAGE.track("budget", "finish");
```

Nur im Anlege-Zweig (neue Zeile), nicht beim Speichern einer bestehenden Zeile.

- [ ] **Step 4: Drei `handoff`-Zählpunkte** — in `vcl-app.js`, jeweils als erste Zeile in den bestehenden Click-Handlern:
  - `el.summaryExportCalculator.addEventListener("click", ...)` (`vcl-app.js:2562`):
    ```js
    if (window.VCL_USAGE) window.VCL_USAGE.track("calculator", "handoff");
    ```
  - `el.summaryExportWorkflow.addEventListener("click", ...)` (`vcl-app.js:2582`):
    ```js
    if (window.VCL_USAGE) window.VCL_USAGE.track("workflow", "handoff");
    ```
  - `el.summaryExportBudget.addEventListener("click", ...)` (`vcl-app.js:2603`):
    ```js
    if (window.VCL_USAGE) window.VCL_USAGE.track("budget", "handoff");
    ```

- [ ] **Step 5: Verifikation (nach Deploy in Task 7)** — Browser, Network-Filter `count`:
  - Im Calculator ein Ergebnis berechnen → `{"tool":"calculator","event":"finish"}`.
  - Guided Workflow bis Station „Fees" durchklicken → `{"tool":"workflow","event":"finish"}`.
  - Im Budget eine erste Planzeile anlegen → `{"tool":"budget","event":"finish"}`.
  - In der Classification Variations wählen und je Button an Calculator/Workflow/Budget übergeben → je ein `handoff`-POST.
  Expected: korrekte `tool`/`event`-Paare, je 1×/Sitzung.

- [ ] **Step 6: Commit** (nur nach User-Freigabe)

```bash
git add variation-fee-calculator/assets/js/vcl-calc-app.js variation-fee-calculator/assets/js/vcl-workflow.js variation-fee-calculator/assets/js/vcl-budget.js variation-fee-calculator/assets/js/vcl-app.js
git commit -m "feat: count finish + classification handoff events"
```

---

## Task 6: Dashboard-Widget + Reset `includes/usage-dashboard.php`

Anzeige der Zähler im WP-Admin plus Reset.

**Files:**
- Create: `variation-fee-calculator/includes/usage-dashboard.php`
- Modify: `variation-fee-calculator/variation-fee-calculator.php` (ein `require_once`)

**Interfaces:**
- Consumes: die `vfc_usage_*`-Options (Task 2/4/5).
- Produces: Dashboard-Widget `vfc_usage_counts`; `admin_post_vfc_reset_usage`-Handler; Helper `vfc_usage_rows_meta()`, `vfc_usage_all_options()`, `vfc_usage_rate()`.

- [ ] **Step 1: Widget-Datei schreiben** — `variation-fee-calculator/includes/usage-dashboard.php`

```php
<?php
/**
 * Admin dashboard widget: Variation-Toolbox usage overview. Pure display of the
 * counters written by includes/usage-counter.php, plus a reset. No new data
 * collection.
 *
 * @package Variation_Fee_Calculator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The six tools in display order: key, label, and whether they carry
 * finished/handoff columns (only the three run-through tools do).
 *
 * @return array[]
 */
function vfc_usage_rows_meta() {
	return array(
		array( 'key' => 'classification', 'label' => 'Classification',  'result' => false ),
		array( 'key' => 'guidance',       'label' => 'Guidance',        'result' => false ),
		array( 'key' => 'timelines',      'label' => 'Timelines',       'result' => false ),
		array( 'key' => 'calculator',     'label' => 'Calculator',      'result' => true ),
		array( 'key' => 'workflow',       'label' => 'Guided Workflow', 'result' => true ),
		array( 'key' => 'budget',         'label' => 'Budget Planning', 'result' => true ),
	);
}

/**
 * All counter option names (used by the widget and the reset handler).
 *
 * @return string[]
 */
function vfc_usage_all_options() {
	$names = array();
	foreach ( vfc_usage_rows_meta() as $row ) {
		$names[] = 'vfc_usage_' . $row['key'] . '_started';
		if ( $row['result'] ) {
			$names[] = 'vfc_usage_' . $row['key'] . '_finished';
			$names[] = 'vfc_usage_' . $row['key'] . '_handoff';
		}
	}
	return $names;
}

/**
 * Formats finished/started as a percentage, or an en dash when there is nothing
 * to divide by.
 *
 * @param int $started  Number of starts.
 * @param int $finished Number of completions.
 * @return string
 */
function vfc_usage_rate( $started, $finished ) {
	if ( $started <= 0 ) {
		return '–';
	}
	return round( $finished / $started * 100 ) . ' %';
}

/**
 * Registers the dashboard widget (admins only).
 */
function vfc_usage_add_dashboard_widget() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	wp_add_dashboard_widget(
		'vfc_usage_counts',
		'Variation Toolbox – Nutzung',
		'vfc_usage_render_dashboard_widget'
	);
}
add_action( 'wp_dashboard_setup', 'vfc_usage_add_dashboard_widget' );

/**
 * Renders the widget: per-tool table, totals, and a reset button.
 */
function vfc_usage_render_dashboard_widget() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$rows           = array();
	$total_started  = 0;
	$total_finished = 0;
	$total_handoff  = 0;

	foreach ( vfc_usage_rows_meta() as $meta ) {
		$s = (int) get_option( 'vfc_usage_' . $meta['key'] . '_started', 0 );
		$f = $meta['result'] ? (int) get_option( 'vfc_usage_' . $meta['key'] . '_finished', 0 ) : null;
		$h = $meta['result'] ? (int) get_option( 'vfc_usage_' . $meta['key'] . '_handoff', 0 ) : null;

		$total_started += $s;
		if ( null !== $f ) {
			$total_finished += $f;
		}
		if ( null !== $h ) {
			$total_handoff += $h;
		}
		$rows[] = array( 'label' => $meta['label'], 's' => $s, 'f' => $f, 'h' => $h );
	}
	?>
	<p style="font-size:13px; margin:0 0 8px;">
		<strong><?php echo (int) $total_started; ?></strong> gestartet ·
		<strong><?php echo (int) $total_finished; ?></strong> abgeschlossen ·
		<?php echo esc_html( vfc_usage_rate( $total_started, $total_finished ) ); ?> Abschlussquote
	</p>
	<table class="widefat striped">
		<thead>
			<tr>
				<th>Tool</th>
				<th style="text-align:right;">Gestartet</th>
				<th style="text-align:right;">Abgeschlossen</th>
				<th style="text-align:right;">Quote</th>
				<th style="text-align:right;">Aus Classification übergeben</th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $rows as $r ) : ?>
				<tr>
					<td><?php echo esc_html( $r['label'] ); ?></td>
					<td style="text-align:right;"><?php echo (int) $r['s']; ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['f'] ) ? '–' : (int) $r['f']; ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['f'] ) ? '–' : esc_html( vfc_usage_rate( $r['s'], $r['f'] ) ); ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['h'] ) ? '–' : (int) $r['h']; ?></td>
				</tr>
			<?php endforeach; ?>
		</tbody>
		<tfoot>
			<tr>
				<th>Gesamt</th>
				<th style="text-align:right;"><?php echo (int) $total_started; ?></th>
				<th style="text-align:right;"><?php echo (int) $total_finished; ?></th>
				<th style="text-align:right;"><?php echo esc_html( vfc_usage_rate( $total_started, $total_finished ) ); ?></th>
				<th style="text-align:right;"><?php echo (int) $total_handoff; ?></th>
			</tr>
		</tfoot>
	</table>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin:8px 0 0;"
		onsubmit="return confirm('Alle Nutzungszähler der Variation Toolbox auf 0 zurücksetzen?');">
		<input type="hidden" name="action" value="vfc_reset_usage">
		<?php wp_nonce_field( 'vfc_reset_usage' ); ?>
		<button type="submit" class="button-link" style="color:#b32d2e;">Zähler zurücksetzen</button>
	</form>
	<?php
}

/**
 * Resets every usage counter to zero. Admin-only, nonce-checked.
 */
function vfc_usage_handle_reset() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Insufficient permissions.' );
	}
	check_admin_referer( 'vfc_reset_usage' );

	foreach ( vfc_usage_all_options() as $name ) {
		update_option( $name, 0, false );
	}

	wp_safe_redirect( admin_url( 'index.php' ) );
	exit;
}
add_action( 'admin_post_vfc_reset_usage', 'vfc_usage_handle_reset' );
```

- [ ] **Step 2: `require_once` einfügen** — `variation-fee-calculator/variation-fee-calculator.php`, direkt nach der `usage-counter.php`-Zeile aus Task 2:

```php
require_once VFC_PLUGIN_DIR . 'includes/usage-dashboard.php';
```

- [ ] **Step 3: Verifikation (nach Deploy in Task 7)** — WP-Admin → Dashboard:
  - Widget „Variation Toolbox – Nutzung" ist sichtbar mit sechs Tool-Zeilen + Gesamt-Zeile.
  - Nachschlage-Tools zeigen in „Abgeschlossen"/„Quote"/„Übergeben" ein `–`.
  - Nach ein paar Test-Interaktionen (Task 4/5) spiegeln die Zahlen die ausgelösten Events.
  - „Zähler zurücksetzen" klicken → nach Bestätigung alle Werte auf `0`.
  Expected: Anzeige und Reset funktionieren wie beschrieben.

- [ ] **Step 4: Commit** (nur nach User-Freigabe)

```bash
git add variation-fee-calculator/includes/usage-dashboard.php variation-fee-calculator/variation-fee-calculator.php
git commit -m "feat: add usage dashboard widget with reset"
```

---

## Task 7: Build-Whitelist, Paket & End-to-End-Verifikation

Neue Dateien ins Deploy-Paket aufnehmen, Build lokal prüfen, deployen, End-to-End verifizieren.

**Files:**
- Modify: `build_zip.py` (`FILES`-Liste)

**Interfaces:**
- Consumes: alle vorherigen Tasks.

- [ ] **Step 1: `FILES` in `build_zip.py` ergänzen** — die drei neuen Dateien in die `FILES`-Liste aufnehmen (bei den passenden Gruppen):

```python
    "includes/usage-counter.php",
    "includes/usage-dashboard.php",
    "assets/js/vcl-usage.js",
```

- [ ] **Step 2: Build lokal ausführen (verifiziert die Datei-Whitelist)**

Run: `cd "D:/Claude/Variation Fee Calculator" && python build_zip.py`
Expected: kein Fehler; `variation-fee-calculator.zip` wird erzeugt. Insbesondere **kein** „ERROR missing files" und **kein** „ERROR unlisted files" (Letzteres bestätigt, dass keine Test-/Doc-Datei im Plugin-Ordner liegt).

- [ ] **Step 3: JS-Regressionstest erneut laufen lassen**

Run: `cd "D:/Claude/Variation Fee Calculator" && node --test tests/vcl-usage.test.mjs`
Expected: PASS — `# fail 0`.

- [ ] **Step 4: Deploy auf NAS** (durch den User, wie üblich) — ZIP hochladen bzw. Plugin-Ordner nach `X:\wordpress\wp-content\plugins\variation-fee-calculator\` spiegeln und Plugin (re)aktivieren, sodass der neue REST-Endpoint registriert wird.

- [ ] **Step 5: Endpoint-Contract per curl prüfen** (optional, ergänzend zur Browser-Verifikation). `<SITE>` = Basis-URL der WordPress-Instanz, auf der die Toolbox läuft (die der User kennt):

```bash
curl -s -X POST "<SITE>/wp-json/vfc/v1/count" -H "Content-Type: application/json" -d '{"tool":"calculator","event":"finish"}'
# Expected: {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" -X POST "<SITE>/wp-json/vfc/v1/count" -H "Content-Type: application/json" -d '{"tool":"timelines","event":"finish"}'
# Expected: 400  (finish nur für calculator/workflow/budget)
```

- [ ] **Step 6: Browser-End-to-End im echten Chrome** (Projektregel: in-app-Browser-Pane oft tot → echtes Chrome) — Network-Filter `count`:
  - Toolbox-Seite laden → `classification start`.
  - Jedes Tool einmal öffnen → je ein `start` mit korrektem Key; Wiederholtes Wechseln → keine Duplikate.
  - Calculator-Ergebnis, Workflow bis „Fees", Budget erste Zeile → je ein `finish`.
  - Drei Übergabe-Buttons → je ein `handoff`.
  - WP-Admin-Dashboard-Widget spiegelt die Zahlen; Reset setzt auf `0`.
  Expected: alle Ereignisse landen korrekt; Widget und Reset stimmen.

- [ ] **Step 7: Commit** (nur nach User-Freigabe)

```bash
git add build_zip.py
git commit -m "build: ship usage-counter files (endpoint, dashboard, client)"
```

---

## Self-Review (vom Planautor durchgeführt)

- **Spec-Abdeckung:** Speicher-Schema → Task 2/6; REST-Endpoint → Task 2; JS-Zählpunkte (1× start, 3× finish, 3× handoff) → Task 4/5; Enqueue+countUrl → Task 3; Dashboard+Reset → Task 6; DSGVO (kein Nonce/Personenbezug) → Task 2 (verankert in Global Constraints); Deploy+FILES → Task 7. Keine Lücke.
- **Platzhalter:** keine „TBD/TODO"; jeder Code-Step enthält vollständigen Code. Einzige bewusste Nicht-Literale: `<SITE>` in Task 7/Step 5 (externe, dem User bekannte URL) und die per-Suche zu findende exakte Result-Render-Zeile in Task 5/Step 1 (Anker via `appState.results` benannt).
- **Typ-/Namenskonsistenz:** `vfc_usage_option_name`, `vfc_usage_start_tools`, `vfc_usage_result_tools`, `vfc_usage_rows_meta`, `vfc_usage_all_options`, `vfc_usage_rate`, `window.VCL_USAGE.track`, Options-Prefix `vfc_usage_`, Tool-Keys und Event-Namen durchgehend identisch verwendet.
