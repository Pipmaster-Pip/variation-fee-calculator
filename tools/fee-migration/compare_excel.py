"""Compares the calculator against the source workbook, cell for cell.

Every other check in this folder compares the calculator against ITSELF -- the
golden master was recorded from the calculator, so it proves a change altered
nothing, not that the calculator agrees with the Excel it was generated from.
This script closes that gap: it drives the real workbook through Excel and the
real calculator through a browser, feeds both the same inputs, and compares the
per-row totals (column S).

How a case is set up, mirroring what the calculator does:
  - column L (number of strengths) is filled ONLY for the rows the calculator
    selected, because a blank L is what marks a row as "not part of this
    submission" -- and some rows read another row's O, which is itself
    L-dependent, so filling all of column L would not be the same question.
  - M2/N2/O2 carry the number of Type IA / IB / II variations.
  - Excel recalculates, S4:S424 is read in one go, and the selected rows'
    values are compared with the `total` of the matching item from
    window.VCLCALC.computeFees.

Usage:
    python tools/fee-migration/compare_excel.py            # default matrix
    python tools/fee-migration/compare_excel.py --quick    # a short smoke run
"""

import argparse
import csv
import decimal
import sys
from pathlib import Path

from feedata import load_fee_rows
from harness import open_calculator

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
WORKBOOK = (HERE / ".." / ".." / "Variation-Fee-Calculator-EU.xlsx").resolve()
SHEET = "Variation fee calculator"

FIRST_ROW, LAST_ROW = 4, 424

# Amounts are euros; a cent is the smallest difference worth reporting. The
# calculator carries full float precision while Excel rounds for display only,
# so an exact equality test would flag noise rather than disagreement.
TOLERANCE = 0.005

COUNT_SETS = [
    (1, 0, 0), (0, 1, 0), (0, 0, 1),
    (2, 0, 0), (0, 2, 0), (0, 0, 2),
    (1, 1, 1), (3, 2, 1),
]
STRENGTH_SETS = [1, 3]

QUICK_COUNTS = [(1, 0, 0), (0, 0, 1), (1, 1, 1)]
QUICK_STRENGTHS = [1]


def build_cases(rows, counts_sets, strength_sets):
    """One case per country + role + special variant + input set.

    Iterating the special variants matters: resolveRow() in the calculator
    prefers the requested special, so asking for each row's own special is what
    reaches the rows that are otherwise never selected.
    """
    combos = {}
    for r in rows:
        combos.setdefault((r["cc"], r["role"]), set()).add(r["special"])

    cases = []
    for (cc, role), specials in sorted(combos.items()):
        for special in sorted(specials, key=lambda s: (s is None, s or "")):
            for strengths in strength_sets:
                for ia, ib, ii in counts_sets:
                    cases.append({
                        "cc": cc, "role": role, "special": special,
                        "strengths": strengths,
                        "counts": {"IA": ia, "IB": ib, "II": ii},
                    })
    return cases


EVAL = """(cases) => cases.map((c) => {
    const special = { IA: c.special, IB: c.special, II: c.special };
    const res = window.VCLCALC.computeFees({
        countries: [{ cc: c.cc, role: c.role, strengths: c.strengths, special }],
        counts: c.counts
    });
    const cr = (res.countries || [])[0];
    if (!cr || !cr.items) return [];
    return cr.items.map((it) => ({
        row: it.row.row,
        type: it.row.type,
        special: it.row.special,
        total: (typeof it.total === 'number') ? it.total : null
    }));
})"""


def engine_results(cases, batch=400):
    """The calculator's answer for every case, as [[{row,total}, ...], ...]."""
    out = []
    with open_calculator() as (page, errors):
        for i in range(0, len(cases), batch):
            out.extend(page.evaluate(EVAL, cases[i:i + batch]))
            print(f"  Rechner {min(i + batch, len(cases))}/{len(cases)}", end="\r", flush=True)
        if errors:
            print("\nSeitenfehler:", sorted(set(errors))[:5], file=sys.stderr)
            sys.exit(1)
    print()
    return out


