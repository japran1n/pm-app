-- F028 (AS-015, AS-016, AS-017, AS-018): enable Supabase Realtime (Postgres
-- logical replication) on the `task_assignees` table so board viewers get
-- postgres_changes events for INSERT/DELETE without a manual refresh.
--
-- `task_assignees` was created in
-- supabase/migrations/20260822020000_task_assignees_table.sql with no
-- publication statement. F025 subscribed to it client-side, but Postgres
-- never emitted events for it because table membership in the
-- `supabase_realtime` publication is a separate opt-in from RLS. This
-- mirrors the exact pattern used for `tasks` in
-- 20260818040000_realtime_tasks_publication.sql, guarded with the same
-- pg_publication_tables existence check to stay idempotent/safe to re-run.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_assignees'
  ) then
    alter publication supabase_realtime add table public.task_assignees;
  end if;
end
$$;

-- `task_assignees` has no surrogate primary key column that survives a
-- DELETE in the default replica identity (DEFAULT uses the primary key,
-- which here is the composite (task_id, user_id) -- that part is fine).
-- However Postgres logical replication only includes the old row's primary
-- key columns for DELETE under REPLICA IDENTITY DEFAULT; the un-assign flow
-- needs `user_id` (part of the PK, already included) but also relies on
-- clients being able to trust the full old row shape it's the same
-- guarantee `tasks` doesn't need since it has a surrogate `id` PK. Since
-- `task_assignees`' primary key already includes `user_id`, DEFAULT would
-- normally suffice, but to make DELETE payloads self-describing (including
-- `assigned_by`/`created_at` on unassign, not just the PK columns) and to
-- avoid relying on every consumer re-deriving state from a partial old
-- row, this table is switched to REPLICA IDENTITY FULL so DELETE events
-- carry the complete old row.
alter table public.task_assignees replica identity full;
