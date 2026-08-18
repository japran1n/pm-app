# Handoff: F071 — db rpc priority counts

## Status
COMPLETE

## Assertions covered
AS-125: PASS — `get_priority_counts` RPC returns per-priority counts computed in the database; verified 2 'high' + 1 'low' returned correctly.
AS-127: PASS — computed via `language sql stable security invoker` RPC (set-returning function), not a full task-list fetch to the client.
AS-128: PASS — soft-deleted task (deleted_at set, priority 'high') excluded; 'high' count stayed at 2, not 3.
AS-129: PASS — task in an archived (soft-deleted) project (priority 'urgent') excluded by default; no 'urgent' row returned.

## Files changed
supabase/migrations/20260818054815_rpc_priority_counts.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
tests/integration/priority-counts-rpc.test.ts

## Commands run
`supabase db push --linked` (0)
`supabase gen types typescript --project-id <linked>` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/integration/priority-counts-rpc.test.ts` (0, 4/4 passed)
`npm test` (0, 69 files / 383 tests passed — full suite including this feature's test)
`npm run build` (0)

## Decisions made
- Followed F068's `search_tasks` pattern exactly: `language sql stable security invoker`, explicit `security invoker` stated (not relying on the implicit default) per M6 scrutiny's finding that SECURITY INVOKER is the required safe pattern for this project's RPCs.
- Function joins `tasks -> projects` and filters `projects.workspace_id = p_workspace_id` explicitly, but relies on RLS (tasks_select_active_members, projects_select_active_members — both already require active workspace membership) as the actual security boundary, matching F070's "two independent layers must agree" defense-in-depth pattern.
- Did not add a `p_include_archived` toggle parameter. AS-129 only specifies the default (exclude archived-project tasks); the spec's Draft scope says "by default," and no other assertion in this feature's assigned set (AS-125/127/128/129) calls for the toggle itself. Documented in the migration comment as a follow-up if a future feature builds the toggle UI.
- Tested the RPC directly via `memberClient.rpc(...)` rather than through an app-level query wrapper, since no dashboard data-layer function exists yet (the dashboard UI is a separate, later M7 feature) — mirrors how F068's own RPC was verified before F069 built a wrapper on top of it.
- `count` returns as `bigint` in Postgres; test coerces with `Number(...)` before comparing, matching the generated TS type (`count: number`).

## Out-of-scope work needed
- The actual dashboard page/component consuming this RPC (bar chart per AS-125's UI half, wired to the active workspace) is not part of this feature — F071's scope per the spec is the DB RPC only.
- A `p_include_archived` toggle parameter, if/when a future feature (per AS-129's "unless explicitly toggled to include them") builds that UI control.
- AS-126 (status pie chart) and AS-130–AS-136 (empty state, overdue count, workspace switching, etc.) are separate assigned features, not covered here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the RPC's return columns `priority` and `count` (not `priority_count` or similar) to match the assertion's own wording ("task counts grouped by priority") and to keep parity with F068/F069's naming conventions of using the plainest possible column names.

## Notes for the next worker
- The RPC is unfiltered on priority IS NULL — the schema allows `priority` to be NULL (tasks_priority_check permits it), so a row with `priority: null` and its count will appear in the result set for workspaces that have such tasks. Any dashboard chart consuming this RPC should decide how to label/bucket a NULL-priority row (e.g. "No priority") rather than assuming all five fixed values are always present or that NULL is filtered out.
- Rows are only returned for priority values that have at least one matching task — a workspace with zero 'urgent' tasks gets no 'urgent' row at all (not a zero-count row). The dashboard chart should default missing priorities to 0 rather than indexing into a fixed-size array.
- MCP usage: none needed beyond `supabase db push --linked` and `supabase gen types typescript` (CLI, not MCP tools) — Supabase MCP tools were not required since schema introspection was done by reading existing migrations directly.
