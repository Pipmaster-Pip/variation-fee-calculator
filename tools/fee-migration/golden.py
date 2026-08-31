"""Runs the real fee engine over the whole input matrix and records the result.

The output is the acceptance test for Bausteine B and C: whatever replaces the
engine has to reproduce this file.
"""

import csv
import gzip
import math
import os
import sys
import tempfile
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
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    return f"{v:.2f}" if ok else ""


def _str(v):
    return "" if v is None else str(v)


def format_run(run_id, entry, res):
    """One field-list per result item. Callers write each list through a csv
    writer so quoting -- not string-mangling -- handles embedded commas."""
    rows = []
    for cr in res["countries"]:
        for it in cr["items"]:
            rows.append([
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
            ])
    return rows


# One page context for the whole run; batching keeps the number of evaluate()
# round trips low without building one enormous argument array.
_EVAL = """(entries) => entries.map((e) => window.VCLCALC.computeFees({
    countries: [{ cc: e.cc, role: e.role, strengths: e.strengths, special: e.special }],
    counts: e.counts
}))"""


def main():
    entries = build_matrix(load_fee_rows())
    OUT.mkdir(exist_ok=True)
    final_path = OUT / "golden.csv.gz"

    # Write to a temp file first; only move it into place once we know the
    # whole run succeeded. Otherwise a page error midway would still leave a
    # complete-looking (but truncated/corrupt) file at the final path.
    fd, tmp_name = tempfile.mkstemp(dir=OUT, suffix=".tmp")
    os.close(fd)
    tmp_path = Path(tmp_name)

    run_ids_seen = set()
    try:
        with open_calculator() as (page, errors):
            with gzip.open(tmp_path, "wt", encoding="utf-8", newline="") as fh:
                writer = csv.writer(fh)
                writer.writerow(HEADER.split(","))
                for i in range(0, len(entries), BATCH):
                    batch = entries[i:i + BATCH]
                    results = page.evaluate(_EVAL, batch)
                    if len(results) != len(batch):
                        raise RuntimeError(
                            f"batch/result size mismatch at offset {i}: "
                            f"sent {len(batch)}, got back {len(results)}")
                    for j, (entry, res) in enumerate(zip(batch, results)):
                        run_id = i + j
                        run_ids_seen.add(run_id)
                        for row in format_run(run_id, entry, res):
                            writer.writerow(row)
                    print(f"  {i + len(batch)}/{len(entries)}", end="\r", flush=True)
            if errors:
                print("\nSeitenfehler beim Laden:", sorted(set(errors))[:5],
                      file=sys.stderr)
                sys.exit(1)

        if len(run_ids_seen) != len(entries):
            raise RuntimeError(
                f"distinct run ids written ({len(run_ids_seen)}) != "
                f"matrix entries ({len(entries)}) -- a batch was silently lost")

        os.replace(tmp_path, final_path)
    finally:
        # If we exited via sys.exit(1) or an exception, drop the partial file
        # rather than leaving stray temp litter or a half-written artifact.
        if tmp_path.exists():
            tmp_path.unlink()

    print(f"\nGolden Master geschrieben: {len(entries)} Läufe")


if __name__ == "__main__":
    main()
