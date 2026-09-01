"""Regression check: runs the CURRENT plugin files against the golden master.

Unlike verify_normalization.py (a one-shot proof for the T/U/V change) this
reads variation-fee-calculator/assets/js/ as it stands right now, so it can be
re-run after any future change to the fee data or the engine.

Usage:
    python tools/fee-migration/verify_current.py
"""

import csv
import gzip
import hashlib
import sys
from pathlib import Path

from feedata import load_fee_rows
from golden import HEADER, format_run, BATCH, _EVAL
from harness import open_calculator
from matrix import build_matrix

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
BASELINE = OUT / "golden.csv.gz"
CURRENT = OUT / "golden-current.csv.gz"


def record(path):
    entries = build_matrix(load_fee_rows())
    with open_calculator() as (page, errors):
        with gzip.open(path, "wt", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(HEADER.split(","))
            for i in range(0, len(entries), BATCH):
                batch = entries[i:i + BATCH]
                results = page.evaluate(_EVAL, batch)
                if len(results) != len(batch):
                    raise RuntimeError(f"batch {i}: {len(results)}/{len(batch)}")
                for j, (entry, res) in enumerate(zip(batch, results)):
                    for fields in format_run(i + j, entry, res):
                        w.writerow(fields)
                print(f"  {i + len(batch)}/{len(entries)}", end="\r", flush=True)
    if errors:
        print("\nSeitenfehler:", sorted(set(errors))[:5], file=sys.stderr)
        sys.exit(1)


def digest(path):
    h = hashlib.sha256()
    with gzip.open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def first_differences(limit=10):
    """Line-by-line diff so a failure names the rows that moved."""
    out = []
    with gzip.open(BASELINE, "rt", encoding="utf-8") as a, \
         gzip.open(CURRENT, "rt", encoding="utf-8") as b:
        for n, (la, lb) in enumerate(zip(a, b), start=1):
            if la != lb:
                out.append(f"  Zeile {n}\n    alt: {la.strip()}\n    neu: {lb.strip()}")
                if len(out) >= limit:
                    break
    return out


def main():
    if not BASELINE.exists():
        print(f"Kein Golden Master unter {BASELINE} -- erst golden.py laufen lassen.",
              file=sys.stderr)
        return 1
    record(CURRENT)
    a, b = digest(BASELINE), digest(CURRENT)
    print(f"\ngolden master {a}")
    print(f"aktueller Stand {b}")
    if a == b:
        print("\nIDENTISCH -- die aktuellen Plugin-Dateien rechnen unveraendert.")
        return 0
    print("\nABWEICHUNG -- der Rechenweg hat sich geaendert:", file=sys.stderr)
    for line in first_differences():
        print(line, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
