# Variation Toolbox – Länder-Update & Verbesserungen (Change-Liste / Spec)

**Datum:** 2026-10-12
**Quelle der Länderdaten:** `VFC-aktualisieren.txt` (Stand: bis IE, A–Z noch nicht vollständig)
**Kanonischer Datenbestand:** `assets/js/vcl-calc-data.js` (convert.py ist laut eigenem Warnhinweis veraltet – die JS-Datei wird direkt gepflegt)

---

**Status (2026-10-12):** v1.40.0 (Bucket A: Daten + AT-Bug) und v1.41.0 (Zuschlag pro Antrag, Teil 3.1) sind auf der NAS-Testumgebung deployed und verifiziert. Zusätzlich auf NAS deployed und über HTTP verifiziert: v1.42.0 (IE-Rebuild, 2.4), v1.43.0 (DK Super-Grouping 3119, 2.3), v1.44.0 (Stepper-Fix, 4.2), v1.45.0/v1.46.0 (FR-IA-Exemptions-Panel mit vollständiger Codeliste, 4.1). Ionos-Produktion noch offen (dort weiterhin 1.32.0). Das veraltete Tooling in `tools/fee-migration/extract_rules.py` (`extract_cap`/`extract_surcharge`) liest Caps und Zuschläge jetzt aus den Spalten T/U/V statt aus Formel-Literalen (Python-Suite: 68 passed).

Legende: ✅ erledigt · ⏳ in Arbeit

---

## 0. Arbeitsmodell & Reihenfolge

1. **Erst Daten (Bucket A)**, dann **Engine-Funktionen (Bucket B)**, dann **UI-Feinschliff (Bucket C)**. (Festgelegt mit Tom.)
2. Datenänderungen gehen direkt in `vcl-calc-data.js`; danach ein ZIP-Build.
3. Diese Spec wird vor der Umsetzung gegengelesen; Werte werden hier korrigiert, nicht erst im Code.

**Datenmodell-Erinnerung:** Eine Zeile = `cc` × `type`(IA/IB/II) × `role`(national/RMS/CMS/EMA) × `special`. Beträge in `F,G,H,I,J,K,T,U,V` (EUR) plus optional `*_lc` (Lokalwährung, maßgeblich) und `*_pt` (Punkte). „Je weitere Typ X" (H/I/J) = Grundgebühr von Typ X desselben Rollen-Satzes. Der **Rechenweg** steckt in den Formelspalten `Mf/Nf/Of/Pf/Qf/Rf/Sf` der Zeile.

---

## Teil 1 – Admin-/Editor-Fixes (die Punkte vom Anfang)

### 1.1 Behördenlink editierbar machen  ⟶ Bucket C (klein)
- **Ist:** Link kommt fest aus der Excel (`HA_WEBSITES.link_url`), im Editor als „nicht änderbar" vermerkt ([fee-editor.js:899](../../../variation-fee-calculator/assets/js/vcl-fee-editor.js)).
- **Soll:** Editierbares Feld im Admin (analog zum Kommentar-/`source`-Feld). Override-Kette:
  - Speichern/Sanitizing in PHP: neues Country-Feld `link` (`esc_url_raw`, nur http/https) in `vcl_sanitize_fee_overrides()`.
  - Frontend-Merge: `ov.linkUrl || entry.link_url` in [vcl-feedata.js:50](../../../variation-fee-calculator/assets/js/vcl-feedata.js).
  - Editor-Masthead: `authorityBit()` nutzt Override statt nur `ha.link_url`.
- **Offen:** Nur URL editierbar, oder auch der Anzeigetext (`link_text`)? → **Vorschlag: nur URL** (Text bleibt aus Excel).

### 1.2 ✅ Länderauswahl springt nach Speichern auf AT  ⟶ Bug, Bucket A
- **Ist:** Nach dem Speichern leitet WordPress ohne `cc` zurück → `activeCc` fällt auf das erste Land alphabetisch (AT) ([fee-editor.js:2352](../../../variation-fee-calculator/assets/js/vcl-fee-editor.js)).
- **Soll:** Aktives Land mitschicken (hidden `vclfe_cc`), im Redirect wieder anhängen (`cc=...`), `startCountry` liest es bereits.

