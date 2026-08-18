# F101: position bound fix

**Milestone:** M5 — Board & drag-and-drop (follow-up)
**Estimated worker time:** 30 minutes
**Depends on:** F044
**Parent:** F044

## Assertion IDs covered
- AS-072, AS-082

## Draft scope
- scrutiny-validator (M5-scrutiny.md, Finding 1) directly traced and confirmed: calculatePosition's floating-point-precision fallback nudge (`prev + Number.EPSILON * Math.max(Math.abs(prev), 1)`) can produce a result OUTSIDE the [prev, next] bound — e.g. prev=1000, next=1001 after repeated reinsertion produces 1001.0000000000002, exceeding next. This breaks the "strictly between neighbors" guarantee.
- Existing tests only assert Number.isFinite/!isNaN on this path, never boundedness — the actual behavioral contract was untested.
- Fix: scale the nudge off the remaining GAP (next - prev), not off prev's absolute magnitude — e.g. nudge toward next by a fraction of the gap, or if the gap has collapsed to the smallest representable float64 step, return a value strictly using nextafter-style logic (or, simpler and robust: if midpoint equals prev or next, return the float64 value immediately adjacent to the smaller/appropriate neighbor using a controlled bit-nudge, clamped to never exceed next).
- Add a regression test asserting `prev <= result <= next` (with correct strict/non-strict boundary per the actual contract) across a precision-collapse test matrix — not just finiteness.

## Files (approximate)
lib/board/position.ts, tests/unit/position.test.ts

## Notes for clarification
Source: M5-scrutiny.md, Finding 1. Severity: high (real ordering-corruption bug, demonstrated by direct trace).
