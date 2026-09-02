# Design: Nutzungszähler für die Variation Toolbox

**Datum:** 2026-08-19
**Plugin:** Variation Toolbox (`variation-fee-calculator`)
**Vorbild:** Regenwald-Quiz-Spielzähler (`regenwald-quiz/includes/counter.php` + `dashboard.php`)

## Ziel

Anonym zählen, wie oft jedes der sechs Toolbox-Tools genutzt wird — analog zum
Quiz-Spielzähler, sichtbar als Dashboard-Widget im WP-Admin. Zusätzlich erfassen,
wie oft eine Auswahl aus der Classification per Button an Calculator, Guided
Workflow oder Budget Planning übergeben wird.

Es geht ausdrücklich **nur um Summen** — kein Zeitverlauf, kein Personenbezug.
Wer Trends/Charts will, ist ein späteres, separates Projekt (eigene DB-Tabelle).

## Semantik (verbindlich)

Jede Zählung erfolgt **höchstens einmal pro Sitzung** (Seitenladung) je Tool und
je Ereignistyp — entprellt über ein In-Memory-`Set` im Browser. Damit tragen alle
Zahlen dieselbe Bedeutung: „in wie vielen Besuchen ist X passiert", vergleichbar
zum Quiz-„Spiel".

| Tool | `started` (Aufruf) | `finished` (Abschluss) | `handoff` (Übergabe aus Classification) |
|---|---|---|---|
| Classification | View `browse` gerendert | — | — |
| Guidance | Guidance-Hub / `grouping` / `precisescope` / `qa` gerendert | — | — |
| Timelines | View `timetables` gerendert | — | — |
| Calculator | View `calculator` gerendert | Gebühren-Ergebnis berechnet & angezeigt | Button „→ Calculator" geklickt |
| Guided Workflow | View `workflow` gerendert | Summary-Station (E) erreicht | Button „→ Workflow" geklickt |
| Budget Planning | View `budget` gerendert | erste Planzeile/Submission angelegt | Button „→ Budget" geklickt |

- Nachschlage-Tools (Classification, Guidance, Timelines) haben **kein**
  `finished` und **kein** `handoff` → Widget zeigt dort `–`.
- **Bewusste Design-Entscheidung:** Die App öffnet immer im View `browse` =
  Classification. Dadurch entspricht „Classification gestartet" praktisch der
  Gesamtzahl der Sitzungen (nützliche Bezugsgröße). So gewollt.

## Architektur

Ansatz **A** (Quiz-Muster 1:1): öffentlicher REST-Endpoint → Integer-Optionen in
`wp_options` → Dashboard-Widget. Keine DB-Tabelle, kein externes Analytics.

### 1. Speicher-Schema (`wp_options`, alle `autoload = false`)

Prefix `vfc_usage_`. 12 Integer-Optionen:

```
vfc_usage_classification_started
vfc_usage_guidance_started
vfc_usage_timelines_started
vfc_usage_calculator_started
vfc_usage_calculator_finished
vfc_usage_calculator_handoff
vfc_usage_workflow_started
vfc_usage_workflow_finished
vfc_usage_workflow_handoff
vfc_usage_budget_started
vfc_usage_budget_finished
vfc_usage_budget_handoff
```

Nachschlage-Tools haben bewusst nur `_started`. Optionen werden lazy angelegt
(`get_option(name, 0)`), kein Aktivierungs-Hook nötig.

### 2. REST-Endpoint — `POST /wp-json/vfc/v1/count`

Neue Datei `includes/usage-counter.php`, `require_once` in
`variation-fee-calculator.php`.

