# Handoff: F081 — Fix AS-054 selection visual and test

## Status
COMPLETE

## Assertions covered
AS-054: PASS — `npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (12/12 passed); component now renders a visible CheckIcon + highlighted background on selected CommandItems, and the rewritten test drives selection through real clicks from an empty state, asserting accumulation after each click.

## Files changed
components/calendar/people-switcher.tsx
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0, 12 passed)
Mutation check (not committed): temporarily changed `toggleMember`'s add-branch from `onSelectionChange([...selectedUserIds, userId])` to `onSelectionChange([userId])` (replace instead of accumulate) and re-ran the suite — 2 tests failed (`test_AS_054_selecting_a_second_member_keeps_the_first_selected` and the rewritten `test_AS_054_three_members_can_be_selected_simultaneously`), confirming the new test is falsifiable. Reverted with `git checkout --` and reapplied the CheckIcon/highlight fix (the checkout also reverted that unstaged change, so it was redone via Edit and re-verified before committing).

## Decisions made
- Used existing `bg-accent text-accent-foreground` tokens for the selected-row highlight rather than introducing a new class, since the repo already uses `accent` for similar selected/hover states elsewhere in `components/ui`.
- Placed the `CheckIcon` after the member name (`ml-auto`) so it aligns to the right edge of the row, consistent with common combobox/checkbox-list patterns and cmdk's own CommandItem layout conventions.
- Rewrote (in place) the existing `test_AS_054_three_members_can_be_selected_simultaneously` test rather than adding a new test with a different name, since the spec's "Replace/add" language permitted either and replacing avoided a redundant near-duplicate of the two tests already above it.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `bg-accent text-accent-foreground` for the selected-state background class since it's the existing semantic token pair in this codebase's UI kit for "currently active/selected" rows, keeping the fix consistent with existing visual language rather than introducing new ad hoc colors.

## Notes for the next worker
No MCP usage — pure UI/component/unit-test fix, no external service state touched. When testing mutations, note that `git checkout -- <file>` reverts ALL unstaged changes to that file, including unrelated ones made in the same session — reapply other edits afterward if you use this technique to verify test falsifiability.
