# Baustein A — Regelmodell, Migration und Abgleich: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beweisen oder widerlegen, dass sich die 421 Gebührenzeilen als erklärende Regeln darstellen lassen, ohne dass sich ein einziges Rechenergebnis ändert.

**Architecture:** Drei Schritte. A1 fährt den **echten** Produktionscode (`window.VCLCALC.computeFees`) in einem Headless-Browser über 151.830 Eingabekombinationen und schreibt einen Golden Master. A2 leitet aus den Excel-Formeln je Zeile eine Regelbeschreibung ab. A3 rechnet mit einem Referenz-Evaluator aus diesen Regeln und stellt das Ergebnis gegen den Golden Master.

**Tech Stack:** Python 3.12 durchgehend — pytest und `playwright.sync_api` (beide bereits installiert, Chromium startbereit). Keine neuen Abhängigkeiten, weder im Plugin noch im Repo.

> **Änderung nach der Vor-Prüfung (2026-08-31):** Ursprünglich waren die Tasks 1–3 in Node geplant, passend zu den vorhandenen `tests/*.test.mjs`. Playwright ist für Node hier aber nicht installiert; es nachzurüsten hieße `package.json`, `package-lock.json` und `node_modules/` in ein Repo zu bringen, das bislang keinerlei JS-Werkzeuge führt. Python ist dagegen die etablierte Werkzeugsprache dieses Repos (`convert.py`, `convert-workload.py`, `convert-annual-fees.py`, `build_zip.py`, `extract_art5.py`, `extract_qa.py`) und erlaubt es zudem, die Eingabematrix zwischen Golden Master und Abgleich **einmal** zu führen statt zweimal.

**Spec:** `docs/superpowers/specs/2026-08-31-fee-rules-migration-a-design.md`

## Global Constraints

