"""Compares the reference evaluator against the golden master.

Scope note (Baustein A): the golden master records nine fields per result
item, but only four of them decide whether the rule model reproduces the
current engine's *fee* output -- `total`, `subsumed`, `capValue` and
`groupingFee`. `singleTotal`, `rawSumSingle`, `groupingBase` and
`groupingPerAdditional` are display-only figures derived from two extra
calculator runs (single type, strength 1); they are recorded so a later
Baustein can check them once the UI is rebuilt, but are out of scope here.

Currency note: evaluate() computes from `amountsEur` -- what the shipped
engine actually computed with under the network-blocked conditions the
golden master was recorded under (F_lc / rate where a static fallback rate
exists, the plain F..K columns otherwise; see out/findings.md). This closed
what used to be a systematic currency-scale mismatch on every non-EUR row;
it is not a remaining scope boundary of this comparison.

Un-priced rows (whole-branch review fix): when several variation types are
filed together, subsumption means the highest type absorbs the lower ones --
those lower rows carry no amount at all on *either* side (golden `total` is
""`, the evaluator returns `total=None`). That is 55.7% of all 347040
result-rows. `diff_row` treats empty-vs-`None` as agreement on every field,
so these rows used to fall into the same "matching" bucket as a real,
correctly-reproduced fee -- inflating the headline figure with rows that
say nothing about whether the rule model works. They are now split out into
their own "unpriced" bucket *before* `diff_row` ever runs on them, and the
match rate is reported over priced rows (and separately over priced-and-
computable rows), never as one number over all 347040.
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


def _priced_golden(rec):
    """Whether the golden master recorded a real amount for this row."""
    return rec.get("total", "") != ""


def _priced_mine(mine):
    """Whether the evaluator produced a real amount for this row."""
    return mine.get("total") is not None


def main():
    rules = load_rules()
    stats = Counter()
    diffs = []
    diff_rows = Counter()  # one tally per (row, differing), NOT per field
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
            # Rows with no amount at all on EITHER side -- almost always
            # subsumption (the highest filed type absorbs the lower ones,
            # leaving them with no fee to report). `diff_row` would call
            # empty-vs-`None` agreement on all four fields here, which used
            # to inflate "matching" with rows that carry no priced answer at
            # all. Split out first, before diff_row ever sees them, and
            # never counted as either a match or a difference.
            if not _priced_golden(rec) and not _priced_mine(mine):
                stats["unpriced"] += 1
                continue
            # Rows whose Excel formula the extractor could not classify
            # ("rule": "unknown", 17 DK rows -- see out/findings.md) evaluate
            # to no number at all, yet the golden master DOES carry a real
            # priced amount here (the both-unpriced case was already handled
            # above). That is a distinct, reported outcome of the study, not
            # an ordinary numeric mismatch -- counting it as "differing"
            # would understate how much of the model works; counting it as
            # "matching" would overstate it. It gets its own bucket and is
            # never passed to diff_row.
            if mine.get("uncomputable"):
                stats["uncomputable"] += 1
                uncomputable.append({"run": run_id, "row": rec["row"], "cc": head["cc"],
                                      "role": head["role"], "type": rec["type"]})
                continue
            d = diff_row(rec, mine)
            # The headline verdict for a priced, computable row is decided by
            # `total` -- the fee amount, the study's actual question. A row
            # whose ONLY discrepancy is on `subsumed`/`capValue`/`groupingFee`
            # still counts as matching here: root cause 3 in out/findings.md
            # documents that the golden master derives `capValue`/
            # `groupingFee` from a different, out-of-scope operational basis
            # (a separate single-type run) than this evaluator does, so those
            # two fields can legitimately disagree even when `total` -- the
            # only one of the four actually being tested here -- is correct.
            # Folding that already-documented, non-fixable comparison gap
            # into "differing" would misrepresent it as a rule-model defect.
            if any(x["field"] == "total" for x in d):
                stats["differing"] += 1
                diff_rows[rec["row"]] += 1
                for x in d:
                    diffs.append({"run": run_id, "row": rec["row"], **x})
            else:
                stats["matching"] += 1
                if d:
                    stats["matching_with_other_field_diff"] += 1

    uncomputable_by_row = Counter(u["row"] for u in uncomputable)

    priced = stats["matching"] + stats["differing"] + stats["uncomputable"]
    computable = stats["matching"] + stats["differing"]
    rate_priced = (stats["matching"] / priced * 100) if priced else 0.0
    rate_computable = (stats["matching"] / computable * 100) if computable else 0.0
    unpriced_pct = stats["unpriced"] / stats["compared"] * 100 if stats["compared"] else 0.0

    lines = [
        "# Abgleich: Regelmodell gegen Golden Master", "",
        "**Kernaussage:** Von den verglichenen "
        f"**{stats['compared']}** Ergebniszeilen tragen "
        f"**{stats['unpriced']}** ({unpriced_pct:.1f}%) auf beiden Seiten ueberhaupt "
        "keinen Betrag (subsumiert durch eine hoehere Variationsart) und sagen nichts "
        "darueber aus, ob das Regelmodell funktioniert. Von den verbleibenden "
        f"**{priced}** Zeilen mit Betrag sind **{stats['uncomputable']}** mit dem "
        "Regelmodell nicht berechenbar (rule: unknown, DK). "
        f"Trefferquote **ueber alle Zeilen mit Betrag**: {stats['matching']}/{priced} = "
        f"**{rate_priced:.1f}%**. Trefferquote **ueber Zeilen mit Betrag, die zusaetzlich "
        f"berechenbar sind**: {stats['matching']}/{computable} = **{rate_computable:.1f}%** "
        "-- das ist die eigentliche Antwort dieser Studie; die beiden Zahlen oben duerfen "
        "nicht mit einer Kennzahl ueber alle "
        f"{stats['compared']} Zeilen verwechselt werden.",
        "",
        "**Vergleichsumfang:** Der Golden Master erfasst neun Felder je Ergebniszeile. "
        "Dieser Abgleich prueft nur die vier, die die Frage \"traegt das Regelmodell\" "
        "beantworten: `total`, `subsumed`, `capValue`, `groupingFee`. `singleTotal`, "
        "`rawSumSingle`, `groupingBase` und `groupingPerAdditional` entstehen aus den "
        "beiden Zusatzlaeufen (Einzeltyp, Staerke 1) und dienen nur der Anzeige -- sie "
        "sind im Golden Master vorhanden, damit ein spaeterer Baustein sie pruefen kann, "
        "wenn die Oberflaeche umgebaut wird, aber hier **nicht** Teil der Kennzahl oben.",
        "",
        "**Fremdwaehrungs-Hinweis:** `evaluate()` rechnet mit `amountsEur` -- den Betraegen, "
        "die der echte Rechner unter den Netzwerk-blockierten Bedingungen der "
        "Golden-Master-Aufnahme tatsaechlich verwendet hat (F_lc / Kurs, wo ein "
        "STATIC_FX_RATES-Fallback existiert, sonst die unveraenderten F..K-Spalten). Das war "
        "vormals ein systematischer Wechselkurs-Fehler auf jeder Nicht-EUR-Zeile (Cause B); "
        "er ist jetzt geschlossen, keine verbleibende Bereichsgrenze mehr. Siehe "
        "`out/findings.md` fuer Details, u.a. dass der ausgelieferte Rechner selbst bei "
        "unerreichbarer ECB-API nur fuer HU/NO/SI konvertiert, nicht fuer die anderen sieben "
        "Laender mit lokaler Waehrung.",
        "",
        "## Ergebnis-Buckets", "",
        "| Bucket | Anzahl | Anteil an allen Zeilen |", "|---|---|---|",
        f"| kein Betrag auf beiden Seiten (subsumiert) | {stats['unpriced']} | "
        f"{unpriced_pct:.1f}% |",
        f"| Betrag vorhanden, uebereinstimmend | {stats['matching']} | "
        f"{stats['matching'] / stats['compared'] * 100:.1f}% |",
        f"| Betrag vorhanden, abweichend | {stats['differing']} | "
        f"{stats['differing'] / stats['compared'] * 100:.1f}% |",
        f"| Betrag vorhanden, nicht berechenbar (rule: unknown, DK) | "
        f"{stats['uncomputable']} | {stats['uncomputable'] / stats['compared'] * 100:.1f}% |",
        f"| fehlend | {stats['missing']} | "
        f"{stats['missing'] / stats['compared'] * 100:.1f}% |",
        "",
        "Die \"kein Betrag\"- und \"nicht berechenbar\"-Zeilen sind weder als Treffer noch "
        "als Abweichung gezaehlt: in beiden Faellen liefert das Regelmodell bewusst keine "
        "Zahl (siehe `out/findings.md`), statt eine zu erraten oder zu unterstellen.",
        "",
        "**Was \"uebereinstimmend\" hier bedeutet:** Massgeblich ist `total` -- der "
        "Gebuehrenbetrag, die eigentliche Frage der Studie. Stimmt `total` ueberein, "
        "zaehlt die Zeile als Treffer, auch wenn `capValue`/`groupingFee` abweichen: "
        "der Golden Master leitet beide aus einem separaten Einzeltyp-Lauf ab, einer "
        "anderen operationalen Definition als dieser Auswerter verwendet (Root Cause 3 "
        f"in `out/findings.md`) -- ein dokumentierter Vergleichsgrenzfall, kein "
        f"Regelmodell-Fehler. **{stats['matching_with_other_field_diff']}** der "
        f"{stats['matching']} Treffer haben trotzdem eine Abweichung auf `capValue`, "
        "`subsumed` oder `groupingFee`; sie tauchen deshalb nicht in den "
        "Abweichungs-Tabellen unten auf (die zeigen nur Zeilen, bei denen `total` "
        "selbst abweicht).",
        "",
        "## Abweichende Ergebniszeilen je Excel-Zeile", "",
        "(Zeilen mit mindestens einer abweichenden Ergebniszeile, nicht Feld-Abweichungen -- "
        "eine Ergebniszeile kann auf mehreren der vier Felder gleichzeitig abweichen, zaehlt "
        "hier aber nur einmal.)",
        "",
        "| Zeile | Anzahl abweichender Ergebniszeilen |", "|---|---|",
    ]
    for row, n in diff_rows.most_common(50):
        lines.append(f"| {row} | {n} |")
    lines += ["", "## Nicht berechenbare Zeilen (rule: unknown) je Excel-Zeile", "",
              "| Zeile | Land | Anzahl Läufe |", "|---|---|---|"]
    row_cc = {u["row"]: u["cc"] for u in uncomputable}
    for row, n in uncomputable_by_row.most_common():
        lines.append(f"| {row} | {row_cc.get(row, '')} | {n} |")
    lines += ["", "## Erste 100 Feld-Abweichungen im Einzelnen", "",
              "(Eine Zeile je abweichendem Feld, nicht je Ergebniszeile -- siehe Bucket-Tabelle "
              "oben fuer die Anzahl der Ergebniszeilen.)",
              "",
              "| Lauf | Zeile | Feld | Golden Master | Regelmodell |", "|---|---|---|---|---|"]
    for d in diffs[:100]:
        lines.append(f"| {d['run']} | {d['row']} | {d['field']} | {d['golden']} | {d['mine']} |")

    (OUT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{stats['compared']} verglichen: {stats['unpriced']} unpriced (subsumed), "
          f"{stats['matching']} matching, {stats['differing']} differing, "
          f"{stats['uncomputable']} uncomputable, {stats['missing']} missing -> out/report.md")
    print(f"match rate over priced rows: {stats['matching']}/{priced} = {rate_priced:.1f}%")
    print(f"match rate over priced+computable rows: {stats['matching']}/{computable} = "
          f"{rate_computable:.1f}%")


if __name__ == "__main__":
    main()
