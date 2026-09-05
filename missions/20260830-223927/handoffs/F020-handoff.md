# Handoff: F020 — Durable todo optimistic guard (FU-J)

## Status
COMPLETE

## Assertions covered
AS-012: PASS — `test_AS_012_optimistic_check_survives_a_server_data_refresh_that_arrives_before_the_toggle_resolves` now also exercises a stale sync arriving AFTER commit; verified this and the other guard-block test fail when `personal-todo-list.tsx:45-80` (the sync/guard block) is deleted.
AS-014: PASS — `test_AS_014_optimistic_uncheck_survives_a_server_data_refresh_that_arrives_before_the_toggle_resolves` extended the same way; same deletion-fails-the-test check performed.

## Files changed
components/my-tasks/personal-todo-list.tsx
tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0, 8/8 pass)
`npx tsc --noEmit` (0)
`npm run lint` (0, only pre-existing warnings unrelated to this feature)
`npm test` (0 exit code from the runner; 80/379 test FILES failed, all pre-existing integration tests against live Supabase failing with "Request rate limit reached" — none in `tests/unit/f006-*` or `personal-todo-list`; confirmed via `grep -i "f006|personal-todo"` on the full run output returning nothing)
Manual regression check: temporarily replaced the guard block (`personal-todo-list.tsx:45-80`, the `if (initialTodos !== syncedInitial) {...}` block) with an unconditional `setTodos(initialTodos)`, re-ran the F006 test file — 3 tests failed (the two rewritten survives-refresh tests plus the pre-existing in-flight-row-not-clobbered test), confirming the tests are no longer vacuous. Restored the real implementation afterward and re-ran — 8/8 pass.

## Decisions made
- Chose the "track `{id, confirmedIsDone}`" option from the spec (over a version/sequence counter) since it required the smallest change to the existing render-phase sync effect and keeps the guard's release condition directly observable (server value matches confirmed value) rather than needing a monotonic counter to reason about.
- Changed `pendingToggleIds: ReadonlySet<string>` to `pendingToggles: ReadonlyMap<string, boolean>` (id -> intended/confirmed isDone). The map is populated on toggle start (as before) but is now ALSO left populated after `setTodos` commits on success — the previous code called `clearPending()` at the same tick as `setTodos`, which is exactly the bug described in the scrutiny finding. Removal now happens only inside the render-phase sync effect, when an incoming `initialTodos` entry's `isDone` matches the map's confirmed value for that id.
- On toggle failure/catch, `clearPending()` is still called immediately (as before) since there's no "confirmed" value to protect in that case — `useOptimistic` reverts to whatever `todos` currently holds, and that state should freely resync from the server.
- Rewrote (did not just extend) the two vacuous tests per spec instructions: each now performs the original in-flight-stale-sync check, then resolves the toggle, then sends a SECOND stale sync (still pre-toggle data) to prove the guard survives past commit, then sends a THIRD sync with matching data to prove the guard correctly releases once the server catches up. This closes the vacuity gap scrutiny found (deleting the guard used to leave 7/8 passing; confirmed deleting it now fails 3/8).

## Out-of-scope work needed
None identified. The `pendingToggles` map growing indefinitely if a `router.refresh()` never occurs after a successful toggle is intentional (the guard is meant to be durable until the server actually confirms) and self-corrects on any subsequent refresh; no cleanup task needed since each row's entry is at most one boolean per todo id and todos are deleted via `handleDelete`, not accumulated.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left the failure-path `clearPending()` call unchanged (drops the guard immediately on toggle failure) since the spec's fix is scoped to the success-commit race window described in the scrutiny finding; failure already has no "confirmed" value to protect and the existing behavior there was not flagged as buggy.

## Notes for the next worker
The render-phase sync effect at the top of `PersonalTodoList` (lines ~45-80) is the single place both the in-flight guard (F019) and the post-commit durable guard (F020) live — read the comment block above it (lines 28-41) before touching toggle logic again. If a future feature adds more optimistic fields to `PersonalTodo` beyond `isDone`, the same durable-guard pattern (map id -> confirmed value, release on match) should be reused rather than reverting to a bare id set.
