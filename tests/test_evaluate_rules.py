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
        "amountsEur": {},
        "cap": {"scope": "P+Q+X", "value": {"const": 100.0}},
        "surcharge": None,
    }
    parts = {"IA": 10.0, "IB": 20.0, "II": 30.0}
    raw_total = parts["IA"] + parts["IB"] + parts["II"]
    with pytest.raises(ValueError):
        _apply_cap(fake_rule, raw_total, parts, strengths=1)


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


# --- Cause C: totalScope, not a blanket P+Q+R sum -------------------------
#
# Excel row 35 (BE, national, II, "analytical"): Sf =
#   IF(O35=0,"",IF(O35>1,K35,F35))
# references neither P, Q nor R of its own row -- the total is one flat fee
# for the whole submission, not a sum of per-type subtotals. The old
# evaluator summed parts["IA"]+parts["IB"]+parts["II"] unconditionally, and
# because _active_counts hands the full counts dict to whichever row leads,
# row 35's own F/K got applied to BOTH the IB and the II slot, doubling the
# fee for one Type IB + one Type II filing (21548.66 instead of 10774.33).
def test_belgium_row_35_is_not_double_counted():
    items = evaluate(RULES, "BE", "national", 1,
                      {"IA": None, "IB": "analytical", "II": "analytical"},
                      {"IA": 0, "IB": 1, "II": 1})
    # The IB row (33) has no "analytical" variant and is subsumed by II
    # anyway (highest type wins) -- its own total must not be counted.
    ib = [i for i in items if i["type"] == "IB"][0]
    assert ib["subsumed"] is True
    assert ib["total"] is None
    ii = [i for i in items if i["type"] == "II"][0]
    assert ii["row"] == 35
    assert ii["total"] == 10774.33
    total = sum(i["total"] for i in items if i["total"] is not None)
    assert total == 10774.33  # not 21548.66


# --- Cause B: amountsEur, not the authoritative local-currency amounts ----
#
# The golden master was recorded with network access blocked, so the
# shipped calculator's applyLiveRatesToRows() only ever found a rate for
# HU/NO/SI (STATIC_FX_RATES); every other local-currency country kept the
# plain euro value already baked into vcl-calc-data.js at export time.
def test_norway_total_uses_the_static_rate_conversion():
    # NO row 322 (RMS, IB, "SmPC, PL and labelling"), rule "scaling": a
    # single item at strength 1 is just the lead amount, converted at the
    # frozen static rate 11.31: 14079 / 11.31 = 1244.8275862068965.
    items = evaluate(RULES, "NO", "RMS", 1,
                      {"IA": None, "IB": "SmPC, PL and labelling", "II": None},
                      {"IA": 0, "IB": 1, "II": 0})
    ib = [i for i in items if i["type"] == "IB"][0]
    assert ib["row"] == 322
    assert ib["total"] == round(14079.0 / 11.31, 2)
    assert ib["total"] == 1244.83


def test_czech_total_keeps_the_export_time_euro_value():
    # CZ row 57 (RMS, IA, "standard"), rule "scaling": CZ has no
    # STATIC_FX_RATES entry, so under frozen conditions F..K were never
    # rewritten -- the total is the plain (already-euro) F column
    # (542.8708880681648), not F_lc (13135.0) divided by anything. Row 57's
    # own Sf is "P57+77" -- a flat 77 surcharge on top -- so the expected
    # total is the plain euro lead amount plus that surcharge.
    items = evaluate(RULES, "CZ", "RMS", 1,
                      {"IA": "standard", "IB": None, "II": None},
                      {"IA": 1, "IB": 0, "II": 0})
    ia = [i for i in items if i["type"] == "IA"][0]
    assert ia["row"] == 57
    assert ia["total"] == round(542.8708880681648 + 77, 2)
    assert ia["total"] == 619.87


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
