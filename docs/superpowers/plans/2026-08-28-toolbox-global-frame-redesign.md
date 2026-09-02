# Toolbox Global Frame Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the Variation Toolbox's global visual chrome (paper/neutral colors, corner radius, box-shadow, and UI/heading typography) to the new cool-paper / Libre Franklin + Source Serif 4 frame approved via mockup, across all six plugin stylesheets, while leaving every per-tool identity color and IA/IB/II type-badge color byte-for-byte unchanged.

**Architecture:** `vcl-style.css`'s `.vcl-app` root variable block (lines 19–99) is the single canonical source for the shared neutrals/radius/shadow that `vcl-workload-style.css`, `vcl-workflow-style.css`, and `vcl-budget-style.css` all inherit by re-opening the same `.vcl-app` selector — so editing that one block cascades into three files for free. `vcl-calc-style.css` (`.vclcalc-app`) and `vcl-guide-style.css` are architecturally isolated (own variables / hardcoded literals) and need direct edits. Font-family swaps are almost entirely literal string replacements (`"IBM Plex Sans"` → `"Libre Franklin"`, `"IBM Plex Serif"` → `"Source Serif 4"`) repeated verbatim dozens of times per file, so each file gets one `replace_all` pass per string rather than per-line edits. `"IBM Plex Mono"` is kept everywhere (mono identity is not changing).

**Tech Stack:** Plain CSS custom properties, Google Fonts (`fonts.googleapis.com`), WordPress `wp_register_style`/`wp_enqueue_style`. No build step, no local PHP execution — verification is via the project's existing browser-harness workflow.

## Global Constraints

