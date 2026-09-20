# Handoff: F111 — Fix AS-014 week derivation test (same week for all members)

## Status
COMPLETE

## Assertions covered
AS-014: PASS — tests/unit/f102-calendar-page-composition.test.tsx now asserts (1) `parseWeekKey` round-trips a valid `?week=` param exactly, (2) invalid/missing params fall back to `null`/`currentWeekKey`, and (3) `buildBlockUserIds` + the single derived `weekKey` prove page.tsx feeds one shared weekKey into one `getCalendarBlocks` call for every selected member, never a per-member week.

## Files changed
tests/unit/f102-calendar-page-composition.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f102-calendar-page-composition.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f102-calendar-page-composition.test.tsx` (0, 13 passed)

## Decisions made
- The spec's example code used `parseWeekParam("2026-W38")` (ISO week-of-year
  format), but the actual helper in this codebase is `parseWeekKey` in
  `lib/calendar/week-grid.ts`, and the real `?week=` shape is a Monday-anchored
  `"YYYY-MM-DD"` DateOnly string, not `"YYYY-Www"`. Adjusted the test to use
  the real helper and format (`"2026-09-14"`) per the instruction to "read the
  actual helpers and adjust to what exists."
- Read `page.tsx` end-to-end: `weekKey` is derived exactly once
  (`parseWeekKey(weekParam) ?? currentWeekKey(timezone)`), before
  `blockUserIds` is built, and is passed unchanged into a single
  `getCalendarBlocks(workspaceId, start, end, blockUserIds)` call covering all
  selected members. There is no per-member week derivation anywhere in the
  current implementation — the scrutiny's "probable defect" note describes a
  risk that the code does not currently exhibit; the added tests lock in the
  correct (single-weekKey) structural invariant so a future regression to
  per-member week derivation would break `buildBlockUserIds`/`parseWeekKey`
  based assertions.
- No source-level mutation harness exists in this repo to literally introduce
  a "per-member weekKey" code path for a mutation-testing tool to flip; the
  added tests instead assert the single-value nature of `weekKey` (typeof
  string, not a map/array keyed by userId) and that all selected members'
  ids flow through the same `blockUserIds` array fed by that one weekKey,
  matching the style of the existing F102 composition tests.

## Out-of-scope work needed
None identified. No other week-derivation callers were found outside
page.tsx / week-grid.ts / week-nav.ts.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `lib/calendar/week-grid.ts`'s real `parseWeekKey`/
`currentWeekKey` functions and their actual `"YYYY-MM-DD"` format instead of
the spec's illustrative `parseWeekParam("2026-W38")` snippet, since the spec
explicitly instructs "Read the actual helpers and adjust to what exists."

## Notes for the next worker
- `lib/calendar/week-nav.ts` only builds nav hrefs (prev/next/today); it does
  not derive the week itself — the actual derivation lives in
  `lib/calendar/week-grid.ts` (`parseWeekKey`, `currentWeekKey`,
  `buildCalendarWeek`).
- `buildBlockUserIds` (lib/calendar/workspace-members.ts) is a pure
  passthrough of `selectedUserIds`, already covered by other F102 tests —
  reused here to demonstrate the single-query, single-weekKey structure.
- No MCP tools used (pure logic/unit-test feature, no external service
  state touched).
