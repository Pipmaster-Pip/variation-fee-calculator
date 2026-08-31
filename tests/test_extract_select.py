import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from extract_rules import load_fee_rows, extract_select

ROWS = {r["row"]: r for r in load_fee_rows()}


def test_standard_italian_row_has_no_gate():
    sel = extract_select(ROWS[257])
    assert sel["subsumption"] == "highest-type-wins"
    assert sel["activeWhen"] is None
    assert sel["anomaly"] is None


def test_danish_standard_row_is_capped_at_one_variation():
    # DK row 87: IF(M2>1, 0, ...) -- only fires for exactly one Type IA
    sel = extract_select(ROWS[87])
    assert sel["activeWhen"] == {"type": "IA", "max": 1}


def test_danish_grouped_row_starts_at_two_variations():
    # DK row 88 "same D.Sp.No.": IF(M2<2, 0, ...)
    sel = extract_select(ROWS[88])
    assert sel["activeWhen"] == {"type": "IA", "min": 2}


def test_eu_row_422_flags_the_foreign_reference():
    # Spec B4: Of reads O341 (a Polish row) instead of O2
    sel = extract_select(ROWS[422])
    assert sel["anomaly"] is not None
    assert "341" in sel["anomaly"]


def test_all_but_the_danish_rows_are_ungated():
    # 411 of 421 rows follow "highest type wins" with no count gate; the gated
    # ones are Denmark's nine threshold rows (spec, Task 4 preamble).
    gated = [r["row"] for r in load_fee_rows() if extract_select(r)["activeWhen"]]
    assert len(gated) == 9
    assert all(ROWS[n]["cc"] == "DK" for n in gated)


def test_only_row_422_carries_an_anomaly():
    flagged = [r["row"] for r in load_fee_rows() if extract_select(r)["anomaly"]]
    assert flagged == [422]
