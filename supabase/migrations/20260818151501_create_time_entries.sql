-- F108: time_entries schema + RLS (AS-161, AS-162, AS-163)
--
-- time_entries -> tasks -> projects -> workspace_members: same join depth
-- as comments (F058). Reuses public.is_task_workspace_member (defined in
-- 20260818040214_create_comments.sql) rather than duplicating the helper,
-- since the join shape (task -> project -> workspace_members) is identical.
--
-- minutes is stored as a plain integer (not an interval/duration type) per
-- this feature's Clarified implementation: both manual entry and
-- timer-stop compute a plain integer minute count before writing the row.
-- CHECK (minutes > 0) enforces AS-162 at the database level, not just Zod.
--
-- RLS is included in the same migration as the table, following F058's
-- precedent (schema + policies as one unit when both are small).
--
-- Only SELECT/INSERT policies are added here. No general UPDATE/DELETE RLS
-- policy is added at this layer: F112 will add author-scoped UPDATE/DELETE
-- policies (author-or-admin, mirroring F061's can_modify_comment) once the
-- edit/delete Server Actions exist. Until then, absence of an UPDATE/DELETE
-- policy denies those operations by default under RLS (same convention as
-- comments between F058 and F061).

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id),
  user_id uuid not null references auth.users (id),
  minutes integer not null,
  billable boolean not null default true,
  note text,
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- AS-162: zero or negative minutes rejected at the database level, not
  -- only in the UI/Zod layer.
  constraint time_entries_minutes_positive check (minutes > 0)
);

-- Index strategy: index every FK/lookup column this table's RLS policy
-- joins through (task_id, via is_task_workspace_member) plus user_id, which
-- the per-person time report (AS-173) and "my entries" queries will filter
-- on. Same convention as F033/F058.
create index if not exists time_entries_task_id_idx on time_entries (task_id);
create index if not exists time_entries_user_id_idx on time_entries (user_id);

-- Reuses set_updated_at(), established in 20260818004413_create_projects.sql.
drop trigger if exists time_entries_set_updated_at on time_entries;
create trigger time_entries_set_updated_at
  before update on time_entries
  for each row
  execute function set_updated_at();

alter table time_entries enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025/F034/F058 — the
-- app never connects as the table owner for reads; privileged server-side
-- access goes through the secret key, which bypasses RLS by design.

-- SELECT: any active member of the workspace that (transitively) owns the
-- entry's task (AS-163, AS-175, AS-176).
create policy time_entries_select_active_members
  on time_entries
  for select
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  );

-- INSERT: any active member of the target task's workspace may log a time
-- entry. with check re-validates task_id on the incoming row so a member
-- of workspace A cannot insert a time entry claiming a task_id that
-- belongs to workspace B (AS-161, AS-163, AS-176).
create policy time_entries_insert_active_members
  on time_entries
  for insert
  to authenticated
  with check (
    public.is_task_workspace_member(task_id)
  );

-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not returned/writable
-- (RLS default deny), which is what AS-163/AS-176 require (filtered, not
-- errored).
