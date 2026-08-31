import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from feedata import load_static_fx_rates
from extract_rules import (
    load_fee_rows, extract_amounts, extract_amounts_eur, extract_total_scope, build_rules,
)

ROWS = {r["row"]: r for r in load_fee_rows()}
STATIC_RATES = load_static_fx_rates()


# --- Cause B: amountsEur reproduces what the shipped engine actually --------
# computes with under the frozen (network-blocked) conditions the golden
# master was recorded under, not the authoritative *_lc source value.

def test_static_rates_are_read_from_the_data_file_not_hardcoded():
    # Spec: the three rates the shipped calculator falls back to when the
    # ECB API is unreachable, read straight from vcl-calc-data.js.
    assert STATIC_RATES == {"HU": 395.12, "NO": 11.31, "SI": 5.8}


def test_norway_converts_lc_by_the_static_rate():
    # NO row 322: F_lc=14079.0, static rate 11.31 -> applyLiveRatesToRows()
    # would have computed F = F_lc / rate under frozen conditions.
    row = ROWS[322]
    assert row["F_lc"] == 14079.0
    eur = extract_amounts_eur(row, STATIC_RATES)
    assert eur["lead"] == 14079.0 / 11.31
    # amounts (the authoritative source value) is untouched: still the local
    # currency figure, not the converted one.
    assert extract_amounts(row)["lead"] == 14079.0
    assert extract_amounts(row)["currency"] == "NOK"


def test_czech_keeps_the_export_time_euro_value_uncoverted():
    # CZ has no STATIC_FX_RATES entry, so applyLiveRatesToRows() never
    # rewrote F..K under frozen conditions -- the plain F column (already a
    # euro value baked in at export time) is what the engine actually used.
    row = ROWS[57]
    assert row["F_lc"] == 13135.0
    eur = extract_amounts_eur(row, STATIC_RATES)
    assert eur["lead"] == row["F"]
    assert eur["lead"] != row["F_lc"]
    # amounts still reports the authoritative CZK source value.
    assert extract_amounts(row)["lead"] == 13135.0


def test_slovenia_is_untouched_by_its_own_static_entry():
    # SI has a STATIC_FX_RATES entry (5.8) but is an EUR country with no _lc
    # columns at all -- nothing should happen to it either way.
    row = ROWS[382]
    assert row.get("currency") is None
    assert row.get("F_lc") is None
    eur = extract_amounts_eur(row, STATIC_RATES)
    plain = extract_amounts(row)
    assert eur == plain
    assert eur["lead"] == 1798.0


def test_amounts_eur_present_on_every_rule():
    rules = build_rules()
    assert len(rules) == 421
    assert all("amounts" in r and "amountsEur" in r for r in rules)


# --- Cause C: totalScope records which subtotals the TOTAL actually sums ---

def test_total_scope_distribution_matches_the_diagnosed_counts():
    # The brief's own tally across all 421 rows, from Sf's own-row P/Q/R
    # references: P+Q+R 174, P 102, P+Q 97, direct 36 (of which 30 reduce to
    # a known shape, 6 don't), Q+R 8, Q 4.
    rules = build_rules()
    from collections import Counter
    cnt = Counter(r["totalScope"]["scope"] for r in rules)
    assert cnt["P+Q+R"] == 174
    assert cnt["P"] == 102
    assert cnt["P+Q"] == 97
    assert cnt["Q+R"] == 8
    assert cnt["Q"] == 4
    assert cnt["direct"] == 30
    assert cnt["unparsed"] == 6
    assert sum(cnt.values()) == 421


def test_belgium_row_35_is_a_direct_gated_flat_total():
    # Sf: IF(O35=0,"",IF(O35>1,K35,F35)) -- references neither P, Q nor R of
    # its own row. The total is one flat fee for the whole row, gated on its
    # own type's count (O -> II), not a sum of subtotals.
    ts = extract_total_scope(ROWS[35])
    assert ts == {"scope": "direct", "direct": {"kind": "gatedFlat", "gate": "II"}}


def test_uk_row_400_total_is_a_constant_zero():
    # Sf: IF(M400=0,"",0) -- the P subtotal on this row is a real fee, but
    # the TOTAL is deliberately zero whenever the row applies at all.
    ts = extract_total_scope(ROWS[400])
    assert ts == {"scope": "direct", "direct": {"kind": "const", "gate": "IA", "value": 0.0}}


def test_spain_row_154_total_ignores_count_entirely():
    # Sf: F154+((L154-1)*G154) -- no M/N/O reference at all, gated only by
    # ISBLANK(L154). The total depends on strengths, never on how many
    # variations were filed.
    ts = extract_total_scope(ROWS[154])
    assert ts == {"scope": "direct", "direct": {"kind": "leadPlusStrengths"}}


def test_denmark_row_98_is_reported_unparsed_not_invented():
    # Sf: IF(M98=0,"",IF(M98>1,"",F98)) -- the M>1 branch is Excel-blank, not
    # a number. That is not one of the three known direct shapes, so per the
    # faithfulness rule it must be reported, not approximated as 0 or as F.
    ts = extract_total_scope(ROWS[98])
    assert ts["scope"] == "unparsed"
    assert "formula" in ts


def test_denmark_row_99_is_also_unparsed():
    # Sf: IF(M99=0,"",IF(M99<2,"",K99)) -- blank at count==1, unlike
    # Belgium's shape which returns F there. Must not be folded into
    # "gatedFlat" just because it superficially resembles it.
    ts = extract_total_scope(ROWS[99])
    assert ts["scope"] == "unparsed"


def test_a_p_plus_q_r_scope_row_is_read_off_its_own_sf():
    # NO row 321 (IB, standard): Sf sums its own P and Q, no R.
    ts = extract_total_scope(ROWS[321])
    assert ts["scope"] == "P+Q"
