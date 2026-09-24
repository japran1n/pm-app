-- Medium-severity database hardening (audit 2026-09-24).
--
-- 1. start_timer_atomic / stop_timer_atomic gated only on
--    is_task_workspace_member, so a viewer or client could create billable
--    time_entries on any task in their workspace via /rpc (SEC-ACT3-04,
--    SEC-006). They now mirror lib/actions/time-entries.ts (canWrite +
--    isProjectVisibleToCaller): a task contributor (owner/admin/member, or a
--    guest who is a project member -- is_task_workspace_writer) who can see
--    the task. A timer whose task the caller can no longer write to is
--    discarded on stop instead of billed. Elapsed minutes are clamped to
--    one day (the new CHECK below).
--
-- 2. time_entries / active_timers RLS did not bind user_id to auth.uid()
--    (DB-RLS-08, GAP4-02). The app writes time_entries only through the
--    admin client and active_timers only through the SECURITY DEFINER RPCs
--    above, so direct end-user writes are bound to the caller:
--      * time_entries INSERT: user_id = auth.uid(), contributor, visible.
--      * active_timers INSERT: user_id = auth.uid(), contributor, visible,
--        started_at within 5 minutes of now() (no back-dated timers).
--      * active_timers DELETE: own timer only.
--    CHECKs: time_entries.minutes <= 1440, entry_date in a sane range
--    (0 existing violators at write time).
--
-- 3. Actor columns were client-settable on insert (DB-RLS-09). A generic
--    BEFORE INSERT OR UPDATE trigger, bind_actor_columns(), active only when
--    current_user = 'authenticated' (SECURITY DEFINER functions run as
--    their owner and service_role is a different role, so neither is
--    affected), forces the listed actor column(s) to auth.uid() on insert
--    and keeps them immutable on update. "Last actor" columns (updated_by,
--    deleted_by) are forced to auth.uid() whenever an update sets them to
--    a new non-null value. Tables whose insert policies already enforce
--    actor = auth.uid() are not touched.
--
-- 4. duplicate_task_atomic authorized the source task but not the
--    destination (DB-FN-05). The destination must now be an existing,
--    non-deleted task in the SAME project as the source (for every caller),
--    and a direct authenticated caller must be a team writer on that
--    project. EXECUTE is revoked from authenticated: the app only calls it
--    through the admin client (lib/actions/tasks/duplicate.ts).
--
-- 5. write_audit_log_entry / create_notification / write_task_activity_entry
--    are called from the user's session client (actor pinning relies on
--    auth.uid()), so EXECUTE stays; the content is bound instead
--    (PRIOR-03, DB-RLS-15):
--      * write_audit_log_entry: a non-team caller (viewer/guest/client) may
--        only record its own 'invite.accepted' for its own membership row
--        (the one audit write such roles make, lib/actions/invites.ts);
--        length/size caps on action, target_type and metadata.
--      * create_notification: a task / comment reference must be visible to
--        the caller and belong to the workspace (comment must match the
--        task when both are given); payload size cap.
--      * write_task_activity_entry: 'field_changed' requires a task
--        contributor (viewers/clients can no longer forge field history).
--    audit_log.actor_id ON DELETE CASCADE -> SET NULL (audit rows survive
--    user deletion; column becomes nullable).
--
-- 6. bulk_delete_tasks_atomic trusted p_deleted_at (DB-FN-10). The
--    parameter is kept for signature compatibility and ignored; now() is
--    used. The direct-caller path now requires a team writer (canTeamWrite,
--    matching bulkDeleteTasks), and EXECUTE is revoked from authenticated:
--    the app only calls it through the admin client.
--
-- 7. Two public functions had no pinned search_path (DB-FN-08).
--
-- This database's f016i_revoke_default_execute event trigger revokes
-- default EXECUTE on CREATE FUNCTION, so every function (re)defined here
-- gets explicit grants.

-- =====================================================================
-- 1. Timers
-- =====================================================================

