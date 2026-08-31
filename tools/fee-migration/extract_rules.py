"""Derives declarative rules from the Excel formulas in vcl-calc-data.js.

Faithful by design: this reproduces today's behaviour, quirks included. Where a
row does something the model does not cover, it is reported -- never guessed at.
"""

import re
from pathlib import Path

# Re-exported so the extractor's tests and callers have one import site.
# The reader itself lives in feedata.py (Task 2) -- one loader, one truth.
from feedata import load_fee_rows  # noqa: F401

HERE = Path(__file__).resolve().parent


def _global_refs(formula, own_row):
    """Row numbers this formula reads that are neither row 2 nor its own row."""
    return sorted({
        int(r) for _c, r in re.findall(r"([A-Z]{1,2})(\d+)", formula)
        if int(r) not in (2, own_row)
    })


def extract_select(row):
    """Reads Mf/Nf/Of into a selection descriptor."""
    own = row["row"]
    mf = row.get("Mf") or ""

    active = None
    gate = re.search(r"IF\(M2([<>])(\d+),0,", mf.replace(" ", ""))
    if gate:
        op, n = gate.group(1), int(gate.group(2))
        # ">1 -> 0" means the row only applies at exactly one; "<2 -> 0" means
        # it only starts at two.
        active = {"type": "IA", "max": n} if op == ">" else {"type": "IA", "min": n}

    anomalies = []
    for key in ("Mf", "Nf", "Of"):
        f = row.get(key)
        if not f:
            continue
        foreign = _global_refs(f, own)
        if foreign:
            anomalies.append(f"{key} reads foreign row(s) {foreign} instead of row 2")

    anomaly = "; ".join(anomalies) if anomalies else None
    return {"subsumption": "highest-type-wins", "activeWhen": active, "anomaly": anomaly}


_AMOUNT_KEYS = {"lead": "F", "perStrength": "G", "rateIA": "H",
                "rateIB": "I", "rateII": "J", "flat": "K"}


def extract_amounts(row):
    """Excel column letters become names. Local-currency rows keep their own
    currency: F..K are derived from F_lc..K_lc at runtime via the FX rate, so
    the *_lc values are the authoritative ones (spec B2)."""
    local = row.get("currency")
    out = {"currency": local or "EUR"}
    for name, col in _AMOUNT_KEYS.items():
        src = f"{col}_lc" if local else col
        out[name] = row.get(src)
    return out


def _norm(formula, own_row):
    """Own-row refs to %, row-2 refs to §, anything else to @ -- so shapes can
    be compared without their absolute row numbers."""
    def rep(m):
        col, r = m.group(1), int(m.group(2))
        return col + ("%" if r == own_row else ("§" if r == 2 else "@"))
    return re.sub(r"([A-Z]{1,2})(\d+)", rep, formula.replace(" ", ""))


def classify_rule(row):
    own = row["row"]
    parts = [row.get(k) for k in ("Pf", "Qf", "Rf") if row.get(k)]
    if not parts:
        return {"rule": "unknown", "evidence": "no P/Q/R formula on this row"}
    body = " ".join(_norm(p, own) for p in parts)

    # First N at full price, then a reduced rate -- over counts (EMA) ...
    if re.search(r"IF\([MNO]%<\d+,[MNO]%\*[FHIJ][%@],\d+\*[FHIJ][%@]\+\([MNO]%-\d+\)", body):
        return {"rule": "per_count_tiered", "evidence": "IF(count<n, count*F, n*F+(count-n)*J)"}

    # ... or over strengths (IE)
    if re.search(r"IF\(L%=1,[FHIJ][%@]\*[MNO]%,IF\(L%>\d+", body):
        return {"rule": "per_strength_tiered", "evidence": "IF(L=1, F*count, tiered by strength)"}

    # A flat grouped fee replaces the per-variation arithmetic from the second on
    if re.search(r">1,K[%@]", body) or re.search(r"K[%@]\+\(L%-1\)", body):
        return {"rule": "flat_from_second", "evidence": "count>1 branch returns K"}

    # Lead variation at full price, each further one at its own rate,
    # every strength adding G
    if re.search(r"\([FHIJ][%@]\+\(L%-1\)\*G[%@]\)", body):
        return {"rule": "scaling", "evidence": "(rate + (L-1)*G) * (count-1) shape"}

    return {"rule": "unknown", "evidence": f"unmatched shape: {body[:160]}"}
