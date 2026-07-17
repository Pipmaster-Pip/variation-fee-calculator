# Extracts the CMDh Art. 5 tracking table into vcl-art5-data.js -- GENERATED, not hand-edited.
#
# Usage:  python extract_art5.py <path-to-Art5-tracking-table.xls>
# Writes: assets/js/vcl-art5-data.js  (next to this script)
#
# Needs xlrd (pip install xlrd) -- the source is a real OLE2 .xls, which openpyxl cannot read.
# Same role as convert.py / extract_qa.py: a source document in, a generated data file out.
#
# The table has two sheets. "As of <date>" is the list of Art. 5 recommendations still standing;
# it is currently EMPTY (a bare section skeleton) because the guideline effective 15 Jan 2026
# absorbed the previous set. "Historical" holds the 52 superseded recommendations, coded in the
# OLD A/B/C nomenclature -- so they are an archive, not codes you would file against today.
import os
import re
import sys

import xlrd

if len(sys.argv) < 2:
    raise SystemExit("usage: python extract_art5.py <path-to-Art5-tracking-table.xls>")
XLS = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "assets", "js", "vcl-art5-data.js")

wb = xlrd.open_workbook(XLS)
DATEMODE = wb.datemode

CLEAN_TYPE = re.compile(r"^(IAIN|IA|IB|II)(\*{1,2})?$")


def cell(sh, r, c):
    return str(sh.cell_value(r, c)).strip()


def iso_date(sh, r, c):
    v = sh.cell_value(r, c)
    if isinstance(v, float) and v > 0:
        y, m, d, *_ = xlrd.xldate_as_tuple(v, DATEMODE)
        return "%04d-%02d-%02d" % (y, m, d)
    return ""


def parse_sheet(sh):
    """Returns (recommendations, footnotes). A row is a recommendation when it has a proposed
    classification (col 3); a row with only col 0 is a section header (or, at the very end, a
    footnote). The nearest preceding top-level header (A./B./C./OTHER...) groups each row."""
    hdr = next(r for r in range(sh.nrows) if cell(sh, r, 1) == "Date issued")
    recs, footnotes, group = [], [], None
    for r in range(hdr + 1, sh.nrows):
        vals = [cell(sh, r, c) for c in range(sh.ncols)]
        if not any(vals):
            continue
        typ = vals[3]
        if not typ and vals[0] and not vals[1] and not vals[2]:
            # Section header or footnote. Footnotes are the trailing lines starting with "*".
            if vals[0].startswith("*"):
                footnotes.append(vals[0])
            elif re.match(r"^[A-Z]\.|^OTHER\b", vals[0]):
                group = vals[0]  # a new top-level grouping
            # sub-section headers (B.I.a) etc.) are ignored: the row's own code carries that
            continue
        if not typ:
            continue
        m = CLEAN_TYPE.match(typ)
        recs.append({
            "group": group or "",
            "code": vals[0],
            "date": iso_date(sh, r, 1),
            "change": vals[2],
            "type": typ,
            "typeClean": bool(m),
            "typeBadge": m.group(1) if m else None,   # IA/IAIN/IB/II for the badge
            "typeStar": m.group(2) if (m and m.group(2)) else "",  # * or ** marker, kept visible
            "conditions": vals[4],
        })
    return recs, footnotes


sheet_names = wb.sheet_names()
current_name = next((n for n in sheet_names if n.lower().startswith("as of")), sheet_names[0])
hist_name = next((n for n in sheet_names if "hist" in n.lower()), sheet_names[-1])

current_recs, current_fn = parse_sheet(wb.sheet_by_name(current_name))
hist_recs, hist_fn = parse_sheet(wb.sheet_by_name(hist_name))

# "As of 15 Jan 2026" -> the label the view shows for the live list.
m = re.search(r"as of\s+(.+)", current_name, re.I)
as_of = m.group(1).strip() if m else ""

data = {
    "meta": {
        "docRef": "CMDh/172/2010, Rev. 17",
        "docDate": "October 2025 (corrected December 2025)",
        "asOf": as_of,
        "title": "CMDh Recommendations for classification of unforeseen variations according to Article 5 of Commission Regulation (EC) 1234/2008",
        "url": "https://www.hma.eu/fileadmin/dateien/Human_Medicines/CMD_h_/procedural_guidance/Variations/Art_5_Recommendations/CMDh_172_2010_Rev17_2025_10_correction_2025_12_-_Tracking_Table_Article_5.xls",
        "lastUpdated": "2026-07-17",
    },
    "footnotes": hist_fn or current_fn,
    "current": current_recs,
    "historical": hist_recs,
}

with open(JS, "w", encoding="utf-8", newline="\n") as f:
    f.write(
        "// Art. 5 recommendations (CMDh/172/2010, Rev. 17) -- GENERATED FILE, DO NOT EDIT BY HAND.\n"
        "//\n"
        "// Produced by extract_art5.py from the source .xls. Re-run that script against a new\n"
        "// revision rather than patching values here, or the next regeneration drops the edit.\n"
        "//\n"
        "// `current` is the still-standing list (empty as of the guideline effective 15 Jan 2026,\n"
        "// which absorbed the earlier recommendations); `historical` is the superseded archive, in\n"
        "// the OLD A/B/C classification nomenclature -- reference only, not codes to file today.\n"
        "// typeClean marks the ~83% of rows whose classification is a plain IA/IAIN/IB/II (the rest\n"
        "// carry prose like \"No change necessary\" and are kept verbatim, without a badge).\n"
        "(function () {\n"
        '  "use strict";\n\n'
        "  window.VCL_ART5_DATA = "
    )
    import json
    f.write(json.dumps(data, ensure_ascii=False, indent=2).replace("\n", "\n  "))
    f.write(";\n})();\n")

# ---- Self-checks ---------------------------------------------------------------------------
import collections
print("source sheets:", sheet_names)
print("current (%r): %d recommendations" % (current_name, len(current_recs)))
print("historical: %d recommendations" % len(hist_recs))
print("type badges:", dict(collections.Counter(r["typeBadge"] for r in hist_recs)))
print("prose (no clean type):", sum(1 for r in hist_recs if not r["typeClean"]))
print("footnotes:", len(data["footnotes"]))
print("date range:", min(r["date"] for r in hist_recs if r["date"]), "->", max(r["date"] for r in hist_recs if r["date"]))
print("wrote", JS)
