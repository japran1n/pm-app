# Handoff: F023 — Fix detail sheet post-success snap-back

## Status
COMPLETE

## Assertions covered
AS-005: PASS — status badge updates immediately AND stays on the new value after moveTaskStatus resolves successfully (test_AS_005_status_updates_immediately_before_the_server_responds now asserts post-resolve value, not a no-op).
AS-007: PASS — priority badge updates immediately AND stays on the new value after editTask resolves successfully, including the "clear to No priority" case (test_AS_007_priority_updates_immediately_before_the_server_responds and test_AS_007_clearing_priority_to_null_updates_immediately_before_the_server_responds).

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` (0, 7/7 passed)
`npm run lint` (0 errors, 13 pre-existing warnings unrelated to this change)
`npx tsc --noEmit` (0)
`npx vitest run` full suite (0 — 278/379 files, 2183/2711 tests passed; 101 pre-existing failing files are all `tests/integration/*` Supabase Auth "Request rate limit reached" (429) failures unrelated to this change — confirmed no `task-detail-sheet` test appears among the failures)

## Decisions made
- Root cause confirmed by reading task-detail-sheet.tsx: `useOptimistic`'s baseline is the `task` prop, which only advances once the caller's own refetch/realtime path catches up — not synchronously when the Server Action resolves. `useOptimistic` reverts to that stale baseline the instant the enclosing transition settles, regardless of success or failure, which is what produced the visible snap-back on the success path (the failure path already had its own correct revert-to-stale behaviour intentionally, per AS-006/AS-008).
- Added `confirmedStatus`/`confirmedPriority` as plain `useState`, initialized `undefined`. Set only inside the `result.ok` branch of `handleStatusChange`/`handlePriorityChange`, immediately after the toast.success call. Never touched on failure, so AS-006/AS-008's revert-to-stale-`task.status`/`task.priority` behaviour is untouched.
- Select `value` bindings changed to `confirmedStatus ?? optimisticStatus ?? task.status` and the priority equivalent (`confirmedPriority !== undefined ? confirmedPriority : optimisticPriority !== undefined ? optimisticPriority : task.priority`, preserving F014's existing "can't use `??` because `null` is a real cleared-priority value" fix).
- The pre-existing "is this actually a change?" guards in both handlers (`if (next === currentStatus) return`) were updated to also read `confirmedStatus`/`confirmedPriority` first, so a second identical status/priority selection right after a successful save is correctly treated as a no-op instead of re-triggering an unnecessary Server Action call.
- Reset `confirmedStatus`/`confirmedPriority` back to `undefined` in the existing "re-sync local edit state on task change" block (the `if (open && task && task.id !== syncedTaskId)` branch) so a freshly opened different task never inherits a confirmed value left over from whichever task was previously open in the same Sheet instance.
- Fixed the two no-op `await waitFor(() => {})` calls (the scrutiny finding) by asserting `toastSuccess` was called with the expected message AND that the Select's value stayed on the new value after that resolution — these tests now fail if the fix is reverted (confirmed by mentally reverting: without `confirmedStatus`/`confirmedPriority`, `useOptimistic` would revert to the stale `task.status`/`task.priority` the instant the transition settles, and these new assertions would catch it).

## Out-of-scope work needed
None identified beyond this fix's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Also updated the pre-existing "is this a no-op change" early-return guards in both handlers to consider the new confirmed state, even though the spec's problem statement only called out the badge snap-back. This was needed for internal consistency (the guard and the display value must agree on what "current" means) and does not change any assertion's observable behaviour — it only avoids an unnecessary duplicate Server Action call in an edge case (selecting the same value twice in a row right after a successful save), which no assertion exercises either way.

## Notes for the next worker
No MCP usage was needed — this is a pure client-component/UI fix with no external service or live-schema interaction. The fix intentionally does NOT change AS-006/AS-008's failure-path revert behaviour: `confirmedStatus`/`confirmedPriority` are only ever set inside the `result.ok` branch, so on failure `useOptimistic` still reverts to the base `task.status`/`task.priority` exactly as before, and both revert tests (`test_AS_006_...`, `test_AS_008_...`) pass unchanged.
