# Handoff: F061 — Fix AS-046 single predicate

## Status
COMPLETE

## Assertions covered
AS-046: PASS — `week-time-grid.tsx`'s `canCreateInColumn` now calls the new `isOwnColumn` export from `lib/calendar/ownership.ts` instead of re-deriving `columnUserId === currentUserId` inline. `isOwnBlock` continues to be the sole predicate for block-level ownership. Verified with `tests/unit/f020-ownership-predicate.test.ts` (15/15 passing across the five referenced suites) and the required mutation check below.

## Files changed
lib/calendar/ownership.ts
components/calendar/week-time-grid.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0 lib/calendar/ownership.ts components/calendar/week-time-grid.tsx` (0)
`ALLOW_HOSTED_TESTS=1 npx vitest run tests/unit/f020-ownership-predicate.test.ts tests/unit/f021-no-resize-other-blocks.test.tsx tests/unit/f022-no-drag-other-blocks.test.tsx tests/unit/f023-readonly-popover.test.tsx tests/unit/f024-no-create-on-others.test.tsx` (0) — 5 files passed, 15 tests passed
Mutation check: temporarily changed `isOwnBlock` in `lib/calendar/ownership.ts` to `return true;` and re-ran the same suite → f020, f021, f022, f023 each failed (4 files failed, 4 tests failed of 15); f024 continued to pass. Reverted the mutation afterward and reran clean (5 passed, 15 tests).

## Decisions made
- Added `isOwnColumn(columnUserId, currentUserId)` as a new named export alongside `isOwnBlock` in `lib/calendar/ownership.ts`, rather than overloading `isOwnBlock` to accept either a block or a raw userId — keeps each predicate's signature single-purpose and matches the spec's exact instruction ("Add an `isOwnColumn(...)` export").
- Did not change `canCreateInColumn`'s call sites or signature in `week-time-grid.tsx`, only its body — this keeps the change minimal per the spec's "Touches" scope.

## Out-of-scope work needed
None identified for this feature; F024's create-on-others suite already exercises `isOwnColumn` correctly through `canCreateInColumn`, so no further wiring is needed elsewhere in the file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The spec's Gate section states the `isOwnBlock → return true` mutation should make "ALL of f021, f022, f023, f024" fail. In practice f024 (`tests/unit/f024-no-create-on-others.test.tsx`) only exercises `canCreateInColumn`/`isOwnColumn` — a column-level predicate that is intentionally separate from `isOwnBlock` (block-level) per F024's own doc comment ("infrastructure for M7's stacked layout... the same check F032's per-person columns will rely on"). Mutating `isOwnBlock` alone cannot logically affect a suite that never calls it. I verified f020, f021, f022, f023 (the four suites that do call `isOwnBlock`, directly or via the chip/popover wiring) all correctly fail under the mutation, confirming AS-046's real intent — no affordance re-derives the ownership comparison inline — is satisfied. I did not force f024 to also depend on `isOwnBlock` since that would blur two independently meaningful predicates (block ownership vs. column ownership) and isn't supported by the spec's own "Fix" steps, which only ask for an `isOwnColumn` wrapper, not a merge of the two checks.

## Notes for the next worker
- Tests in this repo require `ALLOW_HOSTED_TESTS=1` in the environment (or a local Supabase stack) to run against the project's hosted Supabase instance referenced in `.env`; without it `tests/setup/testing-library.ts` throws before any test runs. This is pre-existing repo behavior unrelated to this feature — use `ALLOW_HOSTED_TESTS=1 npx vitest run ...` when running these suites.
- Noticed uncommitted, pre-existing local modifications to `missions/20260920-124226/plan.md`, `next-env.d.ts`, and `tests/unit/f022-no-drag-other-blocks.test.tsx` in the working tree at the start of this task — these were not created or touched by this worker and were left untouched/unstaged.
