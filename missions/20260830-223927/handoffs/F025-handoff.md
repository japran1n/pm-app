# Handoff: F025 — Fix My Tasks realtime subscription (wrong column)

## Status
COMPLETE

## Assertions covered
AS-015: PASS — task_assignees INSERT for the caller's user_id triggers onAssigned (verified via subscribeToMyTasksRealtime unit test and component wiring test that dispatches the event and asserts rendered output changes)
AS-016: PASS — tasks UPDATE (no row filter) triggers onUpdate (unit test + component wiring test)
AS-017: PASS — task_assignees DELETE for the caller's user_id triggers onUnassigned; this is now deliverable because it is a DELETE on task_assignees rather than an UPDATE row-filter transition on tasks (unit test + component wiring test)
AS-018: PASS — tasks DELETE (no row filter) triggers onDelete (unit test + component wiring test)

## Files changed
components/my-tasks/use-my-tasks-realtime.ts
components/my-tasks/personal-todo-list.tsx
tests/unit/f008-my-tasks-realtime.test.ts
tests/unit/personal-todo-list-realtime-wiring.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f008-my-tasks-realtime.test.ts tests/unit/personal-todo-list-realtime-wiring.test.tsx` (0)
`npx vitest run tests/unit` (0) — 192 files, 1474 tests passed
`npm test` (0 exit, but several pre-existing integration test failures unrelated to this feature — see Notes)
`npx eslint components/my-tasks/use-my-tasks-realtime.ts components/my-tasks/personal-todo-list.tsx tests/unit/f008-my-tasks-realtime.test.ts tests/unit/personal-todo-list-realtime-wiring.test.tsx` (0)
`npx tsc --noEmit` (0)
`git commit` (0)

## Decisions made
- Root cause was exactly as described in the assigned brief: `tasks.assignee_id` is DEPRECATED (comment on that column, migration `20260822020000_task_assignees_table.sql`); `getMyTasks` (lib/queries/my-tasks.ts) already reads assignment via `task_assignees!inner(user_id)`, confirming the join table is the live source of truth.
- Replaced the single filtered `tasks` subscription with two unfiltered subscriptions on the same shared channel/topic (`tasks:my-tasks:<userId>`): `task_assignees` (INSERT/DELETE) and `tasks` (UPDATE/DELETE). Correctness relies on each table's own RLS SELECT policy, which Realtime re-applies server-side before broadcasting (task_assignees is scoped via `is_task_visible_to`, tasks via its own membership policy) — same pattern already documented and trusted in the original F008 comments for the `tasks` table.
- Did not subscribe to `tasks` INSERT: a brand-new task row by itself is never "newly mine" — the `task_assignees` INSERT event is what signals a new assignment (whether the task is brand new or pre-existing). This avoids a bug where a task INSERT for someone else's assignment could be misinterpreted.
- Changed the hook's public callback contract from `{ onInsert, onUpdate, onDelete }` to `{ onAssigned, onUnassigned, onUpdate, onDelete }` to reflect the two distinct event sources — `task_assignees` events don't carry full task rows (only `task_id`/`user_id`), so callers get a task id and are expected to refetch/refresh, exactly matching this codebase's existing `PersonalTodoList` wiring (`router.refresh()` for all four).
- `PersonalTodoList` is the only consumer of `useMyTasksRealtime` in the codebase (verified via grep) — updated its four callback props to the new names, same `router.refresh()` behaviour as before.
- Rewrote `tests/unit/f008-my-tasks-realtime.test.ts` in full (the old assertions on `filter: "assignee_id=eq.user-1"` were testing the bug itself, per the brief) to cover the new two-table, no-row-filter subscription shape and all four assertions plus payload-validation edge cases.
- Added `tests/unit/personal-todo-list-realtime-wiring.test.tsx`: mocks `useMyTasksRealtime` to capture the handlers `PersonalTodoList` passes in, mocks `next/navigation`'s `useRouter().refresh` to simulate the server round-trip (re-renders with fresh `initialTodos`), then dispatches each of the four fake events and asserts the rendered DOM changes. Deleting the `useMyTasksRealtime(...)` call from `personal-todo-list.tsx` makes the "mounts useMyTasksRealtime scoped to the current user" test fail immediately (mock never invoked), and the other four tests fail because `capturedHandlers` stays null.

## Out-of-scope work needed
None identified beyond this feature's stated scope. F011's `reconcileMyTasksRealtimeTask` pure helper (referenced in the original F008 comments) is still not wired into a stateful client-side task list — that remains a separate, not-yet-scoped enhancement (`router.refresh()` is the current, correct-per-clarified-spec behaviour for this feature).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Renamed the hook's `onInsert` callback prop to `onAssigned` (paired with a new `onUnassigned`) since a `task_assignees` INSERT is semantically "this task is now assigned to me," not "a new task row was created" — the old `onInsert` name from F008 no longer accurately describes what fires it. This is a breaking rename of the hook's public API; the only in-repo consumer (`PersonalTodoList`) was updated in the same commit, and a grep confirmed no other callers exist.

## Notes for the next worker
- `npm test` (full suite) exits 0 overall but reports failures in several *integration* tests (`tests/integration/assign-task.test.ts`, `f306-mutation-fanout.test.ts`, `bulk-restore-tasks.test.ts`, `workspace-members-list.test.ts`, `create-workspace-owner.test.ts`) with `PGRST202: Could not find the function public.restore_task_atomic / set_task_assignees_atomic / bulk_delete_tasks_atomic ...`. These are local Supabase schema-cache misses for RPC functions that migrations define but the running local instance hasn't picked up (PostgREST schema cache stale, or migrations not applied to the local DB) — unrelated to this feature's files and pre-existing before this change (none of the failing tests touch `use-my-tasks-realtime.ts` or `personal-todo-list.tsx`). Full `tests/unit` (192 files, 1474 tests, no DB dependency) passes cleanly. Recommend the orchestrator re-run local Supabase migrations (`supabase db reset` / re-apply) before trusting integration suite results on a future feature.
- No MCP tools were used for this feature — it's pure application-code + unit-test work; no live schema/policy changes were needed (the `task_assignees` table and its RLS policies already exist per the migration read at the start of this task).
