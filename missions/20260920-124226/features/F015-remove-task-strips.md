# F015: remove task strips

**Milestone:** M4 — Tasks out
**Estimated worker time:** 30 minutes
**Depends on:** none

## Assertion IDs covered
- AS-033: The Planner renders no task strips and no task chips.

## Draft scope
- Remove the all-day task strip row from the week grid.
- Remove the task chip component usage on this route.

## Files (approximate)
- `components/calendar/week-time-grid.tsx`
- `components/calendar/week-view.tsx`

## Notes for clarification
Product decision 6/2.3(a). The week grid keeps blocks and time off only.
