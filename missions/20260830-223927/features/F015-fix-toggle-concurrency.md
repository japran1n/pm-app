# F015: Fix My Tasks toggle concurrency bug

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 20 min
**Depends on:** F013

## Assertion IDs covered
- AS-012: Checking task marks it complete immediately (should be safe under rapid toggles)
- AS-014: Unchecking works immediately (should be safe under rapid toggles)

## Scope

`components/my-tasks/personal-todo-list.tsx:83-85`: the success commit uses an absolute closure-captured `isDone: !todo.isDone` from click time, while the optimistic reducer flips relatively. Two rapid toggles of the same row resolving out of order leave committed state at whichever response lands last, not last user intent.

Fix: capture the intended `isDone` value at the time of the action call and pass it through as a parameter to the success commit, OR use the server response's status value rather than the locally-captured one. The key invariant: the `setTodos` call on success must use the value returned/confirmed by the server, not the closure-captured value from click time.

Add a test case simulating rapid toggle (check then uncheck before first response arrives) to verify the final state matches the last user action.

## Files
`components/my-tasks/personal-todo-list.tsx`, `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`

## Notes
- MCP at run: none
