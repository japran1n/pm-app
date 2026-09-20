# F034: stacked time off

**Milestone:** M7 — Stacked
**Estimated worker time:** 30 minutes
**Depends on:** F032

## Assertion IDs covered
- AS-066: Approved time off for a member is shown as a strip above that member's stacked row.

## Draft scope
- Approved time off renders as a strip above that person's row.

## Files (approximate)
- `components/calendar/stacked-planner.tsx`
- `components/calendar/time-off-day-strip.tsx`

## Notes for clarification
Reuse the existing strip component rather than a second rendering of the same data.
