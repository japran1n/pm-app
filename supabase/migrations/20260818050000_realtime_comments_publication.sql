-- F062 (AS-101, AS-102): enable Supabase Realtime (Postgres logical
-- replication) on the `comments` table so task viewers get
-- postgres_changes events for soft-delete UPDATEs (deleted_at set)
-- without a manual refresh.
--
-- Mirrors F049's tasks publication migration
-- (supabase/migrations/20260818040000_realtime_tasks_publication.sql):
-- postgres_changes only streams changes for tables that are members of
-- the `supabase_realtime` publication, which is a separate opt-in from
-- RLS. Adding a table to a publication twice raises `already member of
-- publication`, so this is guarded with a pg_publication_tables existence
-- check to stay idempotent/safe to re-run.
--
-- Realtime respects the table's existing RLS policies
-- (comments_select_active_members,
-- supabase/migrations/20260818040214_create_comments.sql) for
-- postgres_changes broadcasts to authenticated clients, so no separate
-- Realtime-specific policy is needed here.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end
$$;
