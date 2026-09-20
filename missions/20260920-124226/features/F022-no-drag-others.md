# F022: no drag others

**Milestone:** M5 — Read-only
**Estimated worker time:** 15 minutes
**Depends on:** F020

## Assertion IDs covered
- AS-043: A block owned by another member cannot be dragged to a new time.

## Draft scope
- A block the caller does not own cannot be picked up or moved.

## Files (approximate)
- `components/calendar/week-time-grid.tsx`
- `components/calendar/calendar-block-chip.tsx`

## Notes for clarification
Same defect as F021, on the move path rather than the resize path.
