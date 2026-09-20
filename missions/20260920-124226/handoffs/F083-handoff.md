# Handoff: F083 — Fix AS-055 overflow test with non-default maxVisibleAvatars

## Status
COMPLETE

## Assertions covered
AS-055: PASS — new test `test_AS_055_overflow_shows_first_n_members_in_selection_order_not_last_n` renders 4 members, all selected, `maxVisibleAvatars={2}` (explicit, non-default). Asserts exactly 2 avatars visible, overflow badge "+2", first 2 in selection order (Alice, Bob) are the visible ones, Carol/Dave are not. Verified: mutating `selectedMembers.slice(0, maxVisibleAvatars)` to `selectedMembers.slice(-maxVisibleAvatars)` in `components/calendar/people-switcher.tsx` makes this test FAIL (confirmed by temporarily applying the mutation, running the suite, seeing 1 failure, then reverting).

## Files changed
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/people-switcher-multiselect.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0, 12/12 passed)
Mutation verification (temporary, reverted): `sed -i` changed `slice(0, maxVisibleAvatars)` to `slice(-maxVisibleAvatars)` in `components/calendar/people-switcher.tsx`, ran vitest → 1 test failed (the new AS-055 test) as expected, then restored the original file from the `.bak` backup created by `sed -i.bak` and confirmed `git diff` showed no residual change from this action.

## Decisions made
- Used `data-slot="avatar-fallback"` textContent (initials "AL", "BO", "CA", "DA") to identify which specific members are rendered, rather than relying only on avatar count, so the test distinguishes "first N" from "last N" — this is what makes the `slice(-n)` mutation observable.
- Reused the existing member-shape pattern (`alice`/`bob` objects with `avatarUrl: null`) already used elsewhere in the same test file for consistency.
- Named the new test `test_AS_055_overflow_shows_first_n_members_in_selection_order_not_last_n` per repo convention of encoding the assertion ID and specific behaviour in the test name.

## Out-of-scope work needed
None identified. The existing five other AS-055 tests in the file remain unchanged and still pass; F070/F074/F069 (which touched other AS-055 overflow/avatar-identity gaps) are unrelated prior work already committed.

Note: at the start of this task, `git status` showed pre-existing uncommitted local modifications to `components/calendar/people-switcher.tsx` (adding a `CheckIcon` and checked-item styling), `next-env.d.ts`, and `missions/20260920-124226/plan.md` that were NOT made by this worker and are unrelated to F083's scope (fixing an overflow test). These were left untouched and not committed, since F083's Touches is limited to the test file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Verified the mutation-kills-test requirement by actually applying the mutation locally, running the suite, and reverting, rather than only reasoning about it, per the spec's emphasis on "test MUST FAIL" — this is stronger evidence for the handoff and required no user input.

## Notes for the next worker
- `initialsFor()` in `components/calendar/people-switcher.tsx` derives 2-letter initials from `parts[0][0] + parts[last][0]` for multi-word names, or `slice(0,2)` of the single word for one-word names — so single first names like "Alice"/"Bob"/"Carol"/"Dave" produce "AL"/"BO"/"CA"/"DA", not the two-word-initial pattern ("A" + last name). Confirmed via direct file read before writing assertions.
- The component's visible-avatar slice logic lives at `components/calendar/people-switcher.tsx:128`: `const visibleMembers = selectedMembers.slice(0, maxVisibleAvatars);`.
