# Handoff: F084 — parameterized queries audit

## Status
COMPLETE

## Assertions covered
AS-147: PASS — audit found no raw string-concatenated SQL anywhere in `lib/` or `supabase/`; existing code is already fully compliant, documented in this handoff per the "On no gap found" clarified instruction.

## Files changed
missions/20260817-230717/handoffs/F084-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run build` (0)
`npm test` (0, 419/419 tests passed across 80 files)

## Decisions made
- Treated this as an audit-only feature per the clarified spec's "On no gap found" instruction: no code changes were needed, so the handoff documents "already compliant" explicitly rather than inventing a change.
- Searched broadly (not just `lib/actions/*.ts` as the Files section suggested) to cover `lib/queries/*.ts`, `supabase/migrations/*.sql`, and `app/` route handlers, since the assertion text ("any user-supplied search or filter input") spans the query layer (F068-F070 search, F075/F078 dashboard/filters) as well as the actions layer.

## Audit findings

Grepped the entire codebase (`lib/`, `supabase/`, `app/`) for:
- Raw postgres client usage (`pg.`, `Pool(`, `Client(`, `.query(`) — none found. All DB access goes through `createClient()` / `createAdminClient()` (Supabase JS client) or the `SupabaseClient` type passed in.
- Template-literal SQL construction (`` sql`...${var}...` ``) — none found.
- String concatenation feeding SQL keywords (select/insert/update/delete/from/where) — none found.
- `.rpc()` calls — 5 found, all pass parameters as a bound object (e.g. `supabase.rpc("search_tasks", { p_project_id: project.id, p_query: trimmed })`), never string-interpolated into SQL text. This is the safe, parameterized form.

Specifically verified the two highest-risk areas named in the task:

1. **Search (F068-F070, `lib/queries/search.ts`)**: `searchWorkspaceTasks(workspaceId, query)` takes user-controlled search text, trims it, and passes it as the `p_query` bound parameter to `supabase.rpc("search_tasks", { p_project_id, p_query })`. The backing function (`supabase/migrations/20260818050300_fts_tasks_search_fn.sql`) is `language sql`, uses `plainto_tsquery('english', p_query)` with `p_query` as a typed function argument (not interpolated into the function body's SQL text), and is `security invoker` (RLS still applies, no privilege escalation). No injection surface.

2. **Dashboard/list filters (F054/F078, `lib/queries/tasks.ts`, `lib/queries/dashboard.ts`)**: URL-param-driven filters (`status`, `priority`, `assigneeId`) are applied via chained `.eq("status", filters.status)` / `.eq("priority", filters.priority)` / `.eq("assignee_id", filters.assigneeId)` calls on the Supabase query builder — never interpolated into a string. Dashboard aggregate counts (`getPriorityCounts`, `getStatusCounts`, `getOverdueCount`) call `.rpc(...)` with `{ p_workspace_id: workspaceId }` as a bound parameter; the backing SQL functions (`supabase/migrations/20260818054815_rpc_priority_counts.sql`, `20260818070000_rpc_status_counts.sql`) use `p_workspace_id` as a typed argument in a `where` clause, not string-built. No injection surface.

Conclusion: **AS-147 is already satisfied by the existing implementation.** No raw SQL string concatenation exists anywhere in the codebase; all database access goes through the Supabase client's query builder or parameterized `.rpc()` calls with bound parameters.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Searched beyond the "Files (approximate): lib/actions/*.ts" hint to include lib/queries/*.ts and supabase/migrations/*.sql, since those are where the search and dashboard/filter query logic actually lives, and the task explicitly named those as highest-risk areas to check.

## Notes for the next worker
No MCP tools used (registry marks this feature "MCP at run: none"). If a future feature adds new `.rpc()` calls or raw query helpers, re-run the same grep patterns used here: `.rpc(`, `` sql` ``, `pg.`, `Pool(`, `Client(`, and string-concatenation near SQL keywords, to keep AS-147 satisfied.
