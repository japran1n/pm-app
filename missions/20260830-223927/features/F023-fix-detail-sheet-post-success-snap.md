# F023: Fix detail sheet post-success badge snap-back (FU-L)

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** F003, F004

## Assertion IDs covered
- AS-005: Status change updates badge immediately (and stays updated after success)
- AS-007: Priority change updates badge immediately (and stays updated after success)

## Scope

`use-task-detail-sheet.ts:64,80` — `detail` is only set in `openTask`, so after a successful status/priority save the reconciliation path doesn't exist. The badge visibly snaps back to stale value after a successful save because:
1. The optimistic state resets when the transition settles
2. But the base `task` prop still holds the old value (no re-fetch or local update)

Fix: after a successful status or priority action in `task-detail-sheet.tsx`, update the local task state so the base value reflects the new value. Options:
- Mutate local state to match the confirmed value
- OR use `router.refresh()` after success to re-fetch, and ensure the optimistic state stays until the refresh completes

Also fix the success-path tests — both currently end with `await waitFor(() => {})` which is a no-op. After a successful action the badge should show the new value, not snap back. Add assertions that confirm the badge displays the new value after the action resolves.

## Files
`components/task/task-detail-sheet.tsx`, `tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx`, `tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx`

## Notes
- Read use-task-detail-sheet.ts (if it exists) and task-detail-sheet.tsx to understand how task data flows
- The fix must not break the revert path (AS-006, AS-008)

## Definition of done
- AS-005: PASS — badge shows new status after successful save (no snap-back)
- AS-007: PASS — badge shows new priority after successful save (no snap-back)