class Workbook:
    """The workbook open in Excel, with recalculation under our control."""

    def __init__(self, path):
        import win32com.client as com
        self.app = com.DispatchEx("Excel.Application")
        self.app.Visible = False
        self.app.DisplayAlerts = False
        self.app.ScreenUpdating = False
        self.wb = self.app.Workbooks.Open(str(path), ReadOnly=True, UpdateLinks=0)
        # Manual calculation, so one Calculate() per case is the only recalc and
        # a cell write does not trigger a sweep of the whole sheet. Excel refuses
        # this property until a workbook is actually open, hence the order.
        self.app.Calculation = -4135  # xlCalculationManual
        self.ws = self.wb.Worksheets(SHEET)
        self.l_col = self.ws.Range(f"L{FIRST_ROW}:L{LAST_ROW}")
        self.s_col = self.ws.Range(f"S{FIRST_ROW}:S{LAST_ROW}")

    def evaluate(self, selected_rows, counts):
        """S for every row, given strengths on `selected_rows` only."""
        self.l_col.ClearContents()
        for row, strengths in selected_rows.items():
            self.ws.Cells(row, 12).Value = strengths   # column L
        self.ws.Range("M2").Value = counts["IA"]
        self.ws.Range("N2").Value = counts["IB"]
        self.ws.Range("O2").Value = counts["II"]
        self.app.Calculate()
        values = self.s_col.Value
        return {FIRST_ROW + i: v[0] for i, v in enumerate(values)}

    def close(self):
        # Closed without saving: the workbook is the reference, and nothing here
        # may alter it. (Never write this file from a script -- it carries
        # drawings that only Excel itself preserves.)
        self.wb.Close(SaveChanges=False)
        self.app.Quit()


def as_number(v):
    """Excel hands currency-formatted cells back as decimal.Decimal, not float --
    a plain isinstance(v, float) test silently discards every amount."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float, decimal.Decimal)):
        return float(v)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="a short smoke run")
    args = ap.parse_args()

    if not WORKBOOK.exists():
        print(f"Arbeitsmappe nicht gefunden: {WORKBOOK}", file=sys.stderr)
        return 2

    rows = load_fee_rows()
    counts_sets = QUICK_COUNTS if args.quick else COUNT_SETS
    strength_sets = QUICK_STRENGTHS if args.quick else STRENGTH_SETS
    cases = build_cases(rows, counts_sets, strength_sets)
    print(f"{len(cases)} Faelle ueber {len(rows)} Gebuehrenzeilen")

    engine = engine_results(cases)

    OUT.mkdir(exist_ok=True)
    report = OUT / "excel-comparison.csv"
    compared = agreed = 0
    mismatches = []
    rows_seen = set()

    book = Workbook(WORKBOOK)
    try:
        with open(report, "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["case", "cc", "role", "special", "strengths",
                        "ia", "ib", "ii", "row", "type", "engine", "excel", "diff"])
            for i, (case, items) in enumerate(zip(cases, engine)):
                if not items:
                    continue
                selected = {it["row"]: case["strengths"] for it in items}
                excel = book.evaluate(selected, case["counts"])
                for it in items:
                    e_val = it["total"]
                    x_val = as_number(excel.get(it["row"]))
                    if e_val is None and x_val is None:
                        continue
                    compared += 1
                    rows_seen.add(it["row"])
                    if e_val is not None and x_val is not None and abs(e_val - x_val) <= TOLERANCE:
                        agreed += 1
                        continue
                    diff = (e_val - x_val) if (e_val is not None and x_val is not None) else ""
                    rec = [i, case["cc"], case["role"], case["special"] or "",
                           case["strengths"], case["counts"]["IA"], case["counts"]["IB"],
                           case["counts"]["II"], it["row"], it["type"],
                           "" if e_val is None else f"{e_val:.4f}",
                           "" if x_val is None else f"{x_val:.4f}", diff]
                    w.writerow(rec)
                    mismatches.append(rec)
                if i % 25 == 0:
                    print(f"  Excel {i}/{len(cases)}", end="\r", flush=True)
    finally:
        book.close()

    print()
    print(f"verglichene Betraege : {compared}")
    print(f"beruehrte Zeilen     : {len(rows_seen)} von {len(rows)}")
    print(f"identisch            : {agreed}")
    print(f"abweichend           : {len(mismatches)}")
    if mismatches:
        print(f"\nAbweichungen in {report}. Die ersten fuenf:")
        for rec in mismatches[:5]:
            print(f"  Zeile {rec[8]} {rec[1]} {rec[2]} {rec[3]} "
                  f"L={rec[4]} IA/IB/II={rec[5]}/{rec[6]}/{rec[7]}  "
                  f"Rechner {rec[10]}  Excel {rec[11]}")
        return 1

    print("\nIDENTISCH -- der Rechner liefert dieselben Betraege wie die Arbeitsmappe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
