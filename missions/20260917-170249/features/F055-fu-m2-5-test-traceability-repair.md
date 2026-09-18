# F055: repair test-to-assertion traceability (major)

**Milestone:** M2 follow-ups
**Estimated worker time:** 25 minutes
**Depends on:** F051, F052, F053, F054

## Assertion IDs covered
- AS-042, AS-043, AS-044, AS-045, AS-049, AS-050, AS-076

## Clarified implementation
(Inherited from F014)

## Follow-up scope (from M2-scrutiny.md — FU-M2-5)
Audit every `it("AS-NNN: ...")` label in `lib/webflow-converter/` against the verbatim assertion text and correct the six known mislabels (css.test.ts:102 AS-049, :112 AS-050, :191 AS-076; breakpoints.test.ts:39 AS-074, :54 AS-048). Add missing labelled tests for AS-042–045 at the parseCss level, AS-044 (combinators), AS-049/050/076.

Delete or invert the four mirror tests that assert prototype-parity rather than assertion intent (longhand.test.ts:355 flex:initial drop, :496 font kept as shorthand, :629 var() as border width; breakpoints.test.ts:27 fallback behaviour).

## Definition of done
- Every AS-NNN label in lib/webflow-converter/** matches the assertion it claims
- No mirror tests remain (tests that would pass if the wrong behaviour were kept)
