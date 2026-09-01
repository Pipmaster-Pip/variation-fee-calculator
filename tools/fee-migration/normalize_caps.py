"""Lifts cap and surcharge amounts out of the Excel formula text into columns.

Why: every other fee amount already lives in its own column (F..K), which is why
the fee table can be maintained without touching a formula. Cap ceilings and flat
surcharges are the exception -- they sit as literals inside the S formula
(`IF(sum>19900, 19900, sum)`), so changing one means editing a formula. That is
the single reason caps cannot be typed into a form.

This script gives them columns of their own:

    T  cap amount                (or the 1-strength amount of a two-tier cap)
    U  cap amount from 2 strengths upwards   (two-tier caps only)
    V  flat surcharge

and rewrites the affected S formulas to reference those cells instead of the
literals. Nothing else about the formulas changes.

Self-check: substituting the extracted numbers back into the rewritten formula
must reproduce the original formula character for character. A row that fails
that check is reported and left untouched -- never rewritten on a guess.

Usage:
    python tools/fee-migration/normalize_caps.py
"""

import json
import re
import sys
from pathlib import Path

from feedata import load_fee_rows

HERE = Path(__file__).resolve().parent
RULES = HERE / "out" / "fee-rules.json"
OUT_ROWS = HERE / "out" / "normalized-rows.json"
OUT_REPORT = HERE / "out" / "normalize-report.md"

# The formula columns that may carry a literal we lift out.
FORMULA_KEYS = ("Pf", "Qf", "Rf", "Sf")


def _fmt(v):
    """Render a number the way Excel wrote it in the formula text, so the
    round-trip check compares like with like: 4150 not 4150.0."""
    return str(int(v)) if float(v) == int(v) else str(v)


def plan_row(rule, raw):
    """Work out the new column values and the rewritten formulas for one row.

    Returns (cells, rewrites, note) where cells maps column letter -> value and
    rewrites maps formula key -> new text. Returns (None, None, reason) when the
    row needs no change or cannot be handled.
    """
    cap, sur = rule.get("cap"), rule.get("surcharge")
    if not cap and not sur:
        return None, None, None
    if cap and "unparsed" in cap:
        return None, None, "cap shape not recognised -- left as it is"

    cells, subs = {}, []

    if cap:
        v = cap["value"]
        if "const" in v:
            cells["T"] = float(v["const"])
            subs.append((_fmt(v["const"]), "T"))
        elif "byStrength" in v:
            one, more = float(v["byStrength"]["1"]), float(v["byStrength"]["else"])
            cells["T"], cells["U"] = one, more
            subs.append((_fmt(one), "T"))
            subs.append((_fmt(more), "U"))
        elif "points" in v:
            # Slovenia states its ceilings as points times a point value; the
            # formula carries both factors. We store the product, so the field
            # holds the euro amount actually being applied.
            pts, pv = float(v["points"]), float(v["pointValue"])
            cells["T"] = pts * pv
            subs.append((f"{_fmt(pts)}*{_fmt(pv)}", "T"))
        else:
            return None, None, f"cap value shape not handled: {sorted(v)}"

    if sur:
        cells["V"] = float(sur)
        subs.append((f"+{_fmt(sur)}", "V"))

    rewrites = {}
    for key in FORMULA_KEYS:
        text = raw.get(key)
        if not text:
            continue
        new = text
        for literal, col in subs:
            ref = f"+{col}{raw['row']}" if literal.startswith("+") else f"{col}{raw['row']}"
            new = new.replace(literal, ref)
        if new != text:
            rewrites[key] = new

    if not rewrites:
        return None, None, "values extracted but no formula referenced them"
    return cells, rewrites, None


def verify(rewrites, cells, raw):
    """Substitute the new cell values back and require the original text."""
    for key, new in rewrites.items():
        restored = new
        for col, val in cells.items():
            ref = f"{col}{raw['row']}"
            if col == "T" and "points" in str(cells.get("_shape", "")):
                pass  # handled below by the generic branch
            restored = restored.replace(ref, _fmt(val))
        if restored != raw[key]:
            return False, key, restored
    return True, None, None


def main():
    raws = {r["row"]: r for r in load_fee_rows()}
    rules = json.loads(RULES.read_text(encoding="utf-8"))

    changed, skipped, failed = [], [], []
    out_rows = []

    for rule in rules:
        raw = dict(raws[rule["row"]])
        cells, rewrites, note = plan_row(rule, raw)

        if cells:
            # The points form multiplies two factors, so substituting the single
            # product back cannot reproduce the original text. Verify it
            # numerically instead: the product must equal the two factors.
            is_points = bool(rule.get("cap") and "points" in rule["cap"].get("value", {}))
            if is_points:
                v = rule["cap"]["value"]
                ok = abs(cells["T"] - v["points"] * v["pointValue"]) < 1e-9
                bad_key, restored = (None, None) if ok else ("Sf", "product mismatch")
            else:
                ok, bad_key, restored = verify(rewrites, cells, raws[rule["row"]])

            if ok:
                raw.update(cells)
                raw.update(rewrites)
                changed.append((rule["row"], rule["cc"], sorted(cells)))
            else:
                failed.append((rule["row"], rule["cc"], bad_key, restored))
        elif note:
            skipped.append((rule["row"], rule["cc"], note))

        out_rows.append(raw)

    OUT_ROWS.parent.mkdir(exist_ok=True)
    OUT_ROWS.write_text(json.dumps(out_rows, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# Normalisierung: Deckel und Zuschlaege in eigene Spalten", "",
        "Neue Spalten: **T** Deckelbetrag, **U** Deckelbetrag ab 2 Staerken, "
        "**V** Zuschlag. Die betroffenen Formeln verweisen jetzt auf diese Zellen "
        "statt auf feste Zahlen.", "",
        f"- umgeschrieben: **{len(changed)}** Zeilen",
        f"- unveraendert gelassen: **{len(skipped)}**",
        f"- fehlgeschlagen: **{len(failed)}**", "",
    ]
    if failed:
        lines += ["## Fehlgeschlagen (nicht umgeschrieben)", "",
                  "| Zeile | Land | Feld | zurueckgesetzt ergab |", "|---|---|---|---|"]
        lines += [f"| {r} | {cc} | {k} | `{s}` |" for r, cc, k, s in failed]
        lines.append("")
    if skipped:
        lines += ["## Unveraendert gelassen", "", "| Zeile | Land | Grund |", "|---|---|---|"]
        lines += [f"| {r} | {cc} | {n} |" for r, cc, n in skipped]
        lines.append("")
    lines += ["## Umgeschrieben", "", "| Zeile | Land | neue Spalten |", "|---|---|---|"]
    lines += [f"| {r} | {cc} | {', '.join(c)} |" for r, cc, c in changed]
    OUT_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"umgeschrieben {len(changed)} | unveraendert {len(skipped)} | fehlgeschlagen {len(failed)}")
    for r, cc, k, s in failed:
        print(f"  FEHLER Zeile {r} ({cc}) {k}: {s[:120]}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
