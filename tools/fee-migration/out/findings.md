# Findings: rows classify_rule() could not match (Task 5)

`classify_rule()` matches four named shapes -- `per_count_tiered`, `per_strength_tiered`,
`flat_from_second`, `scaling` -- against the normalized P/Q/R formula bodies. Anything it
cannot match with confidence comes back as `"unknown"` with the raw (normalized) formula
as evidence, per the faithfulness rule: no guessing.

Distribution across all 421 rows (brief Step 5 command):

```
 335  scaling
  52  flat_from_second
  17  unknown
  15  per_strength_tiered
   2  per_count_tiered
```

## The 17 `unknown` rows

All 17 are Denmark (`cc=DK`). None of them scale by count or strength at all -- each
branch of their P/Q/R formula returns a bare fee (`F%` or `K%`) with no
`(L-1)*G` or count-multiplication term. That is a genuinely different shape from the
four families above, not a near-miss of one of them, so `unknown` is the correct,
non-guessed answer for these rows.

Three distinct raw shapes appear among the 17 (row numbers, normalized formula,
fee_code):

**Shape 1 -- single Type IA fee, blocked once more than one applies** (rows 87, 98, 109):
```
=IF(ISBLANK(L%),"",IF(M%=0,0,IF(M%>1,0,F%)))
```
fee_code: 3102 (RMS), 3103 (CMS), 3101 (national).

**Shape 2 -- single Type IB fee, no count gate visible in the formula itself**
(rows 90, 101, 112):
```
=IF(ISBLANK(L%),"",IF(N%=0,0,F%))
```
fee_code: 3102 (RMS), 3103 (CMS), 3101 (national).

**Shape 3 -- Type II fee that switches between a lead fee and a flat grouped fee**
(rows 94, 95, 96, 97, 105, 106, 107, 108, 117, 118, 119):
```
=IF(ISBLANK(L%),"",IF(O%=0,0,IF(AND((M%+N%)=0,O%=1),F%,IF(OR((M%+N%)>0,O%>1),K%,F%))))
```
fee_code: range 3104-3139 (RMS/CMS/national variants).

Full per-row detail (row, cc, type, role, fee_code, evidence) was generated with:

```bash
cd "D:/Claude/Variation Fee Calculator"
python -c "
import sys; sys.path.insert(0,'tools/fee-migration')
from extract_rules import load_fee_rows, classify_rule
for r in load_fee_rows():
    c = classify_rule(r)
    if c['rule'] == 'unknown':
        print(f\"row {r['row']:4d}  cc={r.get('cc')!s:3}  type={r.get('type')!s:3}  role={r.get('role')!s:5}  fee_code={r.get('fee_code')}\")
        print('   evidence:', c['evidence'])
"
```

Row list: 87, 90, 94, 95, 96, 97, 98, 101, 105, 106, 107, 108, 109, 112, 117, 118, 119
(all `cc == "DK"`).

## Not in scope for this task

These DK rows are not scaling, tiered-by-count, tiered-by-strength, or "flat from the
second variation" in the sense `flat_from_second` checks (that family looks for a
`>1,K` or `K+(L-1)` branch keyed to the grouping trigger). Shape 3 rows do reference
`K%` in one branch, but the branch condition (`AND((M+N)=0,O=1)` / `OR((M+N)>0,O>1)`)
does not match the `flat_from_second` regex's expected shapes -- it is gated on `O>1`
combined with `M+N`, not on `L` (lead-variation count) the way the other
`flat_from_second` rows are. Whether Denmark needs a sixth rule family, or whether
these 17 rows should be modeled as data-driven exceptions instead, is a decision for
a later Baustein-A task -- flagged here, not decided here.

# Findings: unparsed ceilings surfaced after the K-guard fix (Task 6)

`extract_cap()`'s safety net used to test for the bare letter `"K"` in the S formula
before reporting an un-typeable ceiling. Every one of the 421 `Sf` formulas is wrapped
in `IF(ISBLANK(L<row>),...)`, and the literal `ISBLANK` itself contains a `K` -- so
that check was always true and the "unparsed" branch was unreachable dead code. It now
tests for a reference to the row's own flat-fee column, `K<row>`, instead. With the
guard actually able to fire, `unparsed cap` went from 0 to 2.

Both newly-surfaced rows are Denmark:

```
row  98  cc=DK  role=CMS       fee_code=3103
  Sf: =IF(ISBLANK(L98),"",IF(M98=0,"",IF(M98>1,"",F98)))

row 109  cc=DK  role=national  fee_code=3101
  Sf: =IF(ISBLANK(L109),"",IF(M109=0,"",IF(M109>1,"",F109)))
```

