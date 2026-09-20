# Handoff: F112 — Fix AS-014 server-time default week

## Status
COMPLETE

## Assertions covered
AS-014: PASS — default week (no `?week=` param) now derives from `currentWeekKey("UTC")` instead of `currentWeekKey(timezone)`, so two viewers with different profile timezones get the same default week. Verified via `test_AS_014_page_uses_server_time_not_viewer_timezone` (source-text assertion that page.tsx never calls `currentWeekKey(timezone|viewerTimezone|profile.timezone)` and always calls `currentWeekKey("UTC")`) plus the existing `test_AS_014_parseWeekKey_*` tests, all passing.

## Files changed
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f102-calendar-page-composition.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f102-calendar-page-composition.test.tsx` (0, 14 passed)
`npx next build` (0)

## Decisions made
- `currentWeekKey` takes a timezone string arg (confirmed in `lib/calendar/week-grid.ts`), so per spec Step 2 the fix is changing the call site from `currentWeekKey(timezone)` to `currentWeekKey("UTC")`. The `timezone` variable itself is left intact and still threaded into `buildCalendarWeek(weekKey, timezone)` for per-day `isToday` highlighting — that part is intentionally viewer-local and out of scope for AS-014 (which is only about which week opens by default).
- Replaced the tautological `for` loop in `test_AS_014_all_selected_members_share_a_single_weekKey_for_one_getCalendarBlocks_call` (F111) — it compared `weekKey` to a hardcoded literal inside a loop over unrelated `userId`s, which is vacuous — with direct assertions outside the loop plus a new dedicated `test_AS_014_page_uses_server_time_not_viewer_timezone` test that does a source-text check against the real page.tsx: fails if the code reverts to passing `timezone`/`viewerTimezone`/`profile.timezone` into `currentWeekKey`, and requires the literal `"UTC"` call to be present.

## Out-of-scope work needed
None identified — this was a scoped, single-call-site fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the `timezone` variable's other use (per-day `isToday` in `buildCalendarWeek`) unchanged since the spec's "goal" statement is specifically about which week is the *default* week, not about today-highlighting within that week — that distinction was already implicit in the existing code structure (two separate call sites) and no clarified answer suggested changing `buildCalendarWeek`'s timezone argument.

## Notes for the next worker
No MCP usage — pure application-code fix plus test-file fix; no external service touched.
