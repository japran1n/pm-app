# F005: stacked window clipping

**Milestone:** M1 — Pure logic
**Estimated worker time:** 30 minutes
**Depends on:** none

## Assertion IDs covered
- AS-018: The stacked layout renders the hours 08:00 to 16:00 only.
- AS-019: The stacked layout renders Monday through Friday only, as five day columns.
- AS-020: A block lying entirely outside 08:00–16:00 is not rendered in the stacked layout.
- AS-021: A block falling on a Saturday or Sunday is not rendered in the stacked layout.
- AS-022: A block that partly overlaps 08:00–16:00 is rendered in the stacked layout clipped to the visible window.

## Draft scope
- Constants for the stacked window: 08:00-16:00, Monday through Friday.
- clipBlockToStackedWindow(block, day) -> clipped range, or null when nothing is visible.
- A block wholly outside the hours returns null.
- A weekend block returns null.
- A partly overlapping block returns the overlapping portion only.

## Files (approximate)
- `lib/calendar/stacked-window.ts`

## Notes for clarification
Clipping is intentional data loss in this view; the user recovers the full picture by selecting that one person (AS-023).
