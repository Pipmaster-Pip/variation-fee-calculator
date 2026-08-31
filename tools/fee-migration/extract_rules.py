"""Derives declarative rules from the Excel formulas in vcl-calc-data.js.

Faithful by design: this reproduces today's behaviour, quirks included. Where a
row does something the model does not cover, it is reported -- never guessed at.
"""

import re
from pathlib import Path

# Re-exported so the extractor's tests and callers have one import site.
# The reader itself lives in feedata.py (Task 2) -- one loader, one truth.
from feedata import load_fee_rows, load_static_fx_rates  # noqa: F401

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


def extract_amounts_eur(row, static_rates=None):
    """What the shipped engine actually computes with (cause B).

    applyLiveRatesToRows() in vcl-calc-app.js rewrites F..K as F_lc / rate,
    but only when a rate is available. The golden master was recorded with
    network access blocked, so LIVE_FX was always empty and the only rates
    available were STATIC_FX_RATES's three entries (HU, NO, SI). For every
    other local-currency country (CH, CZ, DK, IS, PL, RS, SE, UK) no rate
    existed, so F..K were never rewritten and kept the euro values already
    baked into vcl-calc-data.js at export time.

    This reproduces that runtime behaviour: F_lc / rate where a static rate
    exists for this row's country, otherwise the plain F..K columns as-is.
    `amounts` above is left untouched -- it stays the authoritative
    local-currency source value for a later editor to present.
    """
    if static_rates is None:
        static_rates = load_static_fx_rates()
    local = row.get("currency")
    rate = static_rates.get(row["cc"]) if local else None
    out = {"currency": local or "EUR"}
    for name, col in _AMOUNT_KEYS.items():
        if rate:
            lc = row.get(f"{col}_lc")
            out[name] = (lc / rate) if lc is not None else None
        else:
            out[name] = row.get(col)
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


_SCOPE_ORDER = "PQR"


def _cap_scope(sf, own):
    """Which subtotal(s) the ceiling's own comparison operand names.

    Read off the actual operand being compared (e.g. the "Q226+R226" in
    "IF((Q226+R226)>4150,...") instead of substring-matching a fixed list of
    two combinations -- that used to silently default every scope that wasn't
    exactly "P+Q+R" or "P+Q" to "P", including plain-Q and Q+R rows (IE
    224-236). Letters are returned P, Q, R in that order regardless of how
    they appeared in the formula, so scopes compare predictably downstream.
    """
    body = _norm(sf, own)
    m = re.search(r"\(?([PQR][%@§](?:\+[PQR][%@§])*)\)?>", body)
    if not m:
        return "P"
    letters = sorted(set(re.findall(r"[PQR]", m.group(1))), key=_SCOPE_ORDER.index)
    return "+".join(letters)


def extract_cap(row):
    """Reads the ceiling out of the S formula.

    Only the four shapes a form field can hold are accepted (spec B6). Anything
    else comes back as {"unparsed": ...} and lands in the report -- a ceiling
    nobody can type in does not meet the requirement, so it must not be hidden
    behind a special case in code.

    Searched generically across all rows: countries with a cap may be added and
    amounts change, so there is deliberately no country list here.
    """
    sf = row.get("Sf")
    if not sf:
        return None
    body = sf.replace(" ", "")
    own = row["row"]

    # Poland first: 2*F + (L-1)*F*0.8 is a grouping rule with a strength factor.
    # It only looks like a cap because of the ">" comparison (spec B6).
    if re.search(rf"F{own}\*0\.8", body):
        return None

    # Points x point value: IF(P>1500*5.8, 1500*5.8, P)  -- Slovenia.
    # The 5.8 is the point value from the 'Exchange rates' sheet, resolved by
    # convert.py at export time.
    pts = re.search(r">(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?),", body)
    if pts:
        return {"scope": _cap_scope(sf, own),
                "value": {"points": float(pts.group(1)), "pointValue": float(pts.group(2))}}

    # Strength-dependent: IF(L=1, IF(x>a,a,x), IF(x>b,b,x))
    two = re.findall(r">\(?(\d+(?:\.\d+)?)\)?,\1,", body)
    if f"L{own}=1" in body and len(two) >= 2:
        return {"scope": _cap_scope(sf, own),
                "value": {"byStrength": {"1": float(two[0]), "else": float(two[1])}}}

    # Multiple of the lead fee: IF(x>(2*F), 2*F, x)
    mult = re.search(rf">\((\d+)\*F{own}\)", body)
    if mult:
        return {"scope": _cap_scope(sf, own),
                "value": {"multipleOfLead": int(mult.group(1))}}

    # Plain amount: IF(x>19900, 19900, x)  -- Germany
    const = re.findall(r">(\d+(?:\.\d+)?),\1,", body)
    if const:
        return {"scope": _cap_scope(sf, own), "value": {"const": float(const[0])}}

    # A ">" that gates something other than this row's own flat fee (K<row>),
    # but matches none of the four enterable shapes -- report it rather than
    # invent a fifth form. Was `"K" not in body`, which never fired: every
    # Sf formula is wrapped in IF(ISBLANK(L<row>),...) and ISBLANK itself
    # contains a "K", so the bare-letter check was permanently false.
    if re.search(r"IF\([^)]*>[^,]+,", body) and f"K{own}" not in body:
        return {"scope": _cap_scope(sf, own), "unparsed": body[:200]}
    return None


