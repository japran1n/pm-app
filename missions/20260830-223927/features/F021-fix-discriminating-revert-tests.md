# F021: Propagate discriminating test shape to remaining vacuous tests (FU-K)

**Milestone:** M1
**Estimated worker time:** 25 min
**Depends on:** F017

## Assertion IDs covered
- AS-004: due-date cell reverts on server error

## Scope

Scrutiny found that replacing `useOptimistic` with `useState` in `use-optimistic-action.ts` (removing auto-revert entirely) still leaves the following tests green — they are vacuous:

1. `tests/unit/list-due-date-cell-optimistic.test.tsx` — AS-004 failure test does not fail when auto-revert is removed
2. `tests/unit/use-optimistic-action.test.tsx` — core hook revert test(s) similarly non-discriminating

Fix: rewrite these tests so that swapping `useOptimistic` → `useState` in the hook causes them to fail:
- For AS-004: assert that the DISPLAYED date value reverts to the PRE-CHANGE value after action rejects (not just that a toast appears). Start at date A, change to date B, action rejects, assert displayed value is back to A.
- For the hook test: assert optimistic value is temporarily the new value during the transition AND reverts to original after rejection — both phases need checking.

## Files
`tests/unit/list-due-date-cell-optimistic.test.tsx`, `tests/unit/use-optimistic-action.test.tsx`

## Definition of done
- AS-004: PASS — swapping useOptimistic → useState in the hook fails this test
