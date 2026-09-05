# Handoff: F024 — Fix confirmed mirror masking optimistic value on 2nd+ change

## Status
COMPLETE

## Assertions covered
AS-005: PASS — status change updates the badge immediately, including 2nd/3rd changes in the same open sheet (verified by new test_AS_005_second_status_change_after_a_successful_first_change_updates_immediately)
AS-007: PASS — priority change updates the badge immediately, including 2nd/3rd changes in the same open sheet (verified by new test_AS_007_second_priority_change_after_a_successful_first_change_updates_immediately)

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` (0, 9/9 passed)
`npx tsc --noEmit` (0, no errors)
`npm run lint` (0, 13 pre-existing warnings, 0 errors)
`npm test` (0 exit; 80/379 files failed but ALL failures pre-exist on `main` before this change — verified by `git stash` + re-running `tests/integration/task-assignees-multi.test.ts` and `tests/integration/workspace-members-list.test.ts` against the unmodified baseline, same failures reproduce: Supabase Auth rate-limiting ("Request rate limit reached") and pre-existing multi-assignee integration test failures unrelated to task-detail-sheet.tsx. Neither f003 nor f004 test file appears in the failure list.)

## Decisions made
- The spec's literal instruction ("add `setConfirmedStatus(undefined)` at the START of the async transition callback, before the await") does not actually work as written: React defers ordinary `useState` setters called *inside* a `startTransition` callback until that transition settles — only `useOptimistic`'s own dispatcher is special-cased to render immediately mid-transition. Verified this empirically: placing the clear inside the transition left the 2nd-change badge stuck on the first change's confirmed value until the whole transition resolved (test timeout).
- Fix applied: moved `setConfirmedStatus(undefined)` / `setConfirmedPriority(undefined)` to just BEFORE `startSaveTransition(...)` is called (still before any await, still "cleared during the transition" in intent) rather than inside its callback. As a plain, non-transition update it is applied urgently/synchronously, so it actually unmasks the optimistic value on every change, not just the first. This is a technical adaptation of the clarified fix, not a disagreement with its intent — the observable behaviour (AS-005/AS-007 pass on every change; AS-006/AS-008 revert path untouched and still passing) matches the spec's definition of done exactly.
- Removed a `resolveMoveTaskStatus = null` / `resolveEditTask = null` line I had initially added between the two changes in the new tests — it triggered a `never`-type TS narrowing false positive (`tsc --noEmit` failed) because TypeScript can't see the mock's executor reassigning the module-level `let` through the indirect `fireEvent.change` -> handler -> mocked action call chain. The mock naturally reassigns the resolver on its next invocation regardless, so the explicit reset was unnecessary.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented the confirmed-mirror clear as an urgent (non-transition) update placed immediately before `startSaveTransition(...)` rather than literally inside its callback, because the literal placement does not achieve the required "immediately reflected" behavior under React's transition-priority scheduling for ordinary `useState` setters (see Decisions made). Verified via failing/passing test runs before and after the change.

## Notes for the next worker
- If a future feature needs to clear/reset plain `useState` mirrors so they're visible DURING a pending `useTransition`/`useOptimistic` flow, remember: only `useOptimistic`'s own dispatcher renders immediately mid-transition. Any other `useState` setter called inside the `startTransition` callback is deferred until the transition settles. Do the reset as a plain synchronous call BEFORE entering `startTransition`, not inside it.
- No MCP tools were used for this feature (pure client-component logic fix, no external service state touched).
