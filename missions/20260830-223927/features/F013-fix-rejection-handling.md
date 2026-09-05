# F013: Fix server action rejection handling across M1

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 45 min
**Depends on:** F007

## Assertion IDs covered
- AS-002: priority cell reverts + toast on server error (including thrown exceptions)
- AS-004: due-date cell reverts + toast on server error (including thrown exceptions)
- AS-006: status badge in detail sheet reverts + toast on server error (including throws)
- AS-008: priority badge in detail sheet reverts + toast (including throws)
- AS-013: My Tasks checkbox reverts + toast (including throws)

## Scope

The scrutiny validator confirmed that all bare `await action(...)` calls have no try/catch. A Server Action can reject (throw) on network loss, 500s, or serialization errors — the most common real-world failure. Currently only `{ok:false}` returns trigger the toast; a thrown rejection silently leaves the cell in the wrong state.

### Fix 1 — wrap `useOptimisticAction` in try/catch
`lib/hooks/use-optimistic-action.ts`: wrap `await action(newValue)` in try/catch. On catch, call `toast.error(errorMessage)`. The `useOptimistic` revert happens automatically when the transition settles.

### Fix 2 — wrap task-detail-sheet.tsx action calls
`task-detail-sheet.tsx` status (:960), priority (:990) and `saveField` (:717) are NOT using the shared hook. Add try/catch around each `await` call. On catch: toast.error with a descriptive message. Title already handles this correctly (AS-009/010 PASS) — do not change it.

### Fix 3 — wrap personal-todo-list.tsx handleToggle
`personal-todo-list.tsx:72`: add try/catch around `await toggleTodo(...)`. On catch: toast.error("Failed to update task").

### Fix 4 — fix tests to use throwing mocks
Update the following test files to supply a REJECTING mock (not just `{ok:false}`):
- `tests/unit/list-priority-select-optimistic.test.tsx` — rename test and use `vi.fn().mockRejectedValue(new Error("network"))`
- `tests/unit/list-due-date-cell-optimistic.test.tsx` — same
- `tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx` — add throw case
- `tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` — add throw case
- `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` — add throw case

## Files
`lib/hooks/use-optimistic-action.ts`, `components/task/task-detail-sheet.tsx`, `components/my-tasks/personal-todo-list.tsx`, and the 5 test files above.

## Notes
- MCP at run: none
- Read the scrutiny report: missions/20260830-223927/milestones/M1-scrutiny.md for exact line numbers
- Do NOT change the title save path (task-detail-sheet.tsx:770-777) — it already handles errors correctly per AS-010 PASS
