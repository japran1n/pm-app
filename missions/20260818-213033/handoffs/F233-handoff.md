# Handoff: F233 — calendar-task-interactions

## Status
COMPLETE

## Assertions covered
AS-444: PASS — real path proven against `getTaskDetail` (`lib/actions/tasks.ts`), the exact Server Action board.tsx's `?taskId=` click-to-open effect already calls, via `tests/integration/f233-calendar-task-interactions.test.ts` (`test_AS_444_clicking_a_task_the_caller_can_see_opens_its_real_detail_via_getTaskDetail`, plus negative cases for a private-project task and a nonexistent id both returning the identical "Task not found." message). UI wiring (chip and overflow-popover links pointing at the real `/w/{slug}/projects/{projectId}/board?taskId={id}` route) proven in `tests/unit/f233-calendar-day-overflow.test.tsx`.
AS-446: PASS — `tests/integration/f233-calendar-task-interactions.test.ts`'s `test_AS_446_undated_task_count_excludes_dated_tasks_and_counts_only_visible_undated_ones` and its negative sibling (private-project undated task not counted) drive the real `getUndatedTaskCount` query. The explanatory footer text is rendered by the calendar page whenever the count is non-zero (`UndatedTaskFooter` in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`).
AS-447: PASS — `tests/unit/f233-calendar-day-overflow.test.tsx`'s `test_AS_447_a_day_with_more_tasks_than_fit_shows_an_overflow_control_revealing_the_rest` (5 seeded tasks, cap of 3 inline, "+2 more" popover reveals the remaining 2) and its negative sibling (fewer tasks than the cap renders no overflow control).

