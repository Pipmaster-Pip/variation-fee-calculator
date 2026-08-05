# So aktualisierst du die RA-Stunden

Kurzanleitung: Was tun, wenn sich in `RA-CMC-hours.xlsx` etwas ändert.

Wichtig vorab: Die Excel wird **nicht zur Laufzeit** gelesen. Sie ist die Bau-Quelle. Der Guided
Workflow liest zur Laufzeit nur das generierte JS (`window.VCL_WORKLOAD_HD`). Änderungen greifen
also erst nach Converter-Lauf + neuem ZIP + WordPress-Upload.

## Der Ablauf (alles aus dem Projekt-Root `D:\Claude\Variation Fee Calculator`)

```bash
python convert-workload.py "../RA-CMC-hours.xlsx"
```
→ regeneriert `variation-fee-calculator/assets/js/vcl-workload-hours-data.js`

```bash
node test/test-additive-workload.js
```
→ 30 Tests sollten „All tests passed." melden (fängt viele Struktur-/Wertbrüche ab)

```bash
python build_zip.py
```
→ neues `variation-fee-calculator.zip` (die filemtime-Versionierung im PHP-Enqueue erzwingt den
Browser-Reload)

→ **ZIP in WordPress hochladen.** Danach ziehen Live-Preview, Methodik-Box und RA-hours-Referenz
gleichzeitig nach — alles liest dieselbe Single Source.

## Geht automatisch mit (nur Converter neu laufen lassen)
- Stundenwerte ändern (min/max in beliebigen Zellen)
- Aktivitäts-Zeilen hinzufügen/löschen (RA / CMC / Product Information / Compilation) — die letzte
  Datenzeile wird erkannt, keine fixen Zeilenzahlen
- Neue Dimensions-Spalte in einem Modifier-Blatt (Header werden generisch geparst)
- Neue Type/Role-Kombinationen
- `n.a.` bleibt „nicht anwendbar" (wird zu `null`, nicht 0)

## Braucht Code-Anpassung (kurz Bescheid geben)
- Blatt **umbenennen** oder **Spalten-Reihenfolge** in einem Flach-Blatt ändern
  (angenommen: `Variation Type | Role1 | Role2 | process | RA hours (min.) | RA hours (max.)`)
- **Marker-Wortlaut** ändern:
  - `(API chemical)` / `(API biological)` → steuert die Wirksubstanz-Zuordnung im CMC-Blatt
  - `for each CMS` → steuert das Label „for N CMS" + die CMS-Skalierung
  - PI-Prozesstexte mit den Stichwörtern **SmPC / Leaflet / Labelling / Mock** → steuert die
    Filterung nach getickten PI-Dokumenten
- Ein **ganz neuer Modifier** (5. Bündelungsart neben Grouping/WS/AU/SG) → Engine + UI ergänzen

## Eingebaute Sicherungen
- Converter läuft **read-only** (`openpyxl, read_only=True`) — die Excel wird nie überschrieben
  (Regel: Excel nie per openpyxl speichern, Zeichnungen gingen verloren).
- Er druckt eine **Zusammenfassung** + einen **Type-II-CMC-Check** (chemical vs. biological), damit
  ein Zahlendreher sofort auffällt.
- Warnt bei **unerwarteten Spaltenköpfen** in den Modifier-Blättern.

## Faustregel
Reine **Werte-/Zeilen-Änderungen** → Converter + Test + ZIP + Upload, fertig.
**Struktur- oder Wortlaut-Änderungen** (Spalten, Blattnamen, Marker-Texte) → erst Code anpassen.

## Dateien
- Quelle: `RA-CMC-hours.xlsx` (Projekt-Root)
- Converter: `variation-fee-calculator/convert-workload.py`
- Generiert: `variation-fee-calculator/assets/js/vcl-workload-hours-data.js`
- Tests: `test/test-additive-workload.js` (Projekt-Root)
- Build: `build_zip.py` (Projekt-Root)
- Voller Umsetzungs-Log: `docs/ra-hours-additive-plan.md`
