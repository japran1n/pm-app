# Handoff: F007 — Grouping by category (util + test)

## Status
COMPLETE

## Assertions covered
BR-030: PASS — 5 tests (single, ordering by min position, null -> General, mixed, empty)

## Files changed
lib/brief/group-by-section.ts
tests/unit/brief-group-by-section.test.ts

## Commands run
`npx vitest run tests/unit/brief-group-by-section.test.ts` (0)
`npx eslint <files>` (0)
`npx tsc --noEmit` (0, no errors in my files)

## Decisions made
- Implemented exactly as the clarified spec; only refactored map lookup to avoid a non-null assertion.

## Out-of-scope work needed
None.

## Blockers
None.

## Autonomous decisions
None.

## Notes for the next worker
Import `groupBySection` and `BriefSection` from `@/lib/brief/group-by-section`.
