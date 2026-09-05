# F010: Calendar realtime — task reconciliation helper

**Milestone:** M2 — Realtime expansion
**Estimated worker time:** 30 min
**Depends on:** F009

## Assertion IDs covered
- AS-019: (reconcile logic that F009 hook depends on)
- AS-020: (reconcile INSERT case)
- AS-021: (reconcile UPDATE-clear-date and DELETE cases)

## Draft scope
- Create `lib/tasks/reconcile-calendar-realtime-task.ts`.
- Pure function: given calendar task list + realtime event → return new list.
- Mirrors existing `reconcile-list-realtime-task.ts`.
- Unit-test all 4 cases.

## Files (approximate)
`lib/tasks/reconcile-calendar-realtime-task.ts`, corresponding test file

## Notes
- MCP at run: none
- Read `lib/tasks/reconcile-list-realtime-task.ts` as the canonical pattern to mirror

---

## Clarified implementation (from clarifications/F010-clarification.md)

- Pattern: Pure function `reconcileCalendarRealtimeTask(tasks, event)` returning new array
- Data shape: `CalendarTask[]` + Supabase realtime event → `CalendarTask[]`
- State location: Stateless helper
- API contract: `reconcileCalendarRealtimeTask(tasks: T[], event: RealtimePostgresChangesPayload<T>): T[]`
- Failure handling: Unknown event type: return tasks unchanged; log warning
- Empty state: Empty array handled naturally
- Validation: Validate event.eventType is INSERT/UPDATE/DELETE
- Performance budget: O(n); negligible
- Access control: N/A — pure function
- Touches: New file mirrors reconcile-list-realtime-task.ts

### Follow-up decisions
- INSERT: add task if due_date is non-null and not already present
- UPDATE: if due_date changed — replace in array; if null — remove
- UPDATE with null due_date: remove task from array
- DELETE: remove task by id
- Unit test all 4 cases with fixture data

## Definition of done

- **Primary success test:** Unit test covers INSERT, UPDATE-move, UPDATE-clear, DELETE
- **Failure test:** Unit test: unknown event type returns original array
- **Manual verification:** Covered by F009's manual verification
- **Side-effect verification:** Pure function — no side effects
- **Evidence artifact:** Test output (vitest)
