-- F128 (AS-216, AS-217): viewer (and guest) are read-only roles at the
-- database level, not just in the Server Action layer.
--
-- lib/actions/*.ts's Server Actions now re-check `canWrite` (lib/auth/
-- permissions.ts) before every mutation, but that's only the app-layer
-- half — a client holding a real session and the publishable key can call
-- Supabase directly (bypassing every Server Action) and, before this
-- migration, would still succeed at INSERT/UPDATE on tasks/comments/
-- attachments/time_entries as long as they were an *active* member,
-- regardless of role. This migration adds the missing role gate to those
-- write policies, so a viewer/guest's direct write is rejected by RLS too
-- (defense in depth, not a replacement for the Server Action check).
--
-- Approach: new SECURITY DEFINER helpers `is_project_workspace_writer` /
-- `is_task_workspace_writer` mirror the existing read helpers
-- (`is_project_workspace_member` / `is_task_workspace_member`, defined in
-- 20260818013805_rls_tasks.sql / 20260818040214_create_comments.sql)
-- exactly, but add `wm.role not in ('viewer', 'guest')`. The existing read
-- helpers are deliberately left untouched — viewers/guests must keep
-- reading everything they could already read (AS-216's "read everything"
-- half); only the INSERT/UPDATE policies below are repointed at the new
-- writer-scoped helpers.
--
-- SELECT policies (tasks/comments/attachments/time_entries) are
-- unchanged — this migration touches only INSERT/UPDATE policies (tasks,
-- comments, attachments table + storage.objects, time_entries) and
-- comments' existing author-or-admin UPDATE predicate.

-- --- tasks -------------------------------------------------------------

create or replace function public.is_project_workspace_writer(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'guest')
  );
$$;

revoke all on function public.is_project_workspace_writer(uuid) from public;
grant execute on function public.is_project_workspace_writer(uuid) to authenticated, anon;

drop policy if exists tasks_insert_active_members on tasks;
create policy tasks_insert_active_members
  on tasks
  for insert
  to authenticated
  with check (
    public.is_project_workspace_writer(project_id)
  );

drop policy if exists tasks_update_active_members on tasks;
create policy tasks_update_active_members
  on tasks
  for update
  to authenticated
  using (
    deleted_at is null
    and public.is_project_workspace_writer(project_id)
  )
  with check (
    public.is_project_workspace_writer(project_id)
  );

-- --- comments / attachments / time_entries (task-scoped) ---------------

create or replace function public.is_task_workspace_writer(target_task_id uuid)
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
      and wm.role not in ('viewer', 'guest')
  );
$$;

revoke all on function public.is_task_workspace_writer(uuid) from public;
grant execute on function public.is_task_workspace_writer(uuid) to authenticated, anon;

drop policy if exists comments_insert_active_members on comments;
create policy comments_insert_active_members
  on comments
  for insert
  to authenticated
  with check (
    public.is_task_workspace_writer(task_id)
  );

drop policy if exists attachments_insert_active_members on attachments;
create policy attachments_insert_active_members
  on attachments
  for insert
  to authenticated
  with check (
    public.is_task_workspace_writer(task_id)
  );

drop policy if exists time_entries_insert_active_members on time_entries;
create policy time_entries_insert_active_members
  on time_entries
  for insert
  to authenticated
  with check (
    public.is_task_workspace_writer(task_id)
  );

-- comments_update_author_or_admin (20260818041550_rls_comments_delete_
-- update.sql) already restricts UPDATE to "the comment's own author, or an
-- active workspace admin/owner" via can_modify_comment(). A viewer/guest
-- can never be "owner"/"admin", so the only theoretical gap is a caller
-- who authored a comment while an active writable role and was later
-- demoted to viewer/guest without losing their old comment's authorship —
-- `can_modify_comment` is tightened here to also require a currently
-- writable role, closing that edge case (same rationale as this
-- migration's Server Action counterpart in lib/actions/comments.ts's
-- deleteComment).
create or replace function public.can_modify_comment(target_comment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from comments c
    join tasks t on t.id = c.task_id
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where c.id = target_comment_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'guest')
      and (
        c.user_id = auth.uid()
        or wm.role in ('owner', 'admin')
      )
  );
$$;

-- --- attachments: storage.objects (Storage bucket writes) --------------

-- attachments_objects_insert_active_members (20260818050100_create_
-- attachments.sql) authorizes the upload by parsing the task_id out of the
-- object path's first segment and checking workspace membership directly
-- (the attachments row doesn't exist yet at upload time). Repointed at
-- is_task_workspace_writer so a viewer/guest's direct Storage upload is
-- rejected the same way the table-level INSERT above is.
drop policy if exists attachments_objects_insert_active_members on storage.objects;
create policy attachments_objects_insert_active_members
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.is_task_workspace_writer(
      (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid
    )
  );

-- No change to attachments_objects_select_active_members (storage read) or
-- any *_select_* policy on tasks/comments/attachments/time_entries — a
-- viewer/guest's read access, including what Realtime's postgres_changes
-- delivers (Realtime authorizes each change event against the same SELECT
-- RLS policy on the underlying table, not a separate rule set — see this
-- migration's handoff notes for the verification performed), is
-- unaffected by this migration.
