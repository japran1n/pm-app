# Handoff: F003 — computeTimeLeft + resolveDueDate

## Status
COMPLETE

## Assertions covered
PL-014: PASS — all branches, plural, boundaries
PL-015: PASS — precedence tests

## Files changed
lib/projects/time-left.ts
tests/unit/time-left.test.ts

## Commands run
`npx vitest run tests/unit/time-left.test.ts` (0)
`npx tsc --noEmit` (no time-left errors)

## Decisions made
- UTC calendar-day diff; weeks = floor(days/7) for >=14.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions

## Notes for the next worker
Pure module; import from @/lib/projects/time-left.