create or replace function public.start_timer_atomic(p_task_id uuid)
returns table(id uuid, task_id uuid, user_id uuid, started_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_active active_timers%rowtype;
  v_minutes integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from tasks t where t.id = p_task_id and t.deleted_at is null
  )
     or not public.is_task_workspace_writer(p_task_id)
     or not public.is_task_visible_to(p_task_id) then
    raise exception 'you do not have permission to track time on this task'
      using errcode = '42501';
  end if;

  select * into v_active
  from active_timers
  where active_timers.user_id = v_user_id
  limit 1
  for update;

  if found then
    delete from active_timers where active_timers.id = v_active.id;

    -- Only bill the previous timer if the caller may still log time on
    -- that task (role or visibility may have changed since it started).
    if public.is_task_workspace_writer(v_active.task_id)
       and public.is_task_visible_to(v_active.task_id) then
      v_minutes := least(
        1440,
        greatest(1, round(extract(epoch from (now() - v_active.started_at)) / 60.0))
      );

      insert into time_entries (task_id, user_id, minutes, billable, entry_date, note)
      values (v_active.task_id, v_user_id, v_minutes, true, current_date, null);
    end if;
  end if;

  return query
    insert into active_timers (task_id, user_id)
    values (p_task_id, v_user_id)
    returning
      active_timers.id,
      active_timers.task_id,
      active_timers.user_id,
      active_timers.started_at;
end;
$function$;

create or replace function public.stop_timer_atomic()
returns table(id uuid, task_id uuid, user_id uuid, minutes integer, billable boolean, entry_date date, note text, created_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_active active_timers%rowtype;
  v_minutes integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_active
  from active_timers
  where active_timers.user_id = v_user_id
  limit 1
  for update;

  if not found then
    return;
  end if;

  delete from active_timers where active_timers.id = v_active.id;

  -- A caller who can no longer log time on the task (demoted to viewer,
  -- removed from the project, ...) gets the timer discarded, not billed.
  if not public.is_task_workspace_writer(v_active.task_id)
     or not public.is_task_visible_to(v_active.task_id) then
    return;
  end if;

  v_minutes := least(
    1440,
    greatest(1, round(extract(epoch from (now() - v_active.started_at)) / 60.0))
  );

  return query
    insert into time_entries (task_id, user_id, minutes, billable, entry_date, note)
    values (v_active.task_id, v_user_id, v_minutes, true, current_date, null)
    returning
      time_entries.id,
      time_entries.task_id,
      time_entries.user_id,
      time_entries.minutes,
      time_entries.billable,
      time_entries.entry_date,
      time_entries.note,
      time_entries.created_at;
end;
$function$;

revoke all on function public.start_timer_atomic(uuid) from public, anon;
grant execute on function public.start_timer_atomic(uuid) to authenticated, service_role;
revoke all on function public.stop_timer_atomic() from public, anon;
grant execute on function public.stop_timer_atomic() to authenticated, service_role;

-- =====================================================================
-- 2. time_entries / active_timers: bind the owner, sanity CHECKs
-- =====================================================================

drop policy if exists time_entries_insert_active_members on public.time_entries;
create policy time_entries_insert_active_members
  on public.time_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_task_workspace_writer(task_id)
    and public.is_task_visible_to(task_id)
  );

drop policy if exists active_timers_insert_active_members on public.active_timers;
create policy active_timers_insert_active_members
  on public.active_timers for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and started_at between now() - interval '5 minutes' and now() + interval '5 minutes'
    and public.is_task_workspace_writer(task_id)
    and public.is_task_visible_to(task_id)
  );

drop policy if exists active_timers_delete_active_members on public.active_timers;
create policy active_timers_delete_active_members
  on public.active_timers for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.time_entries
  add constraint time_entries_minutes_max_one_day check (minutes <= 1440);
alter table public.time_entries
  add constraint time_entries_entry_date_sane
  check (entry_date between date '2000-01-01' and date '2100-12-31');

-- =====================================================================
-- 3. Actor column binding
-- =====================================================================
-- TG_ARGV[0]: comma-separated "creator" columns -- forced to auth.uid() on
--             INSERT, immutable on UPDATE.
-- TG_ARGV[1]: comma-separated "last actor" columns -- forced to auth.uid()
--             on INSERT when non-null, and on UPDATE whenever set to a new
--             non-null value.
-- Only acts for direct end-user writes (current_user = 'authenticated').

