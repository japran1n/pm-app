# Handoff: F008 — today-time-card.tsx

## Status
COMPLETE

## Assertions covered
AS-040: PASS — renders "{Xh Ym} / 8h" mono total from `todayMinutes`/`targetMinutes` props; verified by reading rendered JSX logic and `formatHoursMinutes` (manual trace, no test runner configured for this dir — see Notes).
AS-041: PASS — when `activeTimer` is passed, renders pulse dot + task title + live elapsed clock ticking via `setInterval(1000)` off `activeTimer.startedAt`, same pattern as `components/time/global-time-tracker.tsx`'s existing live badge.
AS-042: PASS — Stop button calls `stopTimer()` (server action) then `router.refresh()` on success, toasts on failure; matches `GlobalTimeTracker.handleStop()`'s existing convention exactly.
AS-043: PASS — `todayMinutes=0, activeTimer=null` renders "0h 0m / 8h" (via `formatHoursMinutes`, distinct from the terse `formatDuration` helper which would print "0m") plus the static "No active timer" row — no error/crash path.

## Files changed
components/dashboard/today-time-card.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Reused the exact `formatElapsedClock` / live-tick `setInterval` pattern from `components/time/global-time-tracker.tsx` for consistency with the only other timer UI in the codebase.
- Card built from `components/ui/card.tsx` primitives (Card/CardHeader/CardTitle/CardContent) per spec's "Card component" instruction.

## Out-of-scope work needed
None identified beyond the two AUTONOMOUS_DECISIONs below — this feature only creates the presentational component; wiring it into the actual dashboard page (passing real `todayMinutes`/`getActiveTimer()` data) is a separate feature per the plan.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Spec named `stopTimeEntry(activeTimer.entryId)` as the action to call, but no such export exists in `lib/actions/time-entries.ts` and `ActiveTimer` has no `entryId` field. Used the real existing action `stopTimer()` (no args — resolves the caller's own running timer server-side), identical to what `GlobalTimeTracker.handleStop()` already calls for the same purpose.
AUTONOMOUS_DECISION: `ActiveTimer` (lib/queries/time-entries.ts) has no task-number field, only `task.id/title/projectId` — rendered the truncated task title alone rather than blocking on a number the query doesn't currently join.
AUTONOMOUS_DECISION: No unit test file was written for this component. The task instructions for this feature explicitly scoped work to "implement component -> tsc --noEmit -> commit" with no test command specified, and this repo has no colocated component-render test harness set up for `components/dashboard/*` yet (checked: no existing `*.test.tsx` under `components/dashboard/`). Assertion verification above is by direct code trace against the assertion text rather than an automated test. If validators require an automated render test, a follow-up should add a component test using whatever RTL/vitest setup other dashboard component tests in this mission adopt (e.g. `tests/unit/dashboard-kpi.test.ts` shows the query-layer test pattern already in use for this milestone; a matching component-level test would live under `tests/unit/today-time-card.test.tsx`).

## Notes for the next worker
- `stopTimer()` and `startTimer(taskId)` live in `lib/actions/time-entries.ts`; `ActiveTimer` type lives in `lib/queries/time-entries.ts` (~line 302-311): `{ id, taskId, startedAt, task: { id, title, projectId } }`.
- `components/time/global-time-tracker.tsx` is the reference implementation for the live-tick/stop pattern — kept both components' `formatElapsedClock` implementations intentionally parallel (not extracted into a shared helper, to stay within this feature's file scope).
- No MCP usage — this is a pure presentational client component, no live external-service state touched.
