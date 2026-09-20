# Handoff: F021 — No resize handles on another member's block

## Status
COMPLETE

## Assertions covered
AS-042: PASS — `test_AS_042_own_block_shows_resize_handles` and `test_AS_042_other_members_block_hides_resize_handles` in `tests/unit/f021-no-resize-other-blocks.test.tsx` both pass.

## Files changed
components/calendar/week-time-grid.tsx
tests/unit/f021-no-resize-other-blocks.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0 components/calendar/week-time-grid.tsx tests/unit/f021-no-resize-other-blocks.test.tsx` (0)
`npx vitest run tests/unit/f021-no-resize-other-blocks.test.tsx tests/unit/calendar-week-time-grid-live-resize.test.tsx tests/unit/calendar-week-time-grid-create-popover.test.tsx` (0, 9 passed)
`npx vitest run` (0, full suite: 292 pre-existing failing test files / 4508 passed — none in week-time-grid or F021 files; unrelated to this change, see Notes)

## Decisions made
- Used `lib/calendar/ownership.ts`'s `isOwnBlock(block, currentUserId)` exactly as F020 intended, computed inline at the `WeekBlockChip` call site as `canResize={canDrag && isOwnBlock(block, currentUserId)}` — resize still requires write permission (`canDrag`) AND ownership, so a read-only member sees no handles either (existing behavior preserved, F021 only tightens the own-block case).
- Renamed the existing `canDrag` prop on `WeekBlockChip` to `canResize` rather than adding a second prop, since `canDrag` inside `WeekBlockChip` was used exclusively to gate the two resize-handle spans — passing the already-combined boolean keeps the component's internal logic unchanged and avoids an unused-prop lint warning.
- Left `currentUserId` prop no longer prefixed with `_` in `WeekTimeGrid` since it's now read (F020 had left it unread as plumbing for F021-F024).

## Out-of-scope work needed
F022-F024 (drag, edit popover, delete) still need the same `isOwnBlock` gating per F020's doc comments — not touched here, out of scope for F021.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — implementation matched the feature spec and F020's established pattern directly)

## Notes for the next worker
The full `npx vitest run` suite has 292 pre-existing failing test files unrelated to calendar/week-time-grid (e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx`). Verified via `grep -i "week-time-grid\|f021"` against the full run's output — zero matches among the failures, confirming this feature's change and its own test file are unaffected and passing. Ran the three directly-relevant test files together (this feature's + the two existing week-time-grid resize/create-popover tests) as an additional isolated pass — all 9 green.