create or replace function public.bind_actor_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_col text;
  v_new jsonb;
  v_old jsonb;
begin
  if current_user <> 'authenticated' or v_uid is null then
    return new;
  end if;

  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  if tg_nargs > 0 and coalesce(tg_argv[0], '') <> '' then
    foreach v_col in array string_to_array(tg_argv[0], ',') loop
      if tg_op = 'INSERT' then
        if (v_new ->> v_col) is distinct from v_uid::text then
          new := jsonb_populate_record(new, jsonb_build_object(v_col, v_uid));
        end if;
      elsif (v_new -> v_col) is distinct from (v_old -> v_col) then
        new := jsonb_populate_record(new, jsonb_build_object(v_col, v_old -> v_col));
      end if;
    end loop;
  end if;

  if tg_nargs > 1 and coalesce(tg_argv[1], '') <> '' then
    foreach v_col in array string_to_array(tg_argv[1], ',') loop
      if (v_new ->> v_col) is not null
         and (tg_op = 'INSERT' or (v_new -> v_col) is distinct from (v_old -> v_col))
         and (v_new ->> v_col) is distinct from v_uid::text then
        new := jsonb_populate_record(new, jsonb_build_object(v_col, v_uid));
      end if;
    end loop;
  end if;

  return new;
end;
$function$;

revoke all on function public.bind_actor_columns() from public, anon;
grant execute on function public.bind_actor_columns() to authenticated, service_role;

-- Named zz_* so it fires after every other BEFORE trigger on the table.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('active_timers',          'user_id',      ''),
      ('architecture_node_meta', '',             'updated_by'),
      ('attachments',            'uploaded_by',  ''),
      ('comments',               'user_id',      'deleted_by'),
      ('doc_folders',            'created_by',   ''),
      ('docs',                   'created_by',   'updated_by'),
      ('project_members',        'added_by',     ''),
      ('project_roles',          'added_by',     ''),
      ('projects',               'created_by',   ''),
      ('sitemaps',               'created_by',   ''),
      ('status_templates',       'created_by',   ''),
      ('task_assignees',         'assigned_by',  ''),
      ('task_dependencies',      'created_by',   ''),
      ('tasks',                  'author_id',    'deleted_by'),
      ('time_entries',           'user_id',      ''),
      ('view_tasks',             'added_by',     '')
    ) as t(tbl, creator_cols, last_actor_cols)
  loop
    execute format('drop trigger if exists zz_bind_actor_columns on public.%I', r.tbl);
    execute format(
      'create trigger zz_bind_actor_columns before insert or update on public.%I '
      'for each row execute function public.bind_actor_columns(%L, %L)',
      r.tbl, r.creator_cols, r.last_actor_cols
    );
  end loop;
end
$$;

-- =====================================================================
-- 4. duplicate_task_atomic: authorize the destination
-- =====================================================================