### 1.3 Kommentarfeld → „Source" im Frontend  ⟶ bereits im Code umgesetzt
- Kommentar wird als `source`-Override gespeichert, Frontend zeigt `ov.source || entry.comments` ([vcl-feedata.js:48](../../../variation-fee-calculator/assets/js/vcl-feedata.js)).
- **To-do:** Nur verifizieren, dass das aktuelle ZIP auf der Live-Seite deployt ist. Kein Code-Change, sofern es dort wirklich fehlt = Deploy-Thema.

### 1.4 „Sichern, übertragen, zurücksetzen" (Info – keine Änderung)
Betrifft nur die Overrides (`vcl_fee_overrides`): **Exportieren** (JSON-Backup/Transfer), **Importieren** (ersetzt alle Werte, Vorstand gesichert), **Stand vor Import zurückholen**, **Alle Änderungen löschen** (zurück zu Plugin-Beträgen).

---

## Teil 2 – Länder-Daten (Bucket A)

### 2.1 ✅ BG – MRP/DCP als `special`, national-Werte aktualisieren
`standard`-Zeilen für **RMS/CMS werden durch `MRP`/`DCP` ersetzt** (ein RMS ist immer MRP *oder* DCP; Workflow erzwingt die Wahl, default MRP). National bleibt `standard`. Alles EUR, `G`=0, „je weitere" abgeleitet. Fee codes: IA=0042, IB=0043, II=0044.

| Rolle | special | IA | IB | II |
|-------|---------|-----|-----|-----|
| national | standard | 255,65 | 511,29 | **766,94** (war 894,76) |
| RMS | MRP | 766,94 | 766,94 | 1.022,58 |
| RMS | DCP | 766,94 | 766,94 | 1.278,23 |
| CMS | MRP | 511,29 | 511,29 | 766,94 |
| CMS | DCP | 511,29 | 511,29 | 766,94 |

