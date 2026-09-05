# F022: Fix todo guard leak + AS-013 discriminating revert test (FU-M + FU-N)

**Milestone:** M1
**Estimated worker time:** 35 min
**Depends on:** F020

## Assertion IDs covered
- AS-013: My Tasks checkbox reverts + toast on server error

## Scope

### FU-N: Replace equality-based guard release with commit ordering

`components/my-tasks/personal-todo-list.tsx` — F020's guard releases only when server data matches `confirmedIsDone`. This freezes a row permanently if another user toggles it back before the next sync, or if the write didn't persist. Also `handleDelete` never clears the guard entry.

Fix: release the guard by commit sequence, not value equality:
- After `setTodos` on success (the confirmed commit), mark the guard entry as "committed" (add a flag or use a separate set)
- In the sync effect: skip server data for a row if it has a PENDING (not yet committed) guard. Once committed, accept the next server payload unconditionally.
- `handleDelete` must remove the todo's guard entry.

### FU-M: Discriminating AS-013 revert test

`tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx:95-96` — the `waitFor(aria-checked="false")` resolves during the optimistic pending flip, not after revert, so injecting a "commit the failure" mutant still leaves 8/8 tests green.

Fix: after the action rejects, flush all pending React transitions before asserting revert state. Use `act()` or `await new Promise(resolve => setTimeout(resolve, 0))` to advance past the optimistic layer. Then assert the checkbox is back to its original state AND the toast appeared.

## Files
`components/my-tasks/personal-todo-list.tsx`, `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`

## Definition of done
- AS-013: PASS — mutant (committing failed state without reverting) kills the test
- Guard release is commit-ordered, not value-equality based
- handleDelete clears guard entries
