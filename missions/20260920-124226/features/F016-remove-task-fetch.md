# F016: remove task fetch

**Milestone:** M4 — Tasks out
**Estimated worker time:** 30 minutes
**Depends on:** F015

## Assertion IDs covered
- AS-034: Loading the Planner issues no query for tasks.
- AS-036: Stale `?status=`, `?priority=`, `?assigneeId=`, or `?projectId=` values in a Planner URL are ignored without producing an error.

## Draft scope
- Remove the getCalendarTasks call and its props from the page.
- Stale status/priority/assigneeId/projectId params are ignored without error.

## Files (approximate)
- `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`

## Notes for clarification
Old bookmarks carrying those params must still render, silently.
