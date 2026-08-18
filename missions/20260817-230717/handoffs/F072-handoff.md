# Handoff: F072 — db rpc status counts

## Status
COMPLETE

## Assertions covered
AS-126: PASS — `get_status_counts` RPC returns per-status counts computed in the database, powering the dashboard's status pie chart; verified 2 'in_progress' + 1 'todo' returned correctly.
AS-127: PASS — computed via `language sql stable security invoker` RPC (set-returning function), not a full task-list fetch to the client.
AS-128: PASS — soft-deleted task (deleted_at set, status 'in_progress') excluded; 'in_progress' count stayed at 2, not 3.
AS-129: PASS — task in an archived (soft-deleted) project (status 'done') excluded by default; no 'done' row returned.

## Files changed
supabase/migrations/20260818070000_rpc_status_counts.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
tests/integration/status-counts-rpc.test.ts

## Commands run
`supabase db push --linked` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/integration/status-counts-rpc.test.ts` (0, 4/4 passed)
`npm test` (0, 70 files / 387 tests passed — full suite including this feature's test)
`npm run build` (0)

## Decisions made
- Mirrored F071's `get_priority_counts` migration exactly (same file structure, comments, security model): `language sql stable security invoker`, explicit `security invoker` per M6 scrutiny's finding that SECURITY INVOKER is the required safe pattern for this project's RPCs.
- Function joins `tasks -> projects` and filters `projects.workspace_id = p_workspace_id` explicitly, but relies on RLS (tasks_select_active_members, projects_select_active_members — both already require active workspace membership) as the actual security boundary, matching F070/F071's "two independent layers must agree" defense-in-depth pattern.
- Did not add a `p_include_archived` toggle parameter, for the same reason F071 didn't: AS-129 only specifies the default (exclude), and no assigned assertion (AS-126/127/128/129) calls for the toggle itself. Documented in the migration comment as a follow-up if a future feature builds the toggle UI.
- Tested the RPC directly via `memberClient.rpc(...)` rather than through an app-level query wrapper, since no dashboard data-layer function exists yet — mirrors F071's approach.
- Used the tasks table's actual status CHECK constraint values (`todo`, `in_progress`, `in_review`, `done`) rather than reusing F071's priority values, since status and priority are separate columns with different fixed value sets.
- `count` returns as `bigint` in Postgres; test coerces with `Number(...)` before comparing, matching the generated TS type (`count: number`).

## Out-of-scope work needed
- The actual dashboard page/component consuming this RPC (pie chart per AS-126's UI half, wired to the active workspace) is not part of this feature — F072's scope per the spec is the DB RPC only.
- A `p_include_archived` toggle parameter, if/when a future feature (per AS-129's "unless explicitly toggled to include them") builds that UI control.
- AS-125 (priority bar chart, already covered by F071) and AS-130–AS-136 (empty state, overdue count, workspace switching, etc.) are separate features, not covered here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the RPC's return columns `status` and `count` (matching F071's `priority`/`count` naming convention and the assertion's own wording, "task counts grouped by status").

## Notes for the next worker
- The RPC is unfiltered on status IS NULL — the `status` column is `not null default 'todo'` per the schema, so unlike F071's `priority` (which permits NULL), every task always has a concrete status value; no "No status" bucket is needed on the dashboard.
- Rows are only returned for status values that have at least one matching task — a workspace with zero 'in_review' tasks gets no 'in_review' row at all (not a zero-count row). The dashboard chart should default missing statuses to 0 rather than indexing into a fixed-size array (same caveat F071 documented for priority).
- MCP usage: none needed beyond `supabase db push --linked` and `supabase gen types typescript` (CLI, not MCP tools) — same as F071, schema introspection was done by reading the existing F071 migration and the tasks table migration directly.
