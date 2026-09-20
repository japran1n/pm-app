# Handoff: F073 — Fix AS-056 "Just me" test must pin to selfId, not members[0]

## Status
COMPLETE

## Assertions covered
AS-056: PASS — test_AS_056_just_me_shortcut_returns_selection_to_the_signed_in_member_alone now uses a fixture where selfId ("member-c") is not members[0] ("member-a"); confirmed the test fails under the members[0]!.userId mutation and passes against the unmutated component.

## Files changed
tests/unit/people-switcher.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher.test.tsx` (0) — clean pass, 8/8
`npx vitest run tests/unit/people-switcher.test.tsx` against mutated components/calendar/people-switcher.tsx (`onSelectionChange([selfId])` → `onSelectionChange([members[0]!.userId])`) — 1 failed as required (the AS-056 "Just me" test), confirmed mutation caught, then reverted the component file (no net diff, verified via `git diff --stat components/calendar/people-switcher.tsx` showing no changes)

## Decisions made
- Introduced a local 3-member fixture (`membersWithSelfNotFirst`) scoped to just this test rather than mutating the shared `members` fixture, since other tests in the same file (AS-057 "whole team") depend on the shared 2-member array's exact contents/order.
- selfId set to `member-c`, the third and last member, to maximize the chance a `members[0]` fallback is caught regardless of implementation (first vs. last-element bugs).
- Added an explicit `not.toHaveBeenCalledWith(["member-a"])` assertion alongside the positive assertion for a clearer failure message under mutation.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a local fixture rather than editing the shared `members` array, to avoid touching other passing tests (AS-057 whole-team ordering) that are outside this feature's scope per the spec's "Touches" (only the AS-056 test cases in tests/unit/people-switcher.test.tsx).

## Notes for the next worker
No MCP usage — this is a pure unit-test fix with no external service touched. Verified mutation-kill behavior manually by editing components/calendar/people-switcher.tsx in place, running the suite, then restoring the file from a temp copy before committing (component file has zero net diff in this commit).
