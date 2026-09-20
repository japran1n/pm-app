# Handoff: F074 — Fix AS-055 trigger avatar identity

## Status
COMPLETE

## Assertions covered
AS-055: PASS — added two new tests: (1) trigger avatar renders `<img src="...">` for a selected member with a non-null `avatarUrl`, and (2) trigger avatars for two selected members with distinct initials ("AL" and "BO") both appear — this test fails when the trigger render is mutated to `initialsFor(selectedMembers[0]!)` for every avatar, confirmed by manual mutation run.

## Files changed
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0) — 11/11 passing on unmutated source
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (1) — after manually mutating components/calendar/people-switcher.tsx line 169 to `initialsFor(selectedMembers[0]!)`, 1 test failed as required (mutation reverted afterward, source file untouched in final diff)

## Decisions made
- Investigated `components/calendar/people-switcher.tsx`: the trigger avatar loop at line 169 already correctly calls `initialsFor(member)`, not `initialsFor(selectedMembers[0])` — the bug described in the spec (if it ever existed) is not present in current source. This feature is purely about strengthening the test suite per the spec's explicit scope ("Add tests..." / "In tests/unit/people-switcher-multiselect.test.tsx").
- Reused the same `Image` global stub pattern from `tests/unit/people-switcher.test.tsx` (`test_AS_052_lists_active_members_with_avatar_and_name`) for the `<img>` assertion, since Base UI's `Avatar.Image` only mounts the real `<img>` after an async `new window.Image()` load probe that jsdom never fires natively.
- Used two-letter initials ("AL", "BO") rather than single letters, matching the actual `initialsFor` output format observed by running the test against real component output (first + last name initials).
- Ran the mutation described in the spec by hand (sed on the specific line, not a persisted change) to prove test 2 fails when the trigger uses `selectedMembers[0]` for every avatar; confirmed the mutation is reverted and `git status` is clean before committing.

## Out-of-scope work needed
None identified — spec is test-only and fully satisfied.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not modify `components/calendar/people-switcher.tsx` even though the spec's "Problem" section describes a bug, because (a) the "Fix" section scopes the work explicitly to the test file only, and (b) inspection of current source shows the trigger already uses `initialsFor(member)` correctly — there is nothing to fix in application code, only test coverage to add.

## Notes for the next worker
- `PeopleSwitcherMember.avatarUrl` type is `string | null`; the fixture for the image test uses a non-null URL as instructed by the spec.
- If a future worker needs to test the `<img>` branch elsewhere in this component, reuse the `AutoLoadingImage` stub pattern from `tests/unit/people-switcher.test.tsx` (lines ~64-96) — required because Base UI's `Avatar.Image` primitive only renders once `new window.Image()`'s `onload` fires.
