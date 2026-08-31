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
