# F060: Fix AS-034 — rewrite import guard as allowlist

**Milestone:** M4 follow-up (M4-scrutiny-2 FAIL)
**Estimated worker time:** 15 minutes
**Depends on:** F059

## Problem

`tests/unit/f016-calendar-page-no-task-query.test.ts` checks a blocklist of 3 specific import names.
Adding `import { getMyTasks } from "@/lib/queries/my-tasks"` to calendar/page.tsx passes all 21 tests.
The intent of AS-034 is that the Planner page issues NO task query — a blocklist can never prove that.

## Fix

Rewrite the test as an **allowlist**: read the source of:
- `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
- `components/calendar/week-view.tsx`
- `components/calendar/week-time-grid.tsx`
- `components/calendar/week-agenda.tsx`

Extract every `import ... from "..."` statement. For each import whose path starts with `@/lib/queries/`,
assert it is in this allowlist:
```
@/lib/queries/calendar-blocks
@/lib/queries/members
@/lib/queries/time-off
@/lib/queries/workspaces
@/lib/queries/profiles
```

Add/remove entries only if reading the actual file shows other legitimate data queries are present.
The key invariant: NO import from a path containing `/queries/tasks` or `/queries/my-tasks` or
`/queries/calendar` (the old deleted file) is allowed through.

## Why this works

An allowlist fails on ANY new query import, regardless of what it's named, because the import
path itself would not be in the allowed set. The workaround of renaming `getCalendarTasks` to
`getMyTasks` still fails because `@/lib/queries/my-tasks` is not in the allowlist.

## Gate

```bash
npx vitest run tests/unit/f016-calendar-page-no-task-query.test.ts
# Mutation test: add `import { getMyTasks } from "@/lib/queries/my-tasks"` to calendar/page.tsx
# → must FAIL the test
# Restore after verifying
npx tsc --noEmit
```

Write handoff to missions/20260920-124226/handoffs/F060-handoff.md with Status COMPLETE.
Commit before exiting.
