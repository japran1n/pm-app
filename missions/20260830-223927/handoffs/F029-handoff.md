# Handoff: F029 — Fix calendar DELETE gate + reconciler data fabrication

## Status
COMPLETE

## Assertions covered
AS-019: PASS — existing "moves a task to its new date bucket when UPDATE changes due_date" test still passes; no change to this path, only touched to add project_id/isDone derivation for INSERT and DELETE local-state gate.
AS-020: PASS — added tests "derives isDone from the payload's status on INSERT rather than hardcoding false" and "keeps isDone false on INSERT when the payload's status is not 'done'"; isDone now computed via `isDoneStatus(row.status)` instead of hardcoded `false`.
AS-021: PASS — existing UPDATE-clears-due_date and DELETE tests still pass unchanged.
AS-022: PASS — replaced the inert `old.project_id` DELETE check (project_id is never present in real replica-identity-default payloads) with a local-state-presence check; added test "ignores a DELETE event for a task id not present in local state" and "removes a task on DELETE when its id IS present in local state, even with no project_id on old" (realistic `old: {id}`-only payload shape).

## Files changed
lib/calendar/reconcile-realtime-task.ts
tests/unit/f009-calendar-realtime-subscription.test.ts

## Commands run
`npx vitest run tests/unit/f009-calendar-realtime-subscription.test.ts tests/unit/f027-calendar-realtime-wiring.test.tsx tests/unit/f234-calendar-day-grid-wiring.test.ts tests/unit/f326-calendar-day-grid-rerender.test.tsx` (0, 31 passed)
`npx vitest run $(find tests -iname "*calendar*")` (0, 14 files / 96 tests passed)
`npx eslint lib/calendar/reconcile-realtime-task.ts tests/unit/f009-calendar-realtime-subscription.test.ts` (0, no output)
`npx tsc --noEmit` (0, no output)
`npm run lint` (0, 13 pre-existing warnings in unrelated files, 0 errors)

## Decisions made
- AS-022 fix: rewrote the DELETE branch of `reconcileCalendarRealtimeEvent` to check `findTask(byDate, deletedId)` (is this id currently in our local state) instead of `event.old?.project_id`. The old check was permanently dead code — `tasks` has no `replica identity full` (confirmed via the spec and `subscribe-calendar-realtime.ts`'s own doc comments), so Supabase Realtime's DELETE `old` payload only ever carries `{id}` in production; `old.project_id` is always `undefined`, so `if (projectId && ...)` never evaluated true. "Not in local state" is an equivalent-or-better proxy for "not visible to this caller," since every task that IS in local state got there via an RLS-gated fetch or RLS-gated INSERT/UPDATE.
- Rewrote the pre-existing test `"ignores a DELETE event for a project outside the caller's visible set (AS-022)"` because it fabricated `old.project_id` on the DELETE payload — a shape that can never occur against the real `tasks` table's replica identity. Replaced it with two tests that use the realistic `old: {id}`-only shape: one where the id is absent from local state (skipped) and one where it's present (removed).
- AS-020 fix: `isDone` on a fresh INSERT is now `isDoneStatus(row.status)` (no `category` arg), which per `lib/tasks/status-category.ts`'s own documented "degraded path" falls back to a literal `status === "done"` string comparison when category is unresolvable. This matches the codebase's existing documented convention for the "status_id unresolvable" case rather than inventing a new heuristic. `statusCategory`, `projectKey`, `projectName`, `assignees` are left defaulted — these require joins (`project_statuses`, `projects`, `task_assignees`) that a bare `tasks` row `postgres_changes` event never carries, so they are genuinely unavailable, not merely unused. Documented this distinction in the file's own header comment.
- URL filter check (status/priority/assigneeId/projectId) on INSERT: investigated `CalendarDayGrid`'s props (`components/calendar/calendar-day-grid.tsx`) and found it only receives `workspaceId`/`projectIds` (visibility set), not the calendar page's resolved filter object. There is no existing prop channel to hang a filter check off of without also changing the page/grid's prop contract, which is outside `reconcile-realtime-task.ts`'s and `use-calendar-realtime.ts`'s scope (the two files this feature spec names under "Files"). Left as a documented known limitation in the reconciler's header comment rather than guessed at.

## Out-of-scope work needed
- Threading calendar filter params (status/priority/assigneeId/projectId) through `month-grid.tsx` → `CalendarDayGrid` → `useCalendarRealtime` → `reconcileCalendarRealtimeEvent` so realtime-INSERTed tasks that don't match the active filter are skipped. Would need a new prop on `CalendarDayGrid` (e.g. `activeFilters`) and a filter-match check added to the INSERT branch of the reconciler, mirroring however `resolve-filters.ts` already resolves these for the initial server fetch.
- Resolving `projectKey`/`projectName`/`assignees` for realtime-INSERTed calendar tasks (currently left defaulted to `null`/`""`/`[]`) — would need either a client-side lookup against an already-fetched project/member list passed into the grid, or a follow-up server round trip per INSERT event.
- Mobile `AgendaList` (AS-019, AS-021 on the `md:hidden` surface) — see below, explicitly out of scope for M2.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `visibleProjectIds` as a parameter to `reconcileCalendarRealtimeEvent` and still use it to gate INSERT/UPDATE (unchanged from before this feature) even though it's no longer used for DELETE. Removing the parameter entirely would be a larger API surface change than this feature's stated scope ("replace the project_id visibility check" for DELETE specifically), and INSERT/UPDATE payloads DO reliably carry `project_id` (they come through the full `new` row, not the truncated `old` row), so that check remains valid and load-bearing there.

## Notes for the next worker
- `AgendaList` (mobile, `md:hidden`) is a Server Component and architecturally cannot receive live realtime state without a larger refactor (converting it to a client component or wrapping it). This was already documented as out of scope for M2 in this feature's own spec (see spec's "Mobile AgendaList (AS-019, AS-021)" section) and is reaffirmed here as an explicit decision, not an oversight: M2's realtime scope is the desktop day/month grid (`CalendarDayGrid`) only.
- No MCP tools were used for this feature — it's a pure client-side reconciliation-logic fix with no live schema/policy dependency; the `replica identity full` fact was taken from the feature spec and the existing `subscribe-calendar-realtime.ts` doc comments, not re-verified against the live Supabase project via MCP.
- The existing file header comment block in `reconcile-realtime-task.ts` was updated in place to describe the new DELETE gate and INSERT `isDone` derivation, plus the documented filter-params limitation — read it before touching this file again.
