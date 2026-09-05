# F018: Fix priority clear-to-null test (FU-H)

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 20 min
**Depends on:** F014, F016

## Assertion IDs covered
- AS-007: Changing task priority to "No priority" updates badge immediately

## Scope

Scrutiny noted: the clear-to-null priority test in `f004-task-detail-sheet-priority-optimistic.test.tsx` stubs `SelectValue` in a way that makes it always return null, so the test trivially passes even against the broken `??` code. Fix the test to use a genuine value-binding check:

1. Read the Select's `value` prop directly (not via `SelectValue` text content)
2. Or render with a controlled value that distinguishes "no priority" from "unset"
3. The test must fail if `F014`'s fix is reverted

Also verify the test actually covers the `high → No priority` flow and the badge renders the "No priority" label.

## Files
`tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx`

## Clarified implementation
- Test-only change (production fix already in F014)
- The test must be discriminating: reverting the F014 fix must cause this test to fail

## Definition of done
- AS-007: PASS with genuinely discriminating clear-to-null test
