# F007: pure logic tests

**Milestone:** M1 — Pure logic
**Estimated worker time:** 45 minutes
**Depends on:** F002,F003,F004,F005,F006

## Assertion IDs covered
- AS-072: The pure helpers for parsing the people selection, clipping to the stacked window, and ordering rows are covered by unit tests.

## Draft scope
- Unit tests for every function added in M1.
- Explicit regression test that a given order is not alphabetised.
- Explicit test that all-invalid input falls back to self, not to empty.

## Files (approximate)
- `tests/unit/planner-people-selection.test.ts`
- `tests/unit/planner-stacked-window.test.ts`

## Notes for clarification
Written against behaviour, not internals, so the M7 refactor cannot quietly invalidate them.