- CMS-MRP = CMS-DCP (identisch, beide angelegt für symmetrisches Dropdown).
- 0045 („gruppiert verschiedener Typen") ist eine Gruppierungsregel, **keine Zeile** – separat vermerkt.
- **Offen (BG):** standard für RMS/CMS wirklich ersetzen (empfohlen) oder zusätzlich behalten? → **entschieden: ersetzt** (v1.40.0)

### 2.2 ✅ CZ – Type II „neue Studien" als neue `special`-Variante
Neue Pauschal-Variante (Typ II) in **CZK** (`F_lc`; `F` = FX-Snapshot, aus Referenzkurs abgeleitet). Label-Vorschlag: `"neue Studie (Modul 3)"`.

| Rolle | fee_code | F_lc (CZK) |
|-------|----------|-----------|
| national | R-049 | 109.450 |
| RMS | R-051 | 153.230 |
| CMS | R-052 | 87.560 |

- Rechenweg = Pauschale (Sf gibt den Festbetrag zurück, keine Staffelung/Deckel).
- Der bisherige Pro-Zeile-Zuschlag `V`=77 bleibt in diesem Datenzug **unangetastet** → Ablösung in Teil 3.1. → ✅ abgelöst in v1.41.0 (siehe 3.1).

### 2.3 ✅ DK – Supergrouping & Worksharing-Gebühren (Worksharing ✅ v1.40.0; Supergrouping 3119 ✅ v1.43.0)
Neue Zeilen unter **RMS**, DKK (`F_lc`; `F` abgeleitet).

**Worksharing** – neue `"… - worksharing"`-Specials (werden vom Guided-Workflow im WS-Modus automatisch gewählt):

| type | special | fee_code | F_lc (DKK) |
|------|---------|----------|-----------|
| IB/II | quality, simple (Q) - worksharing | 3126 | 48.458 |
| IB/II | quality, complex (Q) - worksharing | 3127 | 94.838 |
| IB | regulatory/clinical (C) - worksharing | 3136 | 38.204 |
| II | regulatory/clinical (C) - worksharing | 3137 | 45.728 |

- „IB/II" heißt: je eine Zeile für IB **und** II mit demselben Betrag/Code.
- **Supergrouping:** MRP-RMS, Fee Code 3119, 19.237 DKK. ✅ **Umgesetzt (v1.43.0, NAS):** eigene Lead-Gebühr je Einreichung (flach, einmal); `leadSpecial` wählt im SG-Modus „… - supergrouping", im WS-Modus „… - worksharing". Fee-Tabelle: 440 Zeilen.

### 2.4 ✅ IE – RMS-Gesamtgebühren (volle Beträge, Zuschlagsspalte entfällt) → verschoben nach Bucket B, deployed v1.42.0
RMS-Zeilen auf **Gesamtbeträge** (national + RMS-Zuschlag) setzen und die separate Zuschlags-Logik entfernen. EUR.

| type | special | fee_code | Gesamt (€) |
|------|---------|----------|-----------|
| IA | standard | 208 | 335 |
| IB | standard | 211/213 | 1.085 |
| IB | reduced rate | 212/213 | 780 |
| II | standard | 217/205 | 1.165 |
| II | standard - reduced | 218/205 | 830 |
| II | complex | 216/219 | 4.185 |
| II | complex - reduced | 235/219 | 1.380 |

- Neu bei RMS anzulegen: IB `reduced rate`, II `standard - reduced`, II `complex - reduced` (existieren bisher nur national/CMS).
- **Offen (IE):** aktuelle RMS-Werte sind vermutlich Zuschläge – vor Überschreiben Ist-Werte abgleichen.
- ✅ **Umgesetzt (v1.42.0, NAS):** RMS-Beträge flach + 3 neue Varianten (IB reduced, II standard-reduced, II complex-reduced), keine strengabhängige Gebühr (G=0), Gruppierungsdeckel 4 150 € (Code 236) nur bei >1 Variation, Einzelvariation ungedeckelt, `V`-Zuschlag entfällt. Fee-Tabelle: 439 Zeilen.
- Gruppierung/Worksharing-**Deckel** (245/236/237) → Teil 3.5 (Bucket B).

### 2.5 Fee codes nachtragen
Diverse Zeilen tragen heute `fee_code: null` (z. B. EE komplett, FR/FI teils). Im Zuge der Länder-Durchsicht ergänzen, wo in den Quellen vorhanden.

---

## Teil 3 – Engine-Funktionen (Bucket B)

### 3.1 ✅ „Zuschlag pro Antrag" – editierbares Länder-Feld (NEU)  ★ Kernfeature (deployed v1.41.0: CZ 2.000 CZK + EE 16 €, CZ `V` abgelöst)
Ersetzt den Pro-Zeile-Zuschlag `V` durch eine **einmal je Antrag** addierte, editierbare Länder-Gebühr.
- **Fachlich korrekter:** Behörde erhebt z. B. CZ 2.000 CZK / EE 16 € **einmal pro Antrag**, nicht je Variation (CZ-WS-Beispiel bestätigt).
- **Umfang:** Betrag wird in **jedem** Berechnungspfad genau einmal addiert: Single-Variation, Grouping, Worksharing, Supergrouping – im klassischen Rechner **und** im Budget-Tool **und** im Guided Workflow (gemeinsame Logik via `vcl-submission.js` prüfen).
- **Speicherung:** Länder-Feld im Datensatz (z. B. `ADMIN_FEE[cc]` mit Lokalwährung) + Override im Fee-Editor (eigenes editierbares Feld pro Land, Währung = Landeswährung). FX: als `_lc` führen, EUR ableiten (erfordert `V_lc`/eigenes Feld in die FX-Umrechnung aufzunehmen – [vcl-calc-app.js:94](../../../variation-fee-calculator/assets/js/vcl-calc-app.js) deckt heute nur F–K ab).
- **Editor-UI:** Ein Feld „Zuschlag pro Antrag" (Screenshot-Wunsch), alte Pro-Zeile-Spalte `V` entfernt.
- **Deckt ab:** CZ 2.000 CZK, EE State fee 16 €.

### 3.2 CZ – Worksharing/Supergrouping-Rabatt
- RMS/CMS-Code-Wahl je nach RMS-Rolle (Tschechien RMS → R-023..025/R-051; sonst R-032..034/R-052).
- Erstes Arzneimittel voll, **jede weitere Zulassungsnummer 50 % Rabatt** auf die Bearbeitungskosten.
- Verwaltungsgebühr 2.000 CZK **einmal pro Antrag** (= Teil 3.1).
- **Prüfen:** Ob die WS-Engine „50 % je weiterer MA" schon ausdrücken kann.

### 3.3 EE – Worksharing-Referenzgebühr
- 1.800 € **pro Verfahren**, separat, wenn Estland Referenzbehörde ist.
- State fee 16 €/Antrag = Teil 3.1.

### 3.4 FI – Gruppierungen & Worksharing
- Process Fee **einmal** nach höchstem Variation-Type (IA 640 / IB 1.010 / II 2.250 €).
- Gruppierte Type-IA mit mehreren Prozessen: Sondergebühr 1.120 €.
- Worksharing: 4.500 € Process Fee + anwendbare Bearbeitungsgebühren (rollenabhängig).

### 3.5 IE – Gruppierung/Worksharing als Deckelungen
- Mehrere Variations je MA Range: Code 245, Deckel 6.425 €.
- Mehrere gleichzeitig eingereichte Variations je MA: Code 236, Deckel 4.150 €.
- Worksharing: Code 237, Deckel 6.960 €.
- Berechnung pro Zulassungsnummer & Änderung; genannte Beträge sind **Obergrenzen**, keine Pauschalen.

---

## Teil 4 – UI-Feinschliff (Bucket C)

### 4.1 ✅ FR – Type-IA-Exemptions anzeigen (v1.45.0 / v1.46.0)
- Daten existieren bereits (`special: "Type IA exemptions"`, Zeilen 183/188/193).
- **Soll:** In „Fee Country – data details" unter **national** ausgeben, **ausklappbar** per Button/Schalter/Link.
- **Zusätzlich:** Recherchieren, ob es auch **Type-IB-Exemptions** gibt (laut Tom/ChatGPT möglich) → ggf. Daten ergänzen. *(Noch offen.)*
- ✅ **Umgesetzt (v1.45.0 / v1.46.0, NAS):** Einklappbares Panel am Fuß des National-Abschnitts; Type-IA-Exemption 2 500 € (Art. III 5° a). v1.46.0 listet alle qualifizierenden Klassifikationscodes mit Beschreibung (gleiche Liste wie `SPECIAL_CODE_HINTS`, Quelle Décret 2025-1445), ein Panel unter National.

### 4.2 ✅ Guided Workflow – Stepper-Layout-Sprung (Screenshot 3) (v1.44.0)
- **Ist:** Beim **ersten** Erhöhen über die Typ-Stepper (IA/IB/II +/−) wird oben eine Variations-Zeile eingefügt; die Stepper rutschen nach unten, der Cursor verliert den Button → Mehrfachklick bricht ab.
- **Ziel:** Button bleibt unter dem Cursor / Klickziel stabil.
- **Optionen:**
  - (a) Pointer Capture auf dem Button, damit Pointer-Events am Button bleiben.
  - (b) Layout-Sprung vermeiden: Stepper-Block über der Liste **fixieren**, oder die eingefügte Zeile unterhalb der Stepper rendern, oder Höhe reservieren.
- **Vorschlag:** (b) – den Sprung gar nicht erst entstehen lassen (Stepper oben, Liste wächst nach unten).
- ✅ **Umgesetzt (v1.44.0, NAS):** Scroll-Anchoring-Fix; der Stepper-Button bleibt beim wiederholten Klicken unter dem Cursor.

---

## Teil 5 – Keine Änderung
DE, EL, HU, IS (laut Liste nichts zu tun).

---

## Offene Entscheidungen (Sammlung)
1. **1.1 Behördenlink:** nur URL editierbar (Vorschlag) oder auch `link_text`?
2. **2.1 BG:** standard-RMS/CMS ersetzen (Vorschlag) oder zusätzlich behalten?
3. **2.2 CZ:** Label der neuen Variante – `"neue Studie (Modul 3)"` ok?
4. **2.3 DK:** Supergrouping-Zeilenauswahl (SG-Mechanismus) – vor Umsetzung klären.
5. **2.4 IE:** aktuelle RMS-Ist-Werte vor Überschreiben abgleichen.
6. **3.1 Zuschlag pro Antrag:** „Antrag"-Begriff bei WS/SG (ein Antrag = ein Submission-Container, Zuschlag einmal pro Container).

## Vorgeschlagene Umsetzungsreihenfolge
1. **Bucket A Daten:** 1.2 (AT-Bug), 2.1 (BG), 2.2 (CZ Type II), 2.3 (DK WS-Zeilen), 2.4 (IE RMS, nach Abgleich), Fee codes.
2. **Bucket C klein:** 1.1 (Behördenlink editierbar).
3. **Bucket B:** 3.1 (Zuschlag pro Antrag) → danach CZ `V` ablösen; dann 3.2–3.5.
4. **Bucket C UI:** 4.1 (FR), 4.2 (Stepper).
5. Rest der Länder A–Z nach gleichem Muster, sobald Tom die Liste fertig hat.
