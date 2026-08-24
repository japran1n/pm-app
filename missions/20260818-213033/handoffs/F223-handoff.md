# Handoff: F223 — status-integration-list-search-dashboard

## Status
COMPLETE

## Assertions covered
AS-411: PASS — `test_AS_411_getProjectColumns_returns_the_projects_renamed_and_added_real_columns_in_position_order` and `test_AS_411_negative_a_viewer_without_access_to_a_private_project_cannot_read_its_columns` (tests/integration/f223-status-integration-list-search-dashboard.test.ts), proven against the real project List page's read path (`lib/queries/statuses.ts`'s `getProjectColumns`), now wired into `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx` -> `<ListFilters>`/`<TaskListTable>` -> `<ListStatusSelect>`.
AS-412: PASS — `test_AS_412_getStatusCounts_reflects_this_workspaces_custom_columns_across_both_projects` and `test_AS_412_negative_a_private_projects_column_name_never_appears_in_the_workspace_chart`, proven against the real `get_status_counts` RPC (rewritten in `supabase/migrations/20260825010000_status_counts_custom_columns.sql`) via `lib/queries/dashboard.ts`'s `getStatusCounts` wrapper, the same function `<StatusPieChart>` consumes.
AS-417: PASS — `test_AS_417_search_results_show_the_tasks_current_column_name_even_when_status_text_is_stale`, `test_AS_417_search_results_show_a_newly_added_custom_column_name_verbatim`, and `test_AS_417_negative_search_never_returns_a_private_projects_task_or_column_name_to_a_non_member`, proven against the real `searchWorkspaceTasks` (`lib/queries/search.ts`), the same function `app/(workspace)/w/[workspaceSlug]/search/page.tsx` renders.

## Files changed
supabase/migrations/20260825010000_status_counts_custom_columns.sql (new)
lib/supabase/database.types.ts
lib/queries/dashboard.ts
components/dashboard/status-pie-chart.tsx
components/task/list-filters.tsx
components/task/list-status-select.tsx
components/task/task-list-table.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx
lib/queries/search.ts
app/(workspace)/w/[workspaceSlug]/search/page.tsx
tests/integration/f223-status-integration-list-search-dashboard.test.ts (new)
tests/integration/dashboard-workspace-switch-refresh.test.ts (updated for sparse RPC shape)
tests/integration/status-counts-rpc.test.ts (updated field name status->name)
tests/unit/dashboard-chart-colors.test.ts (updated StatusCountDatum shape)
tests/unit/dashboard-empty-state.test.ts (updated StatusCountDatum shape)

