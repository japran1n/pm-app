# Handoff: F065 — Fix AS-044 WeekTimeGrid test

## Status
COMPLETE

## Assertions covered
AS-044: PASS — test_AS_044_own_block_shows_save_and_delete renders WeekTimeGrid, clicks own block's chip via `calendar-week-block-chip-block-own`, asserts Save and Delete buttons are present.
AS-045: PASS — test_AS_045_other_members_block_hides_save_and_delete renders WeekTimeGrid with an own block and a teammate's block, clicks the teammate's chip via `calendar-week-block-chip-block-other`, asserts no Save button, no Delete button, and the read-only note is shown.

## Files changed
tests/unit/f023-readonly-popover.test.tsx

## Commands run
`npx vitest run tests/unit/f023-readonly-popover.test.tsx` (0) — 4 passed
`npx tsc --noEmit` (0)
Mutation test: changed `isOwn={isOwnBlock(block, currentUserId)}` to `isOwn={true}` in `components/calendar/week-time-grid.tsx`, reran the test file — `test_AS_045_other_members_block_hides_save_and_delete` FAILED as expected (found Save button that shouldn't have been there). Reverted the change, reran — all 4 passed again.

## Decisions made
- Kept the two pre-existing `CalendarBlockPopoverForm`-level tests (`test_AS_044_isOwn_true_renders_save_and_delete_buttons`, `test_AS_045_isOwn_false_hides_save_and_delete_buttons`) since they test the form component directly and are still valid/useful as a lower-level check; only replaced the F063 `CalendarBlockChip`-based describe block (dead code, zero production call sites) with a new describe block driving `WeekTimeGrid`/`WeekBlockChip`, the component actually rendered in production (`components/calendar/calendar-day-grid.tsx` uses month view; week view via `week-time-grid.tsx` is the one wiring `isOwn={isOwnBlock(block, currentUserId)}`).
- Reused the same mocks (`@/lib/actions/calendar-blocks`, `@/components/auth/membership-provider`) and block-shape pattern from `tests/unit/f021-no-resize-other-blocks.test.tsx` for consistency with existing WeekTimeGrid test setup.
- Did not delete the file's top-level `CalendarBlockPopoverForm` tests since spec said "Delete or replace the CalendarBlockChip-based tests from F063" specifically — only that describe block was removed/replaced, not the whole file.

## Out-of-scope work needed
None identified. `CalendarBlockChip` itself (components/calendar/calendar-block-chip.tsx) appears to still be dead code with zero production call sites; a future cleanup feature could consider removing it entirely, but that's outside this fix's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left the top-level `CalendarBlockPopoverForm`-only tests (AS-044/AS-045 direct form tests) untouched rather than removing them, since they test real, still-used production code (the form component itself) and aren't part of the "dead code" (CalendarBlockChip) the spec called out for removal.

## Notes for the next worker
- `WeekTimeGrid` requires `workspaceId` for a chip's Popover to actually be clickable/openable in some code paths, but resize/create gating aside, `PopoverTrigger` for `WeekBlockChip` renders regardless — tests pass with `workspaceId="workspace-1"` set, matching the f021 test pattern.
- Block chip test ids follow `calendar-week-block-chip-${block.id}` (not `calendar-block-chip-*`, which is the dead `CalendarBlockChip`'s id scheme) — use this format for any new WeekTimeGrid tests.
- No MCP tools were needed for this feature (pure frontend/unit-test fix, no external service state involved).
