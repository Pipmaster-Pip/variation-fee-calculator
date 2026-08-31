"""Compares the reference evaluator against the golden master.

Scope note (Baustein A): the golden master records nine fields per result
item, but only four of them decide whether the rule model reproduces the
current engine's *fee* output -- `total`, `subsumed`, `capValue` and
`groupingFee`. `singleTotal`, `rawSumSingle`, `groupingBase` and
`groupingPerAdditional` are display-only figures derived from two extra
calculator runs (single type, strength 1); they are recorded so a later
Baustein can check them once the UI is rebuilt, but are out of scope here.
"""

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
    uncomputable = []
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
            # Rows whose Excel formula the extractor could not classify
            # ("rule": "unknown", 17 DK rows -- see out/findings.md) evaluate
            # to no number at all. That is a distinct, reported outcome of
            # the study, not an ordinary numeric mismatch -- counting it as
            # "differing" would understate how much of the model works;
            # counting it as "matching" would overstate it. Either way the
            # headline number would misrepresent the study, so it gets its
            # own bucket and is never passed to diff_row.
            if mine.get("uncomputable"):
                stats["uncomputable"] += 1
                uncomputable.append({"run": run_id, "row": rec["row"], "cc": head["cc"],
                                      "role": head["role"], "type": rec["type"]})
                continue
            d = diff_row(rec, mine)
            if d:
                stats["differing"] += 1
                for x in d:
                    diffs.append({"run": run_id, "row": rec["row"], **x})
            else:
                stats["matching"] += 1

    by_row = Counter(d["row"] for d in diffs)
    uncomputable_by_row = Counter(u["row"] for u in uncomputable)
    lines = [
        "# Abgleich: Regelmodell gegen Golden Master", "",
        "**Vergleichsumfang:** Der Golden Master erfasst neun Felder je Ergebniszeile. "
        "Dieser Abgleich prueft nur die vier, die die Frage \"traegt das Regelmodell\" "
        "beantworten: `total`, `subsumed`, `capValue`, `groupingFee`. `singleTotal`, "
        "`rawSumSingle`, `groupingBase` und `groupingPerAdditional` entstehen aus den "
        "beiden Zusatzlaeufen (Einzeltyp, Staerke 1) und dienen nur der Anzeige -- sie "
        "sind im Golden Master vorhanden, damit ein spaeterer Baustein sie pruefen kann, "
        "wenn die Oberflaeche umgebaut wird, aber hier **nicht** Teil der Kennzahl unten.",
        "",
        "**Fremdwaehrungs-Hinweis:** `evaluate()` nutzt bewusst die lokalen `*_lc`-Betraege "
        "unkonvertiert (Spec B2 -- die Umrechnung ist Aufgabe einer spaeteren PHP-Laufzeit, "
        "nicht dieses Referenz-Evaluators). Der Golden Master haelt dagegen den vom echten "
        "Rechner in EUR umgerechneten Betrag fest. Fuer jede Zeile mit `currency != EUR` "
        "weichen `total`/`capValue` daher systematisch um den Wechselkurs-Faktor ab -- das "
        "ist eine bewusste Bereichsgrenze des Referenz-Evaluators, kein Zaehlfehler dieses "
        "Abgleichs. Siehe `out/findings.md` fuer Details.",
        "",
        f"- verglichene Ergebniszeilen: **{stats['compared']}**",
        f"- übereinstimmend: **{stats['matching']}**",
        f"- abweichend: **{stats['differing']}**",
        f"- nicht berechenbar (rule: unknown, 17 DK-Zeilen): **{stats['uncomputable']}**",
        f"- fehlend: **{stats['missing']}**", "",
        "Die \"nicht berechenbar\"-Zeilen sind weder als Treffer noch als Abweichung "
        "gezaehlt: das Regelmodell liefert dort bewusst keine Zahl (siehe "
        "`out/findings.md`), statt eine zu erraten.",
        "",
        "## Abweichungen je Excel-Zeile", "",
        "| Zeile | Anzahl |", "|---|---|",
    ]
    for row, n in by_row.most_common(50):
        lines.append(f"| {row} | {n} |")
    lines += ["", "## Nicht berechenbare Zeilen (rule: unknown) je Excel-Zeile", "",
              "| Zeile | Land | Anzahl Läufe |", "|---|---|---|"]
    row_cc = {u["row"]: u["cc"] for u in uncomputable}
    for row, n in uncomputable_by_row.most_common():
        lines.append(f"| {row} | {row_cc.get(row, '')} | {n} |")
    lines += ["", "## Erste 100 Abweichungen im Einzelnen", "",
              "| Lauf | Zeile | Feld | Golden Master | Regelmodell |", "|---|---|---|---|---|"]
    for d in diffs[:100]:
        lines.append(f"| {d['run']} | {d['row']} | {d['field']} | {d['golden']} | {d['mine']} |")

    (OUT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{stats['matching']}/{stats['compared']} übereinstimmend, "
          f"{stats['differing']} abweichend, {stats['uncomputable']} nicht berechenbar, "
          f"{stats['missing']} fehlend -> out/report.md")


if __name__ == "__main__":
    main()
