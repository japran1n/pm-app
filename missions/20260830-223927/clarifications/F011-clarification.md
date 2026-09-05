# F011 Clarification — My Tasks realtime reconciliation helper

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Pure function `reconcileMyTasksRealtimeTask(tasks, event, userId)` returning new array
2. **Data shape** ★ Input: current `MyTask[]` + event + userId; output: new `MyTask[]`
3. **State location** ★ Stateless helper
4. **API contract** ★ `reconcileMyTasksRealtimeTask(tasks: T[], event: RealtimePostgresChangesPayload<T>, userId: string): T[]`
5. **Failure handling** ★ Unknown event: return tasks unchanged
6. **Empty state** ★ Empty array handled naturally
7. **Validation** ★ Validate eventType; check assignee_id presence
8. **Performance budget** ★ O(n); negligible
9. **Access control** ★ N/A — pure function; RLS handled at subscription level
10. **Touches** ★ New `lib/tasks/reconcile-my-tasks-realtime-task.ts`

## Round B — Follow-ups

11. ★ INSERT: add task if `new_record.assignee_id === userId` and not already in list
12. ★ UPDATE with `assignee_id === userId`: update existing row in list (status change etc.)
13. ★ UPDATE with `assignee_id !== userId` (un-assign): remove task from list
14. ★ DELETE: remove task from list by id
15. ★ Unit test all cases including un-assign detection

## Definition of done

16. **Primary success test** ★ Unit test: INSERT adds task; UPDATE-status updates row; UPDATE-unassign removes row; DELETE removes row
17. **Failure test** ★ Unit test: unknown event type returns original array
18. **Manual verification** ★ Covered by F008's manual verification
19. **Side-effect verification** ★ Pure function — no side effects
20. **Evidence artifact** ★ Test output (vitest)