def extract_surcharge(row):
    """A flat amount added on top of the sum, e.g. P+Q+77."""
    sf = row.get("Sf")
    if not sf:
        return None
    m = re.search(r"[PQR]\d+\+(\d+(?:\.\d+)?)\)", sf.replace(" ", ""))
    return float(m.group(1)) if m else None


def _direct_total(sf, own):
    """When Sf names none of this row's own P/Q/R, it computes the total some
    other way entirely. Only the shapes actually found in the data are
    accepted; anything else is reported as "unparsed" rather than guessed
    at (the same faithfulness rule as extract_cap's four shapes, spec C).

    Three shapes occur:
      - gatedFlat: IF(<gate>=0,"",IF(<gate>>1,K,F)) -- one flat fee for the
        whole row, gated on the row's own IA/IB/II count (26 Belgium rows).
      - const: IF(<gate>=0,"",<n>) -- a fixed number, not an amount column
        at all (2 UK rows, whose Total is always 0 even though their own P
        subtotal is a real fee).
      - leadPlusStrengths: F+((L-1)*G), unconditional on any count (2 Spain
        rows).
    """
    body = sf.replace(" ", "")

    m = re.search(
        rf'IF\((?P<gate>[MNO]){own}=0,"",IF\((?P=gate){own}>1,K{own},F{own}\)\)', body)
    if m:
        gate = {"M": "IA", "N": "IB", "O": "II"}[m.group("gate")]
        return {"kind": "gatedFlat", "gate": gate}

    m = re.search(rf'IF\((?P<gate>[MNO]){own}=0,"",(\d+(?:\.\d+)?)\)', body)
    if m:
        gate = {"M": "IA", "N": "IB", "O": "II"}[m.group("gate")]
        return {"kind": "const", "gate": gate, "value": float(m.group(2))}

    if re.search(rf"F{own}\+\(\(L{own}-1\)\*G{own}\)", body):
        return {"kind": "leadPlusStrengths"}

    return {"kind": "unparsed", "formula": sf}


def extract_total_scope(row):
    """Which subtotal(s) the TOTAL (Sf) actually sums (spec C).

    Read directly off Sf's own-row P/Q/R references, canonically ordered --
    the same evidence-from-operand approach _cap_scope uses for ceilings,
    so the two never drift apart. 385 of 421 rows reference at least one of
    their own P/Q/R and get a combination scope. The other 36 reference
    none: Sf computes the total some other way entirely (one flat fee for
    the row, a constant, or a strength-only formula) -- those get
    "direct" (or "unparsed" if the formula doesn't reduce to one of the
    three known direct shapes, spec C's faithfulness rule).
    """
    sf = row.get("Sf")
    own = row["row"]
    letters = [c for c, r in re.findall(r"([A-Z]{1,2})(\d+)", sf)
               if c in "PQR" and int(r) == own]
    if letters:
        uniq = sorted(set(letters), key=_SCOPE_ORDER.index)
        return {"scope": "+".join(uniq)}

    direct = _direct_total(sf, own)
    if direct["kind"] == "unparsed":
        return {"scope": "unparsed", "formula": direct["formula"]}
    return {"scope": "direct", "direct": direct}


def build_rules():
    rules = []
    static_rates = load_static_fx_rates()
    for row in load_fee_rows():
        cls = classify_rule(row)
        rules.append({
            "row": row["row"], "cc": row["cc"], "role": row["role"],
            "type": row["type"], "special": row["special"],
            "fee_code": row.get("fee_code"),
            "amounts": extract_amounts(row),
            "amountsEur": extract_amounts_eur(row, static_rates),
            "select": extract_select(row),
            "rule": cls["rule"], "evidence": cls["evidence"],
            "cap": extract_cap(row),
            "surcharge": extract_surcharge(row),
            "totalScope": extract_total_scope(row),
        })
    return rules


def main():
    import json as _json
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    rules = build_rules()
    (out / "fee-rules.json").write_text(
        _json.dumps(rules, indent=1, ensure_ascii=False), encoding="utf-8")
    unknown = [r for r in rules if r["rule"] == "unknown"]
    unparsed = [r for r in rules if r["cap"] and "unparsed" in r["cap"]]
    anomalies = [r for r in rules if r["select"]["anomaly"]]
    scope_unparsed = [r for r in rules if r["totalScope"]["scope"] == "unparsed"]
    print(f"{len(rules)} Zeilen -> fee-rules.json")
    print(f"  unknown rule       : {len(unknown)}")
    print(f"  unparsed cap       : {len(unparsed)}")
    print(f"  unparsed totalScope: {len(scope_unparsed)}")
    print(f"  anomalies          : {len(anomalies)}")


if __name__ == "__main__":
    main()
