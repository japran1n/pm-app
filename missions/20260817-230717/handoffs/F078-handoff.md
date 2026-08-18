# Handoff: F078 — dashboard table filters

## Status
COMPLETE

## Assertions covered
AS-134: PASS — `tests/integration/dashboard-task-table-filters.test.ts`, 7/7 tests passed against the real linked Supabase project (not skipped — `.env` has admin creds).

## Files changed
lib/queries/tasks.ts
components/dashboard/dashboard-task-table.tsx
app/(workspace)/w/[workspaceSlug]/page.tsx
tests/integration/dashboard-task-table-filters.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm test` (0) — 76 test files / 408 tests passed
`npx vitest run tests/integration/dashboard-task-table-filters.test.ts` (0) — 7/7 passed, ran live (not skipped)
`npm run build` (0) — `next build` succeeded, TypeScript pass included

## Decisions made
- Added `getWorkspaceListTasks` to `lib/queries/tasks.ts` (next to F053/F054's `getProjectListTasks`) rather than `lib/queries/dashboard.ts`, since it returns `TaskCardTask[]` shaped rows via the same `tasks` table pattern as the other task-list queries, not an RPC-backed aggregate like `dashboard.ts`'s existing exports. Kept `dashboard.ts` untouched.
- Scoped the query via `tasks -> projects!inner(workspace_id) -> .eq("projects.workspace_id", workspaceId)`, exactly the join path the spec named, on top of the existing `tasks_select_active_members` RLS policy (same policy `getProjectBoardTasks`/`getProjectListTasks` already rely on) plus the explicit `deleted_at IS NULL` filter per the soft-delete convention.
- `WorkspaceListTaskFilters` is a type alias of `ProjectListTaskFilters` (identical shape: `status`/`priority`/`assigneeId`) rather than a redeclared type, specifically so `<ListFilters>` (F054, `components/task/list-filters.tsx`) is reusable **completely unmodified** — it only ever reads/writes those three URL query params and has no project/workspace awareness. Verifies the spec's explicit instruction to reuse F054's component/pattern.
- `<TaskListTable>` (F053) is also reused unmodified — it only renders whatever `TaskCardTask[]` it's given, so no project-column addition or other change was needed to make it workspace-wide; it just receives rows from more than one project now.
- New `components/dashboard/dashboard-task-table.tsx` Server Component does its own data-fetching (workspace tasks + workspace members) rather than pushing that into `page.tsx`, matching the clarified spec's "Server Component for data-fetching" pattern and keeping the page component thin — same division of responsibility the F053/F054 list page already uses, just inverted (there the page fetches and passes props down; here the table component owns the fetch). Chose this because the spec explicitly named `components/dashboard/dashboard-task-table.tsx` as *the* file, implying it should own the workspace-wide query.
- The table only renders when `!hasError && !isEmpty` on the dashboard page — reuses the same three-way branch F074 already established (error / empty / populated) rather than duplicating another table-specific empty/error state; an empty workspace already gets F074's "no tasks yet" card, and a fetch error there already covers the table's data source too since both come from the same `workspace.id`.
- Sort (`due_date_asc`/`due_date_desc`, F055) was intentionally NOT wired into the dashboard table — AS-134 only requires "the same status/priority filters," not sort, and the clarified spec's Touches/scope for this feature didn't call it out. `getWorkspaceListTasks` has no `sort` param; `<TaskListTable>` still accepts `sort` as optional and degrades to its default `created_at` order when omitted, so nothing broke by leaving it out.

## Out-of-scope work needed
- No project-name column on the dashboard table. Since this table spans multiple projects (unlike the single-project list view), a "Project" column would materially help users tell which project a row belongs to. Not done here because the spec's approximate file list only named `dashboard-task-table.tsx` and `<TaskListTable>` is explicitly meant to be reused unmodified; adding a project-name column would mean either forking the table component or extending `TaskCardTask` with an optional `projectName`, both of which are scope decisions belonging to a future feature/assertion, not AS-134's "same filters" requirement.
- Due-date sort (F055's `ProjectListTaskSort`) isn't available on the dashboard table — see decision above. A future feature could add a `getWorkspaceListTasks(..., sort)` overload mirroring `getProjectListTasks` if that's ever required by a new assertion.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new query `getWorkspaceListTasks` in `lib/queries/tasks.ts` (not `lib/queries/dashboard.ts`) since it's structurally a sibling of `getProjectListTasks`/`getProjectBoardTasks` (raw `tasks` table query, `TaskCardTask[]` return shape) rather than an RPC-aggregate wrapper like everything currently in `dashboard.ts`. The spec's "Files (approximate)" note only named the component, not the query file, and offered both `dashboard.ts` and `tasks.ts` as options — picked based on the closer structural match.

AUTONOMOUS_DECISION: Gated the table's render behind `!hasError && !isEmpty` (reusing F073/F074's existing dashboard-level error/empty computation) instead of giving `<DashboardTaskTable>` its own independent error/empty branch, to avoid a workspace with a genuinely-broken dashboard fetch also showing a broken table below it, and to avoid a double "no tasks yet" message stacking under F074's existing empty-state card.

## Notes for the next worker

**Milestone 7 (Dashboard, F071–F078) is now fully complete** and ready for a scrutiny-validator pass before Milestone 8 (final security/quality/docs/polish) begins. All eight dashboard features are committed:

- F071/F072: `get_priority_counts`/`get_status_counts` RPCs
- F073: bar/pie charts (AS-135)
- F074: empty-state dashboard (AS-130)
- F075: overdue count tile (AS-131)
- F076: workspace-switch refresh (AS-132)
- F077: consolidated cross-workspace RLS adversarial test (AS-133)
- F078 (this feature): workspace-wide task table reusing F054's filter component (AS-134)

Gotchas for whoever runs scrutiny/UX validation on this milestone:
- The dashboard page (`app/(workspace)/w/[workspaceSlug]/page.tsx`) now reads `searchParams` (status/priority/assigneeId) in addition to `params` — any validator navigating there with query params will now affect the task table's filtering, same as the project list page.
- `getWorkspaceListTasks`'s Supabase `.select()` uses `projects!inner(workspace_id)` to express the join+filter; this requires the `tasks.project_id -> projects.id` FK to be intact (it is, per the schema used throughout this mission) — if a future migration ever renames that relationship, this join clause needs updating alongside `getProjectListTasks`'s sibling query.
- No MCP tools were used for this feature (registry marks dashboard-related Supabase work as introspection-only where needed; this feature was pure query/component code, verified via the standard `npm test`/`tsc`/`eslint`/`next build` toolchain, not live Supabase MCP calls).
