"""Reference evaluator for fee-rules.json.

Throwaway by design: its only job is to prove the rule model reproduces the
current engine. The production implementation lands in PHP in Baustein B.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TYPES = ("IA", "IB", "II")
_RATE = {"IA": "rateIA", "IB": "rateIB", "II": "rateII"}

# Maps a cap scope letter to the per-type subtotal it names. "P" is the
# Type IA subtotal, "Q" is Type IB, "R" is Type II -- the real data uses
# five combinations of these: P, Q, P+Q, Q+R, P+Q+R.
_SCOPE_LETTER_TO_TYPE = {"P": "IA", "Q": "IB", "R": "II"}


def load_rules():
    return json.loads((HERE / "out" / "fee-rules.json").read_text(encoding="utf-8"))


def _pick(rules, cc, role, type_, special):
    cands = [r for r in rules if r["cc"] == cc and r["role"] == role and r["type"] == type_]
    if not cands:
        return None
    if special:
        for r in cands:
            if r["special"] == special:
                return r
    # Mirrors resolveRow: the "no special" branch is dead code in the current
    # engine (no row has an empty special), so the first row wins (spec B3).
    return cands[0]


def _leading_type(counts):
    for t in reversed(TYPES):
        if counts.get(t, 0) > 0:
            return t
    return None


def _active_counts(rule, type_, counts):
    """Subsumption: the highest present type absorbs the lower ones."""
    lead = _leading_type(counts)
    if type_ != lead:
        return {"IA": 0, "IB": 0, "II": 0}
    gate = rule["select"]["activeWhen"]
    if gate:
        n = counts.get(gate["type"], 0)
        if "min" in gate and n < gate["min"]:
            return {"IA": 0, "IB": 0, "II": 0}
        if "max" in gate and n > gate["max"]:
            return {"IA": 0, "IB": 0, "II": 0}
    if type_ == "II":
        return dict(counts)
    if type_ == "IB":
        return {"IA": counts.get("IA", 0), "IB": counts.get("IB", 0), "II": 0}
    return {"IA": counts.get("IA", 0), "IB": 0, "II": 0}


def _part(rule, type_, n, strengths):
    """One type's contribution under the row's rule."""
    if n <= 0:
        return 0.0
    a = rule["amounts"]
    g = a.get("perStrength") or 0.0
    rate = a.get(_RATE[type_]) or 0.0
    lead = a.get("lead") or 0.0
    is_lead = type_ == rule["type"]
    step = (strengths - 1) * g

    if rule["rule"] == "scaling":
        first = (lead if is_lead else rate) + step
        return first + (rate + step) * (n - 1)
    if rule["rule"] == "flat_from_second":
        flat = a.get("flat")
        return (flat if (n > 1 and flat is not None) else lead)
    if rule["rule"] == "per_count_tiered":
        return n * lead if n < 3 else 2 * lead + (n - 2) * rate
    if rule["rule"] == "per_strength_tiered":
        # First approximation: the Excel shape (IE) takes the third-and-further
        # strength rate from a NEIGHBOURING row, which the rule model does not
        # carry yet. Left deliberately simple -- the comparison in Task 8 is what
        # decides whether an explicit field for it is needed.
        per = lead if strengths == 1 else lead * 2 + (strengths - 2) * lead
        return per * n
    # evaluate() handles "unknown" before calling _part(); any other
    # unrecognised rule name reaching here is a bug in the rule model, not a
    # legitimate case to paper over with a silent 0.0.
    raise ValueError(f"unrecognised rule {rule['rule']!r} for row {rule['row']!r}")


def _scope_sum(scope, parts):
    """Sum the per-type subtotals named by a cap scope string like "Q+R".

    Handles any combination of P/Q/R generically instead of hard-coding the
    three shapes the brief covers (P, P+Q, P+Q+R) -- the real rules also use
    Q and Q+R alone. A scope component this doesn't recognise raises, rather
    than silently falling back to the full P+Q+R total (that fallback was
    the brief's original bug: an unhandled scope would go undetected).
    """
    total = 0.0
    for letter in scope.split("+"):
        if letter not in _SCOPE_LETTER_TO_TYPE:
            raise ValueError(f"unrecognised cap scope component {letter!r} in {scope!r}")
        total += parts[_SCOPE_LETTER_TO_TYPE[letter]]
    return total


def _cap_limit(value, strengths, rule):
    """The numeric ceiling for one cap "value" shape, or None if unrecognised."""
    if "const" in value:
        return value["const"]
    if "byStrength" in value:
        return value["byStrength"]["1"] if strengths == 1 else value["byStrength"]["else"]
    if "multipleOfLead" in value:
        return value["multipleOfLead"] * (rule["amounts"].get("lead") or 0.0)
    if "points" in value:
        return value["points"] * value["pointValue"]
    return None


def _apply_cap(rule, parts, strengths):
    """Apply the row's ceiling (if any) and surcharge (if any) to its parts.

    Mirrors the Excel shape IF(sum > cap, cap, sum + surcharge): the
    comparison is made against the sum WITHOUT the surcharge. When the
    ceiling binds, the surcharge is dropped entirely and the result is the
    ceiling alone. When it does not bind, the surcharge is added and the
    result may legitimately exceed the ceiling (e.g. 4000 + 390 = 4390 >
    4150) -- that is correct, not a bug. A naive min(sum, cap) + surcharge
    would apply the surcharge even when the ceiling binds, which the real
    formula never does.
    """
    surcharge = rule.get("surcharge") or 0.0
    total = parts["IA"] + parts["IB"] + parts["II"]
    cap = rule.get("cap")
    # Rows 98 and 109 (both Denmark) carry an "unparsed" cap with no usable
    # ceiling; treat them as uncapped and don't read their "scope".
    if not cap or "unparsed" in cap:
        return total + surcharge, None
    limit = _cap_limit(cap["value"], strengths, rule)
    if limit is None:
        return total + surcharge, None
    subject = _scope_sum(cap["scope"], parts)
    if subject > limit:
        return limit, limit
    return total + surcharge, None


def evaluate(rules, cc, role, strengths, special, counts):
    items = []
    for t in TYPES:
        if counts.get(t, 0) <= 0:
            continue
        rule = _pick(rules, cc, role, t, (special or {}).get(t))
        if not rule:
            continue
        if rule["rule"] == "unknown":
            # The rule extractor could not classify this row's Excel formula
            # (17 Denmark rows, a deliberate, reported gap in the study --
            # not a defect). Emit a marker instead of inventing a euro
            # amount, so the Task 8 comparison can tell "uncomputable" apart
            # from an ordinary numeric mismatch.
            items.append({
                "row": rule["row"], "type": t,
                "total": None,
                "rawSumSingle": None,
                "subsumed": None,
                "count": counts.get(t, 0),
                "capValue": None,
                "groupingFee": None,
                "uncomputable": True,
            })
            continue
        act = _active_counts(rule, t, counts)
        parts = {x: _part(rule, x, act.get(x, 0), strengths) for x in TYPES}
        raw = parts["IA"] + parts["IB"] + parts["II"]
        total, cap_value = _apply_cap(rule, parts, strengths)
        subsumed = sum(act.values()) == 0
        items.append({
            "row": rule["row"], "type": t,
            "total": None if subsumed else round(total, 2),
            "rawSumSingle": round(raw, 2),
            "subsumed": subsumed,
            "count": counts.get(t, 0),
            "capValue": None if cap_value is None else round(cap_value, 2),
            "groupingFee": rule["amounts"].get("flat")
                           if rule["rule"] == "flat_from_second" and sum(act.values()) > 1 else None,
            "uncomputable": False,
        })
    return items
