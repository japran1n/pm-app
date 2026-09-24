-- Canceled is closed, not open.
--
-- The v2 "Canceled" column is seeded with category 'not_started' (so it is
-- never counted as completed work), which made every category-based "open"
-- read treat a canceled task as open work: project open-task counts, the
-- workspace overdue count and the overdue-assignee notifications all
-- counted canceled tasks.
--
-- is_closed_status: done, OR display_group = 'closed', OR the default
-- Canceled name. Mirrors isClosedStatus in lib/tasks/status-category.ts.
-- is_done_status is unchanged (completion metrics still exclude Canceled).
-- Portal buckets (resolveClientBucket) are untouched.

create or replace function public.is_closed_status(p_status_id uuid, p_status text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select ps.category = 'done'
        or ps.display_group is not distinct from 'closed'
        or lower(btrim(ps.name)) in ('canceled', 'cancelled')
      from project_statuses ps
      where ps.id = p_status_id
    ),
    p_status = 'done' or lower(btrim(coalesce(p_status, ''))) in ('canceled', 'cancelled')
  );
$$;

-- An event trigger revokes default EXECUTE on new functions: grant
-- explicitly, matching is_done_status.
revoke all on function public.is_closed_status(uuid, text) from public;
grant execute on function public.is_closed_status(uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- get_open_task_counts
-- ---------------------------------------------------------------------
create or replace function public.get_open_task_counts(project_ids uuid[])
returns table(project_id uuid, open_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  select t.project_id, count(*)::bigint as open_count
  from tasks t
  join project_statuses ps on ps.id = t.status_id
  join projects p on p.id = t.project_id
  where t.project_id = any(project_ids)
    and t.deleted_at is null
    and not public.is_closed_status(t.status_id, t.status)
    and public.is_active_workspace_member(p.workspace_id)
    and (
      (
        public.is_project_client(t.project_id)
        and public.is_project_portal_enabled(t.project_id)
        and t.client_visible
      )
      or (
        not public.is_project_client(t.project_id)
        and public.is_project_visible_to(t.project_id)
      )
    )
  group by t.project_id;
end;
$$;

-- ---------------------------------------------------------------------
-- get_overdue_count
-- ---------------------------------------------------------------------
create or replace function public.get_overdue_count(p_workspace_id uuid, p_timezone text default 'UTC')
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and t.due_date < (now() at time zone p_timezone)::date
    and not public.is_closed_status(t.status_id, t.status);
$$;

-- ---------------------------------------------------------------------
-- notify_overdue_task_assignees
-- ---------------------------------------------------------------------
create or replace function public.notify_overdue_task_assignees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_notified_count integer := 0;
begin
  for v_row in
    select t.id as task_id, t.title as task_title, t.due_date as due_date,
           p.id as project_id, p.workspace_id as workspace_id,
           ta.user_id as assignee_id
    from tasks t
    join projects p on p.id = t.project_id
    join task_assignees ta on ta.task_id = t.id
    join notification_preferences np on np.user_id = ta.user_id
    join workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = ta.user_id
     and wm.status = 'active'
    where t.due_date is not null
      and t.due_date <= (now() at time zone 'utc')::date
      and not public.is_closed_status(t.status_id, t.status)
      and t.deleted_at is null
      and p.deleted_at is null
      and np.task_due_soon_in_app = true
      and not exists (
        select 1
        from notifications n
        where n.user_id = ta.user_id
          and n.task_id = t.id
          and n.kind = 'task_due_soon'
      )
  loop
    begin
      perform public.create_notification(
        p_user_id => v_row.assignee_id,
        p_workspace_id => v_row.workspace_id,
        p_kind => 'task_due_soon',
        p_actor_id => null,
        p_task_id => v_row.task_id,
        p_comment_id => null,
        p_payload => jsonb_build_object('task_title', v_row.task_title, 'due_date', v_row.due_date),
        p_system => true
      );

      v_notified_count := v_notified_count + 1;
    exception
      when others then
        raise warning
          'notify_overdue_task_assignees: failed to notify user % for task % (workspace %): % (%)',
          v_row.assignee_id, v_row.task_id, v_row.workspace_id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_notified_count;
end;
$$;
