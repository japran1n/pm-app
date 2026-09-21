# F002: getUnassignedCount + getKpiDelta

**Milestone:** M1  **Time:** 25 min  **Depends on:** F001

## Assertions
AS-073, AS-074, AS-075

## Clarified implementation
Add to `lib/queries/dashboard.ts`:

1. `getUnassignedCount(workspaceId: string): Promise<number>`
   - Count tasks where `assignee_id IS NULL` AND `deleted_at IS NULL` AND project's `workspace_id = workspaceId` AND project `deleted_at IS NULL` AND task status category ≠ 'done' AND status category ≠ 'cancelled'
   - Use existing `project_statuses` join pattern from `getOverdueCount`

2. `getKpiDelta(workspaceId: string, kind: 'overdue' | 'completed', daysBack: number): Promise<number>`
   - 'overdue': count tasks where due_date < (now() - interval 'N days') AND status not done/cancelled
   - 'completed': count tasks entered a done-category status within daysBack days
   - Return count as number

Add unit tests in `tests/unit/dashboard-kpi.test.ts` using vitest mock for supabase client (follow pattern in existing dashboard tests if any, otherwise mock the supabase chain).

## Definition of done
- Both functions exported from `lib/queries/dashboard.ts`
- TypeScript strict: no `any`
- Unit tests pass
- `npx tsc --noEmit` clean