Both compare `M<row>>1`, not any P/Q/R subtotal -- the branch returns `""` (blank) once
more than one variation applies, rather than capping a sum at a ceiling value. None of
the four enterable cap shapes (const, byStrength, points x pointValue, multipleOfLead)
apply, so `extract_cap` now correctly reports them as `{"unparsed": ...}` instead of
silently returning `None` (no cap) as it did before the fix.

This is not a new, independent problem: rows 98 and 109 are two of the same 17 DK rows
already listed above as `unknown` under `classify_rule()` (Shape 1: "single Type IA
fee, blocked once more than one applies"). The S formula on these rows is simply
mirroring the same `M>1` gate that already made the P/Q/R formula unclassifiable --
so it being unparsed as a *cap* too is consistent, not a second bug. Whether Denmark's
"blocked past one variation" shape needs its own rule family (covering both
`classify_rule` and `extract_cap`) is, again, a decision for a later Baustein-A task.

# Findings: pre-existing spec findings B3/B4, the one `select.anomaly` hit, and the
# comparison's difference hot spots (Task 8)

## B3 -- two dead code branches, with a side effect on preselection

Confirmed still present in the rule model: `_pick()` in `evaluate_rules.py` falls
back to `cands[0]` (first matching row) whenever no candidate's `special` matches --
mirroring `resolveRow`'s dead `candidates.find(r => !r.special)` branch in the real
engine, since none of the 421 rows carry an empty `special` (`convert.py` copies
column D literally, and every cell there holds text, including the word
"standard"). Side effect unchanged from the spec: for the 92 (country, role, type)
combinations with more than one special-case variant, which one is "preselected" in
the UI is decided by Excel row order, not by any explicit "standard" flag -- e.g.
Italy Type II lists "reduced" before "standard", so the preselected amount is the
cheaper one (14,678 EUR instead of 29,357 EUR). Not a comparison defect: the
selector shows the special case it actually used, so nothing is silently miscalculated,
but it means "which special is preselected" is itself a piece of accidental,
row-order-dependent behaviour that the rule model reproduces byte-for-byte only
because `fee-rules.json` preserves the source array's row order.

## B4 -- the wrong cell reference on row 422 (== the one `select.anomaly` hit)

`extract_select()` flags exactly one row in all 421: row 422 (EU/EMA, Type IB,
special "standard"). Its `Of` formula is `=IF(ISBLANK(L422),"",O341)` -- every other
row reads its own country's row-2 count (`O2`), but row 422 reads row **341** (PL,
Type IB, CMS) instead. This is the extractor surfacing spec finding B4 verbatim, not
a new bug. Confirmed harmless, same as the spec says: row 422's own `O` is never
read elsewhere in that row's formula, and `computeCountryResult` only evaluates rows
for the country being priced, so an EU/EMA calculation reading a PL row's O-cell
resolves to `undefined` -> `0` at runtime. A sleeping defect, reported per the
faithfulness rule, not fixed -- fixing it would silently change row 422's behaviour
relative to the golden master with no way to tell the difference apart from a real
migration error.

## Comparison hot spots (Task 8, `compare.py` against `out/golden.csv.gz`)

Headline: **223,721 / 347,040 rows match** (four fields: `total`, `subsumed`,
`capValue`, `groupingFee`); 71,479 differ; 51,840 are uncomputable (see below); 0
missing. Full counts and tables in `out/report.md`.

