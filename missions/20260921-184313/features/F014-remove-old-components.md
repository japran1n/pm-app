# F014: remove old dashboard components

**Milestone:** M5  **Time:** 20 min  **Depends on:** F013

## Assertions
AS-090, AS-091, AS-092, AS-093, AS-094

## Clarified implementation
Delete the following files:
- `components/dashboard/priority-bar-chart.tsx`
- `components/dashboard/status-pie-chart.tsx`
- `components/dashboard/dashboard-task-table.tsx`
- `components/dashboard/dashboard-content.tsx`
- `components/dashboard/dashboard-content-lazy.tsx`
- `components/dashboard/dashboard-skeleton.tsx` (if replaced by home-skeleton.tsx)

Also:
- Remove any imports of deleted files from `page.tsx` or elsewhere (they should already be gone after F013, but verify)
- Delete unit test files that exclusively test deleted components (e.g. `tests/unit/dashboard-empty-state.test.ts` if it only tests DashboardContent)
- Run `npx tsc --noEmit` — must be 0

Check for any other imports: `grep -r "priority-bar-chart\|status-pie-chart\|dashboard-task-table\|dashboard-content\|DashboardContent\|DashboardTaskTable\|PriorityBarChart\|StatusPieChart" --include="*.ts" --include="*.tsx" .`

## Definition of done
- All listed files deleted
- grep for old import names returns no hits in src files
- tsc clean (AS-093)
