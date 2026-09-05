# F017: Fix discriminating failure tests + restore lost coverage

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 30 min
**Depends on:** F013, F016

## Assertion IDs covered
- AS-002: priority cell reverts + toast on server error
- AS-006: status badge reverts + toast on server error

## Scope

Scrutiny found three test quality issues to fix:

### 1. Restore {ok:false} test for list-priority-select
`tests/unit/list-priority-select-optimistic.test.tsx` — F013 replaced the `{ok:false}` revert test with a rejection test, leaving the hook's normal failure branch uncovered. Add back an `{ok:false}` test case alongside the existing rejection test.

### 2. Discriminating revert assertion in detail-sheet throw tests
Both new detail-sheet throw tests start at `todo`/`__none__` and assert the same value — the `waitFor` succeeds on the first tick without the revert actually running. Fix: set an initial state that differs from the expected revert value, so the assertion is genuinely discriminating (e.g. start at "high" priority, trigger throw, assert reverts to "high").

### 3. use-optimistic-action.test.tsx rejection test actually rejects
`tests/unit/use-optimistic-action.test.tsx` — the test named `_on_action_rejection` uses a mock that resolves instead of rejects. Fix the mock to `mockRejectedValue(new Error("fail"))`.

## Files
`tests/unit/list-priority-select-optimistic.test.tsx`, `tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx`, `tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx`, `tests/unit/use-optimistic-action.test.tsx`

## Clarified implementation
- Test-only changes; no production code changes
- Each test must be discriminating: if the revert code were deleted, the test must fail

## Definition of done
- AS-002: PASS with both {ok:false} and throw paths covered
- AS-006: PASS with discriminating revert assertion
