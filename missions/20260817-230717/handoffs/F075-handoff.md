# Handoff: F075 — dashboard overdue count

## Status
COMPLETE

## Assertions covered
AS-131: PASS — `get_overdue_count` RPC returns a database-computed count of overdue tasks (due_date in the past AND status != 'done'), mirroring lib/tasks/is-overdue.ts's (F040) logic in SQL; verified 2 overdue tasks counted correctly out of 8 seeded tasks (done/today/future/soft-deleted/archived-project/other-workspace all excluded). Dashboard now renders an "Overdue tasks" stat tile above the existing charts, server-rendered from this count.

## Files changed
supabase/migrations/20260818080000_rpc_overdue_count.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
lib/queries/dashboard.ts (added `getOverdueCount` wrapper)
components/dashboard/overdue-tile.tsx (new stat tile component)
components/dashboard/dashboard-content.tsx (renders `<OverdueTile>`, added `overdueCount` prop)
app/(workspace)/w/[workspaceSlug]/page.tsx (fetches `getOverdueCount`, passes to `<DashboardContent>`, folded into `hasError`)
tests/unit/dashboard-empty-state.test.ts (added `overdueCount: 0` to the three existing `<DashboardContent>` call sites so they still type-check against the new required prop)
tests/integration/overdue-count-rpc.test.ts (new)

## Commands run
`supabase db push --linked` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/integration/overdue-count-rpc.test.ts tests/unit/dashboard-empty-state.test.ts` (0, 5/5 passed)
`npm test` (0, 73 files / 395 tests passed — full suite including this feature's tests)
`npm run build` (0)

## Decisions made
- Mirrored F071/F072's `get_priority_counts`/`get_status_counts` migrations exactly: `language sql stable security invoker` (explicit, not just default), same `tasks -> projects` join filtered on `p.workspace_id = p_workspace_id`, same exclusion predicates (`t.deleted_at is null`, `p.deleted_at is null`), relying on RLS (tasks_select_active_members, projects_select_active_members) as the actual security boundary — same "two independent layers must agree" pattern as F070-F072.
- Returns `bigint` (a scalar), not `table (...)` like the sibling RPCs, since there's exactly one overdue count per workspace rather than one row per category.
- Since `due_date` is a plain `date` column (not timestamp), `t.due_date < current_date` is already a date-only comparison — matching is-overdue.ts's explicit design note about avoiding time-of-day/timezone drift. No date-truncation function needed.
- `NULL < current_date` evaluates to `NULL` (not true) in SQL, so tasks with no due date are excluded automatically without an explicit `t.due_date is not null` predicate — matches is-overdue.ts's `if (!dueDate) return false;` guard without needing to restate it.
- Placed the `OverdueTile` as a plain Server Component (no `"use client"`) since it's static text with no interactivity, unlike PriorityBarChart/StatusPieChart which need Recharts/the DOM — smallest possible client boundary applied literally (zero client boundary here).
- Only rendered the tile in the populated branch of `DashboardContent`, not in the empty-state branch: `isEmpty` is derived from `totalTasks === 0` (summed from `get_status_counts`), and an overdue task is by definition a non-deleted, non-archived-project task with `status != 'done'` — it would already be counted in `totalTasks`, so `totalTasks === 0` implies `overdueCount === 0` too. No separate empty-state handling needed for the tile itself.
- Folded `overdueResult.error` into the existing `hasError` union and logged it via the same `console.error` convention as the other two RPCs, rather than giving the tile its own independent error state — keeps the page's three-way error/empty/populated branching a single source of truth (per F074's existing design).

## Out-of-scope work needed
(none noticed beyond this feature's scope)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Grouped the new tile in a `sm:grid-cols-3` row above the existing two-chart grid rather than adding a fourth grid cell to the charts row, since a single stat tile alongside two full-width charts would look unbalanced at 2-column width; left room (`grid-cols-3`) for likely future stat tiles (e.g. "tasks due this week") without a layout rework, though only one tile exists today.

## Notes for the next worker
- `lib/queries/dashboard.ts`'s `getOverdueCount` follows the exact `{ data, error }` shape as `getPriorityCounts`/`getStatusCounts`, so any future dashboard RPC wrapper should keep matching that shape for consistency.
- The RPC coerces its `bigint` return via `Number(...)` in `getOverdueCount`, same as the sibling RPCs' `count` columns.
- MCP usage: none needed beyond `supabase db push --linked` and `supabase gen types typescript` (CLI, not MCP tools) — same as F071/F072, schema introspection was done by reading those two prior migrations and the tasks table migration (`due_date date` column) directly.