**Rows that could not be evaluated at all** -- the 17 `rule: unknown` DK rows listed
above produce **51,840** result-rows across the full input matrix (all counted in
their own bucket, never as a match or a difference): rows 87 and 98 (3,840 runs
each), 109 (3,840), and 90/94/95/96/97/105 (2,880 each) are the largest contributors,
with the remaining unknown rows (96/97/105/106/107/108/112/117/118/119 etc.) filling
out the rest. Full per-row breakdown is in `out/report.md`'s "Nicht berechenbare
Zeilen" table. `evaluate()` marks every result item for these rows `uncomputable:
True` with `total: None` rather than guessing a number, exactly per the spec's
faithfulness rule.

**The five largest difference clusters, by Excel row** (all far above the next-
biggest cluster; see `out/report.md` for the full top-50):

| Row | Diffs | cc / role / type | Likely cause |
|---|---|---|---|
| 116 | 2,880 | DK national II ("administrative (E)") | cross-type subsumption folding, see below |
| 163 | 2,490 | ES national IB ("herbal") | subsumption zeroed too aggressively, see below |
| 156 | 2,052 | ES CMS II ("full applications") | cap-scope arithmetic mismatch |
| 35 | 1,800 | BE national II ("analytical") | cross-type subsumption folding |
| 36 | 1,800 | BE national II ("analytical, herbal") | cross-type subsumption folding |

**Root causes identified, roughly in order of impact:**

1. **Cross-type subsumption folding multiplies the total (rows 17, 35-38, 91, 116,
   and every other `flat_from_second` row where more than one type is folded
   together).** `evaluate()`'s `_active_counts()` implements subsumption as "the
   highest present type absorbs the others, keeping their individual counts", then
   `_part()` is called once *per active type* and the results are summed. For a
   `flat_from_second` row this is wrong whenever 2+ types are active at once: each
   call independently falls back to that one row's own `lead` amount (the
   `flat_from_second` branch logic doesn't look at which type is being priced), so
   the total comes out at exactly 2x or 3x the correct figure depending on how many
   types got folded in. Confirmed empirically: `total exactly 2x golden` (9,173
   result-rows) and `total off, ratio~3.000` (8,946 rows) are the two single
   biggest cause-buckets found by an ad-hoc classification of all 71,479
   differences -- both are this one mechanism. This is the largest identified
   single defect in the rule model and is entirely within the four in-scope
   fields (not a `singleTotal`/scope issue).

2. **Subsumption is coarser than the real per-row Excel gate (row 163 and
   similar).** The real engine's `subsumed` flag (`vcl-calc-app.js` ~line 1253) is
   computed per row from that row's own, already-evaluated `M`/`N`/`O` Excel cells
   -- and each row's own `Mf`/`Nf`/`Of` formula decides independently whether it
   reads row 2 verbatim or is itself gated. `evaluate()`'s blanket
   "`type_ != leading type -> zero everything`" rule (`_active_counts`) assumes
   every row obeys a uniform highest-type-wins gate; row 163 (ES national IB
   "herbal") shows a case where the real IB row is **not** subsumed even though
   Type II is present (`golden: subsumed=0, total=331.09`), while the model
   always zeroes it (`mine: subsumed=True, total=None`). 1,080 result-rows show
   exactly the "mine subsumed, golden not" mismatch pattern.

3. **`capValue`/`groupingFee` use a different operational definition in the golden
   master than in the rule model, so they can disagree even when `total` is
   correct.** The real engine derives both flags by comparing the *combined* run
   against a *separate standalone single-type run* (`singleRunCap`/`combinedRunCap`
   in `vcl-calc-app.js` ~lines 1264-1296) -- fields Task 8 explicitly puts out of
   scope (`singleTotal`, `rawSumSingle`). `evaluate()` instead derives `capValue`
   directly from the row's own declared `cap` ceiling within one run. Result:
   6,925 result-rows match on `total` but differ only on `capValue` (a cosmetic
   marker mismatch, e.g. DE row 69: golden and model both compute 19,900.00, but
   golden also reports `capValue: 19900.00` where the model reports `None`).
   A further 4,070 rows differ on both `capValue` *and* `total` together -- a
   genuine cap-arithmetic mismatch, not merely cosmetic. `groupingFee`+`total`
   together differ on 8,580 rows for the same reason (real `groupingFee` reads the
   row's own combined M+N+O counter, which already reflects per-row subsumption
   quirks the model does not reproduce -- see point 2).

4. **Local-currency rows are compared against an EUR-converted golden figure by
   design, not by defect.** `extract_amounts()` deliberately keeps the local
   (`*_lc`) values as authoritative per spec B2 -- FX conversion is explicitly a
   later Baustein's (PHP runtime's) job, not this reference evaluator's. The golden
   master, however, always records the real engine's EUR total (baked in at
   `convert.py` export time from the source workbook, and overwritten with a
   live/static rate at runtime when one is available -- `harness.py` freezes this
   to the static fallback only, which itself only covers HU/NO/SI). Consequently
   **every** row whose `currency != EUR` (129 rows, per spec B2) is essentially
   guaranteed to disagree on `total`/`capValue` by a currency-conversion factor.
   Splitting the 71,479 differences by the matched rule row's currency: 42,740 of
   them are on EUR rows (genuine rule-model gaps, points 1-3 above); the remaining
   28,739 are on non-EUR rows, where this scope gap is expected to dominate (sample
   ratios found: DK ~7.475, PL ~22.423, NO ~11.31, SE ~11.045, HU ~395.12 -- all
   plausible EUR conversion factors for those currencies). **This is not a rule-
   model logic bug and is not something to "fix" in `compare.py` by converting
   currencies before comparing** -- doing so would compare the model against a
   number it was never designed to produce, and would hide a real, deliberate scope
   boundary (spec B2) behind a passing test.

**Net reading:** of the 71,479 differences, roughly 42,700 are on EUR-priced rows
and represent genuine rule-model gaps (overwhelmingly cause 1, the subsumption-
folding multiplier, plus caps/grouping-flag definition mismatches from cause 3);
the remaining ~28,700 are on non-EUR rows and are dominated by the deliberate
currency-conversion scope gap (cause 4), not by additional logic errors on top of
it. The headline match rate (64.5%) should be read with that split in mind rather
than as one undifferentiated number.
