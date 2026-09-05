# F025: Fix My Tasks realtime subscription (wrong column)

**Milestone:** M2
**Estimated worker time:** 45 min
**Depends on:** F008, F011

## Assertion IDs covered
- AS-015, AS-016, AS-017, AS-018

## Root cause

`tasks.assignee_id` is DEPRECATED per `supabase/migrations/20260822020000_task_assignees_table.sql`. Assignment is resolved from the `task_assignees` join table. F008's hook filters on the wrong column.

Additionally, AS-017 (un-assign) is structurally impossible with a row filter: Supabase evaluates UPDATE row filters against the NEW record, so an un-assign (removing from task_assignees) drops the event server-side.

## Fix

Read the actual data model first:
1. Check `supabase/migrations/` to understand the `task_assignees` table schema
2. Check `getMyTasks` server action to understand how tasks are fetched for the current user
3. Check how other realtime hooks in the codebase handle this (board, list views)

Fix approach:
- Subscribe to `task_assignees` table changes (INSERT/DELETE) to detect assignment changes
- Subscribe to `tasks` table changes with no row filter (rely on RLS) to detect task updates
- On `task_assignees` INSERT with matching user_id: trigger a refresh or add the task
- On `task_assignees` DELETE with matching user_id: remove the task
- On `tasks` UPDATE: update matching task if present in local state
- On `tasks` DELETE: remove from local state

Also fix `tests/unit/f008-my-tasks-realtime.test.ts` — line 54 currently asserts `filter: "assignee_id=eq.user-1"` which enforces the bug.

Add component-level wiring tests: dispatch a fake realtime event and assert the rendered todo list updates.

## Files
`components/my-tasks/use-my-tasks-realtime.ts`, `tests/unit/f008-my-tasks-realtime.test.ts`

## Definition of done
- AS-015: PASS — new assignment appears without refresh
- AS-016: PASS — status change updates todo
- AS-017: PASS — un-assign removes from list
- AS-018: PASS — delete removes from list
- Deleting the `useMyTasksRealtime` call from personal-todo-list.tsx must fail at least one test
