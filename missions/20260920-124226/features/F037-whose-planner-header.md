# F037: whose planner header

**Milestone:** M8 — Polish
**Estimated worker time:** 15 minutes
**Depends on:** F031

## Assertion IDs covered
- AS-070: When the single selected person is someone other than the signed-in member, the header states whose planner is being shown.
- AS-071: No per-person colour tint is applied to any block in any layout.

## Draft scope
- When the one selected person is not the caller, the header says whose planner is shown.
- Confirm no per-person colour tint exists in any layout.

## Files (approximate)
- `components/calendar/week-view.tsx`

## Notes for clarification
AS-071 closes out the colour-by-person idea that answers 15 and 2.11 jointly made unnecessary.
