# Handoff: F038 — Accessibility: stacked rows as labelled regions, announced per person

## Status
COMPLETE

## Assertions covered
AS-083: PASS — test_AS_083_stacked_row_is_labelled_region and test_AS_083_row_label_falls_back_to_userId_without_name both pass in tests/unit/f038-stacked-a11y.test.tsx

## Files changed
components/calendar/stacked-person-row.tsx
components/calendar/stacked-planner.tsx
tests/unit/f038-stacked-a11y.test.tsx

## Commands run
`npx tsc --noEmit` (1, but only pre-existing unrelated errors in planner-header.tsx / f037-planner-header-subtitle.test.tsx, confirmed present before my changes via git stash comparison)
`npx eslint components/calendar/stacked-person-row.tsx components/calendar/stacked-planner.tsx tests/unit/f038-stacked-a11y.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f038-stacked-a11y.test.tsx tests/unit/f032-stacked-shell.test.tsx tests/unit/f033-stacked-row-grid.test.tsx tests/unit/f035-stacked-reorder.test.tsx tests/unit/f036-stacked-scroll-colour.test.tsx` (0, 29 passed)
`npx vitest run tests/unit` (full suite: 133 pre-existing failures in unrelated files e.g. list-due-date-cell-optimistic.test.tsx, confirmed unrelated to F038 scope)

## Decisions made
- Added `role="region"` and `aria-label={`${userLabel ?? userId}'s schedule`}` on the outer wrapper of StackedPersonRow, matching the spec exactly. Used `userLabel ?? userId` so a row is never unlabelled even when the caller doesn't pass a name (same fallback posture stacked-planner.tsx already uses upstream at the `userLabel` derivation).
- Added `role="group"` and `aria-label="Team planner"` to the outer container in StackedPersonRow's sibling component StackedPlanner, per the spec's "also check" instruction. This was found already present in the working tree at time of edit (already committed in a prior commit `dbc7a0be`) — verified via `git log` / `git diff` that the file matches what I intended to write, so no further action was needed there.

## Out-of-scope work needed
None identified beyond spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `userLabel ?? userId` as the aria-label subject rather than requiring userLabel, since StackedPersonRow's `userLabel` prop is optional; this keeps AS-083 satisfied (every row is a labelled region) even for callers/tests that omit it.

## Notes for the next worker
`npx tsc --noEmit` and the full vitest suite both show pre-existing failures unrelated to this feature (planner-header.tsx `id` vs `userId` property mismatch on PeopleSwitcherMember, and several optimistic-update tests elsewhere). I confirmed via `git stash`/`git stash pop` that these errors exist independent of my changes and are out of scope for F038 (spec only touches stacked-person-row.tsx and stacked-planner.tsx).
