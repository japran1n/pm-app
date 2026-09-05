# F009: Calendar realtime subscription

**Milestone:** M2 — Realtime expansion
**Estimated worker time:** 45 min
**Depends on:** none

## Assertion IDs covered
- AS-019: When a task's due date is changed by another user, the task moves to the new date column on the calendar without a page refresh.
- AS-020: When a new task with a due date is created by another user, it appears on the calendar on the correct day without a page refresh.
- AS-021: When a task's due date is removed by another user, the task disappears from the calendar without a page refresh.
- AS-022: Calendar realtime only delivers events for tasks the current user is permitted to see.

## Draft scope
- Create `components/calendar/use-calendar-realtime.ts`.
- Subscribe to task changes for the workspace where `due_date` is involved.
- Use shared-topic-channel; RLS handles visibility automatically.
- Wire into the calendar page component.

## Files (approximate)
`components/calendar/use-calendar-realtime.ts`, calendar page component

## Notes
- MCP at run: none
- Read the calendar page component first to understand its task state shape
- Need `old_record` in subscription for move detection

---

## Clarified implementation (from clarifications/F009-clarification.md)

- Pattern: Custom hook `use-calendar-realtime.ts` using `shared-topic-channel.ts`
- Data shape: Subscribes to `postgres_changes` on `tasks` with `workspace_id = eq.{workspaceId}`
- State location: Callback-based; calendar component owns state
- API contract: `useCalendarRealtime({ workspaceId, onDueDateChange })`
- Failure handling: Supabase client handles reconnects; no custom retry
- Validation: Validate that event payload has `due_date` field before acting
- Performance budget: Event delivery is network-latency-bound; calendar update instant
- Access control: Supabase Realtime RLS automatic
- Touches: New hook + calendar page component

### Follow-up decisions
- Topic: `tasks:calendar:${workspaceId}`
- Events: INSERT with non-null due_date; UPDATE changing due_date; UPDATE clearing due_date; DELETE
- For UPDATE: compare `old_record.due_date` vs `new_record.due_date` to detect moves
- Use F010's reconcile helper for all state transitions
- Ensure subscription requests `old` record for due_date change detection

## Definition of done

- **Primary success test:** Unit test: callback called when UPDATE changes due_date
- **Failure test:** Unit test: task removed from calendar when due_date set to null
- **Manual verification:** Two tabs: change due date in A → task moves in calendar B
- **Side-effect verification:** Private project tasks not delivered (RLS)
- **Evidence artifact:** Test output (vitest)
