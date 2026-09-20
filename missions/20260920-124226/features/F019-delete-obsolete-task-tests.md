# F019: delete obsolete task tests

**Milestone:** M4 — Tasks out
**Estimated worker time:** 30 minutes
**Depends on:** F015,F016,F017,F018

## Assertion IDs covered
- AS-040: The My Tasks page continues to show the signed-in member's tasks exactly as before this mission.
- AS-080: Tests covering task behaviour inside the Planner are deleted rather than skipped or commented out.
- AS-081: No unreachable task-fetching or task-filtering code remains on the Planner route.

## Draft scope
- Delete the task-in-Planner tests rather than skipping them.
- Prove the My Tasks page is unchanged.
- Prove no unreachable task-fetching or task-filtering code remains on the route.

## Files (approximate)
- `tests/integration/f233-calendar-task-interactions.test.ts`
- `tests/integration/f235-calendar-filters.test.ts`
- `tests/integration/f232-calendar-query.test.ts`
- `tests/e2e/f235-calendar-responsive.spec.ts`

## Notes for clarification
Check whether each file is entirely about tasks-in-Planner or only partly; keep the parts that still describe live behaviour.
