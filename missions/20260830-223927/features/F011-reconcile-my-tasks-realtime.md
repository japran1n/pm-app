# F011: My Tasks realtime reconciliation helper

**Milestone:** M2 — Realtime expansion
**Estimated worker time:** 30 min
**Depends on:** F008

## Assertion IDs covered
- AS-015: (reconcile INSERT/assign case)
- AS-016: (reconcile UPDATE-status case)
- AS-017: (reconcile UPDATE-unassign case)

## Draft scope
- Create `lib/tasks/reconcile-my-tasks-realtime-task.ts`.
- Pure function: `reconcileMyTasksRealtimeTask(tasks, event, userId)` → new array.
- Unit-test all cases including un-assign detection.

## Files (approximate)
`lib/tasks/reconcile-my-tasks-realtime-task.ts`, corresponding test

## Notes
- MCP at run: none
- Read reconcile-list-realtime-task.ts as pattern reference

---

## Clarified implementation (from clarifications/F011-clarification.md)

- Pattern: Pure function returning new array
- Data shape: `MyTask[]` + event + userId → `MyTask[]`
- State location: Stateless helper
- API contract: `reconcileMyTasksRealtimeTask(tasks: T[], event: RealtimePostgresChangesPayload<T>, userId: string): T[]`
- Failure handling: Unknown event: return tasks unchanged
- Validation: Validate eventType; check assignee_id presence
- Performance budget: O(n); negligible
- Access control: N/A — pure function; RLS handled at subscription level
- Touches: New file

### Follow-up decisions
- INSERT: add task if `new_record.assignee_id === userId` and not already in list
- UPDATE with `assignee_id === userId`: update existing row (status change etc.)
- UPDATE with `assignee_id !== userId` (un-assign): remove task from list
- DELETE: remove task by id
- Unit test all cases including un-assign detection

## Definition of done

- **Primary success test:** Unit test: INSERT adds, UPDATE-status updates, UPDATE-unassign removes, DELETE removes
- **Failure test:** Unit test: unknown event type returns original array
- **Manual verification:** Covered by F008's manual verification
- **Side-effect verification:** Pure function — no side effects
- **Evidence artifact:** Test output (vitest)
