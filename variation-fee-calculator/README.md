# Variation Fee Calculator — WordPress-Plugin

WordPress-Version des Variation Fee Calculators. Rendert den Rechner direkt
ins Seiten-DOM (**kein iframe**) über den Shortcode
`[variation_fee_calculator]`, sodass er sich sauber in dein Theme einfügt.

## Installation

1. Diesen ganzen Ordner (`variation-fee-calculator/`) als ZIP packen
   (Dateiname z. B. `variation-fee-calculator.zip`, der Ordner selbst muss
   im ZIP die oberste Ebene sein).
2. WordPress-Admin → **Plugins → Installieren → Plugin hochladen** → ZIP
   auswählen → **Jetzt installieren** → **Aktivieren**.
3. In der Seite/dem Beitrag, auf der der Rechner erscheinen soll, den
   Shortcode einfügen:

   ```
   [variation_fee_calculator]
   ```

   Fertig — kein iframe, keine zusätzliche Konfiguration nötig.

**Wichtig:** Den Shortcode nur **einmal pro Seite** verwenden — der Rechner
hält einen einzigen globalen JS-Zustand (`appState`); zwei Instanzen auf
derselben Seite würden sich gegenseitig überschreiben.

## Warum kein iframe, und wie die Design-Isolation funktioniert

- **CSS** ist komplett unter der Klasse `.vfc-app` gekapselt
  (`assets/css/vfc-style.css`). Es gibt keine ungebundenen Regeln auf
  `body`, `*` oder generische Klassennamen wie `.btn`/`.panel` — dein
  Theme kann den Rechner nicht verändern, und der Rechner kann dein Theme
  nicht verändern. Das wurde gegen eine simulierte Theme-Seite mit
  absichtlich kollidierenden Klassennamen getestet.
- **JavaScript** ist in eine IIFE gekapselt (`assets/js/vfc-app.js`) und
  liest seine Daten aus `window.VFC_DATA` (`assets/js/vfc-data.js`) statt
  über globale `const`/`let`-Deklarationen. Das verhindert, dass ein
  anderes Plugin oder Theme-Script mit zufällig gleichem Bezeichner
  (z. B. `appState`, `FEE_ROWS`) einen `SyntaxError` auslöst, der die
  **gesamte** Seite lahmlegen würde — nicht nur den Rechner.
- Alle DOM-IDs sind mit `vfc-` präfixiert (`vfc-rail`, `vfc-stepContent`, …),
  um Kollisionen mit vorhandenen IDs im Theme zu vermeiden.
- Die Assets (insgesamt ca. 250 KB, hauptsächlich die Gebührentabelle)
  werden nur auf Seiten geladen, die den Shortcode tatsächlich enthalten —
  nicht global auf jeder Seite der Website.

## Dateien

- `variation-fee-calculator.php` — Haupt-Plugin-Datei: registriert den
  Shortcode, bindet Styles/Scripts nur bei Bedarf ein (Cache-Busting der
  Daten-Datei über deren tatsächliches Änderungsdatum, nicht die
  Plugin-Version — Uploads über die Admin-Seite werden so sofort wirksam).
- `includes/admin.php` — Admin-Seite (Einstellungen → Variation Fee
  Calculator) zum Hochladen einer neuen `vfc-data.js`.
- `assets/css/vfc-style.css` — gekapseltes Design (identisch zur
  Standalone-Version, nur unter `.vfc-app` genestet).
- `assets/js/vfc-app.js` — Rechenlogik + UI (IIFE-gekapselt, IDs
  `vfc-`-präfixiert).
- `assets/js/vfc-data.js` — Gebührendaten (aus Excel generiert).
- `convert.py` — WordPress-Variante des Konverters, erzeugt
  `assets/js/vfc-data.js` im gekapselten Format.

## Gebühren aktualisieren (aus neuer Excel-Datei) — ohne FTP

Unter **WordPress-Admin → Einstellungen → Variation Fee Calculator** gibt es
eine Upload-Seite dafür. Ablauf bei einer geänderten Excel-Tabelle:

```bash
pip install openpyxl        # nur beim allerersten Mal nötig
cd variation-fee-calculator
python3 convert.py pfad/zur/Variation-Fee-Calculator-EU.xlsx
```

Das schreibt lokal `assets/js/vfc-data.js` neu (Standard-Ausgabepfad ist
bereits richtig voreingestellt). Anschließend genau diese eine Datei
(`vfc-data.js`, **nicht** die Excel-Datei) auf der Admin-Seite hochladen —
kein FTP, kein Re-Upload des ganzen Plugins nötig. Die Seite zeigt den
aktuell installierten Stand (Datum aus der Excel-Änderungshistorie) und
legt vor jedem Hochladen automatisch eine Sicherungskopie
(`vfc-data.js.bak`) an.

Bewusst wird auf dieser Admin-Seite **nicht** die rohe Excel-Datei direkt
akzeptiert — die eigentliche Excel-Auswertung (inkl. aller
Sonderfall-Formeln, siehe `convert.py`) bleibt beim geprüften
Python-Konverter, statt sie ein zweites Mal in PHP nachzubauen. Das hält
das Risiko für stille Rechenfehler bei den amtlichen Gebühren gering.

Alternativ (z. B. falls die Admin-Seite aus irgendeinem Grund nicht
erreichbar ist) geht es weiterhin auch klassisch per FTP/SFTP: nur die
Datei `assets/js/vfc-data.js` im Plugin-Ordner auf dem Server ersetzen.

Alle Hinweise zu Sonderfällen, Cap-/Grouping-Logik etc. aus der
Standalone-README gelten unverändert, da `vfc-app.js` inhaltlich identisch
zu `app.js` ist (nur Kapselung + ID-Präfixe unterscheiden sich).

## Beziehung zur Standalone-Version

Dieses Plugin ist unabhängig von der Standalone-Version unter
`../index.html` / `../app.js` / `../data.js` (weiterhin live unter
`https://www.pharmazulassung.de/variation-fee-calculator/index.html`).
Beide Varianten pflegst du getrennt: Excel ändert sich → **beide**
`convert.py`-Skripte laufen lassen (Standalone-Ordner und
Plugin-Ordner), da die Ausgabeformate unterschiedlich sind (bewusst so
gewählt, um Namenskollisionen in WordPress zu vermeiden).
