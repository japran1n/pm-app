# Handoff: F008 — My Tasks realtime subscription

## Status
COMPLETE

## Assertions covered
AS-015: PASS — unit test `AS-015: calls onInsert when an INSERT event arrives with matching assignee_id` in tests/unit/f008-my-tasks-realtime.test.ts; hook mounted in personal-todo-list.tsx triggers `router.refresh()` so the assigned task appears in the server-rendered My Tasks buckets without a page refresh.
AS-016: PASS — unit test `AS-016: calls onUpdate when a status change UPDATE arrives with assignee_id unchanged`.
AS-017: PASS — unit tests `AS-017 (failure test): calls onDelete when an UPDATE event sets assignee_id to null` and `AS-017: calls onDelete when an UPDATE event re-assigns the task to a different user`.
AS-018: PASS — unit test `AS-018: scopes different users to different channels/topics` (per-user topic `tasks:my-tasks:<userId>` plus Realtime's own RLS re-check on the `tasks` table, per the board hook's established security posture referenced in components/task/use-list-realtime.ts's doc comment).

## Files changed
components/my-tasks/use-my-tasks-realtime.ts (new)
components/my-tasks/personal-todo-list.tsx
app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx
tests/unit/f008-my-tasks-realtime.test.ts (new)

## Commands run
`npx vitest run tests/unit/f008-my-tasks-realtime.test.ts tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0, 18/18 passed)
`npx tsc --noEmit` (0)
`npx eslint components/my-tasks/use-my-tasks-realtime.ts components/my-tasks/personal-todo-list.tsx "app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx" tests/unit/f008-my-tasks-realtime.test.ts` (0)
`npm test` (full suite — ran to completion once with exit code 0 per one background run; a second full run showed the same set of pre-existing DB-schema-cache integration failures as documented in F015-handoff.md and F017-handoff.md, e.g. `set_task_assignees_atomic`/`bulk_delete_tasks_atomic`/`restore_task_atomic`/`change_workspace_slug_atomic` PGRST202 "not found in schema cache" errors across many unrelated integration test files — none touch `components/my-tasks/*` or this feature's files. Every unit test this feature added or touches passes.)

## Decisions made
- Followed the clarified API contract exactly: `useMyTasksRealtime({ userId, onInsert, onUpdate, onDelete })`, built on `acquireSharedTopicChannel` (lib/realtime/shared-topic-channel.ts, F329) the same way `components/board/use-board-realtime.ts` (F049) does, so StrictMode double-subscribe safety and deferred teardown are inherited rather than re-implemented.
- Extracted the actual channel wiring into a plain, React-free `subscribeToMyTasksRealtime(supabase, userId, handlers)` function (mirroring `subscribeToBoardRealtime`) so it's unit-testable without a DOM/React runtime, per this repo's vitest config (`environment: "node"`) and the board hook's own established pattern (tests/unit/board-realtime-subscription.test.ts).
- Un-assignment reconciliation (AS-017) is done inside the hook itself, not deferred to the caller: an UPDATE whose `new.assignee_id !== userId` (covers both `null` and re-assignment to a different user) is dispatched as `onDelete(row.id)`, never `onUpdate`. This matches the clarification's "Reconciliation of un-assign: detect assignee_id changing to null in UPDATE new record" answer, generalized slightly to also cover re-assignment to someone else (same observable effect on this user's My Tasks list).
- Payload validation (clarified "Validate incoming event payload shape before calling callbacks"): a lightweight `hasValidId` guard drops any INSERT/UPDATE payload whose `new` record lacks a non-empty string `id`, and any DELETE payload whose `old` record lacks one, rather than forwarding a malformed event to the caller.
- Topic string: `tasks:my-tasks:${userId}`, per the clarification's follow-up decision #11 — unique per user so the shared-channel registry never conflates two different users' subscriptions even if the browser client is reused (e.g. impersonation/testing flows), and different from `board:<projectId>` and `list:<projectId>` so this feature's channel never collides with the board/list Realtime hooks for the same underlying `tasks` table.
- Mount point: `components/my-tasks/personal-todo-list.tsx`, per the clarified "Touches" answer. This is the only Client Component boundary already present on the My Tasks page (the page itself, `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx`, is a Server Component per F230/F231's own doc comment) — added an optional `currentUserId` prop, threaded from the page's already-fetched `user.id`. On any INSERT/UPDATE/DELETE-equivalent event for the caller's tasks, the hook's three callbacks all call `router.refresh()`, which re-runs the page's server-side `getMyTasks` query and re-renders the bucketed rows with fresh data — the simplest correct way to satisfy AS-015/016/017's "without a page refresh" wording (a Next.js `router.refresh()` re-fetches server data in place, it does not navigate/reload the page) without this feature also having to duplicate `getMyTasks`'s bucketing/status-options/dedup logic on the client.
- AUTONOMOUS_DECISION: did NOT wire `lib/tasks/reconcile-my-tasks-realtime-task.ts` (F011's pure reconcile helper) into personal-todo-list.tsx, even though the clarification's follow-up #14 says "Use F011's reconcile helper for all state transitions." F011 is listed as depending on F008 (it runs AFTER this feature in the plan) and does not exist yet — the file doesn't exist in this repo. Reasoned per the ambiguity-resolution priority order (worker-mcp-usage skill): clarified answer first, but an answer that references an artifact from a not-yet-run dependent feature can't literally be followed without inverting the dependency order. Chose the `router.refresh()` integration as the correctly-scoped, spec-satisfying fallback for THIS feature's own definition of done (whose actual DoD tests are unit tests of the hook's callback behavior, not a specific client-state reconciliation strategy), and left the door open for F011 to replace this with a targeted client-side task-list component once its reconcile helper exists.

## Out-of-scope work needed
- F011 (`lib/tasks/reconcile-my-tasks-realtime-task.ts`) still needs to be built as its own feature (it already exists as a separate spec in this mission, depends on F008, not yet implemented). Once it exists, the natural follow-up is a small client-state wrapper around the My Tasks buckets (currently rendered directly by the Server Component `MyTasksPage`) that holds the task rows in client state and applies `reconcileMyTasksRealtimeTask` directly instead of this feature's `router.refresh()` shortcut — trading one full server round-trip per event for a purely client-side patch. Not done here since it would mean converting `MyTasksPage`'s bucket-rendering into a Client Component (a bigger, out-of-scope structural change for a 45-minute feature whose own DoD only requires the hook itself).
- True end-to-end two-tab Realtime delivery (the clarified "Manual verification" step) was not exercised in this ZERO_QUESTIONS run — same category of gap called out in tests/unit/board-realtime-subscription.test.ts's own doc comment for the analogous board feature. Best covered by a Playwright/e2e test with two browser contexts, not vitest.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: used `router.refresh()` from the mounted hook's callbacks instead of F011's not-yet-existing reconcile helper for actual state transitions in personal-todo-list.tsx, since F011 depends on (runs after) F008 in this mission's plan. See "Decisions made" above for the full reasoning.

## Notes for the next worker
- `lib/realtime/shared-topic-channel.ts`'s doc comment is required reading before writing ANY new `subscribe*Realtime` module in this repo — it documents a real StrictMode double-subscribe crash and the exact registry-based fix, which this feature reuses as-is via `acquireSharedTopicChannel`.
- Reference implementation followed most closely: `components/board/use-board-realtime.ts` + `lib/board/subscribe-board-realtime.ts` (F049), including its test file `tests/unit/board-realtime-subscription.test.ts` as the template for `tests/unit/f008-my-tasks-realtime.test.ts`.
- No MCP tools were used for this feature — per mcp-registry.md, F008 is pure client-code/Realtime-subscription work with no live-schema introspection needed (the `tasks` table's Realtime publication was already verified/added by a prior feature, `supabase/migrations/20260818040000_realtime_tasks_publication.sql`).
- A second worker (F009, calendar realtime) appears to be running concurrently against the same working tree — observed several unrelated calendar files as untracked/modified during this run. Not something F008 touched or needed to fix, but flagging again (same pattern F017-handoff.md already noted) in case the orchestrator wants to serialize workers more strictly.
