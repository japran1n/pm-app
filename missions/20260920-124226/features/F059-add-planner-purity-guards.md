# F059: Add falsifiable Planner-purity guards

**Milestone:** M4 follow-up (M4-scrutiny-1 major)
**Depends on:** F057, F058

## Problem (AS-033, AS-034)

Current tests for task removal mirror the deleted implementation rather than the invariant:
- AS-033: test asserts a non-existent `data-testid` is absent (vacuously true)
- AS-034: no test guards that the calendar page issues no task query

## What to add

### Guard 1 — Import allowlist (AS-034)

Add a test in `tests/unit/f016-calendar-page-no-task-query.test.ts`:

Read the source of:
- `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
- `components/calendar/week-view.tsx`
- `components/calendar/week-time-grid.tsx`
- `components/calendar/week-agenda.tsx`

Assert that NONE of them contains an import from `@/lib/queries/calendar` or
`@/lib/queries/tasks` or `getCalendarTasks` (string search, not just import statements —
catches dynamic imports too).

Also assert that the page's `searchParams` type does NOT include `status`, `priority`,
`assigneeId`, `projectId`, or `taskId` (read the type from the source text).

This test fails if anyone re-adds a task fetch to the page.

### Guard 2 — WeekView allowlist render test (AS-033)

Replace the vacuous `calendar-week-allday-*` test case in
`tests/unit/f015-remove-task-strips.test.tsx` with:

Render `<WeekView>` with realistic fixtures (5 calendar blocks, some time-off entries, no
task data). After render, collect all `data-testid` attributes present in the tree. Assert
that NONE contains the substring `task` or `allday-chip` or `agenda-task`.

This fails on ANY task-shaped node regardless of its naming.

## Gate

```bash
npx vitest run tests/unit/f015-remove-task-strips.test.tsx tests/unit/f016-calendar-page-no-task-query.test.ts
npx tsc --noEmit
```

Write handoff to missions/20260920-124226/handoffs/F059-handoff.md with Status COMPLETE.
Commit before exiting.
