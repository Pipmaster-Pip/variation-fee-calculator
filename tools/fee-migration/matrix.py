"""The input space the golden master and the comparison both run over.

Built once, here, so the two can never drift apart.
"""

from itertools import product

TYPES = ("IA", "IB", "II")
STRENGTHS = (1, 2, 3, 5, 10)
MAX_COUNT = 3


def _variants_by_pair(fee_rows):
    """Each (cc, role) with the special-case variants it offers per type."""
    by_type = {}
    for r in fee_rows:
        by_type.setdefault((r["cc"], r["role"], r["type"]), []).append(r["special"])
    pairs = {}
    for r in fee_rows:
        key = (r["cc"], r["role"])
        entry = pairs.setdefault(key, {"cc": r["cc"], "role": r["role"], "byType": {}})
        entry["byType"][r["type"]] = by_type[(r["cc"], r["role"], r["type"])]
    return list(pairs.values())


def _count_combos():
    return [{"IA": a, "IB": b, "II": c}
            for a, b, c in product(range(MAX_COUNT + 1), repeat=3) if a or b or c]


def _special_combos(by_type):
    """Cartesian product of the special-case choices across the three types."""
    types = [t for t in TYPES if t in by_type]
    if not types:
        return [{}]
    return [dict(zip(types, picks))
            for picks in product(*(by_type[t] for t in types))]


def build_matrix(fee_rows):
    counts = _count_combos()
    out = []
    for pair in _variants_by_pair(fee_rows):
        for special in _special_combos(pair["byType"]):
            for c in counts:
                for strengths in STRENGTHS:
                    out.append({"cc": pair["cc"], "role": pair["role"],
                                "strengths": strengths, "special": special,
                                "counts": c})
    return out
