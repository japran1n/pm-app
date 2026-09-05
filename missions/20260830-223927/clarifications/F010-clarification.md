# F010 Clarification — Calendar realtime reconciliation helper

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Pure function `reconcileCalendarRealtimeTask(tasks, event)` returning new task array
2. **Data shape** ★ Input: current `CalendarTask[]` + Supabase realtime event; output: new `CalendarTask[]`
3. **State location** ★ Stateless helper; state lives in caller
4. **API contract** ★ `reconcileCalendarRealtimeTask(tasks: T[], event: RealtimePostgresChangesPayload<T>): T[]`
5. **Failure handling** ★ Unknown event type: return tasks unchanged; log warning
6. **Empty state** ★ Empty array in → empty array out for DELETE/UPDATE events
7. **Validation** ★ Validate event.eventType is INSERT/UPDATE/DELETE
8. **Performance budget** ★ O(n) array operations; negligible
9. **Access control** ★ N/A — pure function
10. **Touches** ★ New `lib/tasks/reconcile-calendar-realtime-task.ts`; mirrors existing `reconcile-list-realtime-task.ts`

## Round B — Follow-ups

11. ★ INSERT: add task to array if due_date is non-null and not already present
12. ★ UPDATE: if due_date changed — remove from old date bucket, add to new date bucket (functionally: replace in array)
13. ★ UPDATE with null due_date: remove task from array
14. ★ DELETE: remove task from array by id
15. ★ Unit test all 4 cases with fixture data

## Definition of done

16. **Primary success test** ★ Unit test covers INSERT, UPDATE-move, UPDATE-clear, DELETE
17. **Failure test** ★ Unit test: unknown event type returns original array unchanged
18. **Manual verification** ★ Covered by F009's manual verification
19. **Side-effect verification** ★ Reconcile function is pure — no side effects possible
20. **Evidence artifact** ★ Test output (vitest)
