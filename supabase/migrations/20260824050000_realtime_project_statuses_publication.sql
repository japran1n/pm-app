-- F221 (AS-413): enable Supabase Realtime (Postgres logical replication)
-- on `project_statuses` so other viewers of the same board see a column
-- add/rename/reorder/remove without a reload -- same mechanism F049 already
-- uses for `tasks` (20260818040000_realtime_tasks_publication.sql).
--
-- REPLICA IDENTITY FULL: `project_statuses`' primary key is just `id`, so
-- by default a DELETE event's OLD row (what Postgres' logical replication
-- -- what Realtime's postgres_changes reads -- includes) would only carry
-- `id`, not `project_id`. The board's realtime subscription
-- (lib/board/subscribe-board-columns-realtime.ts) filters server-side on
-- `project_id=eq.<projectId>` so a client only ever receives events for
-- the project it's actually viewing -- Realtime does NOT apply RLS to
-- DELETE payloads (the row is already gone by the time the WAL entry is
-- read, so there is nothing left to run a SELECT policy against), so this
-- `filter` is the real, and only, boundary against a column-removal event
-- leaking into a board for a project the viewer isn't looking at. Without
-- REPLICA IDENTITY FULL, `project_id` would be missing from the DELETE
-- payload and the filter could never match, silently dropping every
-- DELETE event for every board. Same fix, same rationale, as
-- 20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql's
-- `comment_reactions replica identity full`.
alter table project_statuses replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_statuses'
  ) then
    alter publication supabase_realtime add table public.project_statuses;
  end if;
end
$$;
