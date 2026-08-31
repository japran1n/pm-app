# Handoff: F011 — My Tasks realtime reconciliation helper

## Status
COMPLETE

## Assertions covered
AS-015: PASS — `test_AS_015_insert_adds_newly_assigned_task` and `test_AS_015_insert_for_other_assignee_is_ignored` in `tests/unit/reconcile-my-tasks-realtime-task.test.ts`
AS-016: PASS — `test_AS_016_update_status_updates_existing_task_in_place`
AS-017: PASS — `test_AS_017_update_with_null_assignee_removes_task`, `test_AS_017_update_reassigned_to_someone_else_removes_task`, `test_AS_017_delete_removes_task`

## Files changed
lib/tasks/reconcile-my-tasks-realtime-task.ts (new)
tests/unit/reconcile-my-tasks-realtime-task.test.ts (new)

## Commands run
`npx vitest run tests/unit/reconcile-my-tasks-realtime-task.test.ts` (0) — 9/9 tests passed
`npx vitest run tests/unit` (0) — 187 passed / 3 pre-existing unrelated failures (see below)
`npm run lint` (0) — 0 errors, 13 pre-existing warnings in unrelated files
`npx tsc --noEmit` (0) — no type errors

## Decisions made
- Followed the clarified spec's API contract `reconcileMyTasksRealtimeTask(tasks: T[], event: RealtimePostgresChangesPayload<T>, userId: string): T[]` (from `clarifications/F011-clarification.md`, ★ answers), not the simplified `(todos, event)` two-arg signature mentioned in the initial task prompt — the clarification file and feature spec are the source of truth per CLAUDE.md/worker rules, and the `userId` parameter is required to determine un-assignment (AS-017) and to filter INSERTs to only tasks assigned to the current caller (a bare event has no way to know "is this mine" without it).
- Named the helper's row type `MyTaskRealtimeRow` (generic-constrained, matching the `reconcile-list-realtime-task.ts` pattern of taking `T extends <RowShape>`) rather than importing `PersonalTodo` from `lib/queries/personal-todos.ts` — `PersonalTodo` is an unrelated model (workspace-scoped personal checklist items with no `assignee_id`/Realtime table), while F008's hook (`components/my-tasks/use-my-tasks-realtime.ts`) subscribes to the `tasks` table filtered by `assignee_id`. The feature spec, clarification file, and F008's own doc comment ("F011's `reconcileMyTasksRealtimeTask` pure helper is the intended reconciliation function") all confirm this helper reconciles `tasks` rows, not `PersonalTodo` rows.
- Did not modify `components/my-tasks/use-my-tasks-realtime.ts` (F008). That hook is deliberately callback-based per its clarified design ("State ownership is left to the caller") and holds no task-array state to reconcile — there is no inline reconciliation logic to extract/refactor. Its un-assign detection (any UPDATE where `new.assignee_id !== userId` routed to `onDelete`) is a *dispatch* rule for the hook's three callbacks, separate from this feature's pure array-reconciliation helper, which independently re-derives the same un-assign rule from a raw event + userId for callers that don't go through the hook's callbacks.
- Un-assign detection covers both `assignee_id === null` and `assignee_id === <different user>`, matching F008's documented behavior and the clarified "un-assign" definition.
- An UPDATE for a still-assigned-to-me task not currently present in the list (e.g., the client missed the original INSERT) is treated as an insert rather than silently dropped — a defensive addition consistent with the "O(n), no side effects" performance/purity budget and not contradicted by any clarified answer.

## Out-of-scope work needed
None identified. No inline reconciliation logic existed in F008 to migrate.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the clarified spec's 3-argument signature (tasks, event, userId) instead of the 2-argument signature named in the initial task instructions, because the feature spec and clarification file (the authoritative source per project rules) both specify the userId parameter and it is required to correctly implement un-assignment/scoping logic (AS-017 cannot be determined from the event alone).
AUTONOMOUS_DECISION: Defined a local `MyTaskRealtimeRow` type instead of reusing `PersonalTodo` — see "Decisions made" above for the rationale that these are different domain models.

## Notes for the next worker
- Reference pattern followed: `lib/tasks/reconcile-list-realtime-task.ts` (F251) — generic-over-`T`, switch-on-eventType, `slice()`-based immutable update-in-place.
- `components/my-tasks/use-my-tasks-realtime.ts`'s doc comment (F008) explicitly names this helper as "the intended reconciliation function for callers that hold a task array in state" — no caller currently wires the two together (My Tasks page currently only renders `PersonalTodo` list state, unrelated to assigned-`tasks` Realtime). Wiring a caller (e.g., an assigned-tasks widget on the My Tasks page) that actually uses `useMyTasksRealtime` + `reconcileMyTasksRealtimeTask` together is out of scope for F011 per its "New file" touches answer, and appears to not yet exist as a feature in `plan.md` — flag to orchestrator if a UX validator expects to see assigned tasks live-updating in the UI itself, since today only the pure helper and the subscription hook exist independently.
- No MCP tools used — pure client-side logic, no live schema/policy introspection needed (Realtime publication for `tasks` was already verified by a prior migration per F008's handoff).
