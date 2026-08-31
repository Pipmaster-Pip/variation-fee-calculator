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
