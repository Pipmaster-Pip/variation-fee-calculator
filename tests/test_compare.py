import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from compare import diff_row, _priced_golden, _priced_mine


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


def test_empty_vs_none_is_unpriced_not_a_match():
    # Critical (whole-branch review): a subsumed row carries no amount at all
    # on either side -- golden `total` is "" and the evaluator returns
    # `total=None`. diff_row() alone would call this agreement on every
    # field (both sides read as "no value"), which is exactly how the
    # inflated headline used to count these rows as matches. compare.main()
    # must route such a row into the "unpriced" bucket *before* diff_row ever
    # sees it, never into "matching".
    golden = {"row": "17", "type": "IA", "total": "", "subsumed": "1", "capValue": ""}
    mine = {"row": 17, "type": "IA", "total": None, "subsumed": True, "capValue": None}

    assert not _priced_golden(golden)
    assert not _priced_mine(mine)
    # diff_row on its own would (wrongly, if used alone) call this a match --
    # asserting that here documents why the priced-check has to run first.
    assert diff_row(golden, mine) == []


def test_uncomputable_row_is_its_own_bucket():
    # An "unknown"-rule (DK) row where the golden master DOES carry a real
    # priced amount: the evaluator marks it uncomputable and returns no
    # number. This must land in its own "uncomputable" bucket -- neither
    # counted as a match (it produced no number to agree with) nor lumped
    # into "unpriced" (the golden side is genuinely priced here).
    golden = {"row": "98", "type": "IA", "total": "150.00", "subsumed": "0", "capValue": ""}
    mine = {"row": 98, "type": "IA", "total": None, "subsumed": None, "capValue": None,
            "uncomputable": True}

    assert _priced_golden(golden)
    assert not _priced_mine(mine)
    assert mine["uncomputable"] is True
    # Not both-unpriced, so this row must NOT be routed to the "unpriced"
    # bucket -- it belongs in "uncomputable" instead.
    assert not (not _priced_golden(golden) and not _priced_mine(mine))
