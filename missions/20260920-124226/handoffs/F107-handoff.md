# Handoff: F107 — Fix AS-067 no per-person colour in stacked layout

## Status
COMPLETE

## Assertions covered
AS-067: PASS — added `test_AS_067_block_color_not_overridden_by_person_palette` in `tests/unit/f036-stacked-scroll-colour.test.tsx`, rendering `StackedPlanner` with 2 members (alice/bob) whose blocks have distinct non-palette colors (#ef4444 red, #22c55e green), and asserting each chip keeps its own `block.color`. Verified the mutation the spec describes (swapping `getCalendarBlockDisplayColor(segment.block.color)` for a person-indexed palette lookup) makes this new test fail, while the prior isolated `StackedPersonRow` tests were confirmed to also fail under that mutation (I temporarily applied and reverted the mutation locally, never committed).

## Files changed
tests/unit/f036-stacked-scroll-colour.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f036-stacked-scroll-colour.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0, 8 passed)

## Decisions made
- Added the new test to the existing `f036-stacked-scroll-colour.test.tsx` file (per the spec's "likely in" pointer) rather than a new file, keeping all AS-067 coverage together.
- Used `StackedPlanner`'s real props (`selectedUserIds`, `members: SwitcherMember[]`, `blocksByUser: Map`, `weekKey`, `workspaceSlug`, `selfId`, `weekParam`) read directly from `components/calendar/stacked-planner.tsx` and `lib/calendar/workspace-members.ts` rather than the spec's illustrative sketch, since the real component doesn't take a `personColor` prop today — the point of the test is to prove that if one were ever introduced and wired to overwrite `block.color`, this test catches it.
- Picked block colors (#ef4444, #22c55e) that are two different, non-adjacent entries in `CALENDAR_BLOCK_COLORS` so a `PERSON_PALETTE[i % n]`-style override is very unlikely to coincidentally match by chance.
- Verified mutation-kills-test locally by patching `stacked-person-row.tsx` to hardcode `displayColor = PALETTE[0]` (simulating a person-indexed override) — the new integration test failed as required, plus 2 of the existing isolated-row AS-067 tests failed too, confirming the new test adds coverage at the integration boundary without being redundant. All source changes were reverted before committing (`git status` on `components/calendar/stacked-*.tsx` was clean before commit).
- The `next/navigation` `vi.mock` and `SwitcherMember` usage already present/needed in the test file overlapped with recent parallel changes to the same file (router mock for another feature); no conflict — my edits layered cleanly on top and the final file was re-verified with a fresh read before commit.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not add an actual `personColor` prop to `StackedPersonRow`/`StackedPlanner` (the spec's illustrative code sketch implies one might exist) because the real components have no such prop and the feature is a test-only regression-coverage fix, not a product change. The mutation described in the spec is a hypothetical future regression to guard against, not a current bug to fix.

## Notes for the next worker
No MCP usage — this is a pure client-side test file addition, no external services touched.
