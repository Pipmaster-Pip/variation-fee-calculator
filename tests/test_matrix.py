import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from feedata import load_fee_rows
from matrix import build_matrix

ROWS = load_fee_rows()


def test_the_data_file_still_holds_444_rows():
    # 421 shipped + 15 (BG MRP/DCP, CZ "neue Studie", DK worksharing) + 3 (IE RMS
    # reduced/complex-reduced variants) + 1 (DK super-grouping lead fee 3119),
    # all 2026-10-12; + 4 (LT worksharing IB/II for RMS/CMS, 3a.1/3a.2), 2026-10-13.
    assert len(ROWS) == 444


def test_matrix_has_the_size_the_spec_states():
    assert len(build_matrix(ROWS)) == 208215


def test_matrix_contains_the_hand_checked_italian_case():
    hit = [e for e in build_matrix(ROWS)
           if e["cc"] == "IT" and e["role"] == "RMS" and e["strengths"] == 3
           and e["counts"] == {"IA": 1, "IB": 2, "II": 1}
           and e["special"].get("II") == "standard"]
    assert hit, "Italian case missing from the matrix"


def test_no_combination_without_any_variation():
    assert not [e for e in build_matrix(ROWS) if not any(e["counts"].values())]
