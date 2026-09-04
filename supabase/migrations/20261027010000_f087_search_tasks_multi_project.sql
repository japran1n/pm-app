-- F087 (accessibility/perf audit item 6): lib/queries/search.ts's
-- searchWorkspaceTasks fans out one `search_tasks` RPC call PER PROJECT
-- in the workspace (`projects.map(async (project) => supabase.rpc(...))`)
-- on every debounced command-palette keystroke. A workspace with many
-- projects turns one keystroke into that many round-trips through a
-- single connection pool.
--
-- Fix: add `search_tasks_multi(p_project_ids uuid[], p_query text)`, the
-- same ranked/soft-delete-excluding full-text match as the existing
-- `search_tasks(p_project_id uuid, p_query text)`
-- (20260818050300_fts_tasks_search_fn.sql) but scoped to an ARRAY of
-- project ids with a single `= any(...)` predicate, so the caller issues
-- one RPC for the whole workspace instead of N. The single-project
-- function is left untouched and still callable — F068's own test suite
-- (tests/unit/fts-tasks.test.ts) and several integration tests
-- (search-archived-project-exclusion, trash-exclusion-search,
-- restore-project) call `.rpc("search_tasks", ...)` directly by name, so
-- removing or renaming it would break those call sites for no benefit.
--
-- `language sql stable security invoker` — identical posture to
-- `search_tasks` itself (F070 hardening's own comment in
-- lib/queries/search.ts: no SECURITY DEFINER, so RLS on `tasks` still
-- applies under the calling role, plus the function's own
-- `deleted_at is null` predicate independent of RLS). No `set
-- search_path` line, matching every other `security invoker` function in
-- this schema (e.g. get_priority_counts in
-- 20260818054815_rpc_priority_counts.sql) — that pinning convention is
-- reserved for SECURITY DEFINER functions elsewhere in this schema
-- (20261025010000_security_audit_authz_holes.sql), which run with
-- elevated privilege and are therefore the ones a hijacked search_path
-- could actually escalate.
create or replace function search_tasks_multi(p_project_ids uuid[], p_query text)
returns setof tasks
language sql
stable
security invoker
as $$
  select *
  from tasks
  where project_id = any(p_project_ids)
    and deleted_at is null
    and search_vector @@ plainto_tsquery('english', p_query)
  order by ts_rank(search_vector, plainto_tsquery('english', p_query)) desc;
$$;

grant execute on function search_tasks_multi(uuid[], text) to authenticated;
