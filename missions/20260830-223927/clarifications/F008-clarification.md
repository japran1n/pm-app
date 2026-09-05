# F008 Clarification — My Tasks realtime subscription

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Custom hook `use-my-tasks-realtime.ts` using `shared-topic-channel.ts` (existing ref-counted channel registry)
2. **Data shape** ★ Subscribes to `postgres_changes` on `tasks` table; filters by `assignee_id = eq.{userId}`
3. **State location** ★ Callback-based: hook receives `onTaskChange` callback; state lives in caller (personal-todo-list)
4. **API contract** ★ Hook signature: `useMyTasksRealtime({ userId, onInsert, onUpdate, onDelete })`
5. **Failure handling** ★ Realtime disconnects are handled by Supabase client reconnect; no custom retry needed
6. **Empty state** ★ N/A — no data to show when no subscription; hook just doesn't call callbacks
7. **Validation** ★ Validate incoming event payload shape before calling callbacks
8. **Performance budget** ★ Subscription setup <100ms; event delivery is network-latency-bound
9. **Access control** ★ Supabase Realtime respects RLS automatically — no client-side filter needed
10. **Touches** ★ New `components/my-tasks/use-my-tasks-realtime.ts`; mount in `personal-todo-list.tsx`

## Round B — Follow-ups

11. ★ Topic string: `tasks:my-tasks:${userId}` (unique per user to avoid cross-user event leakage)
12. ★ Events: INSERT (newly assigned), UPDATE (status/other field change), DELETE or UPDATE with null assignee_id (un-assigned)
13. ★ Reconciliation of un-assign: detect `assignee_id` changing to null in UPDATE event new record
14. ★ Use F011's reconcile helper for all state transitions
15. ★ Cleanup: unsubscribe on component unmount (shared-topic-channel handles ref counting)

## Definition of done

16. **Primary success test** ★ Unit test: onInsert called when task INSERT event arrives with matching assignee_id
17. **Failure test** ★ Unit test: onDelete called when UPDATE event sets assignee_id to null
18. **Manual verification** ★ In two tabs: assign task in tab A → appears in My Tasks in tab B without refresh
19. **Side-effect verification** ★ No events from other users' tasks leak into the subscription
20. **Evidence artifact** ★ Test output (vitest)
