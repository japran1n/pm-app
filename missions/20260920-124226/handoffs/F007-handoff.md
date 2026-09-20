# Handoff: F007 — pure logic tests

## Status
COMPLETE

## Assertions covered
AS-072: PASS — added explicit named regression tests for "order is NOT sorted" (z,a,b input stays z,a,b) and "all-invalid falls back to self, not empty" in tests/unit/planner-people-selection.test.ts; all 34 tests across the three pure-logic suites pass.

## Files changed
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts tests/unit/planner-stacked-window.test.ts tests/unit/planner-layout.test.ts` (0) — 32 tests passed before changes, 34 after adding the two regression tests

## Decisions made
- The existing suite already covered "not sorted" implicitly via AS-009 (c,a,b) and "all-invalid" via AS-008, but the spec called for explicit named regression tests using the exact scenario language ("z,a,b order" and "falls back to self, not empty"), so I added two dedicated tests rather than relying on the existing coverage to satisfy AS-072 by inference.
- No production code changes were needed — lib/calendar/people-selection.ts, planner-layout.ts, and stacked-window.ts already implement the correct behaviour per F002–F006 workers.

## Out-of-scope work needed
None identified.

## Blockers

## Autonomous decisions

## Notes for the next worker
No MCP usage required — this is a pure unit-test feature with no external service dependency. Ran only the three existing pure-logic test files as instructed; did not run the full repo test suite since the spec scoped this feature to those three files only.