create or replace function public.duplicate_task_atomic(p_source_task_id uuid, p_new_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source_project uuid;
  v_dest_project uuid;
begin
  select t.project_id into v_source_project
  from public.tasks t where t.id = p_source_task_id;

  select t.project_id into v_dest_project
  from public.tasks t where t.id = p_new_task_id and t.deleted_at is null;

  if v_source_project is null or v_dest_project is null then
    raise exception 'duplicate_task_atomic: task not found' using errcode = 'P0002';
  end if;

  -- The duplicate is always created in the source's own project
  -- (lib/actions/tasks/duplicate.ts); anything else is a cross-project /
  -- cross-tenant write.
  if v_dest_project <> v_source_project or p_new_task_id = p_source_task_id then
    raise exception 'duplicate_task_atomic: destination must be a different task in the same project'
      using errcode = '42501';
  end if;

  if auth.uid() is not null then
    if not public.is_project_workspace_writer(v_source_project)
       or not public.is_project_visible_to(v_source_project) then
      raise exception 'duplicate_task_atomic: caller does not have write access to this project'
        using errcode = '42501';
    end if;
  end if;

  insert into public.checklist_items (task_id, content, position)
  select p_new_task_id, content, position
  from public.checklist_items
  where task_id = p_source_task_id;

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_new_task_id, user_id, assigned_by
  from public.task_assignees
  where task_id = p_source_task_id;
end;
$function$;

revoke all on function public.duplicate_task_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duplicate_task_atomic(uuid, uuid) to service_role;

-- =====================================================================
-- 5. Internal RPCs: bind content to the caller
-- =====================================================================

create or replace function public.write_audit_log_entry(
  p_workspace_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns audit_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.audit_log;
  v_role text;
  v_member_id uuid;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'audit_log: no authenticated actor' using errcode = '28000';
  end if;

  select wm.role, wm.id into v_role, v_member_id
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active';

  if v_role is null then
    raise exception 'audit_log: caller is not an active member of this workspace'
      using errcode = '42501';
  end if;

  if p_action is null or length(p_action) > 100
     or p_target_type is null or length(p_target_type) > 100
     or pg_column_size(v_metadata) > 16384 then
    raise exception 'audit_log: invalid entry' using errcode = '22023';
  end if;

  -- Viewers, guests and clients never perform audited actions except
  -- accepting their own invite (lib/actions/invites.ts). Anything else from
  -- them is a forged entry.
  if v_role not in ('owner', 'admin', 'member') then
    if p_action <> 'invite.accepted'
       or p_target_type <> 'workspace_member'
       or p_target_id is distinct from v_member_id
       or exists (
         select 1 from public.audit_log a
         where a.workspace_id = p_workspace_id
           and a.action = 'invite.accepted'
           and a.target_id = v_member_id
       ) then
      raise exception 'audit_log: not permitted for this role' using errcode = '42501';
    end if;
    v_metadata := jsonb_build_object('role', v_role);
  end if;

  insert into public.audit_log (workspace_id, actor_id, action, target_type, target_id, metadata)
  values (p_workspace_id, auth.uid(), p_action, p_target_type, p_target_id, v_metadata)
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.write_audit_log_entry(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.write_audit_log_entry(uuid, text, text, uuid, jsonb) to authenticated, service_role;

create or replace function public.create_notification(
  p_user_id uuid,
  p_workspace_id uuid,
  p_kind text,
  p_actor_id uuid default null::uuid,
  p_task_id uuid default null::uuid,
  p_comment_id uuid default null::uuid,
  p_payload jsonb default '{}'::jsonb,
  p_system boolean default false
)
returns notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.notifications;
  v_actor uuid;
  v_comment_task uuid;
begin
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
  ) then
    raise exception 'create_notification: recipient % is not an active member of workspace %', p_user_id, p_workspace_id;
  end if;

  if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 16384 then
    raise exception 'create_notification: payload too large' using errcode = '22023';
  end if;

  -- F320: a provided task_id must belong to a project inside the target
  -- workspace.
  if p_task_id is not null then
    if not exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = p_task_id
        and p.workspace_id = p_workspace_id
    ) then
      raise exception 'create_notification: task % does not belong to workspace %', p_task_id, p_workspace_id;
    end if;
  end if;

  -- A comment reference must belong to the workspace too, and to the
  -- task when both are given.
  if p_comment_id is not null then
    select c.task_id into v_comment_task
    from public.comments c
    join public.tasks t on t.id = c.task_id
    join public.projects p on p.id = t.project_id
    where c.id = p_comment_id
      and p.workspace_id = p_workspace_id;

    if v_comment_task is null
       or (p_task_id is not null and v_comment_task <> p_task_id) then
      raise exception 'create_notification: comment % does not belong to this workspace/task', p_comment_id;
    end if;
  end if;

  if p_system and auth.uid() is null then
    -- System-generated notification (no human session).
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'create_notification: no authenticated caller';
    end if;

    if not exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
    ) then
      raise exception 'create_notification: caller % is not an active member of workspace %', auth.uid(), p_workspace_id;
    end if;

    -- A human caller may only reference tasks/comments it can see.
    if p_task_id is not null and not public.is_task_visible_to(p_task_id) then
      raise exception 'create_notification: caller cannot see this task' using errcode = '42501';
    end if;
    if v_comment_task is not null and not public.is_task_visible_to(v_comment_task) then
      raise exception 'create_notification: caller cannot see this comment' using errcode = '42501';
    end if;

    -- Never trust a client-supplied actor id.
    v_actor := auth.uid();
  end if;

  insert into public.notifications (
    user_id, workspace_id, kind, actor_id, task_id, comment_id, payload
  )
  values (
    p_user_id, p_workspace_id, p_kind, v_actor, p_task_id, p_comment_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb, boolean) to authenticated, service_role;

