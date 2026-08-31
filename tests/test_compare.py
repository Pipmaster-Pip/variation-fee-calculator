import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from compare import diff_row


def test_identical_rows_produce_no_diff():
    golden = {"row": "257", "type": "II", "total": "35304.00", "subsumed": "0", "capValue": ""}
    mine = {"row": 257, "type": "II", "total": 35304.00, "subsumed": False, "capValue": None}
    assert diff_row(golden, mine) == []


def test_a_cent_of_difference_is_reported():
    golden = {"row": "257", "type": "II", "total": "35304.00", "subsumed": "0", "capValue": ""}
    mine = {"row": 257, "type": "II", "total": 35304.01, "subsumed": False, "capValue": None}
    d = diff_row(golden, mine)
    assert len(d) == 1 and d[0]["field"] == "total"


def test_a_flag_difference_is_reported():
    golden = {"row": "9", "type": "IA", "total": "100.00", "subsumed": "0", "capValue": "80.00"}
    mine = {"row": 9, "type": "IA", "total": 100.00, "subsumed": False, "capValue": None}
    d = diff_row(golden, mine)
    assert [x["field"] for x in d] == ["capValue"]
