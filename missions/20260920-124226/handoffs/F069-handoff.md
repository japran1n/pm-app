# Handoff: F069 — Fix AS-052 — assert avatar presence per member row

## Status
COMPLETE

## Assertions covered
AS-052: PASS — hardened `test_AS_052_lists_active_members_with_avatar_and_name` in `tests/unit/people-switcher.test.tsx` to assert per-row avatar content (real `<img src=avatarUrl>` for the member with a non-null avatarUrl, fallback initials text for the member with a null avatarUrl), not just element count. Verified the required mutation (stripping avatarUrl rendering from the combobox row's `<Avatar>`) causes the test to fail, then restored the original code.

## Files changed
tests/unit/people-switcher.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher.test.tsx tests/unit/people-switcher-multiselect.test.tsx` (0) — 17 passed
`npx vitest run tests/unit/people-switcher.test.tsx` after applying the mutation (stripped avatar rendering in the combobox row) — 1 failed, 7 passed, confirming AS-052 test now fails on the mutation
`npx vitest run tests/unit/people-switcher.test.tsx tests/unit/people-switcher-multiselect.test.tsx` after restoring the component (0) — 17 passed

## Decisions made
- Reused the existing `AutoLoadingImage` shim pattern from `tests/unit/user-avatar.test.tsx` (test_AS_214) since `components/ui/avatar.tsx`'s `AvatarImage` (Base UI's `Avatar.Image`) only mounts a real `<img>` once a background `new window.Image()` probe fires `onload`, which jsdom never does on its own. Without the shim, the image path would never render, masking exactly the regression this fix needs to catch.
- Asserted the two existing fixture members directly by row index (`rows[0]` = Ada Lovelace, non-null avatarUrl → real `<img src="https://example.com/ada.png">`; `rows[1]` = Grace Hopper, null avatarUrl → fallback initials `"GH"`, computed from `initialsFor` in the component: first + last name initial). This matches the spec's requirement of "at least one member with non-null avatarUrl and one with null avatarUrl, asserting both cases" using the fixture already present in the file rather than adding a redundant one.
- Scoped the change to only the AS-052 test in `people-switcher.test.tsx` (the combobox content list) since that's the assertion's owning test; `people-switcher-multiselect.test.tsx`'s avatar-group tests belong to AS-055 and were left untouched, matching spec's "In `tests/unit/people-switcher.test.tsx` (or ...)" wording — only one file needed editing.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `rows[0]`/`rows[1]` positional indexing into the `[data-slot="avatar"]` NodeList rather than scoping by member name text, since the fixture ordering is stable (Ada Lovelace first, Grace Hopper second) and this keeps the assertion tightly coupled to "row N corresponds to fixture member N" per the spec's per-row wording.

## Notes for the next worker
Note: at the start of this session the working tree already had unrelated uncommitted changes to `components/calendar/people-switcher.tsx` (a stray `"hidden"` class prepended to the trigger's className), `next-env.d.ts`, `tests/unit/people-switcher-placement-a11y.test.tsx`, and `missions/20260920-124226/plan.md`. These predate this feature and were left untouched/uncommitted — only `tests/unit/people-switcher.test.tsx` was staged and committed for F069. Worth flagging to the orchestrator since the `"hidden"` class change looks like it could break the closed-trigger UI if left in place unintentionally.
