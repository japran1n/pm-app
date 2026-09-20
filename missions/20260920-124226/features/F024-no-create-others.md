# F024: no create others

**Milestone:** M5 — Read-only
**Estimated worker time:** 30 minutes
**Depends on:** F020

## Assertion IDs covered
- AS-047: No create affordance is offered on a day column or stacked row belonging to another member.
- AS-048: Dragging over empty space in another member's day column or stacked row creates nothing.
- AS-049: Creating a block by clicking or dragging still works on the signed-in member's own grid.

## Draft scope
- No '+' affordance on a column or row belonging to someone else.
- Drag over empty space there creates nothing.
- Creating on the caller's own grid is unchanged.

## Files (approximate)
- `components/calendar/week-time-grid.tsx`

## Notes for clarification
Answer 22(a): never offer creation on someone else's planner, not even on the caller's own behalf.
