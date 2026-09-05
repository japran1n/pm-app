# Handoff: F032 — Fix initialTaskIds never passed to My Tasks realtime hook

## Status
COMPLETE

## Assertions covered
AS-016: PASS — `tests/unit/personal-todo-list-realtime-wiring.test.tsx` "AS-016: a real tasks UPDATE payload for a task already visible on this page (seeded via initialTaskIds, F032) triggers a refresh whose fresh data renders" drives a real `tasks` UPDATE for `todo-1` (present in `initialTodos`, never assigned via a `task_assignees` event this session) through the mocked channel and asserts the refresh fires and fresh data renders.
AS-018: PASS — `tests/unit/personal-todo-list-realtime-wiring.test.tsx` "AS-018: a real tasks DELETE payload for a task already visible on this page (seeded via initialTaskIds, F032) triggers a refresh whose fresh data renders" plus the two existing "task never tracked" negative tests (still passing) confirm forwarding is correctly gated by the seeded tracked-id set.

## Files changed
components/my-tasks/personal-todo-list.tsx
tests/unit/personal-todo-list-realtime-wiring.test.tsx

## Commands run
`npx vitest run tests/unit/personal-todo-list-realtime-wiring.test.tsx tests/unit/f008* tests/unit/personal-todo-list*` (0, 21 tests passed)
`npx eslint components/my-tasks/personal-todo-list.tsx tests/unit/personal-todo-list-realtime-wiring.test.tsx` (0)
`npx tsc --noEmit` (0)

## Decisions made
- Passed `initialTodos.map(t => t.id)` (not `todos.map(...)`, the live state) as `initialTaskIds` — `initialTodos` is the prop set at mount/each server render; the hook's own effect re-seeds `trackedTaskIdsRef` whenever `initialTaskIds`'s identity changes (e.g. after `router.refresh()` delivers a fresh `initialTodos` array), so using the prop directly (rather than derived client `todos` state, which also includes optimistic/in-flight rows not yet confirmed by the server) matches the hook's documented contract of being seeded from "the server-rendered My Tasks list."
- Rewrote the AS-016 and AS-018 "already tracked" wiring tests to seed tracking purely via `initialTodos` ids (matching production wiring) instead of firing a `task_assignees` INSERT first, per the spec's explicit instruction that the old approach didn't reflect how production works. Left the AS-015/AS-017 (`task_assignees` INSERT/DELETE) and the two AS-018 "never tracked" negative tests unchanged, since those still exercise real behaviour correctly.

## Out-of-scope work needed
None identified beyond this fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `initialTodos` prop (not local `todos` state) as the source for `initialTaskIds`, for the reasoning given above under Decisions made.

## Notes for the next worker
No MCP usage — this is a pure client-side wiring/state bug fix with no live schema or config dependency. The root cause and fix are documented in detail as inline comments in both `components/my-tasks/use-my-tasks-realtime.ts` (pre-existing, from F025/F031) and the new comment added in `personal-todo-list.tsx`.
