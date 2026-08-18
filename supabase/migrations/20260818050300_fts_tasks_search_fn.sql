-- F068: ranked full-text search query helper (AS-124).
--
-- Follows 20260818050200_fts_tasks.sql's weighted search_vector column.
-- ts_rank needs the query's own tsquery to score against the weighted
-- vector — that logic belongs in one place rather than being
-- re-implemented per caller, so it's exposed as a callable Postgres
-- function (supabase-js `.rpc('search_tasks', ...)`).
--
-- `language sql` (not plpgsql) since this is a single set-returning
-- expression. Default `security invoker` (omitted = invoker) means it
-- still runs under the calling role, so RLS on `tasks` still applies —
-- this function does not bypass any workspace/project access control.
create or replace function search_tasks(p_project_id uuid, p_query text)
returns setof tasks
language sql
stable
as $$
  select *
  from tasks
  where project_id = p_project_id
    and deleted_at is null
    and search_vector @@ plainto_tsquery('english', p_query)
  order by ts_rank(search_vector, plainto_tsquery('english', p_query)) desc;
$$;
