import csv
import io
import sys
import pathlib
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


def _through_csv(rows):
    """Round-trip rows through csv.writer/csv.reader, the same path golden.py
    uses to write the real artifact."""
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    buf.seek(0)
    return list(csv.reader(buf))


def test_one_line_per_result_item():
    assert len(format_run(7, ENTRY, RES)) == 1


def test_columns_match_the_header():
    fields = format_run(7, ENTRY, RES)[0]
    assert len(fields) == len(HEADER.split(","))


def test_amounts_carry_two_decimals_and_flags_are_zero_one():
    parsed = _through_csv(format_run(7, ENTRY, RES))[0]
    cols = HEADER.split(",")
    assert parsed[cols.index("runId")] == "7"
    assert parsed[cols.index("cc")] == "IT"
    assert parsed[cols.index("row")] == "257"
    assert parsed[cols.index("total")] == "35304.00"
    assert parsed[cols.index("subsumed")] == "0"
    assert parsed[cols.index("capValue")] == ""


def test_special_case_label_with_comma_round_trips_byte_identical():
    """Regression test for the CSV-encoding defect: a special-case label
    containing a comma must survive csv.writer/csv.reader unchanged, not get
    its comma silently replaced with a space."""
    entry = {"cc": "IT", "role": "RMS", "strengths": 3,
              "special": {"IA": "quality, simple (Q)", "IB": "standard", "II": "standard"},
              "counts": {"IA": 1, "IB": 2, "II": 1}}
    parsed = _through_csv(format_run(7, entry, RES))[0]
    cols = HEADER.split(",")
    assert parsed[cols.index("specialIA")] == "quality, simple (Q)"
