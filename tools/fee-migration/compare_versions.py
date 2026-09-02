"""Compares OLD (origin/main, v1.6.7) vs NEW (current working tree, v1.18.0)
fee-engine results over the shared input matrix.

Does NOT touch variation-fee-calculator/ at all: the old engine files are
extracted with `git show` into tools/fee-migration/out/old/, next to a copy
of harness.html whose <script src> paths point there instead.

Both sides run over exactly the same matrix (built once, from the CURRENT
fee rows) so the comparison is meaningful. Differences (by grandTotal, with
per-country totals where they differ) are written to
tools/fee-migration/out/version-comparison.csv.

This script only measures and reports; it makes no judgement about which
side is "right".

Usage:
    python tools/fee-migration/compare_versions.py --quick
    python tools/fee-migration/compare_versions.py
"""

import csv
import subprocess
import sys
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

# Never let a stray __pycache__ land in the plugin folder or here -- one such
# folder has already corrupted a release ZIP before.
sys.dont_write_bytecode = True

from playwright.sync_api import sync_playwright  # noqa: E402

from feedata import load_fee_rows  # noqa: E402
from matrix import build_matrix  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent  # D:\Claude\Variation Fee Calculator
OUT = HERE / "out"
OLD_DIR = OUT / "old"
OLD_REF = "origin/main"
OLD_JS_PATH = "variation-fee-calculator/assets/js"

TOLERANCE = 0.005  # EUR -- below this is float noise, not a real difference

CSV_HEADER = [
    "n", "cc", "role", "strengths", "ia", "ib", "ii",
    "specialIA", "specialIB", "specialII",
    "kind", "totalOld", "totalNew", "diff",
]


# --- Step 1: extract the OLD engine files without touching the working tree ---

def extract_old_files():
    OLD_DIR.mkdir(parents=True, exist_ok=True)
    for fname in ("vcl-calc-data.js", "vcl-calc-app.js"):
        blob = subprocess.run(
            ["git", "show", f"{OLD_REF}:{OLD_JS_PATH}/{fname}"],
            cwd=REPO_ROOT, capture_output=True, check=True,
        ).stdout
        (OLD_DIR / fname).write_bytes(blob)


# --- Step 2: a harness.html that points at the extracted OLD files ---

OLD_HARNESS = OLD_DIR / "harness-old.html"


def write_old_harness():
    src = (HERE / "harness.html").read_text(encoding="utf-8")
    src = src.replace(
        '<script src="../../variation-fee-calculator/assets/js/vcl-calc-data.js"></script>',
        '<script src="vcl-calc-data.js"></script>',
    ).replace(
        '<script src="../../variation-fee-calculator/assets/js/vcl-calc-app.js"></script>',
        '<script src="vcl-calc-app.js"></script>',
    )
    OLD_HARNESS.write_text(src, encoding="utf-8")


NEW_HARNESS = (HERE / "harness.html").resolve().as_uri()


@contextmanager
def open_engine(page_uri):
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("**", lambda route: route.continue_()
                   if route.request.url.startswith("file://") else route.abort())
        page.on("pageerror", lambda e: errors.append(e.message))
        page.goto(page_uri)
        try:
            page.wait_for_function(
                "() => typeof window.VCLCALC?.computeFees === 'function'",
                timeout=10000)
            ok = True
        except Exception:
            ok = False
        try:
            yield page, errors, ok
        finally:
            browser.close()


_EVAL = """(entries) => entries.map((e) => {
    try {
        const r = window.VCLCALC.computeFees({
            countries: [{ cc: e.cc, role: e.role, strengths: e.strengths, special: e.special }],
            counts: e.counts
        });
        return { ok: true, grandTotal: r.grandTotal,
                 countries: r.countries.map((cr) => ({ cc: cr.cc, total: cr.total })) };
    } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
    }
})"""

BATCH = 500


