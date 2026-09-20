# F017: delete calendar filters

**Milestone:** M4 — Tasks out
**Estimated worker time:** 30 minutes
**Depends on:** F016

## Assertion IDs covered
- AS-035: The Planner shows no status, priority, assignee, or project filter controls.

## Draft scope
- Delete components/calendar/calendar-filters.tsx.
- Delete lib/calendar/resolve-filters.ts.
- Remove every remaining import of both.

## Files (approximate)
- `components/calendar/calendar-filters.tsx`
- `lib/calendar/resolve-filters.ts`

## Notes for clarification
The bar exists only to narrow tasks; with tasks gone it has nothing to filter.
