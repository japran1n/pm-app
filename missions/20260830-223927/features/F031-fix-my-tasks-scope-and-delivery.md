# F031: Fix My Tasks hook scope + prove delivery (AS-016, AS-018, AS-024)

**Milestone:** M2
**Depends on:** F025, F028

## Assertion IDs covered
- AS-016, AS-018, AS-024

## Issues

### AS-018: My Tasks receives workspace-wide events
`use-my-tasks-realtime.ts` forwards every task DELETE/UPDATE to the page with no check that it belongs to the current user. A task deleted from another user's project (that's still RLS-visible) triggers an incorrect removal.

Fix: on `tasks` UPDATE/DELETE, check if the task id is in the current local todos list before calling onUpdate/onDelete. Only propagate events for tasks the user currently sees.

### AS-016: Wiring test never observes a task row
The wiring test mocks `useMyTasksRealtime` and hand-wires `refresh → setTodos`. It tests the harness, not the integration. Fix: rewrite `personal-todo-list-realtime-wiring.test.tsx` to dispatch a real `tasks` UPDATE payload through the mocked channel and assert the rendered todo item updates.

### AS-024: `.subscribe()` not mutation-tested
In `lib/palette/subscribe-palette-search-realtime.ts`, deleting `.subscribe()` leaves the suite green. Fix: add an assertion in the palette realtime test that `.subscribe()` was called on the channel.

## Files
`components/my-tasks/use-my-tasks-realtime.ts`, `tests/unit/personal-todo-list-realtime-wiring.test.tsx`, `tests/unit/palette-search-realtime.test.ts`

## Definition of done
- AS-018: Workspace-wide DELETE/UPDATE filtered to current-user's visible todos
- AS-016: Wiring test dispatches real payload and asserts rendered output
- AS-024: `.subscribe()` call is mutation-tested
