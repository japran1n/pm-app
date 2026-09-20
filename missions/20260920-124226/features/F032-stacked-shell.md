# F032: stacked shell

**Milestone:** M7 — Stacked
**Estimated worker time:** 45 minutes
**Depends on:** F031

## Assertion IDs covered
- AS-024: A selected person with no blocks in the visible week still gets their own labelled row in the stacked layout.
- AS-062: Each stacked row is labelled with the name of the member it belongs to.
- AS-063: Stacked rows appear in the same order as the ids in `?people=`.

## Draft scope
- One row per selected person, labelled with their name.
- Rows follow the ?people= order.
- A person with no blocks still gets a row.

## Files (approximate)
- `components/calendar/stacked-planner.tsx`

## Notes for clarification
The empty row is the point: an empty week is exactly the signal a PM is looking for.
