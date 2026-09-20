# Handoff: F019 — Delete obsolete task-in-Planner tests; prove My Tasks is untouched; prove no dead task code on the route

## Status
COMPLETE

## Assertions covered
AS-040: PASS — `grep -rl "task" "app/(workspace)/w/[workspaceSlug]/my-tasks/"` still returns results (page.tsx, error.tsx reference tasks); no My Tasks test file was deleted; My Tasks route/tests untouched by this feature.
AS-080: PASS — `tests/integration/f232-calendar-query.test.ts`, `tests/integration/f233-calendar-task-interactions.test.ts`, `tests/integration/f235-calendar-filters.test.ts`, `tests/unit/f235-calendar-resolve-filters.test.ts`, and `tests/e2e/f235-calendar-responsive.spec.ts` (all entirely about task behaviour inside the Planner calendar) are deleted, not skipped/commented.
AS-081: PASS — `grep -rn "getCalendarTasks\|CalendarFilters\|resolveCalendarFilters\|task_id" "app/(workspace)/w/[workspaceSlug]/calendar/"` returns zero results. `page.tsx` no longer imports `getCalendarTasks`/`CalendarTask`/`resolveCalendarFilters`/`CalendarFilters`; `WeekView`/`WeekTimeGrid`/`WeekAgenda` no longer accept or pass a `tasksByDate` prop.

## Files changed
(No net diff remains under my ownership at handoff time — see Notes below. The obsolete test files and the route's dead task-fetching code were already removed on `HEAD` by the time this handoff was written, due to concurrent worker activity on the same checkout. State verified directly against `HEAD`:)
- tests/integration/f232-calendar-query.test.ts (deleted)
- tests/integration/f233-calendar-task-interactions.test.ts (deleted)
- tests/integration/f235-calendar-filters.test.ts (deleted)
- tests/unit/f235-calendar-resolve-filters.test.ts (deleted)
- tests/e2e/f235-calendar-responsive.spec.ts (deleted)
- app/(workspace)/w/[workspaceSlug]/calendar/page.tsx (no `getCalendarTasks`/`CalendarFilters`/`resolveCalendarFilters` references remain)
- components/calendar/week-view.tsx, week-time-grid.tsx, week-agenda.tsx (no `tasksByDate` prop remains)
- missions/20260920-124226/features/F019-delete-obsolete-task-tests.md (already present, read-only per spec)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0` (0)
`npx vitest run tests/unit` (1 — 41 pre-existing failing files / 133 pre-existing failing tests, all unrelated to calendar/tasks, confirmed present on HEAD before any of this feature's work — see Notes)
`grep -rn "getCalendarTasks|CalendarFilters|resolveCalendarFilters|task_id" "app/(workspace)/w/[workspaceSlug]/calendar/"` → 0 results
`grep -rl "task" "app/(workspace)/w/[workspaceSlug]/my-tasks/"` → 2 results (page.tsx, error.tsx)
`find tests -iname "*f232-calendar-query*" -o -iname "*f233-calendar-task-interactions*" -o -iname "*f235-calendar-responsive.spec*" -o -iname "*f235-calendar-filters.test*" -o -iname "*f235-calendar-resolve-filters*"` → 0 results

## Decisions made
- Confirmed each of the four files named in the spec's "Files (approximate)" list is entirely about task-in-Planner behaviour (not partly), so each was deleted wholesale rather than partially trimmed, per the spec's own guidance ("Check whether each file is entirely about tasks-in-Planner... keep the parts that still describe live behaviour" — none of these files had any non-task-related live behaviour to keep).
- Also deleted `tests/unit/f235-calendar-resolve-filters.test.ts` (unit-level counterpart of the integration filters test, testing the same deleted `resolveCalendarFilters` — matches AS-080's "tests covering task behaviour inside the Planner" scope even though not literally named in the spec's approximate file list).
- Left `components/calendar/month-grid.tsx` and `components/calendar/agenda-list.tsx` (and `tests/unit/f235-calendar-responsive-render.test.tsx`, which exercises them) untouched — out of scope, see below.

## Out-of-scope work needed
- `components/calendar/month-grid.tsx` and `components/calendar/agenda-list.tsx` still exist and still render task chips, but are no longer imported by the calendar route (Month view was removed by an earlier product decision; Week/`WeekView` is the only view now). `tests/unit/f235-calendar-responsive-render.test.tsx` still tests these two dead components against `tasksByDate` fixtures. This wasn't in F019's "Files (approximate)" list and touches components, not just tests — flagging as a follow-up: a small cleanup feature to delete `month-grid.tsx`, `agenda-list.tsx`, and their test file once confirmed unreachable from any route.
- `lib/queries/calendar.ts` still exports `getCalendarTasks`/`CalendarTask`/`getWorkspaceStatusOptions` (not imported by the Planner route anymore, but not verified dead across the whole app — e.g. My Tasks or other routes may still use adjacent exports). Not touched since the spec's AS-081 grep is scoped to `app/.../calendar/`, not `lib/`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The repo showed heavy concurrent-worker churn on this checkout during this task (uncommitted F015 work with no handoff, a mid-session `git stash`/`pop` that surfaced an unrelated worker's stash, and new commits landing on `HEAD` from other workers, including a `revert:` commit that incidentally deleted the same obsolete test files this feature targets). I verified the final `HEAD` state directly (fresh `grep`/`find`/`tsc`/`eslint`/`vitest` runs against the actual files on disk, not against my own edit history) rather than trusting my own edit sequence, since several of my own edits were clobbered mid-session by concurrent commits. All three assertions were independently re-verified against the current `HEAD` before writing this handoff.
AUTONOMOUS_DECISION: Treated the spec's My Tasks grep path (`app/(workspace)/w/[workspaceSlug]/tasks/`) as a typo for the actual route `app/(workspace)/w/[workspaceSlug]/my-tasks/` (the `tasks/` directory does not exist in this repo) and verified against the real route instead.

## Notes for the next worker
- Do not use `git stash` on this checkout during `/mission-run` — this session's `git stash` / `git stash pop` surfaced a stash left behind by a different concurrent worker process (`stash@{0}: WIP on main: 36c06984 feat(F105)...`), not this session's own stash, and briefly reverted work already believed complete. If you need to diff against a clean state, use `git show HEAD:<path>` or a throwaway worktree instead.
- By the time this handoff was written, F015 (remove-task-strips) and F017 (delete-calendar-filters)'s scope had already landed on `HEAD` via other workers' commits (visible in `git log` as e.g. a `revert:` commit and various `feat(F...)`/`fix(F...)` commits), even though no `F015-handoff.md` exists yet in `missions/20260920-124226/handoffs/`. The orchestrator may want to reconcile the handoff ledger for F015/F017 against actual `HEAD` state.
- No MCP tools were used — this feature is pure test/dead-code deletion with no external service surface.
