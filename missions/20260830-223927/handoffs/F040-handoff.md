# Handoff: F040 — Fix AS-022: calendar realtime subscription needs delivery scoping

## Status
COMPLETE

## Assertions covered
AS-022: PASS — `reconcileCalendarRealtimeEvent` now accepts an optional `visibleDateRange` `{start, end}` ("YYYY-MM-DD"); INSERT/UPDATE events whose `due_date` falls outside the currently rendered calendar window are ignored (or, for a previously-tracked task, removed from local state). `CalendarDayGrid` derives the window from `days[0].date`/`days[days.length-1].date` (the full rendered grid, including leading/trailing adjacent-month days) and passes it through. 4 new tests in `tests/unit/f040-calendar-realtime-date-scope.test.ts` cover: in-window INSERT accepted, out-of-window INSERT ignored, an UPDATE moving a tracked task's due_date outside the window removes it, and a non-vacuous backward-compat test (no `visibleDateRange` passed → unscoped, still exercises the real INSERT path so it fails if that path is removed). Existing F009/F027/F034/F234/F326 calendar realtime tests (42 total across the 6 calendar-realtime-related files) still pass unmodified.

## Files changed
components/calendar/calendar-day-grid.tsx
lib/calendar/reconcile-realtime-task.ts
tests/unit/f040-calendar-realtime-date-scope.test.ts

## Commands run
`npx vitest run tests/unit/f040-calendar-realtime-date-scope.test.ts tests/unit/f034-fix-realtime-bugs.test.ts tests/unit/f009-calendar-realtime-subscription.test.ts tests/unit/f027-calendar-realtime-wiring.test.tsx tests/unit/f234-calendar-day-grid-wiring.test.ts tests/unit/f326-calendar-day-grid-rerender.test.tsx` (0, 6 files / 42 tests passed)
`npm run lint` (0, 13 pre-existing warnings, 0 errors, none in files I touched)
`npx tsc --noEmit` (0)
`npx vitest run` (0 exit code from the runner itself; full suite reported 50 failed test files / 83 failed tests, all in `tests/integration/*` due to `Request rate limit reached` on Supabase test-user sign-in — a pre-existing environment/rate-limit issue unrelated to this change, not touching calendar/realtime files; no calendar or reconcile test appears in the failure list)

## Decisions made
- Added `visibleDateRange` as an OPTIONAL 4th parameter to `reconcileCalendarRealtimeEvent` rather than a required one, so every existing caller/test (which has no notion of a "displayed window") keeps compiling and passing unchanged — only `CalendarDayGrid` (the real production caller) passes it.
- Derived the window bounds from the `days` prop `CalendarDayGrid` already receives (`days[0].date` / `days[days.length-1].date`) rather than threading month/year separately — `days` already includes leading/trailing days from adjacent months per `month-grid.ts`, so this is the true rendered bound, not just the target month's own first/last day.
- Used plain string comparison (`<`/`>`) on "YYYY-MM-DD" values for the range check — safe because `DateOnly` strings are lexically sortable, avoiding any `Date` parsing/timezone risk (consistent with how `lib/calendar/month-grid.ts` and the existing DELETE-gate comment in this same file already reason about dates).
- Distinguished this from the pre-existing F029-documented gap ("if the calendar is ever filtered by URL params like status/priority/assignee, no filter prop channel exists yet") — that gap is about business-logic filters with no prop channel; this feature is about the date WINDOW, for which `days` already IS the prop channel. Left the F029 comment in place unmodified since it's still accurate for those non-date filters.
- Did NOT add scoping to the DELETE branch — a DELETE event's `old` record carries no `due_date` (no replica identity full, same reason `project_id` is unavailable per the AS-022 DELETE-gate comment already in this file), so there's nothing to compare against the window; the existing "not present in local `byDate`" backstop already handles DELETEs correctly regardless of date.

## Out-of-scope work needed
The F029-documented gap remains: if the calendar page is ever extended to accept URL-driven filters (status/priority/assigneeId/projectId), a realtime INSERT for a task matching the current date window but not the active filter will still appear, because `CalendarDayGrid` has no prop channel for those filter values today. Wiring that through is a separate feature (thread the resolved filter object from the calendar page into `CalendarDayGrid` → `useCalendarRealtime` → the reconciler) and was intentionally left alone here since this feature's scope was specifically the date-window gap, not filter scoping.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Confirmed via reading `calendar-day-grid.tsx`/`month-grid.ts` that the calendar is NOT an "always show all tasks regardless of date" surface — it renders exactly the `days` grid for one month at a time, so date-window scoping is the correct fix (not the "document why no scope is needed" alternate path the task description offered).

## Notes for the next worker
- `lib/calendar/reconcile-realtime-task.ts`'s header comment block now documents the `visibleDateRange` param and why string comparison is safe — read that before touching this file again.
- The full unscoped `npx vitest run` run surfaced 50 pre-existing failing integration test files, all Supabase sign-in rate-limit errors (`Request rate limit reached`) unrelated to this change — worth flagging to the orchestrator as a possible test-infra issue (may need slower/staggered sign-ins or a dedicated test-user pool) but out of scope for this feature to fix.
