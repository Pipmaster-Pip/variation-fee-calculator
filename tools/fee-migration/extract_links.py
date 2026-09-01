"""Reads the fee couplings out of the workbook's "National currencies" sheet.

That sheet is where the fees are actually typed. To avoid entering the same
number several times, its columns F..K carry formulas that derive a value from
another cell -- "each additional variation costs the same as the first", "half
of the first", "three quarters" (Slovenia), "a quarter more", "460 on top".
This script reads those formulas back out so the fee editor can offer the same
coupling instead of asking for the number again.

Rather than matching the handful of shapes that happen to occur, it treats each
formula as what they all are: a straight line through one source cell,

    value = source * factor + offset

and recovers factor and offset by evaluating the formula twice, with the source
standing at 0 and at 1. That covers every shape in the sheet today and any
further arithmetic of the same kind. A formula naming more than one source cell,
or containing anything but arithmetic, is reported and left uncoupled.

Everything read is then checked against the amounts already in the plugin: a
coupling that does not reproduce the value it is supposed to produce means the
formula was misread, and the run fails rather than shipping it.

Usage:
    python tools/fee-migration/extract_links.py            # report only
    python tools/fee-migration/extract_links.py --write    # merge into the data file
"""

import argparse
import json
import re
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
ROOT = (HERE / ".." / "..").resolve()
WORKBOOK = ROOT / "Variation-Fee-Calculator-EU.xlsx"
DATA = ROOT / "variation-fee-calculator" / "assets" / "js" / "vcl-calc-data.js"
SHEET = "National currencies"

FIRST_ROW, LAST_ROW = 4, 424
COLUMNS = {"F": 6, "G": 7, "H": 8, "I": 9, "J": 10, "K": 11}

# Excel's structured reference for column F of the current row.
STRUCTURED_F = "Tabelle4[[#This Row],[1st strength]]"

CELL_REF = re.compile(r"\$?([A-K])\$?(\d+)")
SAFE_EXPR = re.compile(r"^[0-9x.+\-*/() ]+$")

# A cent. The workbook and the plugin both hold full precision, so a coupling
# should land far closer than this; the margin only absorbs float noise.
TOLERANCE = 0.005


def load_rows():
    src = DATA.read_text(encoding="utf-8")
    m = re.search(r"FEE_ROWS: (\[.*?\]),\r?\n", src, re.S)
    return json.loads(m.group(1)), src, m


def parse(formula, own_row):
    """-> (column, row, factor, offset) or None if it is not a linear coupling."""
    if not isinstance(formula, str) or not formula.startswith("="):
        return None
    text = formula[1:].strip().replace(STRUCTURED_F, "F%d" % own_row)

    refs = {(c, int(r)) for c, r in CELL_REF.findall(text)}
    if len(refs) != 1:
        return None
    col, row = refs.pop()

    expr = CELL_REF.sub("x", text)
    if not SAFE_EXPR.match(expr):
        return None
    try:
        at0 = eval(expr, {"__builtins__": {}}, {"x": 0.0})
        at1 = eval(expr, {"__builtins__": {}}, {"x": 1.0})
    except Exception:
        return None
    if not isinstance(at0, float) or not isinstance(at1, float):
        return None

    offset = at0
    factor = at1 - at0
    # Excel writes 1/4 as .25 exactly; snap away the noise of the two probes so
    # the shipped numbers read as the fractions they are.
    factor = round(factor, 10)
    offset = round(offset, 10)
    return (col, row, factor, offset)


def encode(col, row, factor, offset, own_row):
    link = {"c": col}
    if row != own_row:
        link["r"] = row
    if factor != 1.0:
        link["f"] = factor
    if offset != 0.0:
        link["o"] = offset
    return link


def notation(row):
    """The column suffix a row is actually maintained in."""
    if row.get("currency"):
        return "_lc"
    if any(k.endswith("_pt") for k in row):
        return "_pt"
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="merge the couplings into vcl-calc-data.js")
    args = ap.parse_args()

    rows, src, match = load_rows()
    by_row = {r["row"]: r for r in rows}

    wb = openpyxl.load_workbook(WORKBOOK, read_only=True)
    ws = wb[SHEET]

    links, unparsed, kinds = {}, [], {}
    for ws_row in ws.iter_rows(min_row=FIRST_ROW, max_row=LAST_ROW, min_col=1, max_col=11):
        row_no = ws_row[0].row
        if row_no not in by_row:
            continue
        for col, idx in COLUMNS.items():
            formula = ws_row[idx - 1].value
            if not isinstance(formula, str) or not formula.startswith("="):
                continue
            parsed = parse(formula, row_no)
            if parsed is None:
                unparsed.append((row_no, col, formula))
                continue
            s_col, s_row, factor, offset = parsed
            links.setdefault(str(row_no), {})[col] = encode(s_col, s_row, factor, offset, row_no)
            kind = "%s%s%s" % (s_col,
                               "" if factor == 1.0 else " x%g" % factor,
                               "" if offset == 0.0 else " +%g" % offset)
            kinds[kind] = kinds.get(kind, 0) + 1
    wb.close()

    n = sum(len(v) for v in links.values())
    print("Kopplungen gelesen : %d in %d Zeilen" % (n, len(links)))
    for kind, count in sorted(kinds.items(), key=lambda kv: -kv[1]):
        print("   %-14s %4d" % (kind, count))
    if unparsed:
        print("\nNicht als Kopplung lesbar (%d) -- bleiben freie Felder:" % len(unparsed))
        for row_no, col, formula in unparsed[:10]:
            print("   Zeile %d %s: %s" % (row_no, col, formula))

    # ---- prove every coupling reproduces the value it stands for ----------
    bad, checked = [], 0
    for row_key, cols in links.items():
        row = by_row[int(row_key)]
        suffix = notation(row)
        for col, link in cols.items():
            source = by_row[link.get("r", int(row_key))]
            want = row.get(col + suffix)
            have = source.get(link["c"] + suffix)
            if want is None or have is None:
                continue
            checked += 1
            got = have * link.get("f", 1.0) + link.get("o", 0.0)
            if abs(got - want) > TOLERANCE:
                bad.append((row_key, col, link, want, got))

    print("\ngeprueft           : %d Kopplungen gegen die Betraege im Plugin" % checked)
    if bad:
        print("ABWEICHUNGEN       : %d" % len(bad), file=sys.stderr)
        for row_key, col, link, want, got in bad[:10]:
            print("   Zeile %s %s -> %s: erwartet %.4f, ergibt %.4f"
                  % (row_key, col, link, want, got), file=sys.stderr)
        return 1
    print("Ergebnis           : jede Kopplung liefert genau den Betrag, der dort steht.")

    if not args.write:
        print("\n(Nur gelesen. Mit --write in vcl-calc-data.js schreiben.)")
        return 0

    for r in rows:
        cols = links.get(str(r["row"]))
        if cols:
            r["links"] = cols
        else:
            r.pop("links", None)
    patched = src[:match.start(1)] + json.dumps(rows, ensure_ascii=False) + src[match.end(1):]
    DATA.write_text(patched, encoding="utf-8", newline="")
    print("\nIn %s geschrieben." % DATA.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
