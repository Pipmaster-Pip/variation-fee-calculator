"""Single reader for the fee table. Shared by the matrix and the extractor so
both always see the same 421 rows."""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = (HERE / ".." / ".." / "variation-fee-calculator" / "assets" / "js"
        / "vcl-calc-data.js").resolve()


def load_fee_rows():
    src = DATA.read_text(encoding="utf-8")
    m = re.search(r"FEE_ROWS:\s*(\[.*?\}\]),\n", src, re.S)
    if not m:
        raise RuntimeError(f"FEE_ROWS not found in {DATA}")
    return json.loads(m.group(1))


def load_static_fx_rates():
    """The runtime's static fallback rates (1 EUR = X local units), keyed by
    country code. Read from the same source file rather than hard-coded, so
    the rule model can never drift from what the shipped calculator actually
    falls back to (spec B: cause B)."""
    src = DATA.read_text(encoding="utf-8")
    m = re.search(r"STATIC_FX_RATES:\s*(\{[^}]*\}),", src)
    if not m:
        raise RuntimeError(f"STATIC_FX_RATES not found in {DATA}")
    return json.loads(m.group(1))
