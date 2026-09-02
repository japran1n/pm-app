-- F006 (AS-017): enable Supabase Realtime (Postgres logical replication) on
-- the `client_requests` table so subscribers get postgres_changes events
-- without a manual refresh.
--
-- `client_requests` was never added to the `supabase_realtime` publication;
-- table membership in the publication is a separate opt-in from RLS. This
-- mirrors the exact pattern used for `task_assignees` in
-- 20260831000001_task_assignees_realtime_publication.sql, guarded with the
-- same pg_publication_tables existence check to stay idempotent/safe to
-- re-run.
--
-- Unlike the task_assignees migration, this migration does NOT alter
-- replica identity. The previous mission's F042 explicitly reverted a
-- replica-identity change on task_assignees back to DEFAULT; the same
-- reasoning applies here, so replica identity is left untouched.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_requests'
  ) then
    alter publication supabase_realtime add table public.client_requests;
  end if;
end
$$;
