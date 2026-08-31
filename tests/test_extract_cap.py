import re
import sys, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from extract_rules import load_fee_rows, extract_cap, extract_surcharge, build_rules

ROWS = {r["row"]: r for r in load_fee_rows()}


def test_italy_has_no_cap_and_no_surcharge():
    assert extract_cap(ROWS[257]) is None
    assert extract_surcharge(ROWS[257]) is None


def test_germany_is_a_plain_amount_one_field_can_hold():
    # Spec B6: DE row 69 caps the sum at a flat 19900 EUR
    cap = extract_cap(ROWS[69])
    assert cap["scope"] == "P+Q+R"
    assert cap["value"] == {"const": 19900.0}


def test_slovenia_is_points_times_a_point_value():
    # Spec B6: SI row 382 caps at 1500 points x 5.8 EUR/point
    cap = extract_cap(ROWS[382])
    assert cap["value"] == {"points": 1500.0, "pointValue": 5.8}


def test_poland_is_not_a_cap():
    # Spec B6: 2*F + (L-1)*F*0.8 is a grouping rule wearing a ">" comparison
    assert extract_cap(ROWS[337]) is None


def test_every_cap_is_enterable():
    # A cap must land in one of the four form shapes, OR be explicitly
    # flagged "unparsed" -- the safety net that reports shapes nobody could
    # type into a form (spec B6). It must never silently masquerade as one
    # of the four under a value shape that doesn't actually match.
    allowed = ({"const"}, {"byStrength"}, {"points", "pointValue"}, {"multipleOfLead"})
    offenders = []
    for r in load_fee_rows():
        cap = extract_cap(r)
        if not cap or "unparsed" in cap:
            continue
        if set(cap.get("value", {})) not in allowed:
            offenders.append((r["row"], cap))
    assert offenders == [], f"caps not expressible as form fields: {offenders}"


def test_ie_row_224_caps_q_only():
    # Finding 1: IF(L=1, IF(Q>4150,4150,Q), IF(Q>6425,6425,Q)) caps Q alone --
    # the P subtotal is zero on this row, so scope "P" would be a silent no-op.
    cap = extract_cap(ROWS[224])
    assert cap["scope"] == "Q"


def test_ie_row_226_caps_q_plus_r():
    # Finding 1: IF(L=1, IF((Q+R)>4150,4150,Q+R), ...) caps Q+R, not P.
    cap = extract_cap(ROWS[226])
    assert cap["scope"] == "Q+R"


def test_ie_row_221_still_caps_all_three():
    # A row that genuinely caps P+Q+R must keep reporting that scope after
    # _cap_scope stopped substring-matching a fixed list of two combinations.
    cap = extract_cap(ROWS[221])
    assert cap["scope"] == "P+Q+R"
    assert cap["value"]["byStrength"] == {"1": 4150.0, "else": 6425.0}


def test_a_strength_dependent_cap_keeps_both_levels():
    hits = [r for r in load_fee_rows()
            if r.get("Sf") and "4150" in r["Sf"] and "6425" in r["Sf"]]
    assert hits, "no row with the 4150/6425 cap found -- data changed?"
    cap = extract_cap(hits[0])
    assert cap["value"]["byStrength"]["1"] == 4150.0
    assert cap["value"]["byStrength"]["else"] == 6425.0


def test_surcharge_is_read_as_a_number():
    hits = [r for r in load_fee_rows()
            if r.get("Sf") and re.search(r"\+77\b", r["Sf"])]
    assert hits, "no row with the +77 surcharge found -- data changed?"
    assert extract_surcharge(hits[0]) == 77.0


def test_build_rules_covers_every_row():
    rules = build_rules()
    assert len(rules) == 421
    assert all("rule" in r and "amounts" in r and "select" in r for r in rules)
