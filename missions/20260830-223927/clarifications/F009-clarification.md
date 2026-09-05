# F009 Clarification — Calendar realtime subscription

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Custom hook `use-calendar-realtime.ts` using `shared-topic-channel.ts`
2. **Data shape** ★ Subscribes to `postgres_changes` on `tasks` filtered by `workspace_id = eq.{workspaceId}`; process only events where `due_date` is involved
3. **State location** ★ Callback-based; calendar component owns state
4. **API contract** ★ `useCalendarRealtime({ workspaceId, onDueDateChange })`
5. **Failure handling** ★ Supabase client handles reconnects; no custom retry
6. **Empty state** ★ N/A
7. **Validation** ★ Validate that event payload has `due_date` field before acting
8. **Performance budget** ★ Event delivery is network-latency-bound; calendar update is instant
9. **Access control** ★ Supabase Realtime RLS filters automatically; no client-side check needed
10. **Touches** ★ New `components/calendar/use-calendar-realtime.ts`; wire into calendar page component

## Round B — Follow-ups

11. ★ Topic: `tasks:calendar:${workspaceId}` (workspace-scoped)
12. ★ Events that matter: INSERT with non-null due_date; UPDATE changing due_date; UPDATE setting due_date to null; DELETE
13. ★ For UPDATE: compare `old_record.due_date` vs `new_record.due_date` to detect moves
14. ★ Use F010's reconcile helper for all state transitions
15. ★ Need `old_record` in event: ensure postgres_changes subscription includes `old` record

## Definition of done

16. **Primary success test** ★ Unit test: onDueDateChange called when UPDATE changes due_date
17. **Failure test** ★ Unit test: task removed from calendar when due_date set to null
18. **Manual verification** ★ Two tabs: change due date in tab A → task moves in calendar tab B
19. **Side-effect verification** ★ Events for tasks in private projects not visible to current user are not delivered (RLS)
20. **Evidence artifact** ★ Test output (vitest)
