# Variation Toolbox — Navigation nach oben (Variante C)

**Datum:** 2026-08-29
**Anker (bekannt guter Stand):** Tag `anchor-before-nav-top` = `2cb55dc`, v1.3.11
**Branch:** `feature/nav-top`
**Mockup (abgenommen):** https://claude.ai/code/artifact/b1220e22-ef0a-43d8-9eac-289bf558796e

## Ziel

Die sechs Tool-Kacheln wandern aus der linken 300px-Spalte in eine waagerechte Leiste
unter den Masthead. Der Klassifikationsbaum bleibt in der linken Spalte, wird aber
einklappbar — und erscheint nur noch in den Views, die ihn tatsächlich brauchen.

Gewinn: **+328 px** (300px Spalte + 28px Gap) Detailbreite, in den Views ohne Baum
dauerhaft, in Classification/Guidance auf Knopfdruck.

## Nicht-Ziel (harte Grenze)

An Design und Inhalten darf sich **nichts** ändern:

- Keine Farbe, kein Font, kein Radius, kein Abstand innerhalb der Views
- Kein Text, kein Datensatz, keine Berechnung
- Keine Änderung an `renderDetail()`, `renderQA()`, `renderArt5()`,
  `renderTimetables()`, `renderChapterBranch()`, `vcl-workflow.js`, `vcl-budget.js`,
  `vcl-calc-app.js`, `vcl-submission.js` oder irgendeiner Datendatei
- Die Identitätsfarben der Tools bleiben exakt: Calculator `--accent` #1F5F5B,
  Workflow #41762F, Classification #2E6E9E, Guidance #3B5BA9, Timetables #2C6E6E,
  Budget #7A3350, Summary #6A4E8C

Ein früherer Anlauf, die Navigation umzustellen, ist gescheitert. Deshalb gilt:
im Zweifel nichts anfassen, lieber nachfragen.

## Ausgangslage im Code

- `includes/lookup.php:415` — `.layout` enthält `.browse-col` (Suche + `#vcl-browseTree`)
  und die neun Detail-Container.
- `assets/css/vcl-style.css:209` — `grid-template-columns: 300px 1fr; column-gap: 28px`,
  Shell 1280px.
- `assets/js/vcl-app.js:2123` — `renderBrowse()` baut **beides** in `el.browseTree`:
  die sechs Tool-Kacheln *und* den Klassifikations-/Guidance-Baum. Das ist die
  Stelle, die aufgeteilt werden muss.
- `assets/js/vcl-app.js:240` — `switchViewVisibility()` schaltet neun Detail-Container,
  blendet `.browse-col` aber in **keinem** View aus.
- `assets/js/vcl-app.js:3385` — `goToDestination(dest)` existiert bereits und kapselt
  jeden Sprung inklusive State-Reset, Render und `jumpToTop()`. **Die neue Leiste ruft
  ausschließlich diese Funktion auf** — keine eigene Navigationslogik.

## Zielzustand

### 1. Waagerechte Tool-Leiste

Neuer Container `#vcl-toolBar` in `lookup.php`, direkt zwischen `</header>` und
`<div class="layout">`. Gefüllt von einer neuen Funktion `renderToolBar()`.

Sechs Knöpfe, Reihenfolge wie heute in der linken Spalte:

| # | Label neu | Meta-Zeile | dest | Farbe |
|---|-----------|------------|------|-------|
| 1 | Variation Fee Calculator | € Fees | `calculator` | `--accent` |
| 2 | Guided Workflow | Step by step | `workflow` | `--workflow` |
| 3 | Classification | E Q C M Art.5 | `classification` | `--classify` |
| 4 | Guidance | Q&A | `guidance` | `--group` |
| 5 | Timetables | Timelines | `timetables` | `--slate` |
| 6 | Budget Planning | Portfolio | `budget` | `--budget` |

Die Kürzung der Labels (3, 4, 5) ist bewusst und vom Nutzer abgenommen: die vollen
Namen passen nicht nebeneinander. Die Beschreibungssätze der alten Kacheln entfallen
in der Leiste — sie bleiben unverändert auf der Start-Übersicht
(`renderWelcomeOverview`), die nicht angefasst wird.

