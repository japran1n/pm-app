# F035: stacked row reorder

**Milestone:** M7 — Stacked
**Estimated worker time:** 45 minutes
**Depends on:** F032,F002

## Assertion IDs covered
- AS-064: A stacked row can be dragged to a new position among the other rows.
- AS-065: Reordering stacked rows rewrites `?people=` so the new order survives a page reload.

## Draft scope
- A row can be dragged to a new position.
- The new order is written back into ?people=, so it survives a reload.

## Files (approximate)
- `components/calendar/stacked-planner.tsx`

## Notes for clarification
Uses the existing @dnd-kit/sortable, matching the board and docs sidebar. Persistence is the URL and nothing else.
