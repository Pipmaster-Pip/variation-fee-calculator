import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from golden import format_run, HEADER

ENTRY = {"cc": "IT", "role": "RMS", "strengths": 3,
         "special": {"IA": "standard", "IB": "standard", "II": "standard"},
         "counts": {"IA": 1, "IB": 2, "II": 1}}
RES = {"countries": [{"items": [
    {"row": {"row": 257, "type": "II"}, "total": 35304, "singleTotal": 29357,
     "rawSumSingle": 29357, "subsumed": False, "count": 1, "capValue": None,
     "groupingFee": None, "groupingBase": None, "groupingPerAdditional": None}
]}]}


def test_one_line_per_result_item():
    assert len(format_run(7, ENTRY, RES)) == 1


def test_columns_match_the_header():
    fields = format_run(7, ENTRY, RES)[0].split(",")
    assert len(fields) == len(HEADER.split(","))


def test_amounts_carry_two_decimals_and_flags_are_zero_one():
    f = format_run(7, ENTRY, RES)[0].split(",")
    cols = HEADER.split(",")
    assert f[cols.index("runId")] == "7"
    assert f[cols.index("cc")] == "IT"
    assert f[cols.index("row")] == "257"
    assert f[cols.index("total")] == "35304.00"
    assert f[cols.index("subsumed")] == "0"
    assert f[cols.index("capValue")] == ""
