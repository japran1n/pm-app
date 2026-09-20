# F021: no resize others

**Milestone:** M5 — Read-only
**Estimated worker time:** 15 minutes
**Depends on:** F020

## Assertion IDs covered
- AS-042: A block owned by another member exposes no resize handles.

## Draft scope
- Resize handles are not rendered on a block the caller does not own.

## Files (approximate)
- `components/calendar/week-time-grid.tsx`

## Notes for clarification
Fixes a live defect: the handle exists today and the server refuses the write.
