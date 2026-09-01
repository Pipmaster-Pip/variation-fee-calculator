"""Proves the cap/surcharge normalisation changes no result.

Builds a patched copy of the calculator -- normalised fee rows plus the one-line
engine change that lets the formula interpreter resolve the new T/U/V columns --
runs the full input matrix against it, and compares the output to the golden
master recorded from the untouched calculator.

Nothing under variation-fee-calculator/ is modified. The patched copies live in
out/ and exist only for this proof.

Usage:
    python tools/fee-migration/verify_normalization.py
"""

import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from feedata import DATA, load_fee_rows
from matrix import build_matrix
from golden import HEADER, format_run, BATCH, _EVAL

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
APP = (HERE / ".." / ".." / "variation-fee-calculator" / "assets" / "js"
       / "vcl-calc-app.js").resolve()

PATCHED_DATA = OUT / "vcl-calc-data.normalized.js"
PATCHED_APP = OUT / "vcl-calc-app.patched.js"
PATCHED_PAGE = OUT / "harness-normalized.html"
NEW_GOLDEN = OUT / "golden-normalized.csv.gz"

# The interpreter reads constant per-row columns from this list. T/U/V behave
# exactly like F..K -- a number sitting in the row -- so they belong here.
OLD_COLS = "if (['F','G','H','I','J','K'].includes(letter)) {"
NEW_COLS = "if (['F','G','H','I','J','K','T','U','V'].includes(letter)) {"


def build_patched_data():
    src = DATA.read_text(encoding="utf-8")
    rows = json.loads((OUT / "normalized-rows.json").read_text(encoding="utf-8"))
    m = re.search(r"(FEE_ROWS:\s*)(\[.*?\}\])(,\n)", src, re.S)
    if not m:
        raise RuntimeError("FEE_ROWS block not found")
    patched = src[:m.start(2)] + json.dumps(rows, ensure_ascii=False) + src[m.end(2):]
    PATCHED_DATA.write_text(patched, encoding="utf-8")


def build_patched_app():
    src = APP.read_text(encoding="utf-8")
    if OLD_COLS not in src:
        raise RuntimeError("column list not found in vcl-calc-app.js -- did it change?")
    PATCHED_APP.write_text(src.replace(OLD_COLS, NEW_COLS, 1), encoding="utf-8")


def build_page():
    """Same DOM as harness.html, pointing at the patched copies."""
    ids = ["vclcalc-app", "vclcalc-rail", "vclcalc-stepContent", "vclcalc-fxStatus",
           "vclcalc-headerTag", "vclcalc-typeCounters", "vclcalc-countryDetailList",
           "vclcalc-specialPanel", "vclcalc-specialBlocks", "vclcalc-changelogPanel",
           "vclcalc-haWebsitesPanel", "vclcalc-strengthsNote"]
    buttons = ["vclcalc-selectAll", "vclcalc-resetSelection", "vclcalc-restart",
               "vclcalc-strengthsReset", "vclcalc-toStep2", "vclcalc-toStep3",
               "vclcalc-toResult", "vclcalc-back1", "vclcalc-back2", "vclcalc-back3",
               "vclcalc-toggleChangelog", "vclcalc-toggleHaWebsites"]
    body = "".join(f'<div id="{i}"></div>' for i in ids)
    body += '<input id="vclcalc-countrySearch">'
    body += "".join(f'<button id="{b}"></button>' for b in buttons)
    PATCHED_PAGE.write_text(
        "<!doctype html><meta charset=\"utf-8\"><title>normalised harness</title>"
        + body
        + f'<script src="{PATCHED_DATA.name}"></script>'
        + f'<script src="{PATCHED_APP.name}"></script>',
        encoding="utf-8")


def record():
    entries = build_matrix(load_fee_rows())
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("**", lambda r: r.continue_()
                   if r.request.url.startswith("file://") else r.abort())
        page.on("pageerror", lambda e: errors.append(e.message))
        page.goto(PATCHED_PAGE.as_uri())
        page.wait_for_function("() => typeof window.VCLCALC?.computeFees === 'function'")
        import csv
        with gzip.open(NEW_GOLDEN, "wt", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(HEADER.split(","))
            for i in range(0, len(entries), BATCH):
                batch = entries[i:i + BATCH]
                results = page.evaluate(_EVAL, batch)
                if len(results) != len(batch):
                    raise RuntimeError(f"batch {i}: {len(results)} results for {len(batch)} inputs")
                for j, (entry, res) in enumerate(zip(batch, results)):
                    for fields in format_run(i + j, entry, res):
                        w.writerow(fields)
                print(f"  {i + len(batch)}/{len(entries)}", end="\r", flush=True)
        browser.close()
    if errors:
        print("\nSeitenfehler:", sorted(set(errors))[:5], file=sys.stderr)
        sys.exit(1)


def digest(path):
    h = hashlib.sha256()
    with gzip.open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    build_patched_data()
    build_patched_app()
    build_page()
    record()
    a, b = digest(OUT / "golden.csv.gz"), digest(NEW_GOLDEN)
    print(f"\noriginal    {a}")
    print(f"normalisiert {b}")
    if a == b:
        print("\nIDENTISCH -- die Normalisierung aendert kein einziges Ergebnis.")
        return 0
    print("\nABWEICHUNG -- die Normalisierung ist nicht verhaltensgleich.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
