-- F049 (AS-076): enable Supabase Realtime (Postgres logical replication)
-- on the `tasks` table so board viewers get postgres_changes events for
-- INSERT/UPDATE/DELETE without a manual refresh.
--
-- Supabase Realtime's postgres_changes feature only streams changes for
-- tables that are members of the `supabase_realtime` publication — this is
-- a separate opt-in from RLS (discovery round-2 Q1/Q2: Supabase Realtime
-- chosen for tasks + comments). Adding a table to a publication twice
-- raises `already member of publication`, so this is guarded with a
-- pg_publication_tables existence check to stay idempotent/safe to re-run.
--
-- Realtime respects the table's existing RLS policies (tasks_select_active_
-- members, supabase/migrations/20260818013805_rls_tasks.sql) for
-- postgres_changes broadcasts to authenticated clients, so no separate
-- Realtime-specific policy is needed here — the same workspace-membership
-- check that gates a normal SELECT also gates what a client receives over
-- the Realtime channel.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end
$$;
