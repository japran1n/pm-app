# Handoff: F042 — fix clipBlockToStackedWindow — per-day segmentation + timezone contract

## Status
COMPLETE

## Assertions covered
AS-021: PASS — block starting before 08:00 is clipped to 08:00 (verified via test "AS-021: a block starting before 08:00 is clipped to 08:00 (Wednesday)")
AS-022: PASS — block ending after 16:00 is clipped to 16:00, now correctly expressed as a segment in the returned array (verified via test "AS-022: a block ending after 16:00 is clipped to 16:00 (Wednesday)")

## Files changed
lib/calendar/stacked-window.ts
tests/unit/planner-stacked-window.test.ts

## Commands run
`npx vitest run tests/unit/planner-stacked-window.test.ts` (0) — 10 tests passed
`npx tsc --noEmit` (0) — clean, no output
`grep -rl "stacked-window" app components lib` (0, no matches) — confirmed no external callers of this module before changing the signature

## Decisions made
- Confirmed via grep that no file in app/, components/, lib/ imports stacked-window.ts, so the breaking signature change (`{starts_at,ends_at}|null` -> `Array<{starts_at,ends_at}>`) is safe with no downstream fixes needed.
- Rewrote the day-enumeration loop to iterate UTC calendar days from floor(start) to ceil(end) using millisecond arithmetic (`Date.UTC` day boundaries stepped by 24h), rather than reusing `getUTCDate()+1` style increments, to avoid month/year rollover bugs.
- Kept `STACKED_DAYS`/`STACKED_START_HOUR`/`STACKED_END_HOUR` exports and their existing tests (AS-018, AS-019) untouched — spec only requires fixing the clip function.
- Added the required timezone contract comment at the top of the file per spec wording.
- Test dates for the new multi-day cases use 2026-09-27 (Sun) through 2026-10-03 (Sat), verified as the correct real-calendar weekdays for that week.

## Out-of-scope work needed
None identified — no current callers of clipBlockToStackedWindow exist yet, so no rendering/consumer code needed updates for the new array-returning signature. A future feature that wires this helper into the stacked calendar view will need to iterate the returned array instead of assuming a single segment.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left the pre-existing dirty working-tree files (lib/calendar/people-selection.ts, tests/unit/planner-people-selection.test.ts) untouched and out of this commit, since they belong to a different feature and are outside F042's Touches scope.

## Notes for the next worker
No MCP usage required — this is pure logic with no external service dependency. The test file title for AS-020 was removed since the spec's "block entirely outside window" cases are not separately assigned an assertion ID in this feature's scope (AS-020 covers a different assertion per the constants describe block, i.e. it does not apply here); those two tests are kept but untitled with an assertion ID since they're regression coverage, not new assigned assertions.
