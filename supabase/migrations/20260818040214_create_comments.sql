-- F058: comments schema + RLS (AS-104)
--
-- comments -> tasks -> projects -> workspace_members: one join level deeper
-- than tasks. Adds a comments-specific SECURITY DEFINER helper mirroring
-- F034's public.is_project_workspace_member, joining through tasks first.
--
-- Learned from F100 (projects_name_not_empty gap): a `not null` column does
-- NOT reject an empty string. `text` gets an explicit non-empty-after-trim
-- CHECK from the start, per this feature's spec.
--
-- RLS is included in the same migration as the table (not a follow-up),
-- following F033/F034's split precedent but combined here since both the
-- schema and policies are small and this feature is scoped as one unit.

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id),
  user_id uuid not null references auth.users (id),
  text text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint comments_text_not_empty check (btrim(text) <> '')
);

-- Index strategy: index the FK/lookup column this table's RLS policy joins
-- through, per the migration-type clarification's Index strategy answer
-- (same convention as F033/F034 for tasks.project_id).
create index if not exists comments_task_id_idx on comments (task_id);

-- SECURITY DEFINER helper: is the current user an active member of the
-- workspace that owns the project that owns the task that owns this
-- comment? Mirrors the shape/grants of F034's
-- public.is_project_workspace_member(project_id), but joins one level
-- deeper starting from tasks.
create or replace function public.is_task_workspace_member(target_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

revoke all on function public.is_task_workspace_member(uuid) from public;
grant execute on function public.is_task_workspace_member(uuid) to authenticated, anon;

alter table comments enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025/F034 — the app
-- never connects as the table owner for reads; privileged server-side
-- access goes through the secret key, which bypasses RLS by design.

-- SELECT: any active member of the workspace that (transitively) owns the
-- comment's task, excluding soft-deleted rows (AS-104, soft-delete
-- convention).
create policy comments_select_active_members
  on comments
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_task_workspace_member(task_id)
  );

-- INSERT: any active member of the target task's workspace may add a
-- comment. with check re-validates task_id on the incoming row so a member
-- of workspace A cannot insert a comment claiming a task_id that belongs to
-- workspace B (AS-104).
create policy comments_insert_active_members
  on comments
  for insert
  to authenticated
  with check (
    public.is_task_workspace_member(task_id)
  );

-- No UPDATE policy in this migration: comment "deletion" is a soft-delete
-- (setting deleted_at), which per F061's future scope note is handled by a
-- dedicated feature (author-or-admin authorization, AS-098/AS-099/AS-100).
-- Adding an unrestricted UPDATE policy now would let any member edit any
-- comment's text, which is out of scope for AS-104. F061 should add a
-- narrowly-scoped UPDATE policy (author OR workspace admin/owner) rather
-- than this feature speculatively adding a wrong-shaped one.
--
-- No DELETE policy: comments use soft-delete only (deleted_at), per this
-- feature's spec and tech-decisions.md's soft-delete convention. Absence of
-- a DELETE policy denies hard DELETE by default under RLS.
--
-- No policy is created for anon or for authenticated non-members: absence of
-- a matching policy means those rows are simply not returned/writable (RLS
-- default deny), which is what AS-104 requires (filtered, not errored).
