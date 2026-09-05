# F008: My Tasks realtime subscription

**Milestone:** M2 — Realtime expansion
**Estimated worker time:** 45 min
**Depends on:** F006

## Assertion IDs covered
- AS-015: When another user assigns a task to the current user, the task appears in My Tasks without a page refresh.
- AS-016: When a task in My Tasks has its status changed by another user, the My Tasks row updates live.
- AS-017: When a task is un-assigned from the current user by another user, it disappears from My Tasks without a page refresh.
- AS-018: My Tasks realtime only delivers events for tasks the current user is permitted to see (respects project-level RLS).

## Draft scope
- Create `components/my-tasks/use-my-tasks-realtime.ts`.
- Subscribe to `postgres_changes` on `tasks` filtered by `assignee_id = eq.{userId}`.
- Use `shared-topic-channel.ts` (ref-counted channel).
- Supabase Realtime respects RLS automatically.
- Mount in `personal-todo-list.tsx`.

## Files (approximate)
`components/my-tasks/use-my-tasks-realtime.ts`, `components/my-tasks/personal-todo-list.tsx`

## Notes
- MCP at run: none (Supabase client SDK — not MCP tools)
- Read `lib/realtime/shared-topic-channel.ts` first — mandatory for all new realtime hooks
- Read `components/task/use-list-realtime.ts` as pattern reference

---

## Clarified implementation (from clarifications/F008-clarification.md)

- Pattern: Custom hook using `shared-topic-channel.ts`
- Data shape: Subscribes to `postgres_changes` on `tasks`; filter `assignee_id = eq.{userId}`
- State location: Callback-based; state lives in caller (personal-todo-list)
- API contract: `useMyTasksRealtime({ userId, onInsert, onUpdate, onDelete })`
- Failure handling: Supabase client handles reconnects; no custom retry
- Validation: Validate incoming event payload shape before calling callbacks
- Performance budget: Event delivery is network-latency-bound
- Access control: Supabase Realtime RLS automatic; no client-side filter needed
- Touches: New hook file + personal-todo-list.tsx mount point

### Follow-up decisions
- Topic string: `tasks:my-tasks:${userId}`
- Events: INSERT (newly assigned), UPDATE (status change), DELETE or UPDATE with null assignee_id
- Reconciliation of un-assign: detect `assignee_id` changing to null in UPDATE new record
- Use F011's reconcile helper for state transitions
- Cleanup: unsubscribe on unmount (shared-topic-channel handles ref counting)

## Definition of done

- **Primary success test:** Unit test: onInsert called when INSERT event arrives with matching assignee_id
- **Failure test:** Unit test: onDelete called when UPDATE sets assignee_id to null
- **Manual verification:** Two tabs: assign task in tab A → appears in My Tasks in tab B without refresh
- **Side-effect verification:** No events from other users' tasks leak through
- **Evidence artifact:** Test output (vitest)
