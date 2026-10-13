# FI Worksharing/Supergrouping Lead-Process-Fee + „once-per-application"-Fee-Relocation – Spec

**Datum:** 2026-10-13
**Baut auf:** v1.47.0 (FI Process-Fee Stage A+B), [2026-10-12-variation-toolbox-updates-design.md](2026-10-12-variation-toolbox-updates-design.md) Teil 3.4
**Kanonischer Datenbestand:** `assets/js/vcl-calc-data.js`
**Zielversion:** v1.48.0

---

## Zusammenfassung

Zwei Änderungen in einem Zug:

1. **FI Stage C** – FI als Worksharing-/Supergrouping-**Lead** bekommt eine flache Process-Fee
   (WS **4.500 €**, SG **1.120 €**) **zusätzlich** zu seinen Pro-Variation-Bearbeitungsgebühren.
2. **Fee-Relocation** – die „once per application"-Zeilen (Admin-Fee CZ/EE, Process-Fee FI) wandern
   im klassischen Rechner aus der **Overview** heraus und erscheinen als **letzte Zeile** je Land
   in „Details – fees by country", fließen in „Country subtotal" und folgen dem Währungsumschalter.

---

## Teil A – FI Worksharing/Supergrouping Lead-Process-Fee

### A.1 Fachliches Modell (Quelle: Verordnung 1344/2025, Abschnitt 1.2.1, vom User bestätigt)

FI als WS/SG-**Lead (RMS)** zahlt **zwei Komponenten**:

- einen **flachen Process-Fee einmal pro Antrag**: **4.500 €** (Worksharing) bzw. **1.120 €** (Supergrouping),
- **plus** die normalen **Pro-Variation-Bearbeitungsgebühren** der FI-Variationen
  (FI RMS standard: IA 0 € / IB 485 € / II 1.280 €).

**Beispiel (vom User):** WS, 1× Typ IB + 1× Typ II →
4.500 € + 485 € + 1.280 € = **6.265 €**.

**SG-Fall (all-IA):** 1.120 € + 0 € (IA-Bearbeitungsgebühr = 0) = **1.120 €**.

Das unterscheidet FI vom DK-Muster: Der DK-Lead zahlt **nur** eine flache Zeile und ist aus dem
Pro-Variation-Pricing ausgeschlossen; der FI-Lead bleibt **im** Pro-Variation-Pricing und bekommt
den flachen Betrag **obendrauf**.

### A.2 Ausgangslage im Code (verifiziert)

