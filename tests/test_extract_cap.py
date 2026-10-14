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


def test_ie_row_224_caps_the_ib_subtotal():
    # IE 2026-10-12: a flat 4150 grouping ceiling (code 236). The scope is reported
    # P+Q uniformly; on a CMS row the IA subtotal P is structurally zero, so P+Q is
    # numerically the IB subtotal.
    cap = extract_cap(ROWS[224])
    assert cap["scope"] == "P+Q"
    assert cap["value"] == {"const": 4150.0}


def test_ie_row_226_caps_the_summed_subtotals():
    cap = extract_cap(ROWS[226])
    assert cap["scope"] == "P+Q+R"
    assert cap["value"] == {"const": 4150.0}


def test_ie_row_221_caps_at_the_flat_grouping_ceiling():
    # IE's ceiling used to be strength-dependent (4150 at 1 strength, 6425 at 2+).
    # As of 2026-10-12 IE charges no per-strength fee and the ceiling is a flat 4150
    # applied only when grouping.
    cap = extract_cap(ROWS[221])
    assert cap["scope"] == "P+Q+R"
    assert cap["value"] == {"const": 4150.0}


def test_no_row_has_a_strength_dependent_cap_anymore():
    # The only byStrength caps were IE's (4150/6425); both are gone after the IE
    # rebuild. extract_cap still supports the shape for any future row.
    assert [r["row"] for r in load_fee_rows()
            if (extract_cap(r) or {}).get("value", {}).get("byStrength")] == []


def test_no_row_carries_a_v_surcharge_anymore():
    # The per-row V surcharge was retired: CZ's moved to the per-application admin
    # fee (v1.41.0) and IE's folded into flat full RMS amounts (2026-10-12). No
    # shipped row carries one now; extract_surcharge still reads a V column if a
    # future row brings one back.
    assert [r["row"] for r in load_fee_rows() if r.get("V")] == []


def test_build_rules_covers_every_row():
    rules = build_rules()
    assert len(rules) == 456
    assert all("rule" in r and "amounts" in r and "select" in r for r in rules)