## Files changed
lib/queries/calendar.ts
components/calendar/day-cell.tsx
components/calendar/day-overflow.tsx (new)
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/integration/f233-calendar-task-interactions.test.ts (new)
tests/unit/f233-calendar-day-overflow.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts — identical to F232's own handoff)
`npx vitest run tests/unit/f233-calendar-day-overflow.test.tsx` (0 — 3/3 passed)
`npx vitest run tests/integration/f233-calendar-task-interactions.test.ts` (0 — 5/5 passed)
`npx vitest run tests/integration/f232-calendar-query.test.ts tests/integration/f233-calendar-task-interactions.test.ts tests/unit/calendar-month-grid.test.ts tests/unit/f233-calendar-day-overflow.test.tsx tests/unit/board-task-detail-sheet-wiring.test.ts tests/unit/notification-bell-panel.test.tsx` (0 — 52/52 passed; the calendar + task-detail-sheet regression slice)
`npx vitest run tests/integration/f232-calendar-query.test.ts tests/integration/f233-calendar-task-interactions.test.ts` (re-run alone after the full-suite pass below, to isolate from rate-limit pressure — 0, 12/12 passed)
`npm test` (full suite, exit 0 from the runner itself but 54 test FILES / 90 tests failed with "Something went wrong. Please try again in a moment." from Supabase Auth rate limiting — a documented known infra condition, NOT related to this feature. 1732 passed / 90 failed / 198 skipped. Verified none of the 54 failing files are calendar/task-detail-sheet files — grepped the failure list for "calendar", "task-detail", "f233", "f232": zero matches. One unrelated pre-existing unhandled-rejection warning from `tests/unit/user-avatar.test.tsx` (a `cookies()`-outside-request-scope error inside `getMentionCandidates`, unrelated to this feature's files) also appeared, same class of pre-existing noise, not caused by this change.)

## Decisions made
- AS-444 is satisfied by reusing the EXACT click-through F232 already built (`TaskChip`'s `<Link href=".../board?taskId={id}">`) rather than building a second in-place sheet inside the calendar page — this matches the clarified instruction verbatim ("wire it to the same component and the same `?taskId=` style contract the board already uses"). F246 (the future dedicated `/tasks/[taskKey]` deep-link route named in the spec's Draft Scope) doesn't exist yet (M17, not yet built) — the CURRENT real deep-link convention is board.tsx's `?taskId=` search param + `useTaskDetailSheet`, which already calls the real `getTaskDetail` Server Action (F323-hardened). No new sheet, no new fetch path, no second source of truth was added.
- AS-446's "link to the list view filtered to them" (spec's Draft Scope) was NOT built: there is no existing workspace-wide "tasks with no due date" filtered view anywhere in this codebase (the per-project List view's filters are project-scoped, not workspace-wide; My Tasks is assignee-scoped, not "every undated task"). Building one would require touching `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx` or a new workspace-wide route, both outside this feature's named Files (`day-cell.tsx`, `day-overflow.tsx`, `calendar/page.tsx`). Per the clarified ambiguity-resolution rule ("the simpler option that adds no new dependency and no second source of truth"), AS-446 is satisfied by a plain explanatory footer text with the real count (no link) rather than a link to a page that doesn't correctly filter what it claims to. See "Out-of-scope work needed" below.
- AS-447's overflow cap is 3 visible chips per day cell (`DAY_CELL_VISIBLE_TASKS` in `day-cell.tsx`) — an arbitrary but reasonable number for a 7rem-min-height cell; not specified numerically anywhere in the spec/clarification, so this is the simplest fixed value that keeps the grid's fixed-row layout intact (growing the cell height per day would break the grid other days rely on).
- The overflow control is a Base UI `Popover` (`components/ui/popover.tsx`), the same primitive `components/notifications/notification-bell.tsx` already uses — its `PopoverTrigger` renders a real native `<button>` element (not a `<div onMouseEnter>`), so it is keyboard-reachable (Tab to focus, Enter/Space to activate, Escape to close) by construction, satisfying the clarification note ("must be keyboard reachable, not hover-only") without a new dependency.
- `getUndatedTaskCount` (lib/queries/calendar.ts) uses the plain RLS-scoped session client (`createClient()`), never `createAdminClient()` — mirrors `getCalendarTasks`'s own F322/F323-avoidance rationale exactly (same `tasks_select_active_members` RLS policy is the sole visibility boundary; no second hand-rolled check). Uses `count: "exact", head: true` for a single no-rows-fetched round trip, matching this feature's performance budget.

## Out-of-scope work needed
- A genuinely workspace-wide "tasks with no due date" filtered list view does not exist in this codebase yet. If a future feature wants AS-446's footer to link somewhere real, it needs either (a) a new workspace-wide route analogous to My Tasks but scoped to "every visible task with no due date" (not just the caller's own assigned tasks), or (b) extending the per-project List view's filters to accept a `?dueDate=none` param and building a workspace-level aggregator page. Neither exists today; this feature's footer intentionally shows the count with no link rather than link to something that doesn't correctly filter.
- Nav entry for "Calendar" in `components/nav/app-sidebar.tsx` still isn't wired (F232's handoff already flagged this; still true after F233 — deferred to whichever of F233/F234/F235 lands last, per that handoff's own note. Since this is the last of the three to touch this file's neighbors, F234 or F235's worker, or a small follow-up, should add it once F234/F235 land.)

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: AS-444 satisfied via the existing board `?taskId=` deep-link (no new sheet/route built) per the clarified spec's explicit instruction to reuse the same component/contract — see Decisions made.
AUTONOMOUS_DECISION: AS-446's "link to filtered list view" not built (no such filtered view exists workspace-wide); footer shows count + explanation text only, no link — simpler option, no new dependency, no second source of truth, per clarified ambiguity-resolution rule. See Decisions made and Out-of-scope work needed.
AUTONOMOUS_DECISION: overflow cap fixed at 3 visible chips per day cell — not specified numerically in the spec.

## Notes for the next worker
- MCP usage: none required. Registry lists "MCP at run: none" for F233, and no schema/migration changes were made — `getUndatedTaskCount` reads through the same `tasks`/`projects` tables and `is_project_visible_to` RLS predicate `getCalendarTasks` already established in F232.
- F234 (drag-reschedule, AS-445) and F235 (filters/responsive, AS-448/449) seams are unaffected: `MonthGrid`'s day-cell mapping and `getCalendarTasks`'s optional `projectId` narrowing param are untouched by this feature. `DayCell` now has one more prop-free internal cap constant (`DAY_CELL_VISIBLE_TASKS`) but its own props signature (`day`, `tasks`, `workspaceSlug`) is unchanged, so F234's drag-boundary wrapper around `MonthGrid`'s body doesn't need to know about the overflow control.
- `getTaskDetail`'s F323-hardened "Task not found." convention (never a distinguishable "forbidden" message) was verified end-to-end against a REAL seeded private-project task in this feature's own integration test, not assumed from reading the source — this is the exact bug class F322/F323 fixed, so it was worth re-proving here rather than trusting it by inspection alone.
