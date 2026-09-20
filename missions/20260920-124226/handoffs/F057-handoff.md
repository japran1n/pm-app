# Handoff: F057 — Delete orphaned month-view task subtree

## Status
COMPLETE

## Assertions covered
AS-081: PASS — grep for `getCalendarTasks|CalendarTaskFilters|tasksByDate` across `app/`, `components/`, `lib/` returns zero results after deletion; confirmed via the gate command in the spec.

## Files changed
components/calendar/agenda-list.tsx (deleted)
components/calendar/calendar-day-grid.tsx (deleted)
components/calendar/day-cell.tsx (deleted)
components/calendar/day-overflow.tsx (deleted)
components/calendar/month-grid.tsx (deleted)
components/calendar/use-calendar-realtime.ts (deleted)
lib/calendar/reconcile-realtime-task.ts (deleted)
lib/calendar/reschedule.ts (deleted)
lib/queries/calendar.ts (deleted)
lib/tasks/subscribe-calendar-realtime.ts (deleted)
lib/queries/tasks.ts (modified — added relocated `getWorkspaceStatusOptions`/`CalendarStatusOption`, cleaned a stale comment reference)
lib/queries/calendar-blocks.ts (modified — cleaned a stale comment reference to deleted `lib/queries/calendar.ts`)
tests/unit/f009-workspace-status-options-project-scan.test.ts (modified — import path updated to `@/lib/queries/tasks`)
tests/unit/f009-calendar-realtime-subscription.test.ts (deleted)
tests/unit/f027-calendar-realtime-wiring.test.tsx (deleted)
tests/unit/f034-fix-realtime-bugs.test.ts (deleted)
tests/unit/f040-calendar-realtime-date-scope.test.ts (deleted)
tests/unit/f233-calendar-day-overflow.test.tsx (deleted)
tests/unit/f234-calendar-day-grid-wiring.test.ts (deleted)
tests/unit/f234-calendar-reschedule-plan.test.ts (deleted)
tests/unit/f235-calendar-responsive-render.test.tsx (deleted)
tests/unit/f326-calendar-day-grid-rerender.test.tsx (deleted)
tests/unit/f326-month-grid-datakey-wiring.test.tsx (deleted)
tests/unit/f338-priority-a11y-contrast.test.tsx (deleted)

## Commands run
`grep -rn "getWorkspaceStatusOptions" app/ components/ lib/ tests/` (0, found only lib/queries/calendar.ts def + tests, no live route)
`grep -rn '"@/lib/queries/calendar"' app/ components/ lib/` (0, confirmed only the-modules-being-deleted import it)
`npx tsc --noEmit` (0, clean)
`npx eslint --max-warnings=0` (0, clean)
`grep -rn "getCalendarTasks|CalendarTaskFilters|tasksByDate" app/ components/ lib/` (1, zero matches — gate satisfied)
`npx vitest run` (0 exit; 293 pre-existing failing test files / 310 failing tests unrelated to this change — none reference calendar/F009/F057; full run took ~170s)
`npx vitest run tests/unit/f009-workspace-status-options-project-scan.test.ts` (0, 3/3 passed — confirms the relocated function works correctly from its new location)

## Decisions made
- `getWorkspaceStatusOptions` (and its `CalendarStatusOption` type) had zero live-route callers but one live unit test (`tests/unit/f009-workspace-status-options-project-scan.test.ts`, F009/AS-008). Per the spec's step 1 instruction, relocated it into `lib/queries/tasks.ts` (the file its own perf-rationale comment already pointed to as the pattern precedent) rather than deleting it, and updated the test's import path. Preserved the original implementation and F009 rationale comments verbatim.
- Cleaned two stale comments (in `lib/queries/calendar-blocks.ts` and `lib/queries/tasks.ts`) that referenced `getCalendarTasks (lib/queries/calendar.ts)` by name, since the spec's own gate grep (`getCalendarTasks|CalendarTaskFilters|tasksByDate`) would otherwise still match them even though they were harmless prose.
- Deleted 11 test files (10 named in the spec plus `tests/unit/f338-priority-a11y-contrast.test.tsx`, which I found via a broader grep) after confirming each one's only imports were from the deleted modules — none tested surviving code (`lib/calendar/month-grid.ts` date-math or `lib/calendar/week-grid.ts`).
- Did not investigate or fix the 293 pre-existing failing test files (list-due-date-cell-optimistic.test.tsx and others) — none reference calendar/orphaned-subtree code, confirmed via grep of the failure log for "calendar", "f057", "f009". These are out of scope for this feature.

## Out-of-scope work needed
The pre-existing suite has 293 failing test files (310 failing tests) unrelated to calendar cleanup — e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx` fails on a `waitFor(() => expect(editTaskMock).toHaveBeenCalledWith(...))` timeout. This predates F057 and is not caused by this deletion (confirmed no calendar/F009/F057 references in the failure log). Worth a dedicated triage feature if the mission needs a fully green suite.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Relocated `getWorkspaceStatusOptions`/`CalendarStatusOption` to `lib/queries/tasks.ts` rather than any other query file, since `lib/queries/tasks.ts` already imports `createClient` the same way and its own comments (line ~285, F235/AS-448) already reference `getWorkspaceStatusOptions` as the established "visible-project resolution pattern" precedent — placing it there keeps the precedent and its user in the same file.
AUTONOMOUS_DECISION: Included `tests/unit/f338-priority-a11y-contrast.test.tsx` in the test-deletion set beyond the spec's explicit list, since it exclusively imports `DayCell`/`AgendaList`/deleted `CalendarTask`/`CalendarDay` types and has no other subject.

## Notes for the next worker
No MCP tools were used — this is a pure file-deletion/relocation task with no external service surface. `lib/calendar/month-grid.ts` (date-math) and `lib/calendar/week-grid.ts` were left untouched as instructed; both are still imported by `app/(workspace)/w/[workspaceSlug]/time/me/page.tsx` and `components/time/my-time-view.tsx`. F058 (retire-surviving-task-tests) is the next feature in this chain per the mission plan.
