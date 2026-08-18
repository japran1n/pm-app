-- F109: active_timers schema + RLS (AS-164, AS-165, AS-168)
--
-- active_timers holds 0 or 1 row per user: the row is created when a member
-- starts a live timer and deleted when the timer stops (F111 converts it
-- into a time_entries row at that point). Because the row lives in Postgres
-- rather than browser state, an active timer's running state survives a
-- page reload or a new tab (AS-168) — any client re-reads this table.
--
-- The UNIQUE constraint on user_id is the mechanism that enforces AS-165
-- ("a member has at most one active timer running at any time across the
-- whole workspace") at the database level, not just app logic: a second
-- INSERT for the same user_id fails outright. Per this feature's Clarified
-- implementation, F111's start-timer action must handle that by stopping
-- the previous timer first (AS-166), not by letting the constraint
-- violation bubble up as a raw error.
--
-- Same join depth / RLS pattern as time_entries (F108) and comments (F058):
-- active_timers -> tasks -> projects -> workspace_members, via the existing
-- public.is_task_workspace_member(task_id) helper.

create table if not exists active_timers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id),
  user_id uuid not null references auth.users (id) unique,
  started_at timestamptz not null default now()
);

-- Index strategy: index task_id, the FK/lookup column this table's RLS
-- policy joins through (mirrors time_entries_task_id_idx from F108). The
-- UNIQUE constraint on user_id already creates a unique index there, so a
-- separate plain index on user_id is unnecessary.
create index if not exists active_timers_task_id_idx on active_timers (task_id);

alter table active_timers enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025/F034/F058/F108 —
-- the app never connects as the table owner for reads; privileged
-- server-side access goes through the secret key, which bypasses RLS by
-- design.

-- SELECT: any active member of the workspace that (transitively) owns the
-- timer's task (AS-168, AS-175, AS-176) — this is what lets a reload or a
-- new tab read the running timer back from the server.
create policy active_timers_select_active_members
  on active_timers
  for select
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  );

-- INSERT: any active member of the target task's workspace may start a
-- timer on it. with check re-validates task_id on the incoming row so a
-- member of workspace A cannot insert an active timer claiming a task_id
-- that belongs to workspace B (AS-164, AS-176).
create policy active_timers_insert_active_members
  on active_timers
  for insert
  to authenticated
  with check (
    public.is_task_workspace_member(task_id)
  );

-- DELETE: any active member of the timer's task workspace may stop
-- (delete) the timer. F111's stop-timer action runs as the timer's own
-- user, so this is scoped the same way as SELECT/INSERT rather than
-- author-only, matching this table's "0 or 1 row per user" lifecycle.
create policy active_timers_delete_active_members
  on active_timers
  for delete
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  );

-- No UPDATE policy: an active timer is never edited in place in this
-- feature set — it is deleted and a new time_entries row is created
-- instead (AS-166, AS-167). Absence of an UPDATE policy denies that
-- operation by default under RLS, consistent with F108's convention for
-- policies not yet needed by a landed feature.

-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not returned/writable
-- (RLS default deny), which is what AS-176 requires (filtered, not
-- errored).
