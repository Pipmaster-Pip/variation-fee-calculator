# Admin tab "Einleitungstexte" — editable tool intro texts (Design)

Date: 2026-10-09
Status: Approved for implementation
Scope: Variation Toolbox admin page + the tool renderers

## 1. Goal

Let the admin author the one descriptive **intro paragraph** shown under each tool's
heading, from a new "Einleitungstexte" tab in the Variation Toolbox admin page. Each tool's
heading, its "Reference:" line and its "Last updated" line stay untouched. Defaults are the
current texts; clearing a field reverts that tool to its default.

## 2. Editable texts (7)

| id | Tool / view | Current default (source) |
|----|-------------|--------------------------|
| `masthead` | Main masthead intro | `includes/lookup.php` ~493 |
| `classification` | Classification of Variations | `assets/js/vcl-app.js` ~173 |
| `calculator` | Variation Fee Calculator | `assets/js/vcl-app.js` ~187 |
| `timetables` | Timetables for Variation Procedures | `assets/js/vcl-app.js` ~1607 |
| `guidedworkflow` | Guided Workflow | `assets/js/vcl-workflow.js` ~2590 |
| `budget` | Budget Planning | `assets/js/vcl-budget.js` ~1129 |
| `guidance` | Guidance on Variations (hub) | `assets/js/vcl-app.js` ~3886 |

Out of scope (confirmed): the 4 guidance sub-views whose line under the heading is the
auto-derived source-document title (Grouping, Precise scope, Q&A, Art. 5), and the 3
Guidance-hub card blurbs.

## 3. Data model (overlay, mirroring the fee-override pattern)

- **PHP `vcl_intro_defaults()`** — single source for the 7 default texts, as plain text
  (real `—` / `&`, no HTML entities), keyed by id.
- **WP option `vcl_intro_texts`** — associative array `id → custom text`; only non-empty
  entries stored. The sole persisted state.
- **Resolver `vcl_intro_text($id)`** — returns the override when it is a non-empty string,
  else the default. Unknown id → "".

## 4. Delivery

- **Masthead** (`lookup.php`): the intro `<p>` prints `esc_html( vcl_intro_text('masthead') )`.
- **6 JS intros**: in the shortcode enqueue, inject
  `window.VCL_INTRO = { classification, calculator, timetables, guidedworkflow, budget, guidance }`
  (each already resolved to override-or-default) via `wp_add_inline_script` on `vcl-data`
  (loads before every tool script). A small helper in each renderer,
  `introHtml(id, fallback)`, returns
  `escapeHtml( (window.VCL_INTRO && window.VCL_INTRO[id] != null) ? window.VCL_INTRO[id] : fallback )`.
  Each tool's intro `<p>` content is replaced by `introHtml("<id>", "<current default>")`.
  The inline `<current default>` (plain text) is a defensive fallback for when the injection
  is absent (e.g. the dev harness); PHP is the source of truth at runtime.
- Rendering is plain text escaped on output (`esc_html` in PHP, existing `escapeHtml` in JS):
  no HTML, no XSS, and `&` / `—` round-trip correctly.

## 5. Admin tab "Einleitungstexte"

- Registered in `vcl_toolbox_tabs()` after `settings`; router branch in
  `vcl_render_toolbox_page()`; new renderer `vcl_render_intro_tab()` — all in
  `includes/fee-editor.php` / `includes/admin.php`, following the existing "Einstellungen" tab.
- 7 labelled `<textarea>` fields (one per id), each **prefilled with the resolved text**
  (`vcl_intro_text($id)`), so the admin edits the existing wording directly. Placeholder /
  helptext: "Leer lassen = Standardtext." Clearing a field reverts to the default.
- Save handler: `manage_options` capability, nonce, `sanitize_textarea_field` per field;
  stores non-empty values into `vcl_intro_texts`, drops empty ones; `wp_safe_redirect` back
  to the tab. Follows the save pattern of the settings/sources tabs.

## 6. Non-goals / constraints

- No version-gated behaviour; purely additive. Bump `Version:` / `VFC_VERSION` as usual.
- No rich text / HTML; single paragraph of plain text per tool.
- No new shipped JS/CSS file (so no `build_zip.py` FILES change); only existing files edited.

## 7. Testing / verification

- **JS**: in the dev harness, set `window.VCL_INTRO` before render and confirm each tool shows
  the injected text; unset → confirm the inline default fallback renders.
- **PHP**: code review of the tab, resolver and masthead output; live check on the NAS test
  environment (edit a text → save → the tool shows it; clear → default returns).

## 8. Touched files

- `includes/fee-editor.php` — tab registration + router branch.
- `includes/admin.php` — `vcl_intro_defaults()`, `vcl_intro_text()`, `vcl_render_intro_tab()`,
  save handler.
- `includes/lookup.php` — masthead `<p>` via resolver; inject `window.VCL_INTRO` on `vcl-data`.
- `assets/js/vcl-app.js` — `introHtml()` + wrap classification / calculator / timetables /
  guidance intros.
- `assets/js/vcl-workflow.js` — wrap the Guided Workflow intro.
- `assets/js/vcl-budget.js` — wrap the Budget intro.
- `variation-fee-calculator.php` — version bump.