def run_matrix(page_uri, entries, label):
    """Returns list of per-entry result dicts, in the same order as entries."""
    out = []
    with open_engine(page_uri) as (page, errors, loaded):
        if not loaded:
            print(f"  WARNUNG: {label} -- computeFees nie verfuegbar geworden "
                  f"({errors[:3] if errors else 'kein pageerror'})", file=sys.stderr)
            return [{"ok": False, "error": "engine-not-loaded"} for _ in entries]
        for i in range(0, len(entries), BATCH):
            batch = entries[i:i + BATCH]
            results = page.evaluate(_EVAL, batch)
            if len(results) != len(batch):
                raise RuntimeError(f"{label} batch {i}: {len(results)}/{len(batch)}")
            out.extend(results)
            print(f"  {label}: {i + len(batch)}/{len(entries)}", end="\r", flush=True)
        print()
        if errors:
            print(f"  {label} Seitenfehler: {sorted(set(errors))[:5]}", file=sys.stderr)
    return out


def main():
    quick = "--quick" in sys.argv

    print("Extrahiere ALT-Stand (origin/main) nach", OLD_DIR)
    extract_old_files()
    write_old_harness()

    print("Baue Matrix aus aktuellen Gebuehrenzeilen...")
    entries = build_matrix(load_fee_rows())
    if quick:
        entries = entries[::max(1, len(entries) // 200)][:200]
    print(f"  {len(entries)} Kombinationen")

    old_results = run_matrix(OLD_HARNESS.as_uri(), entries, "ALT")
    new_results = run_matrix(NEW_HARNESS, entries, "NEU")

    OUT.mkdir(exist_ok=True)
    csv_path = OUT / "version-comparison.csv"

    diffs = []
    by_country = Counter()
    errors_old = errors_new = 0
    n_checked = 0
    n_diff = 0

    for n, (entry, ro, rn) in enumerate(zip(entries, old_results, new_results)):
        cc = entry["cc"]
        base = {
            "n": n, "cc": cc, "role": entry["role"], "strengths": entry["strengths"],
            "ia": entry["counts"]["IA"], "ib": entry["counts"]["IB"], "ii": entry["counts"]["II"],
            "specialIA": entry["special"].get("IA") or "",
            "specialIB": entry["special"].get("IB") or "",
            "specialII": entry["special"].get("II") or "",
        }

        if not ro.get("ok"):
            errors_old += 1
            diffs.append({**base, "kind": "old-error",
                           "totalOld": ro.get("error", ""), "totalNew": "", "diff": ""})
            by_country[cc] += 1
            n_checked += 1
            continue
        if not rn.get("ok"):
            errors_new += 1
            diffs.append({**base, "kind": "new-error",
                           "totalOld": "", "totalNew": rn.get("error", ""), "diff": ""})
            by_country[cc] += 1
            n_checked += 1
            continue

        n_checked += 1
        to, tn = ro["grandTotal"] or 0, rn["grandTotal"] or 0
        d = tn - to
        if abs(d) > TOLERANCE:
            n_diff += 1
            by_country[cc] += 1
            diffs.append({**base, "kind": "total",
                           "totalOld": f"{to:.2f}", "totalNew": f"{tn:.2f}",
                           "diff": f"{d:.2f}"})
            # Per-country breakdown, only for the countries that actually differ.
            old_by_cc = {c["cc"]: c["total"] or 0 for c in ro.get("countries", [])}
            new_by_cc = {c["cc"]: c["total"] or 0 for c in rn.get("countries", [])}
            for ccode in set(old_by_cc) | set(new_by_cc):
                oc, nc = old_by_cc.get(ccode, 0), new_by_cc.get(ccode, 0)
                dc = nc - oc
                if abs(dc) > TOLERANCE:
                    diffs.append({**base, "kind": f"country:{ccode}",
                                  "totalOld": f"{oc:.2f}", "totalNew": f"{nc:.2f}",
                                  "diff": f"{dc:.2f}"})

    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_HEADER)
        w.writeheader()
        for row in diffs:
            w.writerow(row)

    print(f"\nGeprueft: {n_checked} Kombinationen")
    print(f"Abweichend (Gesamtbetrag): {n_diff}")
    print(f"ALT-Fehler (keine Daten/Exception im alten Stand): {errors_old}")
    print(f"NEU-Fehler (keine Daten/Exception im neuen Stand): {errors_new}")
    print(f"CSV geschrieben: {csv_path} ({len(diffs)} Zeilen)")
    print("\nAbweichungen nach Land (nur Zaehlung):")
    for cc, cnt in by_country.most_common():
        print(f"  {cc}: {cnt}")


if __name__ == "__main__":
    main()
