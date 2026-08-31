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
