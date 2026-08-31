import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from extract_rules import load_fee_rows, extract_amounts, classify_rule

ROWS = {r["row"]: r for r in load_fee_rows()}


def test_italian_amounts_are_named_not_lettered():
    a = extract_amounts(ROWS[257])
    assert a["lead"] == 29357.0
    assert a["perStrength"] == 0.0
    assert a["rateIA"] == 1055.0
    assert a["rateIB"] == 2446.0
    assert a["rateII"] == 29357.0
    assert a["flat"] is None


def test_local_currency_row_keeps_its_own_currency():
    # CZ row 57 carries F_lc/G_lc etc.; the EUR values are derived at runtime
    a = extract_amounts(ROWS[57])
    assert a["currency"] == "CZK"
    assert a["lead"] is not None


def test_italy_is_plain_scaling():
    assert classify_rule(ROWS[257])["rule"] == "scaling"


def test_ema_row_423_is_count_tiered_not_scaling():
    # Spec B5: IF(O<3, O*F, 2*F+(O-2)*J) -- first two full, then reduced.
    # Misclassifying this as "scaling" was the flaw in the pre-analysis.
    assert classify_rule(ROWS[423])["rule"] == "per_count_tiered"


def test_no_rule_is_guessed():
    for r in load_fee_rows():
        c = classify_rule(r)
        assert c["rule"] in {"scaling", "flat_from_second", "per_strength_tiered",
                             "per_count_tiered", "unknown"}
        assert c["evidence"], f"row {r['row']} classified without evidence"
