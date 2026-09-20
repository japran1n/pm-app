# F036: stacked scroll and colour

**Milestone:** M7 — Stacked
**Estimated worker time:** 30 minutes
**Depends on:** F033

## Assertion IDs covered
- AS-067: A block in the stacked layout keeps its own colour; no per-person colour is substituted.
- AS-068: Selecting many members makes the stacked layout scroll rather than compressing the rows until they are unreadable.
- AS-069: The Planner displays no hours total, no capacity figure, and no utilisation percentage anywhere.

## Draft scope
- Many rows scroll rather than compressing to unreadable heights.
- A block keeps its own colour.
- No hours, capacity, or utilisation figure is rendered.

## Files (approximate)
- `components/calendar/stacked-planner.tsx`

## Notes for clarification
AS-069 is a negative assertion on purpose: capacity was explicitly cut in answers 17, 19 and 2.14.
