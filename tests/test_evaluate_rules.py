import sys, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

import pytest

from evaluate_rules import load_rules, evaluate, _apply_cap

RULES = load_rules()


def test_italy_matches_the_hand_checked_value():
    # Same case as the smoke test in Task 1, verified by hand against the
    # Excel formulas of row 257: 1055 + 4892 + 29357 = 35304
    items = evaluate(RULES, "IT", "RMS", 3,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 1, "IB": 2, "II": 1})
    total = sum(i["total"] for i in items if i["total"] is not None)
    assert round(total, 2) == 35304.00
    # A normally computed item carries a numeric total and is never marked
    # uncomputable -- the marker must not leak onto ordinary rows. IA/IB are
    # subsumed here (II leads), so check the leading type's item.
    ii = [i for i in items if i["type"] == "II"][0]
    assert ii["uncomputable"] is False
    assert isinstance(ii["total"], float)


# --- Defect (c): "unknown" rows must not invent a euro amount ------------
#
# 17 Denmark rows (rows 98 and 109 among them) carry rule == "unknown": the
# extractor could not classify their Excel formula. That is a deliberate,
# reported gap in the study, not a defect to compute around -- evaluate()
# must surface it as "uncomputable" rather than silently emitting 0.0.
def test_unknown_rule_row_98_is_uncomputable_not_zero():
    items = evaluate(RULES, "DK", "CMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 1, "IB": 0, "II": 0})
    ia = [i for i in items if i["type"] == "IA"][0]
    assert ia["row"] == 98
    assert ia["total"] is None
    assert ia["uncomputable"] is True


def test_unknown_rule_row_109_is_uncomputable_not_zero():
    items = evaluate(RULES, "DK", "national", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 1, "IB": 0, "II": 0})
    ia = [i for i in items if i["type"] == "IA"][0]
    assert ia["row"] == 109
    assert ia["total"] is None
    assert ia["uncomputable"] is True


def test_lower_types_are_subsumed_by_the_highest():
    items = evaluate(RULES, "IT", "RMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 1, "IB": 0, "II": 1})
    ia = [i for i in items if i["type"] == "IA"][0]
    assert ia["subsumed"] is True


# --- Defect (a): generic scope handling, not just P / P+Q / P+Q+R --------
#
# Excel row 224 (IE, CMS, IB, "standard"): Sf =
#   IF(N224=0,"",IF(L224=1, IF(Q224>4150,4150,Q224), IF(Q224>6425,6425,Q224)))
# The ceiling here is checked against Q224 ALONE (the IB subtotal) -- scope
# "Q" -- not against P+Q. fee-rules.json row 224 has cap.scope == "Q".
def test_ceiling_with_scope_q_binds_on_the_ib_subtotal_alone():
    # strengths=1 -> row 224's per-strength-tiered rate for L=1 is F224*N224
    # (lead=450). 10 IB items: 450*10 = 4500 > 4150 -> ceiling binds at 4150.
    items = evaluate(RULES, "IE", "CMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 0, "IB": 10, "II": 0})
    ib = [i for i in items if i["type"] == "IB"][0]
    assert ib["row"] == 224
    assert ib["total"] == 4150.00
    assert ib["capValue"] == 4150.00


# Excel row 226 (IE, CMS, II, "standard"): Sf =
#   IF(O226=0,"",IF(L226=1, IF((Q226+R226)>4150,4150,Q226+R226), ...))
# The ceiling is checked against Q226+R226 (IB+II subtotal) -- scope "Q+R" --
# with no P component. fee-rules.json row 226 has cap.scope == "Q+R".
def test_ceiling_with_scope_q_plus_r_binds_on_the_ib_and_ii_subtotal():
    # strengths=1, only II filed: Q226 (row 224's rate * 0 IB items) = 0;
    # R226 = F226*O226 (lead=450) = 450*10 = 4500 > 4150 -> ceiling binds.
    items = evaluate(RULES, "IE", "CMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 0, "IB": 0, "II": 10})
    ii = [i for i in items if i["type"] == "II"][0]
    assert ii["row"] == 226
    assert ii["total"] == 4150.00
    assert ii["capValue"] == 4150.00


def test_unrecognised_cap_scope_raises_instead_of_silently_using_the_full_total():
    # The brief's version fell back to the full P+Q+R total via
    # scope_sum.get(cap["scope"], total) whenever the scope string wasn't one
    # of its three hard-coded keys. That silently hides an unhandled scope.
    fake_rule = {
        "amounts": {},
        "cap": {"scope": "P+Q+X", "value": {"const": 100.0}},
        "surcharge": None,
    }
    parts = {"IA": 10.0, "IB": 20.0, "II": 30.0}
    with pytest.raises(ValueError):
        _apply_cap(fake_rule, parts, strengths=1)


# --- Defect (b): the IE cap-plus-surcharge shape -------------------------
#
# Excel row 220 (IE, RMS, IB, "standard"): Sf =
#   IF(N220=0,"",IF(L220=1,
#       IF((P220+Q220)>4150, 4150, P220+Q220+390),
#       IF((P220+Q220)>6425, 6425, P220+Q220+390)))
# The comparison is against the sum WITHOUT the surcharge; when the ceiling
# binds the result is the ceiling ALONE (surcharge dropped), otherwise it is
# sum+surcharge (which may legitimately exceed the ceiling).
def test_ie_surcharge_is_dropped_when_the_ceiling_binds():
    # strengths=1, 4 IB items: row 220's per-strength-tiered sum for L=1 is
    # lead(1085)*4 = 4340 > 4150 -> ceiling binds -> total is 4150 alone,
    # the 390 surcharge is NOT added on top.
    items = evaluate(RULES, "IE", "RMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 0, "IB": 4, "II": 0})
    ib = [i for i in items if i["type"] == "IB"][0]
    assert ib["row"] == 220
    assert ib["total"] == 4150.00
    assert ib["capValue"] == 4150.00


def test_ie_surcharge_is_added_when_the_ceiling_does_not_bind():
    # strengths=1, 3 IB items: sum = 1085*3 = 3255 <= 4150 -> ceiling does not
    # bind -> total is sum + surcharge = 3255 + 390 = 3645, and capValue is
    # None (no ceiling was applied).
    items = evaluate(RULES, "IE", "RMS", 1,
                     {"IA": "standard", "IB": "standard", "II": "standard"},
                     {"IA": 0, "IB": 3, "II": 0})
    ib = [i for i in items if i["type"] == "IB"][0]
    assert ib["row"] == 220
    assert ib["total"] == 3645.00
    assert ib["capValue"] is None