Aktiv-Zustand: `border-color: var(--tc)` plus `box-shadow: 0 0 0 1px var(--tc)`
(gleichmäßiger Ring). **Ausdrücklich kein unterer Balken / kein `inset` Schatten** —
vom Nutzer abgelehnt. Rahmenbreite ganzzahlig (1px), weil 1.5px in Chrome unten
dicker rendert.

Der Calculator-Knopf erscheint nur, wenn `el.calculatorCol` existiert — dieselbe
Bedingung wie heute.

Nicht sticky (bewusste Entscheidung, die Seite hat oben schon eine feste Nav).

### 2. Linke Spalte nur noch für den Baum

`renderBrowse()` baut ab jetzt **nur** den Klassifikations-/Guidance-Baum
(Suchfeld bleibt, Kapitel E/Q/C/M/Art.5, Guidance-Unterpunkte). Die sechs
Kachel-Blöcke ziehen unverändert nach `renderToolBar()` um; ihre Klick-Handler
werden durch `goToDestination(dest)` ersetzt.

Views **mit** linker Spalte: `browse`, `art5`, `grouping`, `precisescope`, `qa`
Views **ohne** linke Spalte: `calculator`, `workflow`, `budget`, `timetables`, `summary`

`switchViewVisibility()` setzt entsprechend `.hidden` auf `#vcl-browseCol` und
`data-tree="off"` auf `.layout`; das Grid fällt dann auf `grid-template-columns: 1fr`.

### 3. Baum-Toggle

Knopf am Kopf des Detailbereichs, nur sichtbar in den Views mit Baum.
Beschriftung „Liste ausblenden" / „Liste einblenden", in der Farbe des aktiven Tools.
Zustand wird **nicht** persistiert (Entscheidung: erst nach dem Umbau bewerten);
er startet in jedem Seitenaufruf offen und wird beim Tool-Wechsel zurückgesetzt.

### 4. Bewusst offen gelassen

Nach dem Umbau separat zu bewerten, **nicht** Teil dieser Umsetzung:
Leiste sticky, Baum sticky mit eigenem Scrollbalken, Baum-Zustand merken,
Suchfeld nach oben verlegen.

## Verifikation (Abnahmekriterium)

Screenshot-Vergleich vorher/nachher für **jeden** der neun Views, im echten Chrome
(der In-App-Browser ist bei diesem Projekt unzuverlässig). Vorher-Bilder werden vom
Anker-Tag erzeugt, bevor die erste Zeile geändert wird.

Geprüft wird pro View:
1. Inhalt identisch (Texte, Zahlen, Reihenfolge)
2. Farben und Typografie identisch
3. Detailbereich breiter oder gleich, nie schmaler
4. Alle Klickpfade funktionieren: Tool-Wechsel, Kapitel aufklappen, Eintrag öffnen,
   Auswahl treffen, Summary öffnen, Handoff Calculator → Workflow → Budget

Zusätzlich: `?code=`-Deeplink, „Start"-Knopf, „How to use"-Modal, Summary-Pille.

## Versionierung

`Version:`-Header in `variation-fee-calculator.php` **und** `VFC_VERSION` auf
**1.4.0** (nicht 1.3.12 — es ist ein Layout-Umbau, kein Fix). Regel gilt bei jeder
Änderung, siehe Memory `feedback-bump-version-every-change`.

## Aufgabenschnitt für die Umsetzung

Jede Aufgabe ist einzeln prüfbar und einzeln zurückrollbar:

1. **Vorher-Screenshots** aller neun Views vom Anker-Stand sichern
2. **Markup + CSS** für `#vcl-toolBar` (statisch, noch nicht verdrahtet, noch nicht sichtbar)
3. **`renderToolBar()`** herausziehen, Handler auf `goToDestination()` umstellen,
   Kacheln aus `renderBrowse()` entfernen
4. **`switchViewVisibility()`** blendet `.browse-col` aus, Grid auf eine Spalte
5. **Baum-Toggle** einbauen
6. **Version-Bump** auf 1.4.0
7. **Nachher-Screenshots + Vergleich** aller neun Views

Nach jeder Aufgabe: Zwischenstand prüfen, erst dann die nächste.
