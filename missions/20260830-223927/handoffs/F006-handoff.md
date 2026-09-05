# Handoff: F006 — Optimistic My Tasks checkbox toggles

## Status
COMPLETE

## Assertions covered
AS-012: PASS — checking a to-do flips checkbox + adds strikethrough before `toggleTodo`'s promise resolves (test_AS_012_checking_a_task_marks_it_visually_complete_before_the_server_confirms).
AS-013: PASS — checkbox and strikethrough revert to prior state and `toast.error("Failed to update task")` fires when `toggleTodo` resolves `{ ok: false }` (test_AS_013_checkbox_reverts_and_shows_an_error_toast_when_the_toggle_fails).
AS-014: PASS — unchecking a done to-do immediately clears checked state + strikethrough before server confirmation (test_AS_014_unchecking_a_completed_task_marks_it_incomplete_immediately).

## Files changed
components/my-tasks/personal-todo-list.tsx
tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0)
`npm run lint` (0)
`npx tsc --noEmit` (0)
`npm test` (0 — vitest process exit code; see notes below on unrelated failures)

## Decisions made
- Replaced the component's hand-rolled optimistic `setTodos` toggle with `React.useOptimistic`, per the clarified spec's explicit pattern requirement. `useOptimistic(todos, reducer)` derives `optimisticTodos` from the committed `todos` state; the reducer flips `isDone` for the toggled id.
- Used the standard React 19 pattern: `startTransition(async () => { setOptimisticIsDone(id); await action(); ... })`. Calling the optimistic setter first (synchronously, before the `await`) inside the transition callback is what makes the UI update instantly while the transition is pending.
- No manual revert code is needed on failure — `useOptimistic` automatically falls back to the base `todos` state once the transition settles, as long as `setTodos` is never called on the failure path. This matches the clarification's "revert-on-error is sufficient, no undo toast."
- Per clarification line 11 (`toast.error("Failed to update task")` — literal, not server-provided message), changed the failure branch to use this fixed string instead of `result.error`. This is a narrow, intentional deviation from the pre-existing `result.error` pattern used elsewhere in the same file (create/delete), scoped only to the toggle handler, and directly matches the clarified spec's explicit instruction.
- Left `handleCreate` and `handleDelete` untouched — out of scope per the clarified "Touches" list (checkbox toggle only).

## Out-of-scope work needed
- `handleCreate`/`handleDelete` still use the older manual `setTodos`-based optimistic pattern (not `useOptimistic`). Not touched — spec scoped this feature to the checkbox toggle only.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used fixed `toast.error("Failed to update task")` copy instead of forwarding `result.error` from the server action, because the clarification file explicitly specifies this literal string for the failure-handling answer (line 11, marked ★). This only affects the toggle handler, not create/delete.

## Notes for the next worker
- `npm test` (full suite) has 90 pre-existing failures across 46 integration test files, all due to `Request rate limit reached` errors from Supabase auth sign-in during test setup (visible in `tests/integration/trash-view.test.ts`, `tests/integration/workspace-members-list.test.ts`, etc.) — infra rate-limiting unrelated to this feature. Grepped the full run output for "personal-todo", "f006", and "my-tasks" — zero matches, confirming none of these failures touch this feature's files or tests. The dedicated F006 test file and `npx tsc --noEmit` / `npm run lint` all pass cleanly in isolation.
- No MCP tools used — pure client-component change, no live external state involved.