create or replace function public.write_task_activity_entry(
  p_task_id uuid,
  p_kind text,
  p_field text default null::text,
  p_old_value jsonb default null::jsonb,
  p_new_value jsonb default null::jsonb,
  p_system boolean default false
)
returns task_activity
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.task_activity;
  v_actor uuid;
begin
  if p_system and auth.uid() is null then
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'task_activity: no authenticated actor';
    end if;
    if not public.is_task_visible_to(p_task_id) then
      raise exception 'task_activity: caller cannot see this task';
    end if;
    -- Field changes are task edits: only task contributors make them.
    -- Viewers and clients can no longer forge field history.
    if p_kind = 'field_changed' and not public.is_task_workspace_writer(p_task_id) then
      raise exception 'task_activity: caller cannot edit this task' using errcode = '42501';
    end if;
    v_actor := auth.uid();
  end if;

  if not exists (select 1 from public.tasks t where t.id = p_task_id) then
    raise exception 'task_activity: task % does not exist', p_task_id;
  end if;

  insert into public.task_activity (task_id, actor_id, kind, field, old_value, new_value)
  values (p_task_id, v_actor, p_kind, p_field, p_old_value, p_new_value)
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.write_task_activity_entry(uuid, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.write_task_activity_entry(uuid, text, text, jsonb, jsonb, boolean) to authenticated, service_role;

-- audit_log rows must survive user deletion.
alter table public.audit_log alter column actor_id drop not null;
alter table public.audit_log drop constraint audit_log_actor_id_fkey;
alter table public.audit_log
  add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

-- =====================================================================
-- 6. bulk_delete_tasks_atomic: server-side timestamp
-- =====================================================================

create or replace function public.bulk_delete_tasks_atomic(
  p_task_ids uuid[],
  p_deleted_by uuid,
  p_deleted_at timestamp with time zone
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_allowed_ids uuid[];
  v_deleted_ids uuid[];
  -- p_deleted_at is kept for signature compatibility and ignored: the
  -- deletion time is always the server's.
  v_deleted_at timestamptz := now();
begin
  if auth.uid() is not null then
    -- Direct authenticated caller: only tasks this caller may delete
    -- (team writer + visible project, same as bulkDeleteTasks), attributed
    -- to the caller.
    select array_agg(t.id) into v_allowed_ids
    from public.tasks t
    where t.id = any(p_task_ids)
      and public.is_project_workspace_writer(t.project_id)
      and public.is_project_visible_to(t.project_id);

    p_deleted_by := auth.uid();
  else
    -- service_role path (admin.rpc from bulkDeleteTasks), which has
    -- already filtered and re-verified p_task_ids.
    v_allowed_ids := p_task_ids;
  end if;

  if v_allowed_ids is null or array_length(v_allowed_ids, 1) is null then
    return '{}';
  end if;

  with deleted as (
    update public.tasks
    set deleted_at = v_deleted_at,
        deleted_by = p_deleted_by
    where id = any(v_allowed_ids)
      and deleted_at is null
    returning id
  )
  select array_agg(id) into v_deleted_ids from deleted;

  if v_deleted_ids is not null and array_length(v_deleted_ids, 1) > 0 then
    update public.tasks
    set deleted_at = v_deleted_at,
        deleted_by = p_deleted_by
    where parent_task_id = any(v_deleted_ids)
      and deleted_at is null;
  end if;

  return coalesce(v_deleted_ids, '{}');
end;
$function$;

revoke all on function public.bulk_delete_tasks_atomic(uuid[], uuid, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.bulk_delete_tasks_atomic(uuid[], uuid, timestamp with time zone) to service_role;

-- =====================================================================
-- 7. Pin search_path
-- =====================================================================

alter function public.get_workspace_time_by_person_and_day(uuid, date, date)
  set search_path = public, pg_temp;
alter function public.get_latest_task_activity(uuid[])
  set search_path = public, pg_temp;
