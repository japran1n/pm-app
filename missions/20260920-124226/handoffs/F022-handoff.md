# Handoff: F022 — No drag-to-move on another member's block

## Status
COMPLETE

## Assertions covered
AS-043: PASS — `tests/unit/f022-no-drag-other-blocks.test.tsx` (2 tests) confirms a block owned by the current user is draggable (`data-draggable="true"`, `cursor-grab` class, dnd-kit `useDraggable` not disabled) and a block owned by another member is not (`data-draggable="false"`, `cursor-default` class, drag listeners not spread onto the DOM node).

## Files changed
components/calendar/calendar-block-chip.tsx
tests/unit/f022-no-drag-other-blocks.test.tsx
missions/20260920-124226/features/F022-no-drag-other-blocks.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0components/calendar/calendar-block-chip.tsx tests/unit/f022-no-drag-other-blocks.test.tsx` (0)
`npx vitest run tests/unit/f022-no-drag-other-blocks.test.tsx` (0 — 2 passed)
`npx vitest run` (0 — 310 pre-existing integration-test failures, all `TypeError: fetch failed` against live Supabase/network, none touching calendar/planner code; 4510 passed, 1684 skipped)

## Decisions made
- `components/calendar/calendar-block-chip.tsx` (dnd-kit `useDraggable`-based chip) is the only place in the codebase that implements drag-to-move for calendar blocks. `week-time-grid.tsx`'s `WeekBlockChip` only implements resize (F021) and drag-to-create; it has no move-drag path, so AS-043 has a single implementation site.
- Followed the exact pattern F021 established for `canResize` (`canDrag && isOwnBlock(block, currentUserId)`), applied here as `canMove`, passed to `useDraggable({ disabled: !canMove })`.
- Also gated spreading dnd-kit's `{...listeners}` on `canMove` (not just the `disabled` flag) so a non-owner's chip carries no pointer/keyboard drag handlers in the DOM at all, matching the "no drag affordance" requirement in the spec.
- Added `data-draggable` attribute purely as a test hook; it carries no runtime behavior.
- `CalendarBlockChip` had no callers anywhere in the app (confirmed via repo-wide grep) before this change, so adding the required `currentUserId` prop is non-breaking.

## Out-of-scope work needed
- `CalendarBlockChip` is currently unused/dead code (no import sites outside its own test file) — it appears to be a leftover from an earlier month-view implementation. If a future feature reintroduces drag-to-move in the week time grid (`WeekBlockChip`/`week-time-grid.tsx`), that implementation will need its own ownership gate mirroring this one; it does not exist today so there was nothing to fix there for AS-043.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented the ownership gate on `calendar-block-chip.tsx` (the sole drag-to-move implementation) rather than `week-time-grid.tsx`, since the latter has no move-drag code path to gate. This follows "Files (approximate)" in the plan draft, which listed both files as candidates, and the clarification file confirms no additional constraints beyond the spec.

## Notes for the next worker
- No MCP usage — pure client-component/unit-test change, no external service state touched.
- `npx vitest run` (full suite) takes ~3 minutes and has ~310 pre-existing failures from tests hitting live Supabase over the network (`fetch failed`); this is unrelated to F022 and was true before this change (verified none of the failing test file names reference calendar/planner).
