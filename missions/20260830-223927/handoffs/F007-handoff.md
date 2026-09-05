# Handoff: F007 — Shared useOptimisticAction helper

## Status
COMPLETE

## Assertions covered
(no new assertions — this feature is a refactor that keeps F001–F006 consistent; no assertion IDs assigned)

## Files changed
lib/hooks/use-optimistic-action.ts (new)
tests/unit/use-optimistic-action.test.tsx (new)
components/task/list-priority-select.tsx (retrofitted onto the hook)
components/task/list-due-date-cell.tsx (retrofitted onto the hook)

## Commands run
`npx vitest run tests/unit/use-optimistic-action.test.tsx tests/unit/list-priority-select-optimistic.test.tsx tests/unit/list-due-date-cell-optimistic.test.tsx` (0, all 8 tests passed)
`npx tsc --noEmit` (0)
`npx eslint components/task/list-priority-select.tsx components/task/list-due-date-cell.tsx lib/hooks/use-optimistic-action.ts tests/unit/use-optimistic-action.test.tsx` (0)
`npx eslint .` (0 errors, 13 pre-existing warnings unrelated to this feature)
`npm test` (0 — full suite: 2482 passed, 88 failed, 131 skipped across 2701 tests; every failure is a pre-existing integration test hitting live Supabase — auth rate limits ("Request rate limit reached") and 30s timeouts in tests/integration/task-assignees-multi.test.ts, toggle-reaction.test.ts, upload-attachment.test.ts, workspace-members-list.test.ts, etc. None reference list-priority-select, list-due-date-cell, or use-optimistic-action; grepping the full failure output for those three filenames returns zero matches. This is the pre-existing flaky/rate-limited state of the integration suite, not a regression from this feature.)

## Decisions made
- Followed the clarified signature exactly: `useOptimisticAction<T>(current, action, errorMessage) => [optimisticValue, isPending, run]`, action returns `void | { error: string }`, hook shows `result.error || errorMessage` on failure and no toast on success — matching the clarified "hook handles toast internally" and "if action returns `{error}`, show that message; otherwise show generic `errorMessage`" answers.
- `list-priority-select.tsx` and `list-due-date-cell.tsx` (F001/F002) were retrofitted onto the hook because their pattern is an exact match: single scalar value, `editTask` returning `{ok, error}`, and a FIXED error message string per component ("Failed to update priority" / "Failed to update due date") — no behaviour change, confirmed by re-running their existing F001/F002 optimistic-update tests unmodified and green.
- `task-detail-sheet.tsx`'s status/priority Selects (F003/F004) and `personal-todo-list.tsx`'s toggle (F006) were deliberately left un-retrofitted — see Out-of-scope work needed below for why forcing them into this hook's fixed-`errorMessage`-per-instance contract would require a behaviour change, which the spec forbids ("No behaviour change; `tsc --noEmit` must pass").
- The hook's `run` callback wraps `startTransition` internally (rather than exposing `startTransition` to the caller) so callers never need to import `useTransition` themselves — this is what let both retrofitted components drop their own `useTransition`/`useOptimistic` imports entirely.

## Out-of-scope work needed
- `components/task/task-detail-sheet.tsx`'s `handleStatusChange`/`handlePriorityChange` (F003/F004, AS-005–AS-008): these build a DYNAMIC error message per call (`` `Failed to set status to ${nextLabel}` ``/`` `Failed to set priority to ${nextLabel}` ``, embedding the target label the user just picked) and `handleStatusChange` also awaits an async confirmation guard (`confirmIfMovingToDone`) BEFORE applying the optimistic value — neither fits the hook's `errorMessage: string` (fixed at hook-instantiation time, not per-call) or `run(newValue)` (synchronous, no pre-flight async gate) contract without either (a) widening the hook's signature beyond what was clarified, or (b) losing the per-value error message / confirm-first behaviour, both of which count as a behaviour change this feature is explicitly not allowed to make. A future feature could widen the hook to accept `errorMessage: string | ((value: T) => string)` and an optional pre-flight guard callback if this generalization is wanted; that is new hook-surface, not a same-feature refactor, so it was left alone here per this feature's own "no forced awkward abstractions" allowance.
- `components/my-tasks/personal-todo-list.tsx`'s `handleToggle` (F006, AS-012–AS-014): `useOptimistic` here is a REDUCER over an array (`(state, toggledId) => state.map(...)`), not a plain `useOptimistic<T>(current)` over a single value, and `toggleTodo`'s action signature is `{todoId, isDone}` rather than a single `T`. Forcing this into `useOptimisticAction<T>` would mean `T` = the whole todo array and `action` receiving the whole array (losing the single-flip semantics) or introducing a second, different hook shape — out of scope for this feature's fixed generic-scalar signature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied the hook only to the two components whose pattern is a structural match (F001/F002), per this feature's own escape hatch ("If the components' patterns are too heterogeneous to fit cleanly into one hook without forcing awkward abstractions, it is acceptable to apply the hook only where it fits naturally and mark the rest as out-of-scope"). Verified this doesn't silently narrow the feature by confirming, file by file, that the remaining four callers (task-detail-sheet.tsx's status/priority/title and personal-todo-list.tsx's toggle) all have a genuine shape mismatch (dynamic error message, async pre-flight guard, or reducer-over-array optimistic state) rather than just being left for convenience.

## Notes for the next worker
- The hook lives at `lib/hooks/use-optimistic-action.ts`, sibling to the existing (still separately used) `lib/hooks/use-inline-field-edit.ts` — they are NOT the same abstraction; `use-inline-field-edit.ts` is the older hand-rolled local-state + isSaving pattern this mission's F001 comment already noted as superseded for the two cells this feature retrofits, but it isn't touched here since no caller of it was in this feature's scope.
- `tests/unit/use-optimistic-action.test.tsx` exercises the hook directly via a tiny harness component (not through any real caller), per the clarified "Unit test the hook itself with a mock server action" definition-of-done item: it covers (1) the optimistic value applying before the mocked action resolves, (2) revert + toast with the hook's own `errorMessage` when the action returns `{ error: "" }`, and (3) revert + toast with the ACTION'S OWN error message when the action returns a non-empty `{ error }`.
- No MCP tools were used — this is a pure application-code refactor with no live external-service state to inspect (per the feature spec's "MCP at run: none").