- Never change: shortcode `[variation_classification_lookup]`, localStorage key `variationLookupSelections`, class prefixes `vcl-`/`vclcalc-`, PHP constants `VFC_*`, any options keys.
- Never change the hex value of any identity/accent color: `--ia`/`--ib`/`--ii` (+ `-bg`), `--classify`, `--group`, `--tt-rms`, `--cms`, `--tt-mah`, `--slate`, `--plum`, `--history`, `--workload`, `--workflow`, `--budget` (all + their `-bg`/`-tint` variants) in `vcl-style.css`, and `--accent`/`--accent-soft`/`--accent-deep`/`--amber`/`--amber-soft` (the Fee Calculator gold identity) in `vcl-calc-style.css`. Only neutral/paper/border/ink/radius/shadow/font tokens change.
- `"IBM Plex Mono"` stays everywhere it currently appears — only Sans→Libre Franklin and Serif→Source Serif 4 are swapped.
- All work happens on branch `feature/toolbox-redesign`; `main` and tag `pre-redesign-2026-08-28` are the untouched fallback anchor.
- ZIP builds only via `python build_zip.py` from the repo root (`D:\Claude\Variation Fee Calculator\`) — never PowerShell `Compress-Archive`. Deploys go to the NAS test environment only; production (Ionos) is out of scope until the user approves.
- Verification harness: generate `_verify-guide.html` from the HTML shell in `includes/lookup.php`, serve with `python -m http.server 8791` from the plugin folder, check via browser tools at `http://localhost:8791/_verify-guide.html`, then **delete the harness file** before any commit or ZIP build (the build script fails if an unlisted file is present).

---

## File Structure

No new files. Six existing files get edited:
- `includes/lookup.php` — Google Fonts URL (1 line block)
- `assets/css/vcl-style.css` — canonical neutral/radius/shadow tokens + font-family replace_all (source of truth, cascades to 3 other files)
- `assets/css/vcl-calc-style.css` — own neutral/shadow tokens + `--sans` value (isolated scope)
- `assets/css/vcl-guide-style.css` — hardcoded radius/shadow/font-family literals (no shared var block)
- `assets/css/vcl-workload-style.css`, `vcl-workflow-style.css`, `vcl-budget-style.css` — font-family replace_all only (neutrals inherited from vcl-style.css automatically)

## Scope Note

This plan covers **only the global frame** (paper, borders, radius, shadow, typography) — the layer validated in the first "Toolbox Redesign" mockup. It does **not** cover: moving the left `browse-col` navigation into a horizontal top bar, the Summary/Guided-Workflow stat tiles, sticky right-rail cards, or the grouping/cap fee-note chips shown in the later "Fee Calculator Redesign" and "Toolbox Walkthrough" mockups. Those touch `vcl-app.js`'s rendering logic (not just CSS) and need their own investigation + plan once this foundational layer is live and confirmed on the NAS.

---

### Task 1: Register the new Google Fonts, keep IBM Plex Mono

**Files:**
- Modify: `includes/lookup.php:17-22`

**Interfaces:**
- Produces: the `vcl-fonts` style handle now loads Libre Franklin + Source Serif 4 + IBM Plex Mono (previously IBM Plex Serif + Sans + Mono). All other tasks' `font-family` values depend on these families actually being loaded by this handle.

- [ ] **Step 1: Edit the font registration URL**

In `includes/lookup.php`, replace the `wp_register_style( 'vcl-fonts', ... )` call:

```php
	wp_register_style(
		'vcl-fonts',
		'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700&family=Source+Serif+4:opt@9..40;ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
		array(),
		null
	);
```

(This replaces the existing lines 17–22 in place — same `wp_register_style` call, only the URL string changes.)

- [ ] **Step 2: Verify no other file references the old Google Fonts URL**

Run:
```bash
grep -rn "fonts.googleapis.com" "D:\Claude\Variation Fee Calculator\variation-fee-calculator"
```
Expected: only one match, the new URL in `includes/lookup.php`.

- [ ] **Step 3: Commit**

```bash
git add "includes/lookup.php"
git commit -m "feat: swap toolbox Google Fonts to Libre Franklin + Source Serif 4"
```

---

### Task 2: Swap the canonical `.vcl-app` neutral/radius/shadow tokens and fonts (vcl-style.css)

**Files:**
- Modify: `assets/css/vcl-style.css:20-26` (neutral tokens), `:95` (font-family), `:96` (radius), `:98` (shadow), plus every other literal `"IBM Plex Sans"` / `"IBM Plex Serif"` occurrence in the file (~44 lines per the audit)

**Interfaces:**
- Consumes: nothing (this is the canonical source file)
- Produces: `--paper`, `--panel`, `--ink`, `--muted`, `--ink-faint`, `--border`, `--border-soft` values that `vcl-workload-style.css`, `vcl-workflow-style.css`, and `vcl-budget-style.css` all read via `var()` inside the same `.vcl-app` scope — Task 5 depends on these new values already being in place.

- [ ] **Step 1: Update the neutral tokens, radius, and shadow**

In `assets/css/vcl-style.css`, inside the `.vcl-app { ... }` root block (lines 19–99), change these lines:

```css
  --paper: #F3F5F8;
  --panel: #FFFFFF;
  --ink: #1B212C;
  --muted: #4D5566;
  --ink-faint: #838DA0;
  --border: #DDE2E9;
  --border-soft: #EDF0F4;
```
(replaces the current lines 20–26: `--paper: #FBFAF8;` / `--panel: #FFFFFF;` / `--ink: #1A2332;` / `--muted: #4A5568;` / `--ink-faint: #8A93A3;` / `--border: #E2E5EA;` / `--border-soft: #EEF0F2;` — same 7 variable names, new values only)

Then change line 96 and line 98:

```css
  border-radius: 10px;
```
```css
  box-shadow: 0 1px 2px rgba(20, 30, 48, 0.05), 0 6px 20px rgba(20, 30, 48, 0.06);
```

Leave every `--ia`/`--ib`/`--ii`/`--group`/`--tt-rms`/`--cms`/`--tt-mah`/`--classify`/`--slate`/`--plum`/`--history` line (36–68) and their `-bg`/`-tint` variants completely untouched.

- [ ] **Step 2: Replace the font-family literals across the whole file**

Using the editor's find-and-replace-all (or equivalent), run two whole-file replacements on `assets/css/vcl-style.css`:

1. Replace every occurrence of `"IBM Plex Sans"` with `"Libre Franklin"`
2. Replace every occurrence of `"IBM Plex Serif"` with `"Source Serif 4"`

Do **not** touch any occurrence of `"IBM Plex Mono"` — leave it as-is everywhere.

- [ ] **Step 3: Verify no stray IBM Plex Sans/Serif references remain**

Run:
```bash
grep -n "IBM Plex Sans\|IBM Plex Serif" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-style.css"
```
Expected: no output (zero matches). A second check confirms Mono survived:
```bash
grep -c "IBM Plex Mono" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-style.css"
```
Expected: same count as before the edit (the mono occurrences from the audit, unchanged).

- [ ] **Step 4: Verify identity colors are untouched**

Run:
```bash
grep -n "^\s*--ia:\|^\s*--ib:\|^\s*--ii:\|^\s*--classify:\|^\s*--group:\|^\s*--slate:\|^\s*--plum:\|^\s*--history:" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-style.css"
```
Expected: `--ia: #1F5F5B;`, `--ib: #A8651A;`, `--ii: #B23A2E;`, `--classify: #2E6E9E;`, `--group: #3B5BA9;`, `--slate: #2C6E6E;`, `--plum: #6A4E8C;`, `--history: #9C6B2E;` — identical hex values to before this task.

- [ ] **Step 5: Commit**

```bash
git add "assets/css/vcl-style.css"
git commit -m "feat: swap the toolbox's global paper/border/radius/shadow tokens and typography"
```

---

### Task 3: Swap the Fee Calculator's own neutral tokens and sans font (vcl-calc-style.css)

**Files:**
- Modify: `assets/css/vcl-calc-style.css:11-17` (neutrals), `:29` (shadow), `:27` (`--sans` font stack)

**Interfaces:**
- Consumes: nothing (independent `.vclcalc-app` scope, does not read `.vcl-app` variables)
- Produces: `--ink`, `--ink-soft`, `--ink-faint`, `--paper`, `--panel`, `--line`, `--line-strong`, `--shadow` values used by every rule in this file via `var()`

- [ ] **Step 1: Update the neutral tokens and shadow**

In `assets/css/vcl-calc-style.css`, inside the `.vclcalc-app{ ... }` root block (lines 8–41), change:

```css
  --ink:#1b212c;
  --ink-soft:#4d5566;
  --ink-faint:#838da0;
  --paper:#f3f5f8;
  --panel:#ffffff;
  --line:#dde2e9;
  --line-strong:#c3cbd6;
```
(replaces current lines 11–17: `--ink:#29221a;` / `--ink-soft:#5f5140;` / `--ink-faint:#968a73;` / `--paper:#fbfaf8;` / `--panel:#ffffff;` / `--line:#e2e5ea;` / `--line-strong:#c7cdd6;`)

Then change line 29:
```css
  --shadow: 0 1px 2px rgba(20,30,48,.05), 0 6px 20px rgba(20,30,48,.06);
```

Leave `--accent`, `--accent-soft`, `--accent-deep`, `--amber`, `--amber-soft` (lines 20–24, the Fee Calculator gold identity) and `--radius` (line 28, already overridden per-component later in the file) completely untouched.

- [ ] **Step 2: Swap the sans font stack**

Change line 27:
```css
  --sans: "Libre Franklin","Helvetica Neue",Arial,sans-serif;
```
(replaces `--sans: "Inter","Helvetica Neue",Arial,sans-serif;`)

Line 26 (`--serif: "Source Serif 4","Georgia",serif;`) already matches the new frame — leave it unchanged. Line 25 (`--mono: "IBM Plex Mono",...`) also stays unchanged.

- [ ] **Step 3: Verify the gold identity colors are untouched**

Run:
```bash
grep -n "^\s*--accent:\|^\s*--accent-soft:\|^\s*--accent-deep:\|^\s*--amber:\|^\s*--amber-soft:" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-calc-style.css"
```
Expected: `--accent:#8f6e2e;`, `--accent-soft:#f5eedd;`, `--accent-deep:#5f4a1e;`, `--amber:#a8651a;`, `--amber-soft:#fbf0e2;` — identical to before this task.

- [ ] **Step 4: Verify no literal "Inter" remains**

Run:
```bash
grep -n "Inter" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-calc-style.css"
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "assets/css/vcl-calc-style.css"
git commit -m "feat: swap the Fee Calculator's neutral tokens and sans font, keep gold identity"
```

---

### Task 4: Fix the hardcoded literals in vcl-guide-style.css (How-to-use modal)

**Files:**
- Modify: `assets/css/vcl-guide-style.css:28`, `:34`, `:36`, `:48`, `:73`

**Interfaces:**
- Consumes: `.vcl-app`'s `--panel`/`--border`/`--ink`/`--ink-faint` from Task 2 (already updated by the time this task runs)
- Produces: nothing consumed elsewhere — this is a leaf file (the How-to-use modal only)

- [ ] **Step 1: Update the modal's own radius and shadow literals**

In `assets/css/vcl-guide-style.css`, inside `.vcl-app .vcl-guide-shell { ... }` (lines 25–37), change line 28:
```css
  border-radius: 10px;
```
and line 34:
```css
  box-shadow: 0 20px 60px rgba(20, 30, 48, 0.28);
```

- [ ] **Step 2: Swap the three hardcoded font-family literals**

Change line 36 (still inside `.vcl-guide-shell`):
```css
  font-family: "Libre Franklin", -apple-system, sans-serif;
```

Change line 48 (`.vcl-guide-head h2`):
```css
.vcl-app .vcl-guide-head h2 { margin: 0; font-size: 17px; font-weight: 600; font-family: "Source Serif 4", serif; }
```

Change line 73 (`.vcl-guide-page-head h3`):
```css
.vcl-app .vcl-guide-page-head h3 { margin: 0; font-size: 16px; font-family: "Source Serif 4", serif; }
```

Leave line 69 (`.vcl-guide-counter`, `"IBM Plex Mono"`) unchanged.

- [ ] **Step 3: Verify no IBM Plex Sans/Serif remains in this file**

Run:
```bash
grep -n "IBM Plex Sans\|IBM Plex Serif" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-guide-style.css"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "assets/css/vcl-guide-style.css"
git commit -m "fix: update the How-to-use modal's radius, shadow and fonts to the new frame"
```

---

### Task 5: Font-family replace-all in the three inheriting stylesheets

**Files:**
- Modify: `assets/css/vcl-workload-style.css` (~9 font-family lines), `assets/css/vcl-workflow-style.css` (~7 font-family lines), `assets/css/vcl-budget-style.css` (~9 font-family lines)

**Interfaces:**
- Consumes: `.vcl-app`'s neutral/radius/shadow tokens from Task 2, automatically (these files reuse the same `.vcl-app` selector and never define their own paper/panel/ink/border/radius/shadow — no direct edit needed for those)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Replace font-family literals in vcl-workload-style.css**

Run two whole-file replacements on `assets/css/vcl-workload-style.css`:
1. `"IBM Plex Sans"` → `"Libre Franklin"`
2. `"IBM Plex Serif"` → `"Source Serif 4"`

Leave every `"IBM Plex Mono"` occurrence and the `--workload`/`--workload-bg`/`--workload-tint` block (lines 20–22) untouched.

- [ ] **Step 2: Replace font-family literals in vcl-workflow-style.css**

Same two replacements on `assets/css/vcl-workflow-style.css`. Leave `"IBM Plex Mono"` and the `--workflow`/`--workflow-bg`/`--workflow-tint` block (lines 4–6) untouched — including line 897's hardcoded `background: #41762F; color: #fff;` (identity-tied, not a neutral).

- [ ] **Step 3: Replace font-family literals in vcl-budget-style.css**

Same two replacements on `assets/css/vcl-budget-style.css`. Leave `"IBM Plex Mono"` and the `--budget`/`--budget-bg`/`--budget-tint` block (lines 11–13) untouched.

- [ ] **Step 4: Verify no stray IBM Plex Sans/Serif remains in any of the three files**

Run:
```bash
grep -rn "IBM Plex Sans\|IBM Plex Serif" \
  "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-workload-style.css" \
  "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-workflow-style.css" \
  "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-budget-style.css"
```
Expected: no output.

- [ ] **Step 5: Verify the three identity-color blocks are untouched**

Run:
```bash
grep -n "^\s*--workload:\|^\s*--workload-bg:" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-workload-style.css"
grep -n "^\s*--workflow:\|^\s*--workflow-bg:" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-workflow-style.css"
grep -n "^\s*--budget:\|^\s*--budget-bg:" "D:\Claude\Variation Fee Calculator\variation-fee-calculator\assets\css\vcl-budget-style.css"
```
Expected: `--workload: #7A3350;` / `--workload-bg: #F5E9EE;`, `--workflow: #41762F;` / `--workflow-bg: #EBF2E3;`, `--budget: #7A3350;` / `--budget-bg: #F5E9EE;` — identical to before this task.

- [ ] **Step 6: Commit**

```bash
git add "assets/css/vcl-workload-style.css" "assets/css/vcl-workflow-style.css" "assets/css/vcl-budget-style.css"
git commit -m "feat: swap fonts to Libre Franklin/Source Serif 4 in workload, workflow and budget views"
```

---

### Task 6: Browser-harness verification across the app

**Files:**
- Create (temporary, deleted at the end): `variation-fee-calculator/_verify-guide.html`

**Interfaces:**
- Consumes: all CSS/PHP changes from Tasks 1–5
- Produces: nothing (verification-only task, no shipped artifact)

- [ ] **Step 1: Generate the verification harness**

Follow the project's standing harness procedure (`PROJECT_BRIEF.md`, "Harte Regeln" §2): build `_verify-guide.html` in the plugin folder from the HTML shell rendered by `includes/lookup.php`'s shortcode output, so the six stylesheets and the Google Fonts link load exactly as they would on the real page.

- [ ] **Step 2: Serve it and open in the browser**

```bash
cd "D:\Claude\Variation Fee Calculator\variation-fee-calculator" && python -m http.server 8791
```
Open `http://localhost:8791/_verify-guide.html?r=1` (bump the `?r=` query on every reload — cached assets otherwise hide the change, per the project's documented cache trap).

- [ ] **Step 3: Check computed typography and neutrals**

Using the browser DOM tools, run `getComputedStyle` checks (this project's documented reliable verification path, since screenshots time out unpredictably in the in-app preview):
- `.vcl-app` body text: computed `font-family` starts with `Libre Franklin`
- An `h1`/`.mono` element: computed `font-family` starts with `Source Serif 4` / `IBM Plex Mono` respectively
- `.vcl-app` computed `background-color` and `border-radius` (should be `10px`, not `14px`)

- [ ] **Step 4: Check identity colors are pixel-identical to before**

Open the Classification view, click into a Type IA/IB/II entry, and check computed `color`/`background-color` on a `.badge.type-ia` / `.type-ib` / `.type-ii` element against the hex values from Task 2 Step 4 and Task 3 Step 3. Repeat for one Workload-view element (should show `#7A3350`) and the Fee Calculator's primary button (should show `#8f6e2e`).

- [ ] **Step 5: Check the How-to-use modal**

Open the guide modal, confirm its heading uses Source Serif 4, body text uses Libre Franklin, and the modal corners/shadow match the new radius/shadow from Task 4.

- [ ] **Step 6: Delete the harness**

```bash
rm "D:\Claude\Variation Fee Calculator\variation-fee-calculator\_verify-guide.html"
```
Confirm it's gone before the next step — `build_zip.py` fails the build if any unlisted file remains in the plugin folder.

---

### Task 7: Build the ZIP for NAS testing

**Files:**
- Reads: all files in `variation-fee-calculator/` per the `FILES` list in `build_zip.py`
- Produces: `variation-fee-calculator.zip` (gitignored, not committed)

- [ ] **Step 1: Confirm the harness is gone and the tree is clean**

```bash
cd "D:\Claude\Variation Fee Calculator" && git status
```
Expected: only the 6 CSS/PHP files and `docs/superpowers/plans/2026-08-28-toolbox-global-frame-redesign.md` as tracked changes since branching — no `_verify-guide.html`.

- [ ] **Step 2: Build the ZIP**

```bash
cd "D:\Claude\Variation Fee Calculator" && python build_zip.py
```
Expected: exits successfully, reports all `FILES` present, forward-slash paths, no unlisted files.

- [ ] **Step 3: Hand off for NAS upload**

Tell the user the ZIP is built and ready at `D:\Claude\Variation Fee Calculator\variation-fee-calculator.zip` for them to upload to the NAS test environment — uploading itself is a manual step outside this plan's scope (per the user's instruction that testing happens exclusively on the NAS until everything fits).

---

## Self-Review Notes

- **Spec coverage:** All six stylesheets from the audit are covered (Tasks 2–5), the font registration is covered (Task 1), verification and packaging are covered (Tasks 6–7). The two hardcoded-literal exceptions found by the audit (`vcl-guide-style.css`'s radius/shadow/font lines) got their own task instead of being missed inside a generic "replace fonts" step.
- **Identity-color safety:** Every task that touches a file containing an identity-color block ends with a grep step diffing those exact hex values against the audit's recorded originals — this is the concrete enforcement of the CLAUDE.md/PROJECT_BRIEF "UNVERÄNDERT lassen" rule, not just a reminder in prose.
- **Out of scope, flagged, not silently dropped:** the top-nav relocation and the stat-tile/rail/mtag-chip component work from the later mockups are explicitly named in the Scope Note above as needing their own follow-up plan, rather than being implied as "done" by this one.