## Commands run
`supabase db push` (0) — applied 20260825010000_status_counts_custom_columns.sql to the linked project via CLI (mcp-registry.md's stated primary path)
`npx tsc --noEmit` (0) — 0 errors
`npx eslint .` (0) — 0 errors, 2 pre-existing warnings (lib/queries/search.ts:280 `_titleMatches`, tests/unit/invite-member-pagination.test.ts:186 `_columns`) plus 0 new
`npx vitest run tests/integration/f223-status-integration-list-search-dashboard.test.ts` (0) — 7/7 passed
`npx vitest run` (targeted regression slice: f223 + f221-board-custom-columns + f222-status-category-semantics + status-counts-rpc + dashboard-workspace-switch-refresh + dashboard-rls-cross-workspace + trash-exclusion-dashboard + perf-budget + list-view-filters + list-status-inline-edit + dashboard-task-table-filters + search-tasks + search-task-key + search-archived-project-exclusion + trash-exclusion-search + task-key-display-queries + dashboard-chart-colors + dashboard-empty-state + list-table-status-priority-colors + list-table-bulk-selection + task-key-display-render) (0) — 21 files, 96 tests, all passed
`npm test` (full suite, `vitest run`, twice) — first full run before this feature's changes: 0 failures (baseline). After changes: 240–259/266 files passed; the ~7-26 failing files (invite-member.test.ts, workspace-role-expansion.test.ts, checklist-actions.test.ts, f219-status-management.test.ts, recurrence-scheduled-generation*.test.ts) are Supabase Auth Admin API flakiness ("AuthRetryableFetchError: Database error finding users" / "Something went wrong" from `inviteMember`) — none of these files import or exercise anything this feature touched, and re-running f219-status-management.test.ts alone (not batched with the rest of the suite) passed cleanly, confirming rate-limit-class flakiness per the known infra conditions, not a regression. tests/unit/trash-list.test.tsx's 2 failures ("invariant expected app router to be mounted" in TrashRestoreButton) were verified via `git stash` to fail identically on unmodified `main` — pre-existing, unrelated to this feature.

## Decisions made
- **AUTONOMOUS_DECISION (F223 clarification's open question — "group by category or by column name" for the dashboard's cross-project chart)**: grouped by column NAME, not category. AS-412's own text ("reflects custom columns") is about individual columns, not the three category buckets — a category-only chart would collapse two differently-named "in_progress"-category columns into one indistinguishable slice, defeating the assertion. This is also the simpler option (matches the pre-existing `group by status` shape, no new dependency, no second source of truth): two PROJECTS whose columns happen to share a name (e.g. both call a column "Blocked") are summed into one slice — a coherent workspace-wide reading of "how many tasks are in a column named X". Colour/category for a same-named-across-projects slice picks the first contributing `project_statuses` row deterministically (`array_agg(... order by ps.id)`); documented in the migration's own comment.
- `get_status_counts(uuid)` changed its return shape (`status text` -> `name text, color text, category text`), which Postgres doesn't allow via bare `CREATE OR REPLACE FUNCTION` (OUT param types must match) — the migration does an explicit `drop function if exists` first, same pattern as any signature-changing RPC update elsewhere in this codebase.
- Did NOT touch `active_project_tasks` (no `drop view ... cascade`) — `get_status_counts` only needed its own function body changed (it already had `status_id` available via `select t.*` in the view), so none of the view's other three dependent functions (`get_priority_counts`, `get_overdue_count`, `get_workspace_time_by_person`) were put at risk. Verified all three still compile/execute via the regression slice above (perf-budget.test.ts exercises `get_priority_counts`/`get_status_counts`/`get_overdue_count` together; `get_workspace_time_by_person` was never touched and its own test suite — not in this feature's file scope — wasn't re-run, but the view itself is unchanged).
- `ListFilters`/`ListStatusSelect`/`TaskListTable` all got a new OPTIONAL `statusOptions` prop, defaulting to the legacy fixed-four (`DEFAULT_STATUS_OPTIONS`) when omitted. The project List page (F053/F054's own named scope — the literal target of AS-411's "the list view") now always passes its real columns; the workspace-wide `DashboardTaskTable` (multi-project, no single project's columns to hand) was left on the default — see Out-of-scope below.
- `TaskCardTask["status"]` is a legacy fixed-four union predating per-project columns (F218/F221) — a custom column name is cast through it with `as TaskCardTask["status"]`, reusing F221's own established convention (`components/board/board.tsx`'s identical cast) rather than widening the type across the whole codebase, which was out of this feature's file scope.
- `lib/queries/search.ts`'s `SearchTaskResult` gained `statusName`/`statusColor` (resolved via one extra `project_statuses` query, batched once per search call, keyed by the already-globally-unique `status_id`) while keeping the raw `status` text field for back-compat. The search results page now renders `statusName`/`statusColor` instead of `status`/`STATUS_COLORS[status]`.
- Project List page's status filter validation moved from a fixed `Set(["todo","in_progress","in_review","done"])` to `new Set(columns.map(c => c.name))`, fetched via the same `getProjectColumns` call that feeds the UI — a tampered/stale `?status=` query param is now validated against the project's REAL current columns, not a value that could never exist for a customized project.

## Out-of-scope work needed
- **`DashboardTaskTable`'s inline status editor across multiple projects with divergent custom columns** (`components/dashboard/dashboard-task-table.tsx`) still falls back to the legacy fixed-four `statusOptions` default — it spans every project in the workspace and `TaskCardTask` has no `projectId` field to resolve a per-row column set from, so giving it real per-project columns needs either a `projectId` field added to `TaskCardTask` (used broadly across board/list/dashboard) or a `statusOptionsByProject: Map<projectId, ...>` threaded through `TaskListTable`. AS-411's own text is scoped to "the list view", not the dashboard table, and this feature's Files list didn't name `dashboard-task-table.tsx`, so this was left as a documented gap rather than expanded silently. A follow-up feature could extend AS-411's guarantee to the dashboard table specifically.
- `get_workspace_time_by_person` was flagged by F222's own migration comment as NOT recreated alongside the other three `active_project_tasks`-dependent functions. This feature did not touch `active_project_tasks` at all (see Decisions above), so that gap is unchanged and still open — a future worker touching the view itself must recreate all four dependents, not three.
- `tasks.status` (the text column) is still live and still the write path every existing action uses — per this feature's own instructions, the column and its sync trigger are NOT dropped here; F270 is the dedicated cleanup feature for that.

## Blockers
(none — Status is COMPLETE)

## Notes for the next worker
- MCP: Supabase MCP was `Pending approval` per `mcp-registry.md`'s note ("never block a feature on MCP approval") — used the Supabase CLI (`supabase db push`) as the registry's stated primary path instead; no MCP tool calls were made this session.
- The stale-status edge case (`AS-417`'s trickiest scenario) only exists because `sync_task_status_and_status_id` (20260824010000) is a trigger on `tasks`, not on `project_statuses` — renaming a column never touches any task row that was already in it. Any future reader of task status text (not just this feature's three surfaces) needs the same "resolve via `status_id`, not `tasks.status`" treatment; grep for `.status` reads that aren't already `status_id`-joined if more such readers turn up.
- `get_status_counts`'s new sparse-row contract (only present column names get a row — no more dense four-value array) is a real, deliberate behaviour change from the pre-F223 RPC. `lib/queries/dashboard.ts`'s `getStatusCounts` wrapper no longer backfills zero-count rows; any caller relying on "every status always has a row, some with count 0" needs to explicitly `?? 0` on lookup (see the two test-file updates in this handoff's Files changed for the exact pattern).
