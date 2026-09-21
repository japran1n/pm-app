# F004: getMyProjectsProgress

**Milestone:** M1  **Time:** 20 min  **Depends on:** F001

## Assertions
AS-050, AS-051, AS-052

## Clarified implementation
Add to `lib/queries/projects.ts`:

```ts
export type MyProjectProgress = {
  projectId: string;
  projectName: string;
  projectKey: string;
  doneCount: number;
  totalCount: number;
  overdueCount: number;
  nextMilestoneName: string | null;
  nextMilestoneDate: string | null; // ISO date
};

export async function getMyProjectsProgress(
  workspaceId: string,
  userId: string
): Promise<MyProjectProgress[]>
```

Logic:
1. Get project ids where userId is a project_member and project is active (not deleted, not archived): join `project_members` → `projects` where `workspace_id = workspaceId`.
2. For each project, count tasks: `totalCount` = tasks not deleted; `doneCount` = tasks in done-category status; `overdueCount` = tasks not done, `due_date < now()`.
3. Return all projects (no cap — user typically in ≤10 projects).
4. Order by overdueCount desc, then projectName asc.

For efficiency, do this in a single query with a GROUP BY or use three RPCs — worker chooses whichever is cleaner. No new RPC function required; plain Supabase query is fine.

Unit test: mock chain, verify counts.

## Definition of done
- Function exported, typed
- Unit test passes
- tsc clean
