# Handoff: F232 — calendar-month-grid

## Status
COMPLETE

## Assertions covered
AS-442: PASS — real query path (`getCalendarTasks`) proven via `tests/integration/f232-calendar-query.test.ts` (first/last-of-month cell placement, no-due-date exclusion, private/archived/trashed exclusion) plus pure grid-shape unit tests in `tests/unit/calendar-month-grid.test.ts`.
AS-443: PASS — `tests/unit/calendar-month-grid.test.ts` covers previous/next month key crossing year boundaries, `parseMonthKey`/`toMonthKey` round-trip, and `currentMonthKey` ("jump to today"); wired into the page via `?month=` URL search param links in `components/calendar/month-grid.tsx`.
AS-450: PASS — `test_AS_450_isToday_flag_is_computed_in_the_supplied_timezone` and `test_AS_450_current_month_key_reflects_the_supplied_timezone` (unit) plus `test_AS_450_calendar_month_grid_opens_on_the_current_date_in_the_callers_timezone` (integration) prove the same instant lands in a different month/day depending on the caller's IANA timezone.

## Files changed
lib/calendar/month-grid.ts
lib/queries/calendar.ts
components/calendar/month-grid.tsx
components/calendar/day-cell.tsx
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/calendar-month-grid.test.ts
tests/integration/f232-calendar-query.test.ts

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts)
`npx vitest run tests/integration/f230-my-tasks-query.test.ts tests/integration/f232-calendar-query.test.ts tests/unit/calendar-month-grid.test.ts tests/unit/my-tasks-bucket.test.ts` (0 — 4 files, 35 tests passed)
`npm test` (full suite, 0 exit but 30 pre-existing integration test FILES failed with "Something went wrong" from `supabase.auth.admin.createUser` — Supabase Auth rate limiting, a documented known infra condition, NOT related to this feature; none of the 30 failing files are F232/calendar files, and none touch code this feature changed. 1888 passed / 46 failed / 78 skipped overall.)

## Decisions made
- Reused F230's `lib/my-tasks/bucket.ts` Monday-start-week convention (`weekStartsOn: 1`) for the calendar grid's week start, so "this week" means the same thing across My Tasks and the calendar — no second week-start rule introduced.
- Reused `lib/time/user-timezone.ts`'s `todayInTimeZone` for both "which month opens by default" and each day cell's "isToday" flag — the calendar can never disagree with the overdue badge or My Tasks about what day it is in the viewer's timezone.
- Query is workspace-wide (not project-scoped), per the spec's ambiguity-resolution default: "Workspace-wide is the more useful default." Accepts an optional `projectId` narrowing argument as a clean seam for F235's filter work, unused by this feature's own page.
- `getCalendarTasks` uses the plain RLS-scoped session client (`createClient()`), never `createAdminClient()` — `tasks_select_active_members`'s existing `is_project_visible_to` RLS predicate is the sole visibility enforcement boundary, mirroring `lib/queries/my-tasks.ts`'s own justification for the same choice (F322/F323's recurring bug class avoided by construction, not by a second application-code check).
- Assignee avatars are resolved via the existing batched `resolveAssignees` (lib/queries/assignee-names.ts) rather than embedding a `profiles` relation directly in the tasks select — matches this codebase's one existing name/avatar-resolution path (email isn't reliably in `profiles`, so a raw embed would have silently produced worse assignee labels than the shared resolver already handles via its Auth Admin API fallback).
- Grid date maths (`lib/calendar/month-grid.ts`) works entirely in UTC-anchored `Date` objects internally (anchored at UTC-noon on the 15th of the target month) and only ever emits/reads plain "YYYY-MM-DD" strings — the CI/browser runtime's own ambient local timezone can never leak into which days are considered leading/trailing/current-month, only the explicit `timeZone` argument affects the `isToday` flag.
- Empty-month state ("No tasks are due this month") renders below the still-fully-rendered empty grid rather than replacing it with the shared `EmptyState` pattern — the grid itself, with its now/nav controls, remains the useful content even with zero tasks, unlike a genuinely empty list view.

## Out-of-scope work needed
- Wiring a "Calendar" link into the primary nav (`components/nav/app-sidebar.tsx`) was not done — not named in this feature's Files list, and out of this feature's Touches scope. A follow-up (or F233/F234/F235, whichever lands last) should add the nav entry once the view's interactive pieces (click-through AS-444, drag-reschedule AS-445) are also in place.
- AS-444 (click a task opens detail view), AS-445 (drag-reschedule), AS-446 (no-due-date explanation UI), AS-447 (per-day overflow control), AS-448 (active filters incl. assignee), AS-449 (phone-width responsive) are explicitly F233/F234/F235's own assigned assertions per this feature's spec — left as clean seams: `DayCell`'s task chips are plain `<Link>`s (F233 can add `onClick` handling without restructuring), `MonthGrid`'s day-cell mapping is a flat list F234 can wrap in a client "use client" drag boundary, and `getCalendarTasks` already excludes null-due-date tasks and accepts an optional `projectId` filter F235 can extend with an assignee filter.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Scope is workspace-wide with an optional project-filter seam, per spec's clarified default (see Decisions made).
AUTONOMOUS_DECISION: Week start is Monday, reusing F230's `bucket.ts` convention rather than inventing a second week-start rule (see Decisions made).
AUTONOMOUS_DECISION: Assignee avatars resolved via the existing shared `resolveAssignees` helper rather than a new `profiles` embed (see Decisions made).

## Notes for the next worker
- MCP usage: none required for this feature (registry lists "MCP at run: none" for F232, and no schema/migration changes were made — the `tasks`, `task_assignees`, `projects`, `project_statuses` tables and `is_project_visible_to`/`tasks_select_active_members` RLS this feature reads through already existed from prior features).
- `lib/calendar/month-grid.ts` is pure and has no DB dependency — the DST-transition test in `tests/unit/calendar-month-grid.test.ts` uses March 2026 (America/New_York spring-forward on 2026-03-08) as the transition month, matching the DST boundary already verified elsewhere in this codebase's `lib/time/user-timezone.ts` test suite.
- The 30 pre-existing integration test file failures observed in the full `npm test` run are Supabase Auth rate limiting ("Something went wrong. Please try again in a moment." from `auth.admin.createUser`) — a documented known infra condition in this feature's instructions, reproduced identically across many unrelated F-numbered test files, not a regression introduced by this feature. Re-running the F230/F232-scoped test files alone (isolated from the full-suite rate-limit pressure) passed cleanly (35/35).