- In `vcl-submission.js` liefert `leadSpecial()` für FI **null** (FI hat keine „… - worksharing"-Zeile),
  d.h. `leadFees()` bepreist den FI-Lead **heute schon** mit seinen Standard-Pro-Variation-Gebühren
  (485/1.280). **Es fehlt nur der flache Aufschlag.** → Kein Umbau des Pro-Variation-Pricings nötig.
- `PROCESS_FEES['FI'] = {role:'RMS', byType:{IA:640, IB:1010, II:2250}}` deckt bereits den
  Normal-(Single/Grouping-)Fall ab (v1.47.0); dieser wird in `computeSubmissionFees` bei
  `leadPricingActive()` übersprungen (Zeile 258) – der WS/SG-Lead-Fee ersetzt ihn.

### A.3 Datenänderung – `vcl-calc-data.js`

`PROCESS_FEES['FI']` um zwei flache EUR-Beträge erweitern:

```js
PROCESS_FEES: {"FI": {"role":"RMS","byType":{"IA":640.0,"IB":1010.0,"II":2250.0},"ws":4500.0,"sg":1120.0}}
```

- `ws` = Worksharing-Lead-Process-Fee (flach, einmal), `sg` = Supergrouping-Lead-Process-Fee.
- **Keine neuen `FEE_ROWS`** → Zeilenzahl bleibt **440**, Guardrail-Tests (`test_matrix`,
  `test_amounts`) unberührt.
- EUR (Fimea ist Euro-Behörde, keine FX).

### A.4 Engine-Helper – `vcl-calc-app.js`

Neuer Helper analog zu `processFeeFor()`:

```js
// Flat worksharing/supergrouping lead process fee for a country/role, EUR.
// mode: 'ws' | 'sg'. 0 where undefined or the role does not match.
function processFeeFlatFor(cc, role, mode) {
  const base = (typeof cc === 'string' && cc.indexOf(' - ') > -1) ? cc.slice(0, cc.indexOf(' - ')) : cc;
  const pf = (typeof PROCESS_FEES !== 'undefined' && PROCESS_FEES) ? PROCESS_FEES[base] : null;
  if (!pf || pf.role !== role) return 0;
  const amt = (mode === 'sg') ? pf.sg : pf.ws;
  return (typeof amt === 'number') ? amt : 0;
}
```

Auf `window.VCLCALC` exponieren (neben `processFeeFor`).

### A.5 Lead-Pricing-Erweiterung – `vcl-submission.js`, `leadFees()`

Der flache Betrag wird **in `leadFees()`** addiert (nicht als separater Block), damit der lokal im
Workflow gebildete Display-`grand` **und** der `computeSubmissionFees`-Total automatisch konsistent
bleiben (ein Geldpfad):

```js
function leadFees(sub, counts, engines) {
  if (!leadPricingActive(sub) || !sub.lead || !engines.computeFees) return null;
  if (feeCountsTotal(counts) === 0) return null;
  var s = leadSpecial(sub, engines);
  var role = leadPricingRole(sub, engines);
  var r = engines.computeFees({
    countries: [{ cc: sub.lead, role: role, strengths: strengthsFor(sub, sub.lead), special: { IA: s, IB: s, II: s } }],
    counts: counts, adminFees: false, processFees: false,
  });
  var lf = (r.countries && r.countries[0]) || null;
  if (lf) {
    var mode = sgActive(sub) ? 'sg' : 'ws';
    var flat = engines.processFeeFlatFor ? engines.processFeeFlatFor(sub.lead, role, mode) : 0;
    if (flat) {
      lf.total = (lf.total || 0) + flat;
      lf.processFeeFlat = flat;        // für die Breakdown-Zeile (Variante A)
      lf.processFeeFlatMode = mode;    // 'ws' | 'sg'
    }
  }
  return lf;
}
```

- DK bekommt `flat = 0` (kein `ws`/`sg` in `PROCESS_FEES`) → unverändert.
- `lf.total` enthält danach Pro-Variation + flach; `computeSubmissionFees` addiert `lf.total`
  (Zeile 236–237) in Total **und** `byCc[lead]` → FI-by-country-Zeile korrekt.

### A.6 Wiring – beide `subEngines()`

`processFeeFlatFor` in beiden Engine-Shapes ergänzen:
- `vcl-workflow.js` `subEngines()` (bei `processFeeFor`, Zeile ~180).
- `vcl-budget.js` `engines()` (bei `processFeeFor`, Zeile ~21).

### A.7 UI – `vcl-workflow.js`, `buildWorksharingLeadBox()` (Variante A)

Wenn `lead.processFeeFlat > 0`: unter der Lead-Grid-Zeile eine **kombinierte Breakdown-Zeile**
einziehen. Die Grid-Betragszeile zeigt weiterhin den **Gesamtbetrag** des Leads (6.265 €).

Breakdown-Zeile (zwei Teilbeträge):
- „incl. {Worksharing|Super-grouping} process fee (once): **{flat}**"
- „+ per-variation processing fees: **{lead.total − flat}**"

Der Betrag „per-variation" = `lead.total − lead.processFeeFlat`. Formatierung via `fmtEUR`.
Der bestehende Hinweistext darunter wird um den Process-Fee-Hinweis ergänzt.

CSS: eine schlanke Breakdown-Zeile (neue Klasse `vcl-wf-ws-lead__bd` in `vcl-workflow-style.css`,
Rahmen oben `0.5px var(--line)`, 12px, `--ink-faint`), kein neues Layout-System.

---

## Teil B – „once-per-application"-Fee-Relocation (klassischer Rechner)

### B.1 Verhalten heute (`vcl-calc-app.js`, Overview ~Zeile 2023–2032)

Admin-Fee (CZ 2.000 CZK / EE 16 €) und Process-Fee (FI) werden als **eigene `<tr>`-Zeilen in der
Overview-Tabelle** gerendert (`vres-adminrow`), mit Klammer-Format `€82.07 (CZK 2.000,00)`.
`cr.total` (Country subtotal + Overview-Total-Spalte) enthält diese Fees **nicht**; der Grand Total
addiert sie separat.

### B.2 Soll

1. **Overview:** Die beiden `.map(...)`-Blöcke, die `vres-adminrow`-Zeilen für Admin- und
   Process-Fee erzeugen (Zeile 2023–2032), **entfernen**.
2. **Overview-Total-Spalte je Land** (Zeile 2010–2020): statt `cr.total` den **All-in-Betrag**
   `cr.total + (cr.adminFee||0) + (cr.processFee||0)` anzeigen (EUR/Local via `m`). Grand Total im
   tfoot bleibt `res.grandTotal` (unverändert).
3. **Details-Card** (`countryCards`, ~Zeile 1922–1976): nach den Variationszeilen (`rowsHtml`) je
   Land eine Zeile anhängen, wenn `cr.adminFee > 0.005` bzw. `cr.processFee > 0.005`:
   - Label: „Administrative fee (once per application)" bzw. „Process fee (once per application)".
     **Kein** Ländername (steht schon in der Card), **keine Klammer**.
   - Betrag folgt dem Umschalter:
     - Admin-Fee: lokale Ansicht mit eigener Admin-Währung → `fmtLocalCurrency(cr.adminFeeLocal, cr.adminFeeCurrency)`
       wenn `mode==='local' && cr.adminFeeCurrency`; sonst `fmtEUR(cr.adminFee)`.
       (So exakt wie der kanonische Lokalbetrag, z. B. CZK 2.000,00.)
     - Process-Fee: EUR (`fmtEUR(cr.processFee)`), FI ist Euro-Land. Für Robustheit dennoch via
       `m(cr.processFee)`.
   - Styling: neue Zeilenklasse (z. B. `vres-feerow`), optisch dezent abgesetzt
     (`font-style:italic`, leichter Tönungs-Hintergrund), Label `colspan=4`, Betrag in letzter Spalte.
4. **Country subtotal (tfoot)** (Zeile 1959–1975) und **Card-Header-Betrag** (`vres-amt`, Zeile 1970):
   den All-in-Betrag `cr.total + adminFee + processFee` zeigen (via `m`). Bei `mechanic==='cap'`
   gilt der Cap nur für die Variationssumme; die Fees kommen additiv obendrauf (Cap-Rohwert-Darstellung
   unverändert, aber Subtotal = gecappte Variationssumme + Fees).

### B.3 Konsistenz / Export

- **Grand Total** (Overview-tfoot + Details-`vres-grand`) bleibt `res.grandTotal` → unverändert.
- **Excel-/Print-Export** (`data-calc-excel` / `data-calc-print`, Zeile ~2314 ff.): prüfen, dass die
  Fees dort weiterhin genau einmal erscheinen (heute als eigene Overview-Zeilen). Export so anpassen,
  dass er die neue Darstellung spiegelt (Fee als Detailzeile je Land; Overview-Total all-in).
  **Doppelzählung vermeiden.**

---

## Tests

- **Node** `test/test-submission.js` (neu):
  - FI als WS-Lead, {IB 1, II 1} → `leadFees().total` = 6.265; `processFeeFlat` = 4.500;
    `computeSubmissionFees().total` enthält 6.265 genau einmal.
  - FI als SG-Lead, {IA n} → `leadFees().total` = 1.120; `processFeeFlat` = 1.120.
  - DK als WS-Lead unverändert (kein `processFeeFlat`).
- **Node** Classic-Calculator (falls Harness vorhanden): `computeFees({countries:[{cc:'FI',role:'RMS',...}],counts:{IB:1,II:1}})`
  → `grandTotal` enthält Process-Fee 2.250 einmal; `countries[0].processFee` = 2.250.
- **Python** `python -m pytest tests/ -q`: Zeilenzahl **440** bleibt → bestehende Guardrails grün.
- **Browser (NAS, HTTP):** Overview ohne separate Fee-Zeilen; Details mit Fee-Zeile je Land;
  EUR/Local-Umschalter zeigt bei CZ CZK 2.000,00 ↔ €82,07 ohne Klammer; Grand Total unverändert;
  Guided-Workflow-Lead-Box zeigt 6.265 € + Breakdown-Zeile.

---

## Version & Deploy

- `v1.48.0`: Header + `VFC_VERSION` in `variation-fee-calculator.php` bumpen.
- ZIP via `python build_zip.py`.
- NAS-Deploy (Sandbox AUS), nur geänderte Dateien kopieren + Hash prüfen, nie löschen.
- Über HTTP verifizieren (`http://192.168.178.43/pharmazulassung/`, Toolbox `?page_id=765`).
- Ionos-Produktion bleibt außen vor (weiter 1.32.0).

## Betroffene Dateien

- `assets/js/vcl-calc-data.js` (A.3: PROCESS_FEES.FI.ws/.sg)
- `assets/js/vcl-calc-app.js` (A.4: processFeeFlatFor + expose; B: Overview/Details/Export)
- `assets/js/vcl-submission.js` (A.5: leadFees)
- `assets/js/vcl-workflow.js` (A.6: subEngines; A.7: buildWorksharingLeadBox)
- `assets/js/vcl-budget.js` (A.6: engines)
- `assets/css/vcl-workflow-style.css` (A.7: Breakdown-Zeile)
- `assets/css/vcl-calc-style.css` (B: Fee-Detailzeile)
- `variation-fee-calculator.php` (Version)
- `test/test-submission.js` (Tests)

## Nicht in Scope

- FR Type-IB-Exemptions (keine belastbare Quelle).
- CZ 50 %-WS-Rabatt je weiterer MA (braucht MA-Count-Konzept).
- Länder A–Z ab IE.
- Ionos-Produktions-Deploy.
