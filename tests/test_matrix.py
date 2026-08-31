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
