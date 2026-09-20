# F057: Delete orphaned month-view task subtree

**Milestone:** M4 follow-up (M4-scrutiny-1 blocker)
**Estimated worker time:** 25 minutes
**Depends on:** F015, F016, F017, F019

## Problem (AS-081)

The following files are reachable from no route in the app. They define `getCalendarTasks`,
`getUndatedTaskCount`, `CalendarTaskFilters`, and task chips — exactly what AS-081 forbids:

- `lib/queries/calendar.ts` — defines `getCalendarTasks`, `getUndatedTaskCount`, `CalendarTaskFilters` with ZERO call sites
- `components/calendar/month-grid.tsx`
- `components/calendar/calendar-day-grid.tsx`
- `components/calendar/agenda-list.tsx`
- `components/calendar/day-cell.tsx`
- `components/calendar/day-overflow.tsx`
- `components/calendar/use-calendar-realtime.ts`
- `lib/calendar/reschedule.ts`
- `lib/calendar/reconcile-realtime-task.ts`
- `lib/tasks/subscribe-calendar-realtime.ts`

## What NOT to delete

- `lib/calendar/month-grid.ts` (the date-math module — imported by `app/(workspace)/w/[workspaceSlug]/time/me/page.tsx` and `components/time/my-time-view.tsx`)
- `lib/calendar/week-grid.ts`

## Steps

1. Check `lib/queries/calendar.ts` for any non-task exports that have live callers outside tests.
   Specifically: `getWorkspaceStatusOptions` — grep for callers. If any live route imports it,
   relocate it to the appropriate query file before deleting `calendar.ts`.

2. Delete all 10 files listed above.

3. Delete any test files that exist ONLY to test the deleted modules (the ones testing
   `month-grid.tsx`, `calendar-day-grid.tsx`, `agenda-list.tsx`, `day-cell.tsx`,
   `day-overflow.tsx`, `use-calendar-realtime.ts`, `reschedule.ts`, `reconcile-realtime-task.ts`).
   F058 will handle remaining tests; this feature only deletes tests whose subject module was
   just deleted.

4. Run `npx tsc --noEmit` — must be clean. Fix any remaining import errors.

## Gate

```bash
npx tsc --noEmit
npx eslint --max-warnings=0
grep -rn "getCalendarTasks\|CalendarTaskFilters\|tasksByDate" app/ components/ lib/ --include="*.ts" --include="*.tsx"
# ^ must be zero results
```

Write handoff to missions/20260920-124226/handoffs/F057-handoff.md with Status COMPLETE.
Commit before exiting.