- **Originalgetreu, nicht besser.** Das heutige Verhalten wird nachgebildet, Eigenheiten eingeschlossen (Spec B3: Vorauswahl „reduced"; B4: Fehlbezug `O341`). Auffälligkeiten kommen nach `out/findings.md`, sie werden **nicht** behoben.
- **Kein Plugin-Code wird verändert.** Nach jedem Task gilt: `git status` zeigt ausschließlich neue Dateien unter `tools/fee-migration/`, `tests/` und `docs/`.
- **Ablage:** `tools/fee-migration/` im Repo-Wurzelverzeichnis `D:\Claude\Variation Fee Calculator` — bewusst außerhalb des Plugin-Ordners, weil `build_zip.py:20` alles unter `variation-fee-calculator/` ins WordPress-ZIP packt.
- **Determinismus:** Kein Netzzugriff im Golden-Master-Lauf. Playwright blockt alle externen Anfragen, damit `LIVE_FX` leer bleibt und `STATIC_FX_RATES` greifen (Spec B2).
- **Beträge** werden auf 2 Nachkommastellen gerundet verglichen, Flags exakt.
- **Zeilenenden:** Die 16 als geändert gemeldeten Dateien unterscheiden sich nur in CRLF/LF. Nicht anfassen, nicht mit committen.
- **Sprache:** Code-Kommentare und Commit-Messages Englisch, Dokumente Deutsch.
- **Jeder Deckel muss eingebbar sein** (Spec B6). Zulässig sind genau vier Formen: `{"const": n}`, `{"byStrength": {"1": a, "else": b}}`, `{"points": n, "pointValue": v}`, `{"multipleOfLead": n}`. Alles andere ist ein Befund, kein Sonderfall im Code.
- **Der Deckel ist offen.** Deckel werden **generisch** über alle 421 Zeilen gesucht, nie gegen eine Länderliste geprüft — es können Länder hinzukommen und Beträge sich ändern. `cap` ist ein Feld, das jede Zeile tragen kann, auch eine ohne heutigen Deckel.
- **Committen ja, pushen nein.** Commits je Aufgabe wie geplant; **kein `git push`** in Baustein A.

---

### Task 1: Prüfstand-Seite und Erreichbarkeit der Rechen-Schnittstelle

Der Prüfstand lädt den echten Produktionscode. Eine nach Node portierte Kopie wäre wertlos — sie könnte abweichen, und dann prüfte man die Kopie statt das Produkt.

`vcl-calc-app.js` ruft am Dateiende `render()` auf und greift ab `:531` auf 25 DOM-Knoten zu. `window.VCLCALC` wird jedoch bereits bei `:476` gesetzt, also **vor** `render()`. Die Seite stellt trotzdem alle Knoten bereit, damit keine Ausnahme im Log rauscht.

**Files:**
- Create: `tools/fee-migration/harness.html`
- Create: `tools/fee-migration/harness.py`
- Test: `tests/test_harness_smoke.py`

**Interfaces:**
- Produces: `open_calculator()` — Kontextmanager, liefert `(page, errors)`; die Seite stellt `window.VCLCALC.computeFees(input)` bereit.
- `computeFees` erwartet `{countries: [{cc, role, strengths, special}], counts: {IA,IB,II}}` und liefert `{countries: [...], grandTotal}`.

- [ ] **Step 1: Prüfstand-Seite anlegen**

`tools/fee-migration/harness.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Fee engine harness</title>
<!-- All 25 ids the calculator touches at load, so nothing throws while we
     drive the pure computation API. Order matters: data before app. -->
<div id="vclcalc-app"></div>
<div id="vclcalc-rail"></div>
<div id="vclcalc-stepContent"></div>
<div id="vclcalc-fxStatus"></div>
<div id="vclcalc-headerTag"></div>
<div id="vclcalc-typeCounters"></div>
<div id="vclcalc-countryDetailList"></div>
<input id="vclcalc-countrySearch">
<div id="vclcalc-specialPanel"></div>
<div id="vclcalc-specialBlocks"></div>
<div id="vclcalc-changelogPanel"></div>
<div id="vclcalc-haWebsitesPanel"></div>
<div id="vclcalc-strengthsNote"></div>
<button id="vclcalc-selectAll"></button>
<button id="vclcalc-resetSelection"></button>
<button id="vclcalc-restart"></button>
<button id="vclcalc-strengthsReset"></button>
<button id="vclcalc-toStep2"></button>
<button id="vclcalc-toStep3"></button>
<button id="vclcalc-toResult"></button>
<button id="vclcalc-back1"></button>
<button id="vclcalc-back2"></button>
<button id="vclcalc-back3"></button>
<button id="vclcalc-toggleChangelog"></button>
<button id="vclcalc-toggleHaWebsites"></button>
<script src="../../variation-fee-calculator/assets/js/vcl-calc-data.js"></script>
<script src="../../variation-fee-calculator/assets/js/vcl-calc-app.js"></script>
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

Der erwartete Wert ist **von Hand gegen die Excel-Formeln der Zeile 257 nachgerechnet**, nicht aus dem Code übernommen — sonst prüfte der Test sich selbst:

```
P257 = (H + (L-1)*G254) + (H + (L-1)*G254)*(M-1) = 1055 + 1055*0 =  1.055
Q257 = (I + (L-1)*G255) + (I + (L-1)*G255)*(N-1) = 2446 + 2446*1 =  4.892
R257 = (F + (L-1)*G257) + (J + (L-1)*G257)*(O-1) = 29357 + 0     = 29.357
S257 = P + Q + R                                                 = 35.304
```

`tests/test_harness_smoke.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from harness import open_calculator


def test_italy_rms_three_strengths_one_ia_two_ib_one_ii():
    with open_calculator() as (page, errors):
        res = page.evaluate("""() => window.VCLCALC.computeFees({
            countries: [{ cc: "IT", role: "RMS", strengths: 3,
                          special: { IA: "standard", IB: "standard", II: "standard" } }],
            counts: { IA: 1, IB: 2, II: 1 }
        })""")
        assert round(res["grandTotal"], 2) == 35304.00
        assert errors == [], f"page errors while loading: {errors}"
```

- [ ] **Step 3: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_harness_smoke.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'harness'`

- [ ] **Step 4: Den Seitenöffner implementieren**

`tools/fee-migration/harness.py`:

```python
"""Opens the harness page with the real production scripts loaded.

Every external request is aborted so LIVE_FX stays empty and the static
exchange rates apply -- without this the golden master would drift with the
daily ECB rate (spec B2).
"""

from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PAGE = (HERE / "harness.html").as_uri()


@contextmanager
def open_calculator():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("**", lambda route: route.continue_()
                   if route.request.url.startswith("file://") else route.abort())
        page.on("pageerror", lambda e: errors.append(e.message))
        page.goto(PAGE)
        page.wait_for_function(
            "() => typeof window.VCLCALC?.computeFees === 'function'")
        try:
            yield page, errors
        finally:
            browser.close()
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_harness_smoke.py -v`
Expected: PASS

Schlägt er mit einem Ladefehler fehl, statt mit einer falschen Zahl: `errors` ausgeben und die fehlenden DOM-Knoten in `harness.html` ergänzen. Ein Ausweichen auf einen Export der reinen Rechenfunktionen ist **nur** zulässig, wenn die Seite nicht zum Laufen zu bringen ist, und muss dann in `out/findings.md` als Abweichung von der Spec vermerkt werden.

Schlägt er mit **35304 ≠ irgendetwas anderes** fehl, ist das ein echter Befund: Der erwartete Wert stammt aus der Excel, nicht aus dem Code. Dann nicht den Test anpassen, sondern die Abweichung untersuchen.

- [ ] **Step 6: Committen**

```bash
git add tools/fee-migration/harness.html tools/fee-migration/harness.py tests/test_harness_smoke.py
git commit -m "test(fee-migration): harness page driving the real fee engine"
```

---

### Task 2: Eingabematrix

**Files:**
- Create: `tools/fee-migration/feedata.py`
- Create: `tools/fee-migration/matrix.py`
- Test: `tests/test_matrix.py`

**Interfaces:**
- Produces: `feedata.load_fee_rows() -> list[dict]` — liest `FEE_ROWS` aus `vcl-calc-data.js`. **Von Task 4 wiederverwendet**, dort per `from feedata import load_fee_rows` in `extract_rules.py` re-exportiert.
- Produces: `matrix.build_matrix(fee_rows) -> list[dict]` mit Einträgen `{"cc", "role", "strengths", "special": {"IA","IB","II"}, "counts": {"IA","IB","II"}}`. **Von Task 8 wiederverwendet**, damit Golden Master und Abgleich dieselbe Matrix benutzen und nicht auseinanderlaufen können.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_matrix.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from feedata import load_fee_rows
from matrix import build_matrix

ROWS = load_fee_rows()


def test_the_data_file_still_holds_421_rows():
    assert len(ROWS) == 421


def test_matrix_has_the_size_the_spec_states():
    # 482 special-case combinations x 63 count combinations x 5 strengths
    assert len(build_matrix(ROWS)) == 151830


def test_matrix_contains_the_hand_checked_italian_case():
    hit = [e for e in build_matrix(ROWS)
           if e["cc"] == "IT" and e["role"] == "RMS" and e["strengths"] == 3
           and e["counts"] == {"IA": 1, "IB": 2, "II": 1}
           and e["special"].get("II") == "standard"]
    assert hit, "Italian case missing from the matrix"


def test_no_combination_without_any_variation():
    assert not [e for e in build_matrix(ROWS) if not any(e["counts"].values())]
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_matrix.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'feedata'`

- [ ] **Step 3: Matrix implementieren**

`tools/fee-migration/feedata.py`:

```python
"""Single reader for the fee table. Shared by the matrix and the extractor so
both always see the same 421 rows."""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = (HERE / ".." / ".." / "variation-fee-calculator" / "assets" / "js"
        / "vcl-calc-data.js").resolve()


def load_fee_rows():
    src = DATA.read_text(encoding="utf-8")
    m = re.search(r"FEE_ROWS:\s*(\[.*?\}\]),\n", src, re.S)
    if not m:
        raise RuntimeError(f"FEE_ROWS not found in {DATA}")
    return json.loads(m.group(1))
```

`tools/fee-migration/matrix.py`:

```python
"""The input space the golden master and the comparison both run over.

Built once, here, so the two can never drift apart.
"""

from itertools import product

TYPES = ("IA", "IB", "II")
STRENGTHS = (1, 2, 3, 5, 10)
MAX_COUNT = 3


def _variants_by_pair(fee_rows):
    """Each (cc, role) with the special-case variants it offers per type."""
    by_type = {}
    for r in fee_rows:
        by_type.setdefault((r["cc"], r["role"], r["type"]), []).append(r["special"])
    pairs = {}
    for r in fee_rows:
        key = (r["cc"], r["role"])
        entry = pairs.setdefault(key, {"cc": r["cc"], "role": r["role"], "byType": {}})
        entry["byType"][r["type"]] = by_type[(r["cc"], r["role"], r["type"])]
    return list(pairs.values())


def _count_combos():
    return [{"IA": a, "IB": b, "II": c}
            for a, b, c in product(range(MAX_COUNT + 1), repeat=3) if a or b or c]


def _special_combos(by_type):
    """Cartesian product of the special-case choices across the three types."""
    types = [t for t in TYPES if t in by_type]
    if not types:
        return [{}]
    return [dict(zip(types, picks))
            for picks in product(*(by_type[t] for t in types))]


def build_matrix(fee_rows):
    counts = _count_combos()
    out = []
    for pair in _variants_by_pair(fee_rows):
        for special in _special_combos(pair["byType"]):
            for c in counts:
                for strengths in STRENGTHS:
                    out.append({"cc": pair["cc"], "role": pair["role"],
                                "strengths": strengths, "special": special,
                                "counts": c})
    return out
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_matrix.py -v`
Expected: PASS, alle vier Tests

Weicht die Zahl von 151.830 ab, ist **nicht** der Test anzupassen: erst klären, warum die Zählung aus der Spec nicht mehr stimmt, und den Befund in `out/findings.md` festhalten.

- [ ] **Step 5: Committen**

```bash
git add tools/fee-migration/feedata.py tools/fee-migration/matrix.py tests/test_matrix.py
git commit -m "feat(fee-migration): input matrix over countries, specials, counts and strengths"
```

---

### Task 3: Golden-Master-Lauf

**Files:**
- Create: `tools/fee-migration/golden.py`
- Create: `tools/fee-migration/.gitignore`
- Test: `tests/test_golden_format.py`

**Interfaces:**
- Consumes: `harness.open_calculator` (Task 1), `feedata.load_fee_rows` und `matrix.build_matrix` (Task 2).
- Produces: `golden.format_run(run_id, entry, res) -> list[str]`
- Produces: `out/golden.csv.gz`. Eine Zeile je Ergebniszeile eines Laufs, Spalten:
  `runId, cc, role, strengths, ia, ib, ii, specialIA, specialIB, specialII, row, type, total, singleTotal, rawSumSingle, subsumed, count, capValue, groupingFee, groupingBase, groupingPerAdditional`
  Beträge auf 2 Nachkommastellen, leere Werte als leeres Feld, Booleans als `0`/`1`.

Begründung des Formats: als JSON wären es über 200 MB. Kompaktes CSV ergibt rund 18 MB, gzip-gepackt etwa 3 MB — im Repo tragbar und als Prüfstein für B und C unmittelbar nutzbar.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_golden_format.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from golden import format_run, HEADER

ENTRY = {"cc": "IT", "role": "RMS", "strengths": 3,
         "special": {"IA": "standard", "IB": "standard", "II": "standard"},
         "counts": {"IA": 1, "IB": 2, "II": 1}}
RES = {"countries": [{"items": [
    {"row": {"row": 257, "type": "II"}, "total": 35304, "singleTotal": 29357,
     "rawSumSingle": 29357, "subsumed": False, "count": 1, "capValue": None,
     "groupingFee": None, "groupingBase": None, "groupingPerAdditional": None}
]}]}


def test_one_line_per_result_item():
    assert len(format_run(7, ENTRY, RES)) == 1


def test_columns_match_the_header():
    fields = format_run(7, ENTRY, RES)[0].split(",")
    assert len(fields) == len(HEADER.split(","))


def test_amounts_carry_two_decimals_and_flags_are_zero_one():
    f = format_run(7, ENTRY, RES)[0].split(",")
    cols = HEADER.split(",")
    assert f[cols.index("runId")] == "7"
    assert f[cols.index("cc")] == "IT"
    assert f[cols.index("row")] == "257"
    assert f[cols.index("total")] == "35304.00"
    assert f[cols.index("subsumed")] == "0"
    assert f[cols.index("capValue")] == ""
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_golden_format.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'golden'`

- [ ] **Step 3: Golden-Master-Lauf implementieren**

`tools/fee-migration/golden.py`:

```python
"""Runs the real fee engine over the whole input matrix and records the result.

The output is the acceptance test for Bausteine B and C: whatever replaces the
engine has to reproduce this file.
"""

import gzip
import sys
from pathlib import Path

from feedata import load_fee_rows
from harness import open_calculator
from matrix import build_matrix

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

HEADER = ("runId,cc,role,strengths,ia,ib,ii,specialIA,specialIB,specialII,"
          "row,type,total,singleTotal,rawSumSingle,subsumed,count,capValue,"
          "groupingFee,groupingBase,groupingPerAdditional")

BATCH = 500


def _num(v):
    return f"{v:.2f}" if isinstance(v, (int, float)) and not isinstance(v, bool) else ""


def _str(v):
    return "" if v is None else str(v).replace(",", " ").replace('"', " ").replace("\n", " ")


def format_run(run_id, entry, res):
    lines = []
    for cr in res["countries"]:
        for it in cr["items"]:
            lines.append(",".join(str(x) for x in [
                run_id, entry["cc"], entry["role"], entry["strengths"],
                entry["counts"]["IA"], entry["counts"]["IB"], entry["counts"]["II"],
                _str(entry["special"].get("IA")), _str(entry["special"].get("IB")),
                _str(entry["special"].get("II")),
                it["row"]["row"], it["row"]["type"],
                _num(it.get("total")), _num(it.get("singleTotal")),
                _num(it.get("rawSumSingle")),
                1 if it.get("subsumed") else 0,
                "" if it.get("count") is None else it["count"],
                _num(it.get("capValue")), _num(it.get("groupingFee")),
                _num(it.get("groupingBase")), _num(it.get("groupingPerAdditional")),
            ]))
    return lines


# One page context for the whole run; batching keeps the number of evaluate()
# round trips low without building one enormous argument array.
_EVAL = """(entries) => entries.map((e) => window.VCLCALC.computeFees({
    countries: [{ cc: e.cc, role: e.role, strengths: e.strengths, special: e.special }],
    counts: e.counts
}))"""


def main():
    entries = build_matrix(load_fee_rows())
    OUT.mkdir(exist_ok=True)
    with open_calculator() as (page, errors):
        with gzip.open(OUT / "golden.csv.gz", "wt", encoding="utf-8", newline="") as fh:
            fh.write(HEADER + "\n")
            for i in range(0, len(entries), BATCH):
                batch = entries[i:i + BATCH]
                results = page.evaluate(_EVAL, batch)
                for j, (entry, res) in enumerate(zip(batch, results)):
                    for line in format_run(i + j, entry, res):
                        fh.write(line + "\n")
                print(f"  {i + len(batch)}/{len(entries)}", end="\r", flush=True)
        if errors:
            print("\nSeitenfehler beim Laden:", sorted(set(errors))[:5], file=sys.stderr)
            sys.exit(1)
    print(f"\nGolden Master geschrieben: {len(entries)} Läufe")


if __name__ == "__main__":
    main()
```

`tools/fee-migration/.gitignore`:

```
# Generated artefacts. golden.csv.gz is committed deliberately (see plan Task 3);
# everything else here is reproducible output.
out/*
!out/golden.csv.gz
!out/fee-rules.json
!out/report.md
!out/findings.md
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_golden_format.py -v`
Expected: PASS, alle drei Tests

- [ ] **Step 5: Den vollen Lauf ausführen**

Run: `python tools/fee-migration/golden.py`
Expected: Fortschrittsausgabe, am Ende `Golden Master geschrieben: 151830 Läufe`, Datei `tools/fee-migration/out/golden.csv.gz` vorhanden.

- [ ] **Step 6: Reproduzierbarkeit belegen**

```bash
cd "D:/Claude/Variation Fee Calculator"
cp tools/fee-migration/out/golden.csv.gz /tmp/golden-1.gz
python tools/fee-migration/golden.py
gunzip -c /tmp/golden-1.gz > /tmp/a.csv
gunzip -c tools/fee-migration/out/golden.csv.gz > /tmp/b.csv
diff -q /tmp/a.csv /tmp/b.csv && echo "REPRODUZIERBAR"
```

Expected: `REPRODUZIERBAR`

Schlägt das fehl, ist der Lauf nicht deterministisch — wahrscheinlichste Ursache: eine Netzanfrage kam durch und `LIVE_FX` wurde gefüllt. Dann die `page.route`-Sperre in `smoke.mjs` prüfen, **nicht** den Vergleich abschwächen.

- [ ] **Step 7: Committen**

```bash
git add tools/fee-migration/golden.py tools/fee-migration/.gitignore \
        tools/fee-migration/out/golden.csv.gz tests/test_golden_format.py
git commit -m "feat(fee-migration): golden master over 151830 engine runs"
```

---

### Task 4: Regel-Extraktor — Zeilenauswahl

Die Zeilenauswahl ist vollständig vorab analysiert: neun Formen, davon 411 Zeilen einheitlich „höchster vorkommender Typ übernimmt". Ausnahmen sind Dänemark (Schwellen) und der Fehlbezug aus Spec B4.

**Files:**
- Create: `tools/fee-migration/extract_rules.py`
- Test: `tests/test_extract_select.py`

**Interfaces:**
- Produces: `load_fee_rows() -> list[dict]`, `extract_select(row) -> dict`
  mit `{"subsumption": "highest-type-wins", "activeWhen": None | {"type": "IA", "min": 2} | {"type": "IA", "max": 1}, "anomaly": None | str}`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_extract_select.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from extract_rules import load_fee_rows, extract_select

ROWS = {r["row"]: r for r in load_fee_rows()}


def test_standard_italian_row_has_no_gate():
    sel = extract_select(ROWS[257])
    assert sel["subsumption"] == "highest-type-wins"
    assert sel["activeWhen"] is None
    assert sel["anomaly"] is None


def test_danish_standard_row_is_capped_at_one_variation():
    # DK row 87: IF(M2>1, 0, ...) -- only fires for exactly one Type IA
    sel = extract_select(ROWS[87])
    assert sel["activeWhen"] == {"type": "IA", "max": 1}


def test_danish_grouped_row_starts_at_two_variations():
    # DK row 88 "same D.Sp.No.": IF(M2<2, 0, ...)
    sel = extract_select(ROWS[88])
    assert sel["activeWhen"] == {"type": "IA", "min": 2}


def test_eu_row_422_flags_the_foreign_reference():
    # Spec B4: Of reads O341 (a Polish row) instead of O2
    sel = extract_select(ROWS[422])
    assert sel["anomaly"] is not None
    assert "341" in sel["anomaly"]


def test_all_but_the_danish_rows_are_ungated():
    # 411 of 421 rows follow "highest type wins" with no count gate; the gated
    # ones are Denmark's nine threshold rows (spec, Task 4 preamble).
    gated = [r["row"] for r in load_fee_rows() if extract_select(r)["activeWhen"]]
    assert len(gated) == 9
    assert all(ROWS[n]["cc"] == "DK" for n in gated)


def test_only_row_422_carries_an_anomaly():
    flagged = [r["row"] for r in load_fee_rows() if extract_select(r)["anomaly"]]
    assert flagged == [422]
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_extract_select.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'extract_rules'`

- [ ] **Step 3: Auswahl-Extraktion implementieren**

`tools/fee-migration/extract_rules.py`:

```python
"""Derives declarative rules from the Excel formulas in vcl-calc-data.js.

Faithful by design: this reproduces today's behaviour, quirks included. Where a
row does something the model does not cover, it is reported -- never guessed at.
"""

import re
from pathlib import Path

# Re-exported so the extractor's tests and callers have one import site.
# The reader itself lives in feedata.py (Task 2) -- one loader, one truth.
from feedata import load_fee_rows  # noqa: F401

HERE = Path(__file__).resolve().parent

_TYPE_COL = {"IA": "M", "IB": "N", "II": "O"}


def _global_refs(formula, own_row):
    """Row numbers this formula reads that are neither row 2 nor its own row."""
    return sorted({
        int(r) for _c, r in re.findall(r"([A-Z]{1,2})(\d+)", formula)
        if int(r) not in (2, own_row)
    })


def extract_select(row):
    """Reads Mf/Nf/Of into a selection descriptor."""
    own = row["row"]
    mf = row.get("Mf") or ""

    active = None
    gate = re.search(r"IF\(M2([<>])(\d+),0,", mf.replace(" ", ""))
    if gate:
        op, n = gate.group(1), int(gate.group(2))
        # ">1 -> 0" means the row only applies at exactly one; "<2 -> 0" means
        # it only starts at two.
        active = {"type": "IA", "max": n} if op == ">" else {"type": "IA", "min": n}

    anomaly = None
    for key in ("Mf", "Nf", "Of"):
        f = row.get(key)
        if not f:
            continue
        foreign = [r for r in _global_refs(f, own) if r != own]
        if foreign:
            anomaly = f"{key} reads foreign row(s) {foreign} instead of row 2"

    return {"subsumption": "highest-type-wins", "activeWhen": active, "anomaly": anomaly}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_extract_select.py -v`
Expected: PASS, alle fünf Tests

- [ ] **Step 5: Committen**

```bash
git add tools/fee-migration/extract_rules.py tests/test_extract_select.py
git commit -m "feat(fee-migration): derive row-selection rules from Mf/Nf/Of"
```

---

### Task 5: Regel-Extraktor — Beträge und Regelfamilie

Die Zahl der Regelfamilien ist **Ergebnis**, nicht Vorgabe (Spec B5). Der Extraktor ordnet zu, was er sicher erkennt, und meldet den Rest als `unknown` — er rät nicht.

**Files:**
- Modify: `tools/fee-migration/extract_rules.py`
- Test: `tests/test_extract_rule.py`

**Interfaces:**
- Consumes: `load_fee_rows`, `_global_refs` (Task 4)
- Produces: `extract_amounts(row) -> dict`, `classify_rule(row) -> dict` mit
  `{"rule": "scaling"|"flat_from_second"|"per_strength_tiered"|"per_count_tiered"|"unknown", "evidence": str}`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_extract_rule.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from extract_rules import load_fee_rows, extract_amounts, classify_rule

ROWS = {r["row"]: r for r in load_fee_rows()}


def test_italian_amounts_are_named_not_lettered():
    a = extract_amounts(ROWS[257])
    assert a["lead"] == 29357.0
    assert a["perStrength"] == 0.0
    assert a["rateIA"] == 1055.0
    assert a["rateIB"] == 2446.0
    assert a["rateII"] == 29357.0
    assert a["flat"] is None


def test_local_currency_row_keeps_its_own_currency():
    # CZ row 57 carries F_lc/G_lc etc.; the EUR values are derived at runtime
    a = extract_amounts(ROWS[57])
    assert a["currency"] == "CZK"
    assert a["lead"] is not None


def test_italy_is_plain_scaling():
    assert classify_rule(ROWS[257])["rule"] == "scaling"


def test_ema_row_423_is_count_tiered_not_scaling():
    # Spec B5: IF(O<3, O*F, 2*F+(O-2)*J) -- first two full, then reduced.
    # Misclassifying this as "scaling" was the flaw in the pre-analysis.
    assert classify_rule(ROWS[423])["rule"] == "per_count_tiered"


def test_no_rule_is_guessed():
    for r in load_fee_rows():
        c = classify_rule(r)
        assert c["rule"] in {"scaling", "flat_from_second", "per_strength_tiered",
                             "per_count_tiered", "unknown"}
        assert c["evidence"], f"row {r['row']} classified without evidence"
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_extract_rule.py -v`
Expected: FAIL — `cannot import name 'extract_amounts'`

- [ ] **Step 3: Beträge und Klassifikation implementieren**

An `tools/fee-migration/extract_rules.py` anhängen:

```python
_AMOUNT_KEYS = {"lead": "F", "perStrength": "G", "rateIA": "H",
                "rateIB": "I", "rateII": "J", "flat": "K"}


def extract_amounts(row):
    """Excel column letters become names. Local-currency rows keep their own
    currency: F..K are derived from F_lc..K_lc at runtime via the FX rate, so
    the *_lc values are the authoritative ones (spec B2)."""
    local = row.get("currency")
    out = {"currency": local or "EUR"}
    for name, col in _AMOUNT_KEYS.items():
        src = f"{col}_lc" if local else col
        out[name] = row.get(src)
    return out


def _norm(formula, own_row):
    """Own-row refs to %, row-2 refs to §, anything else to @ -- so shapes can
    be compared without their absolute row numbers."""
    def rep(m):
        col, r = m.group(1), int(m.group(2))
        return col + ("%" if r == own_row else ("§" if r == 2 else "@"))
    return re.sub(r"([A-Z]{1,2})(\d+)", rep, formula.replace(" ", ""))


def classify_rule(row):
    own = row["row"]
    parts = [row.get(k) for k in ("Pf", "Qf", "Rf") if row.get(k)]
    if not parts:
        return {"rule": "unknown", "evidence": "no P/Q/R formula on this row"}
    body = " ".join(_norm(p, own) for p in parts)

    # First N at full price, then a reduced rate -- over counts (EMA) ...
    if re.search(r"IF\([MNO]%<\d+,[MNO]%\*[FHIJ][%@],\d+\*[FHIJ][%@]\+\([MNO]%-\d+\)", body):
        return {"rule": "per_count_tiered", "evidence": "IF(count<n, count*F, n*F+(count-n)*J)"}

    # ... or over strengths (IE)
    if re.search(r"IF\(L%=1,[FHIJ][%@]\*[MNO]%,IF\(L%>\d+", body):
        return {"rule": "per_strength_tiered", "evidence": "IF(L=1, F*count, tiered by strength)"}

    # A flat grouped fee replaces the per-variation arithmetic from the second on
    if re.search(r">1,K[%@]", body) or re.search(r"K[%@]\+\(L%-1\)", body):
        return {"rule": "flat_from_second", "evidence": "count>1 branch returns K"}

    # Lead variation at full price, each further one at its own rate,
    # every strength adding G
    if re.search(r"\([FHIJ][%@]\+\(L%-1\)\*G[%@]\)", body):
        return {"rule": "scaling", "evidence": "(rate + (L-1)*G) * (count-1) shape"}

    return {"rule": "unknown", "evidence": f"unmatched shape: {body[:160]}"}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_extract_rule.py -v`
Expected: PASS, alle fünf Tests

- [ ] **Step 5: Verteilung ausgeben und festhalten**

```bash
cd "D:/Claude/Variation Fee Calculator"
python -c "
import sys; sys.path.insert(0,'tools/fee-migration')
from extract_rules import load_fee_rows, classify_rule
import collections
c = collections.Counter(classify_rule(r)['rule'] for r in load_fee_rows())
for k, v in c.most_common(): print(f'{v:4d}  {k}')
"
```

Expected: eine Verteilung über die fünf Kategorien. **Jede Zeile in `unknown` ist ein Befund, kein Fehler** — sie gehört mit ihrer `evidence` nach `out/findings.md`.

- [ ] **Step 6: Committen**

```bash
git add tools/fee-migration/extract_rules.py tests/test_extract_rule.py
git commit -m "feat(fee-migration): classify rule families from P/Q/R formulas"
```

---

### Task 6: Regel-Extraktor — Deckel und Zuschlag

Der riskanteste Teil des Modells (Spec A2). Zusätzlich gilt **Spec B6**: Der Deckel muss später im Editor eingebbar sein, also in Formularfelder passen. Zulässig sind genau vier Formen — fester Betrag (DE `19900`), zwei Beträge nach Stärkenzahl (`4150`/`6425`), Punktzahl × Punktwert (SI `1500*5.8`), Vielfaches der Grundgebühr (`2*F`).

**Polen darf nicht als Deckel geführt werden:** `IF(L=1, IF(sum>2*F, 2*F, sum), IF(count>1, 2*F+(L-1)*F*0.8, sum))` ist eine Gruppierungsregel mit Stärkenfaktor 0,8 und sieht nur wegen des `>`-Vergleichs wie ein Deckel aus. Der Extraktor muss sie als solche erkennen und **nicht** in `cap` ablegen.

**Files:**
- Modify: `tools/fee-migration/extract_rules.py`
- Test: `tests/test_extract_cap.py`

**Interfaces:**
- Produces: `extract_cap(row) -> None | dict` mit `{"scope": "P"|"P+Q"|"P+Q+R", "value": {...}}`,
  wobei `value` **genau eine** der vier eingebbaren Formen ist: `{"const": 19900}`,
  `{"byStrength": {"1": 4150, "else": 6425}}`, `{"points": 1500, "pointValue": 5.8}`,
  `{"multipleOfLead": 2}`
- Produces: `extract_surcharge(row) -> None | float`
- Produces: `build_rules() -> list[dict]` — setzt Task 4–6 zu `out/fee-rules.json` zusammen

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_extract_cap.py`:

```python
import re
import sys, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from extract_rules import load_fee_rows, extract_cap, extract_surcharge, build_rules

ROWS = {r["row"]: r for r in load_fee_rows()}


def test_italy_has_no_cap_and_no_surcharge():
    assert extract_cap(ROWS[257]) is None
    assert extract_surcharge(ROWS[257]) is None


def test_germany_is_a_plain_amount_one_field_can_hold():
    # Spec B6: DE row 69 caps the sum at a flat 19900 EUR
    cap = extract_cap(ROWS[69])
    assert cap["scope"] == "P+Q+R"
    assert cap["value"] == {"const": 19900.0}


def test_slovenia_is_points_times_a_point_value():
    # Spec B6: SI row 382 caps at 1500 points x 5.8 EUR/point
    cap = extract_cap(ROWS[382])
    assert cap["value"] == {"points": 1500.0, "pointValue": 5.8}


def test_poland_is_not_a_cap():
    # Spec B6: 2*F + (L-1)*F*0.8 is a grouping rule wearing a ">" comparison
    assert extract_cap(ROWS[337]) is None


def test_every_cap_is_enterable():
    allowed = ({"const"}, {"byStrength"}, {"points", "pointValue"}, {"multipleOfLead"})
    offenders = []
    for r in load_fee_rows():
        cap = extract_cap(r)
        if cap and set(cap.get("value", {})) not in allowed:
            offenders.append((r["row"], cap))
    assert offenders == [], f"caps not expressible as form fields: {offenders}"


def test_a_strength_dependent_cap_keeps_both_levels():
    hits = [r for r in load_fee_rows()
            if r.get("Sf") and "4150" in r["Sf"] and "6425" in r["Sf"]]
    assert hits, "no row with the 4150/6425 cap found -- data changed?"
    cap = extract_cap(hits[0])
    assert cap["value"]["byStrength"]["1"] == 4150.0
    assert cap["value"]["byStrength"]["else"] == 6425.0


def test_surcharge_is_read_as_a_number():
    hits = [r for r in load_fee_rows()
            if r.get("Sf") and re.search(r"\+77\b", r["Sf"])]
    assert hits, "no row with the +77 surcharge found -- data changed?"
    assert extract_surcharge(hits[0]) == 77.0


def test_build_rules_covers_every_row():
    rules = build_rules()
    assert len(rules) == 421
    assert all("rule" in r and "amounts" in r and "select" in r for r in rules)
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_extract_cap.py -v`
Expected: FAIL — `cannot import name 'extract_cap'`

- [ ] **Step 3: Deckel, Zuschlag und Zusammenbau implementieren**

An `tools/fee-migration/extract_rules.py` anhängen:

```python
def _cap_scope(sf, own):
    body = _norm(sf, own)
    if "P%+Q%+R%" in body:
        return "P+Q+R"
    if "P%+Q%" in body:
        return "P+Q"
    return "P"


def extract_cap(row):
    """Reads the ceiling out of the S formula.

    Only the four shapes a form field can hold are accepted (spec B6). Anything
    else comes back as {"unparsed": ...} and lands in the report -- a ceiling
    nobody can type in does not meet the requirement, so it must not be hidden
    behind a special case in code.

    Searched generically across all rows: countries with a cap may be added and
    amounts change, so there is deliberately no country list here.
    """
    sf = row.get("Sf")
    if not sf:
        return None
    body = sf.replace(" ", "")
    own = row["row"]

    # Poland first: 2*F + (L-1)*F*0.8 is a grouping rule with a strength factor.
    # It only looks like a cap because of the ">" comparison (spec B6).
    if re.search(rf"F{own}\*0\.8", body):
        return None

    # Points x point value: IF(P>1500*5.8, 1500*5.8, P)  -- Slovenia.
    # The 5.8 is the point value from the 'Exchange rates' sheet, resolved by
    # convert.py at export time.
    pts = re.search(r">(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?),", body)
    if pts:
        return {"scope": _cap_scope(sf, own),
                "value": {"points": float(pts.group(1)), "pointValue": float(pts.group(2))}}

    # Strength-dependent: IF(L=1, IF(x>a,a,x), IF(x>b,b,x))
    two = re.findall(r">\(?(\d+(?:\.\d+)?)\)?,\1,", body)
    if f"L{own}=1" in body and len(two) >= 2:
        return {"scope": _cap_scope(sf, own),
                "value": {"byStrength": {"1": float(two[0]), "else": float(two[1])}}}

    # Multiple of the lead fee: IF(x>(2*F), 2*F, x)
    mult = re.search(rf">\((\d+)\*F{own}\)", body)
    if mult:
        return {"scope": _cap_scope(sf, own),
                "value": {"multipleOfLead": int(mult.group(1))}}

    # Plain amount: IF(x>19900, 19900, x)  -- Germany
    const = re.findall(r">(\d+(?:\.\d+)?),\1,", body)
    if const:
        return {"scope": _cap_scope(sf, own), "value": {"const": float(const[0])}}

    # A ">" that gates something other than K, but matches none of the four
    # enterable shapes -- report it rather than invent a fifth form.
    if re.search(r"IF\([^)]*>[^,]+,", body) and "K" not in body:
        return {"scope": _cap_scope(sf, own), "unparsed": body[:200]}
    return None


def extract_surcharge(row):
    """A flat amount added on top of the sum, e.g. P+Q+77."""
    sf = row.get("Sf")
    if not sf:
        return None
    m = re.search(r"[PQR]\d+\+(\d+(?:\.\d+)?)\)", sf.replace(" ", ""))
    return float(m.group(1)) if m else None


def build_rules():
    rules = []
    for row in load_fee_rows():
        cls = classify_rule(row)
        rules.append({
            "row": row["row"], "cc": row["cc"], "role": row["role"],
            "type": row["type"], "special": row["special"],
            "fee_code": row.get("fee_code"),
            "amounts": extract_amounts(row),
            "select": extract_select(row),
            "rule": cls["rule"], "evidence": cls["evidence"],
            "cap": extract_cap(row),
            "surcharge": extract_surcharge(row),
        })
    return rules


def main():
    import json as _json
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    rules = build_rules()
    (out / "fee-rules.json").write_text(
        _json.dumps(rules, indent=1, ensure_ascii=False), encoding="utf-8")
    unknown = [r for r in rules if r["rule"] == "unknown"]
    unparsed = [r for r in rules if r["cap"] and "unparsed" in r["cap"]]
    anomalies = [r for r in rules if r["select"]["anomaly"]]
    print(f"{len(rules)} Zeilen -> fee-rules.json")
    print(f"  unknown rule : {len(unknown)}")
    print(f"  unparsed cap : {len(unparsed)}")
    print(f"  anomalies    : {len(anomalies)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_extract_cap.py -v`
Expected: PASS, alle fünf Tests

- [ ] **Step 5: Regeln erzeugen**

Run: `python tools/fee-migration/extract_rules.py`
Expected: `421 Zeilen -> fee-rules.json` plus die drei Zählungen. Die Zahlen für `unknown`, `unparsed cap` und `anomalies` sind das eigentliche Zwischenergebnis von A — sie gehören in `out/findings.md`.

- [ ] **Step 6: Committen**

```bash
git add tools/fee-migration/extract_rules.py tools/fee-migration/out/fee-rules.json \
        tests/test_extract_cap.py
git commit -m "feat(fee-migration): extract caps and surcharges, assemble fee-rules.json"
```

---

### Task 7: Referenz-Evaluator

Bewusst Wegwerfcode: er beweist das Modell. Die Produktionsfassung entsteht in Baustein B in PHP.

**Files:**
- Create: `tools/fee-migration/evaluate_rules.py`
- Test: `tests/test_evaluate_rules.py`

**Interfaces:**
- Consumes: `out/fee-rules.json`
- Produces: `evaluate(rules, cc, role, strengths, special, counts) -> list[dict]`
  je aktiver Zeile `{"row", "type", "total", "singleTotal", "rawSumSingle", "subsumed", "count", "capValue", "groupingFee"}` — dieselben Feldnamen wie im Golden Master.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_evaluate_rules.py`:

```python
import sys, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from evaluate_rules import load_rules, evaluate

RULES = load_rules()


def test_italy_matches_the_hand_checked_value():
    # Same case as the smoke test in Task 1, verified by hand against the
    # Excel formulas of row 257: 1055 + 4892 + 29357 = 35304
    items = evaluate(RULES, "IT", "RMS", 3,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 1, "IB": 2, "II": 1})
    total = sum(i["total"] for i in items if i["total"] is not None)
    assert round(total, 2) == 35304.00


def test_lower_types_are_subsumed_by_the_highest():
    items = evaluate(RULES, "IT", "RMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 1, "IB": 0, "II": 1})
    ia = [i for i in items if i["type"] == "IA"][0]
    assert ia["subsumed"] is True
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_evaluate_rules.py -v`
Expected: FAIL — Modul nicht gefunden

- [ ] **Step 3: Evaluator implementieren**

`tools/fee-migration/evaluate_rules.py`:

```python
"""Reference evaluator for fee-rules.json.

Throwaway by design: its only job is to prove the rule model reproduces the
current engine. The production implementation lands in PHP in Baustein B.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TYPES = ("IA", "IB", "II")
_RATE = {"IA": "rateIA", "IB": "rateIB", "II": "rateII"}


def load_rules():
    return json.loads((HERE / "out" / "fee-rules.json").read_text(encoding="utf-8"))


def _pick(rules, cc, role, type_, special):
    cands = [r for r in rules if r["cc"] == cc and r["role"] == role and r["type"] == type_]
    if not cands:
        return None
    if special:
        for r in cands:
            if r["special"] == special:
                return r
    # Mirrors resolveRow: the "no special" branch is dead code in the current
    # engine (no row has an empty special), so the first row wins (spec B3).
    return cands[0]


def _leading_type(counts):
    for t in reversed(TYPES):
        if counts.get(t, 0) > 0:
            return t
    return None


def _active_counts(rule, type_, counts):
    """Subsumption: the highest present type absorbs the lower ones."""
    lead = _leading_type(counts)
    if type_ != lead:
        return {"IA": 0, "IB": 0, "II": 0}
    gate = rule["select"]["activeWhen"]
    if gate:
        n = counts.get(gate["type"], 0)
        if "min" in gate and n < gate["min"]:
            return {"IA": 0, "IB": 0, "II": 0}
        if "max" in gate and n > gate["max"]:
            return {"IA": 0, "IB": 0, "II": 0}
    if type_ == "II":
        return dict(counts)
    if type_ == "IB":
        return {"IA": counts.get("IA", 0), "IB": counts.get("IB", 0), "II": 0}
    return {"IA": counts.get("IA", 0), "IB": 0, "II": 0}


def _part(rule, type_, n, strengths):
    """One type's contribution under the row's rule."""
    if n <= 0:
        return 0.0
    a = rule["amounts"]
    g = a.get("perStrength") or 0.0
    rate = a.get(_RATE[type_]) or 0.0
    lead = a.get("lead") or 0.0
    is_lead = type_ == rule["type"]
    step = (strengths - 1) * g

    if rule["rule"] == "scaling":
        first = (lead if is_lead else rate) + step
        return first + (rate + step) * (n - 1)
    if rule["rule"] == "flat_from_second":
        flat = a.get("flat")
        return (flat if (n > 1 and flat is not None) else lead)
    if rule["rule"] == "per_count_tiered":
        return n * lead if n < 3 else 2 * lead + (n - 2) * rate
    if rule["rule"] == "per_strength_tiered":
        # First approximation: the Excel shape (IE) takes the third-and-further
        # strength rate from a NEIGHBOURING row, which the rule model does not
        # carry yet. Left deliberately simple -- the comparison in Task 8 is what
        # decides whether an explicit field for it is needed.
        per = lead if strengths == 1 else lead * 2 + (strengths - 2) * lead
        return per * n
    return 0.0


def _apply_cap(rule, parts, strengths):
    cap = rule.get("cap")
    scope_sum = {"P": parts["IA"],
                 "P+Q": parts["IA"] + parts["IB"],
                 "P+Q+R": parts["IA"] + parts["IB"] + parts["II"]}
    total = scope_sum["P+Q+R"]
    if not cap or "unparsed" in cap:
        return total, None
    v, subject = cap["value"], scope_sum.get(cap["scope"], total)
    if "const" in v:
        limit = v["const"]
    elif "byStrength" in v:
        limit = v["byStrength"]["1"] if strengths == 1 else v["byStrength"]["else"]
    elif "multipleOfLead" in v:
        limit = v["multipleOfLead"] * (rule["amounts"].get("lead") or 0.0)
    elif "points" in v:
        limit = v["points"] * v["pointValue"]
    else:
        return total, None
    return (limit, limit) if subject > limit else (total, None)


def evaluate(rules, cc, role, strengths, special, counts):
    items = []
    for t in TYPES:
        if counts.get(t, 0) <= 0:
            continue
        rule = _pick(rules, cc, role, t, (special or {}).get(t))
        if not rule:
            continue
        act = _active_counts(rule, t, counts)
        parts = {x: _part(rule, x, act.get(x, 0), strengths) for x in TYPES}
        raw = parts["IA"] + parts["IB"] + parts["II"]
        total, cap_value = _apply_cap(rule, parts, strengths)
        if rule.get("surcharge"):
            total += rule["surcharge"]
        subsumed = sum(act.values()) == 0
        items.append({
            "row": rule["row"], "type": t,
            "total": None if subsumed else round(total, 2),
            "rawSumSingle": round(raw, 2),
            "subsumed": subsumed,
            "count": counts.get(t, 0),
            "capValue": None if cap_value is None else round(cap_value, 2),
            "groupingFee": rule["amounts"].get("flat")
                           if rule["rule"] == "flat_from_second" and sum(act.values()) > 1 else None,
        })
    return items
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_evaluate_rules.py -v`
Expected: PASS

Schlägt der erste Test fehl, ist **das ein echtes Ergebnis** — das Regelmodell bildet Italien nicht ab. Dann nicht den erwarteten Wert anpassen (er ist von Hand aus der Excel abgeleitet), sondern die Abweichung analysieren und in `out/findings.md` festhalten.

- [ ] **Step 5: Committen**

```bash
git add tools/fee-migration/evaluate_rules.py tests/test_evaluate_rules.py
git commit -m "feat(fee-migration): reference evaluator over the derived rules"
```

---

### Task 8: Abgleich und Bericht

**Files:**
- Create: `tools/fee-migration/compare.py`
- Create: `tools/fee-migration/out/findings.md`
- Test: `tests/test_compare.py`

**Interfaces:**
- Consumes: `out/golden.csv.gz` (Task 3), `evaluate` (Task 7)
- Produces: `out/report.md`

**Bewusste Einschränkung des Vergleichs:** Der Golden Master erfasst neun Felder,
verglichen werden in A nur vier — `total`, `subsumed`, `capValue`, `groupingFee`.
`singleTotal`, `rawSumSingle`, `groupingBase` und `groupingPerAdditional`
entstehen im heutigen Code aus den beiden Zusatzläufen (Einzeltyp, Stärke 1) und
dienen nur der Anzeige. Sie **stehen im Golden Master**, damit Baustein C sie
prüfen kann, wenn die Oberfläche umgebaut wird — für die Frage „trägt das
Regelmodell" sind sie nicht nötig. Diese Einschränkung ist in `out/report.md`
zu vermerken.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/test_compare.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from compare import diff_row


def test_identical_rows_produce_no_diff():
    golden = {"row": "257", "type": "II", "total": "35304.00", "subsumed": "0", "capValue": ""}
    mine = {"row": 257, "type": "II", "total": 35304.00, "subsumed": False, "capValue": None}
    assert diff_row(golden, mine) == []


def test_a_cent_of_difference_is_reported():
    golden = {"row": "257", "type": "II", "total": "35304.00", "subsumed": "0", "capValue": ""}
    mine = {"row": 257, "type": "II", "total": 35304.01, "subsumed": False, "capValue": None}
    d = diff_row(golden, mine)
    assert len(d) == 1 and d[0]["field"] == "total"


def test_a_flag_difference_is_reported():
    golden = {"row": "9", "type": "IA", "total": "100.00", "subsumed": "0", "capValue": "80.00"}
    mine = {"row": 9, "type": "IA", "total": 100.00, "subsumed": False, "capValue": None}
    d = diff_row(golden, mine)
    assert [x["field"] for x in d] == ["capValue"]
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `python -m pytest tests/test_compare.py -v`
Expected: FAIL — Modul nicht gefunden

- [ ] **Step 3: Abgleich implementieren**

`tools/fee-migration/compare.py`:

```python
"""Compares the reference evaluator against the golden master."""

import csv
import gzip
import json
from collections import Counter
from pathlib import Path

from evaluate_rules import load_rules, evaluate

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
FIELDS = ("total", "subsumed", "capValue", "groupingFee")


def _g_num(v):
    return None if v == "" else round(float(v), 2)


def diff_row(golden, mine):
    out = []
    for f in FIELDS:
        if f not in golden:
            continue
        g = golden[f]
        m = mine.get(f)
        if f == "subsumed":
            same = (g == "1") == bool(m)
        else:
            gv, mv = _g_num(g), (None if m is None else round(float(m), 2))
            same = gv == mv
        if not same:
            out.append({"field": f, "golden": g, "mine": m})
    return out


def main():
    rules = load_rules()
    stats = Counter()
    diffs = []
    with gzip.open(OUT / "golden.csv.gz", "rt", encoding="utf-8", newline="") as fh:
        by_run = {}
        for rec in csv.DictReader(fh):
            by_run.setdefault(rec["runId"], []).append(rec)

    for run_id, recs in by_run.items():
        head = recs[0]
        items = evaluate(
            rules, head["cc"], head["role"], int(head["strengths"]),
            {"IA": head["specialIA"] or None, "IB": head["specialIB"] or None,
             "II": head["specialII"] or None},
            {"IA": int(head["ia"]), "IB": int(head["ib"]), "II": int(head["ii"])})
        mine_by_row = {str(i["row"]): i for i in items}
        for rec in recs:
            stats["compared"] += 1
            mine = mine_by_row.get(rec["row"])
            if mine is None:
                stats["missing"] += 1
                diffs.append({"run": run_id, "row": rec["row"], "field": "-",
                              "golden": "present", "mine": "absent"})
                continue
            d = diff_row(rec, mine)
            if d:
                stats["differing"] += 1
                for x in d:
                    diffs.append({"run": run_id, "row": rec["row"], **x})
            else:
                stats["matching"] += 1

    by_row = Counter(d["row"] for d in diffs)
    lines = [
        "# Abgleich: Regelmodell gegen Golden Master", "",
        f"- verglichene Ergebniszeilen: **{stats['compared']}**",
        f"- übereinstimmend: **{stats['matching']}**",
        f"- abweichend: **{stats['differing']}**",
        f"- fehlend: **{stats['missing']}**", "",
        "## Abweichungen je Excel-Zeile", "",
        "| Zeile | Anzahl |", "|---|---|",
    ]
    for row, n in by_row.most_common(50):
        lines.append(f"| {row} | {n} |")
    lines += ["", "## Erste 100 Abweichungen im Einzelnen", "",
              "| Lauf | Zeile | Feld | Golden Master | Regelmodell |", "|---|---|---|---|---|"]
    for d in diffs[:100]:
        lines.append(f"| {d['run']} | {d['row']} | {d['field']} | {d['golden']} | {d['mine']} |")

    (OUT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{stats['matching']}/{stats['compared']} übereinstimmend -> out/report.md")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `python -m pytest tests/test_compare.py -v`
Expected: PASS, alle drei Tests

- [ ] **Step 5: Den vollen Abgleich fahren**

Run: `python tools/fee-migration/compare.py`
Expected: eine Zahl wie `NNN/NNN übereinstimmend -> out/report.md`

**Diese Zahl ist das Ergebnis von Baustein A.** Sie ist nicht zu schönen: eine Abweichung wird nicht dadurch behoben, dass man den Vergleich lockert oder das Regelmodell an einen Einzelfall anpasst, ohne die Ursache zu verstehen.

- [ ] **Step 6: Befunde zusammenschreiben**

`tools/fee-migration/out/findings.md` anlegen mit:
1. den Vorab-Befunden aus der Spec (B3 tote Codezweige und Vorauswahl, B4 Fehlbezug `O341`),
2. allen Zeilen mit `rule: unknown` samt ihrer `evidence`,
3. allen Zeilen mit `cap.unparsed`,
4. allen `select.anomaly`-Treffern,
5. den Abweichungsschwerpunkten aus `report.md`.

Je Eintrag: Zeile, Land, was auffällt, und ob es das heutige Ergebnis beeinflusst.

- [ ] **Step 7: Committen**

```bash
git add tools/fee-migration/compare.py tools/fee-migration/out/report.md \
        tools/fee-migration/out/findings.md tests/test_compare.py
git commit -m "feat(fee-migration): compare rule model against the golden master"
```

---

## Abnahme von Baustein A

1. `python -m pytest tests/ -v` läuft grün (die vorhandenen `tests/*.test.mjs` bleiben unberührt und laufen weiter über `node --test tests/`).
2. `out/golden.csv.gz` liegt vor und ist reproduzierbar (Task 3, Step 6).
3. `out/fee-rules.json` deckt alle 421 Zeilen ab.
4. `out/report.md` weist eine konkrete Übereinstimmungszahl aus.
5. `out/findings.md` benennt jede nicht abbildbare Zeile mit Begründung.
6. `git status` zeigt keine Änderung an Plugin-Dateien (die 16 CRLF-Meldungen ausgenommen).

**Erfolg ist nicht „100 %".** Erfolg ist eine belastbare Zahl plus eine begründete Liste der Ausnahmen. Über den Umgang mit den Ausnahmen entscheidet der Auftraggeber, nicht der Plan.