- Route über `rest_api_init`, Namespace `vfc/v1`, Pfad `/count`, Methode `POST`.
- `permission_callback => __return_true` und **kein Nonce** — anonyme, evtl.
  gecachte Seiten müssen zählen können; die Aktion ist harmlos (nur „+1"). Exakt
  die Begründung aus `regenwald-quiz/includes/counter.php`.
- Parameter:
  - `tool` ∈ `{ classification, guidance, timelines, calculator, workflow, budget }`
  - `event` ∈ `{ start, finish, handoff }`
- Validierung:
  - `start` für alle sechs Tools erlaubt.
  - `finish` **nur** für `calculator | workflow | budget`, sonst `400`.
  - `handoff` **nur** für `calculator | workflow | budget`, sonst `400`.
  - Jede andere Kombination → `WP_Error` mit `status 400`.
- Aktion: passende Option = `(int) get_option(name, 0) + 1`,
  `update_option(name, value, false)`. Antwort `{ ok: true }` / `200`.
- Optionsname wird aus validierten Whitelisten zusammengesetzt:
  `finish` → Suffix `_finished`, `handoff` → `_handoff`, sonst `_started`.

### 3. Frontend-Zählpunkte — neues Modul `assets/js/vcl-usage.js`

Kleines, isoliertes Modul (~30 Zeilen), unabhängig testbar:

```
window.VCL_USAGE = {
  track(tool, event) {
    const key = tool + ':' + event;
    if (counted.has(key)) return;      // 1×/Sitzung/Ereignis
    counted.add(key);
    const url = (window.VCL_CONFIG && VCL_CONFIG.countUrl) || null;
    if (!url) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, event }),
      keepalive: true,
    }).catch(() => {});               // Zählen darf das Tool nie stören
  }
};
```

Einhängen in `vcl-app.js` und die Tool-Module:

- **`start` (alle sechs) — ein einziger Punkt** in der zentralen `render()`-Funktion
  (um `vcl-app.js:194`, wo `state.view` ausgewertet wird). Aktuellen View +
  `guidanceOpen`/`guidanceHub` auf einen Tool-Key mappen und
  `VCL_USAGE.track(key, 'start')` rufen. Robust: greift unabhängig davon, über
  welchen Pfad (Nav-Button, Overview-Card, Deep-Link, `goToDestination`) der View
  erreicht wird. `render()` läuft oft — der Dedup-`Set` sorgt für 1×/Sitzung.
  - Mapping: `browse`/`summary`/`art5` → `classification`;
    `grouping`/`precisescope`/`qa` **oder** `guidanceHub` sichtbar → `guidance`;
    `timetables` → `timelines`; `calculator` → `calculator`;
    `workflow` → `workflow`; `budget` → `budget`.
- **`finish` calculator** — an der Stelle, wo ein Gebühren-Ergebnis erfolgreich
  gerendert wird (Calculator-Ergebnisansicht).
- **`finish` workflow** — beim Rendern der Summary-Station (E) in `vcl-workflow.js`.
- **`finish` budget** — in der „Planzeile/Submission hinzufügen"-Funktion in
  `vcl-budget.js` (beim ersten erfolgreichen Hinzufügen; Dedup verhindert
  Mehrfachzählung in derselben Sitzung).
- **`handoff` (drei)** — je ein `track` in den bestehenden Click-Handlern der
  Übergabe-Buttons in `vcl-app.js`:
  - `summaryExportCalculator` (`vcl-app.js:2562`) → `track('calculator','handoff')`
  - `summaryExportWorkflow` (`vcl-app.js:2582`) → `track('workflow','handoff')`
  - `summaryExportBudget` (`vcl-app.js:2603`) → `track('budget','handoff')`

### 4. Enqueue / Config

In `includes/lookup.php`:
- `vcl-usage.js` registrieren (bei `vcl_register_assets`, ~`lookup.php:88`) und
  im Shortcode enqueuen (bei `vcl_enqueue`, ~`lookup.php:314`), als Dependency von
  `vcl-app` oder davor geladen.
- Bestehenden `wp_localize_script('vcl-app', 'VCL_CONFIG', …)`-Aufruf
  (~`lookup.php:322`) um `'countUrl' => rest_url('vfc/v1/count')` ergänzen.

### 5. Dashboard-Widget — `includes/usage-dashboard.php`

Neue Datei, `require_once` in der Haupt-PHP. Nur `current_user_can('manage_options')`.
Registrierung über `wp_dashboard_setup` (`wp_add_dashboard_widget`), Titel
„Variation Toolbox – Nutzung". Aufbau 1:1 im Quiz-Look:

- Kopfzeile als Text: Gesamt gestartet · Gesamt abgeschlossen · Abschlussquote.
- Tabelle `widefat striped`, feste Reihenfolge/Labels der sechs Tools:

  | Tool | Gestartet | Abgeschlossen | Quote | Aus Classification übergeben |
  |---|---|---|---|---|
  | Classification | n | – | – | – |
  | Guidance | n | – | – | – |
  | Timelines | n | – | – | – |
  | Calculator | n | n | % | n |
  | Guided Workflow | n | n | % | n |
  | Budget Planning | n | n | % | n |
  | **Gesamt** | Σ | Σ | % | Σ |

- Quote = `round(finished / started * 100) . ' %'`; bei `started <= 0` → `–`
  (Hilfsfunktion analog `rwq_completion_rate`).
- „Abgeschlossen"/„Quote"/„Übergeben" bei Nachschlage-Tools = `–`.
- **Reset**: Formular (`method=post`) an `admin-post.php` mit
  `action = vfc_reset_usage`, `wp_nonce_field` + `check_admin_referer`,
  `current_user_can('manage_options')`. Handler setzt alle zwölf Optionen auf `0`
  (bzw. `delete_option`) und `wp_safe_redirect` zurück zum Dashboard. Keine neue
  Admin-Menüseite nötig.

## DSGVO

Kein IP, kein Timestamp, keine personenbezogenen Daten — ausschließlich
aggregierte Integer-Summen. Der öffentliche Endpoint ist unkritisch (nur „+1" auf
whitelisted Zähler). Kein Consent-Banner erforderlich. Identische Begründung wie
beim bereits produktiven Quiz-Zähler.

## Betroffene / neue Dateien

**Neu:**
- `includes/usage-counter.php` (REST-Endpoint + optional Reset-Handler)
- `includes/usage-dashboard.php` (Dashboard-Widget; Reset-Handler kann hier oder in
  usage-counter.php liegen)
- `assets/js/vcl-usage.js` (Zähl-Client)

**Additive Änderungen:**
- `variation-fee-calculator.php` — zwei `require_once`.
- `includes/lookup.php` — `vcl-usage.js` register/enqueue + `countUrl` im Localize.
- `assets/js/vcl-app.js` — ein `start`-Zählpunkt in `render()`; drei `handoff`-Zeilen
  in den Export-Button-Handlern.
- `assets/js/vcl-workflow.js` — `finish` an der Summary-Station.
- `assets/js/vcl-budget.js` — `finish` beim ersten Anlegen einer Planzeile.

## Deploy

Wie üblich: `build_zip.py` am Repo-Root → NAS-WordPress
(`X:\wordpress\wp-content\plugins\variation-fee-calculator\`). Drei neue Dateien in
die ZIP-Whitelist aufnehmen, falls `build_zip.py` explizit listet.

## Nicht im Scope (YAGNI)

- Zeitverlauf / Tages- oder Monatswerte / Charts.
- Unterscheidung einzelner Guidance-Dokumente oder Timetable-Tabs.
- Eindeutige-Nutzer-Zählung (localStorage/Cookies).
- Export der Zähler.
