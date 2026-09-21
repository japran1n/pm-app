# F003: getQaReturns

**Milestone:** M1  **Time:** 25 min  **Depends on:** F001

## Assertions
AS-023

## Clarified implementation
`task_activity` columns (confirmed from codebase): `id, task_id, kind, field, old_value, new_value, actor_id, created_at`.

Add to `lib/queries/my-tasks.ts`:

```ts
export type QaReturnItem = {
  taskId: string;
  taskTitle: string;
  taskNumber: number;
  projectKey: string;
  projectName: string;
  changedAt: string; // ISO timestamp
};

export async function getQaReturns(
  workspaceId: string,
  userId: string
): Promise<QaReturnItem[]>
```

Logic:
1. Find tasks assigned to `userId` in the workspace (join `tasks → projects`).
2. Find `task_activity` rows for those tasks where:
   - `field = 'status'` (status change)
   - `actor_id != userId` (someone else changed it, not the assignee themselves)
   - `created_at > now() - interval '7 days'`
3. Get the `new_value` status id/name. Join to `project_statuses` to check its `category`. Must NOT be 'done', NOT be 'cancelled'.
4. Get the `old_value` status id/name. Join to `project_statuses` to check its `category` or name contains 'qa' (case-insensitive) OR category = 'qa'.
5. Return task title, number, project key/name, changedAt. Max 10 rows, newest first.

**Note:** `old_value`/`new_value` in task_activity for status field may be the status name or ID — check what the actions write by grepping `lib/actions/tasks.ts` for task_activity inserts. Adapt accordingly.

Unit test: mock supabase chain returning known rows, verify result shape.

## Definition of done
- Function exported, typed, no `any`
- Unit test in `tests/unit/` passes
- `npx tsc --noEmit` clean
