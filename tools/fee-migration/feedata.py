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
