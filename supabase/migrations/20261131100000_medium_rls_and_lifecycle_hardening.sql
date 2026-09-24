-- Remaining medium DB hardening (audit 2026-09-24).
--
-- 1. GAP5-05 / SEC-ACT1-12: a soft-deleted workspace (workspaces.deleted_at)
--    now denies everything through RLS. Every membership-derived helper
--    used by policies/RPCs additionally requires the workspace to be live
--    (one extra primary-key lookup inside each STABLE SECURITY DEFINER fn).
-- 2. DB-FN-06: the portal-triage RPCs also require project visibility.
-- 3. DB-RLS-06: team-only predicates for calendar blocks, time off, project
--    create/update, channel creation and shared view membership.
-- 4. DB-RLS-07: task_assignees / task_dependencies writes need a task
--    writer (mirrors canEditTask: owner/admin/member).
-- 5. GAP4-04: tasks cross-reference guard trigger.
-- 6. SEC-CONTENT-07: task-attachments accepts text/markdown (doc-approval
--    snapshots are stored there as doc-snapshot.md).
--
-- Every function created/replaced gets explicit EXECUTE grants: this
-- database's event trigger revokes default EXECUTE on CREATE FUNCTION.

-- ---------------------------------------------------------------------
-- 1 + 2. Live-workspace helpers and visibility-checked triage RPCs.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_active_workspace_member(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
  );
$function$;

revoke all on function public.is_active_workspace_member(target_workspace_id uuid) from public;
revoke all on function public.is_active_workspace_member(target_workspace_id uuid) from anon;
grant execute on function public.is_active_workspace_member(target_workspace_id uuid) to authenticated;
grant execute on function public.is_active_workspace_member(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role in ('owner', 'admin')
  );
$function$;

revoke all on function public.is_workspace_admin(target_workspace_id uuid) from public;
revoke all on function public.is_workspace_admin(target_workspace_id uuid) from anon;
grant execute on function public.is_workspace_admin(target_workspace_id uuid) to authenticated;
grant execute on function public.is_workspace_admin(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_workspace_client(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role = 'client'
  );
$function$;

revoke all on function public.is_workspace_client(target_workspace_id uuid) from public;
revoke all on function public.is_workspace_client(target_workspace_id uuid) from anon;
grant execute on function public.is_workspace_client(target_workspace_id uuid) to authenticated;
grant execute on function public.is_workspace_client(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_project_client(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role = 'client'
  );
$function$;

revoke all on function public.is_project_client(target_project_id uuid) from public;
revoke all on function public.is_project_client(target_project_id uuid) from anon;
grant execute on function public.is_project_client(target_project_id uuid) to authenticated;
grant execute on function public.is_project_client(target_project_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_project_workspace_member(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
  );
$function$;

revoke all on function public.is_project_workspace_member(target_project_id uuid) from public;
revoke all on function public.is_project_workspace_member(target_project_id uuid) from anon;
grant execute on function public.is_project_workspace_member(target_project_id uuid) to authenticated;
grant execute on function public.is_project_workspace_member(target_project_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_project_workspace_writer(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role in ('owner', 'admin', 'member')
  );
$function$;

revoke all on function public.is_project_workspace_writer(target_project_id uuid) from public;
revoke all on function public.is_project_workspace_writer(target_project_id uuid) from anon;
grant execute on function public.is_project_workspace_writer(target_project_id uuid) to authenticated;
grant execute on function public.is_project_workspace_writer(target_project_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_project_visible_to(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and (
        (
          wm.role not in ('guest', 'client')
          and (
            p.visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  );
$function$;

revoke all on function public.is_project_visible_to(target_project_id uuid) from public;
revoke all on function public.is_project_visible_to(target_project_id uuid) from anon;
grant execute on function public.is_project_visible_to(target_project_id uuid) to authenticated;
grant execute on function public.is_project_visible_to(target_project_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_project_visible_to_row(target_project_id uuid, target_workspace_id uuid, target_visibility text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and (
        (
          wm.role not in ('guest', 'client')
          and (
            target_visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = target_project_id
            and pm.user_id = auth.uid()
        )
      )
  );
$function$;

revoke all on function public.is_project_visible_to_row(target_project_id uuid, target_workspace_id uuid, target_visibility text) from public;
revoke all on function public.is_project_visible_to_row(target_project_id uuid, target_workspace_id uuid, target_visibility text) from anon;
grant execute on function public.is_project_visible_to_row(target_project_id uuid, target_workspace_id uuid, target_visibility text) to authenticated;
grant execute on function public.is_project_visible_to_row(target_project_id uuid, target_workspace_id uuid, target_visibility text) to service_role;

CREATE OR REPLACE FUNCTION public.is_task_client(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role = 'client'
  );
$function$;

revoke all on function public.is_task_client(target_task_id uuid) from public;
revoke all on function public.is_task_client(target_task_id uuid) from anon;
grant execute on function public.is_task_client(target_task_id uuid) to authenticated;
grant execute on function public.is_task_client(target_task_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_task_workspace_member(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
  );
$function$;

revoke all on function public.is_task_workspace_member(target_task_id uuid) from public;
revoke all on function public.is_task_workspace_member(target_task_id uuid) from anon;
grant execute on function public.is_task_workspace_member(target_task_id uuid) to authenticated;
grant execute on function public.is_task_workspace_member(target_task_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_task_workspace_writer(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and (
        wm.role in ('owner', 'admin', 'member')
        or (
          wm.role = 'guest'
          and exists (
            select 1
            from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
$function$;

revoke all on function public.is_task_workspace_writer(target_task_id uuid) from public;
revoke all on function public.is_task_workspace_writer(target_task_id uuid) from anon;
grant execute on function public.is_task_workspace_writer(target_task_id uuid) to authenticated;
grant execute on function public.is_task_workspace_writer(target_task_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_project_lead_or_workspace_admin(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.projects p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
     where p.id = target_project_id
       and wm.user_id = auth.uid()
       and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
       and wm.role in ('owner', 'admin')
  )
  or exists (
    select 1
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
      join public.workspace_members wm
        on wm.workspace_id = p.workspace_id
       and wm.user_id = pm.user_id
     where pm.project_id = target_project_id
       and pm.user_id = auth.uid()
       and pm.project_role = 'lead'
       and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
       and wm.role not in ('client', 'viewer')
  );
$function$;

revoke all on function public.is_project_lead_or_workspace_admin(target_project_id uuid) from public;
revoke all on function public.is_project_lead_or_workspace_admin(target_project_id uuid) from anon;
grant execute on function public.is_project_lead_or_workspace_admin(target_project_id uuid) to authenticated;
grant execute on function public.is_project_lead_or_workspace_admin(target_project_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_channel_member(target_channel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.channel_members   cm
      join public.channels          c  on c.id = cm.channel_id
      join public.workspace_members wm on wm.workspace_id = c.workspace_id
     where cm.channel_id = target_channel_id
       and cm.user_id    = auth.uid()
       and wm.user_id    = auth.uid()
       and wm.status     = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
  );
$function$;

revoke all on function public.is_channel_member(target_channel_id uuid) from public;
revoke all on function public.is_channel_member(target_channel_id uuid) from anon;
grant execute on function public.is_channel_member(target_channel_id uuid) to authenticated;
grant execute on function public.is_channel_member(target_channel_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_read_workspace_docs(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role <> 'client'
  );
$function$;

revoke all on function public.can_read_workspace_docs(target_workspace_id uuid) from public;
revoke all on function public.can_read_workspace_docs(target_workspace_id uuid) from anon;
grant execute on function public.can_read_workspace_docs(target_workspace_id uuid) to authenticated;
grant execute on function public.can_read_workspace_docs(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_write_workspace_docs(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role not in ('viewer', 'client')
  );
$function$;

revoke all on function public.can_write_workspace_docs(target_workspace_id uuid) from public;
revoke all on function public.can_write_workspace_docs(target_workspace_id uuid) from anon;
grant execute on function public.can_write_workspace_docs(target_workspace_id uuid) to authenticated;
grant execute on function public.can_write_workspace_docs(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_read_workspace_sitemaps(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role in ('owner', 'admin', 'member', 'viewer')
  );
$function$;

revoke all on function public.can_read_workspace_sitemaps(target_workspace_id uuid) from public;
revoke all on function public.can_read_workspace_sitemaps(target_workspace_id uuid) from anon;
grant execute on function public.can_read_workspace_sitemaps(target_workspace_id uuid) to authenticated;
grant execute on function public.can_read_workspace_sitemaps(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_write_workspace_sitemaps(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role in ('owner', 'admin', 'member')
  );
$function$;

revoke all on function public.can_write_workspace_sitemaps(target_workspace_id uuid) from public;
revoke all on function public.can_write_workspace_sitemaps(target_workspace_id uuid) from anon;
grant execute on function public.can_write_workspace_sitemaps(target_workspace_id uuid) to authenticated;
grant execute on function public.can_write_workspace_sitemaps(target_workspace_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_read_sitemap(target_sitemap_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sitemaps s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id
    where s.id = target_sitemap_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role in ('owner', 'admin', 'member', 'viewer')
  );
$function$;

revoke all on function public.can_read_sitemap(target_sitemap_id uuid) from public;
revoke all on function public.can_read_sitemap(target_sitemap_id uuid) from anon;
grant execute on function public.can_read_sitemap(target_sitemap_id uuid) to authenticated;
grant execute on function public.can_read_sitemap(target_sitemap_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_write_sitemap(target_sitemap_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sitemaps s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id
    where s.id = target_sitemap_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role in ('owner', 'admin', 'member')
  );
$function$;

revoke all on function public.can_write_sitemap(target_sitemap_id uuid) from public;
revoke all on function public.can_write_sitemap(target_sitemap_id uuid) from anon;
grant execute on function public.can_write_sitemap(target_sitemap_id uuid) to authenticated;
grant execute on function public.can_write_sitemap(target_sitemap_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.can_modify_comment(target_comment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from comments c
    join tasks t on t.id = c.task_id
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where c.id = target_comment_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
      and wm.role <> 'viewer'
      and (
        c.user_id = auth.uid()
        or wm.role in ('owner', 'admin')
      )
  );
$function$;

revoke all on function public.can_modify_comment(target_comment_id uuid) from public;
revoke all on function public.can_modify_comment(target_comment_id uuid) from anon;
grant execute on function public.can_modify_comment(target_comment_id uuid) to authenticated;
grant execute on function public.can_modify_comment(target_comment_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.accept_client_request_atomic(p_request_id uuid)
 RETURNS TABLE(task_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_body text;
  v_desired_by date;
  v_status text;
  v_task_id uuid;
  v_caller_role text;
  v_scope_verdict text;
  v_client_decision text;
  v_quote_valid_until date;
  v_task_type_key text;
  v_task_type_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select cr.project_id, cr.title, cr.body, cr.desired_by, cr.status, p.workspace_id,
         cr.scope_verdict, cr.client_decision, cr.quote_valid_until
    into v_project_id, v_title, v_body, v_desired_by, v_status, v_workspace_id,
         v_scope_verdict, v_client_decision, v_quote_valid_until
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null);

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if v_caller_role = 'client' then
    raise exception 'a client cannot accept their own request'
      using errcode = '42501';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'caller cannot access this project'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if v_scope_verdict = 'change_request' then
    if v_client_decision is distinct from 'approved' then
      raise exception 'this change request has not been approved by the client yet'
        using errcode = 'CR047';
    end if;

    if v_quote_valid_until is not null and v_quote_valid_until < current_date then
      raise exception 'this change request''s quote has expired; send a fresh quote before accepting'
        using errcode = 'CR048';
    end if;
  end if;

  if v_status = 'accepted' then
    raise exception 'request already accepted';
  end if;

  -- F116 (AS-063): resolved by system_key, never by name.
  if v_scope_verdict = 'change_request' then
    v_task_type_key := 'change_request';
    v_task_type_id := public.ensure_task_type(
      v_workspace_id, 'change_request', 'Change request', '#8b5cf6', true, true
    );
  else
    v_task_type_key := 'client_request';
    v_task_type_id := public.ensure_task_type(
      v_workspace_id, 'client_request', 'Client request', '#f59e0b', true, true
    );
  end if;

  insert into public.tasks (project_id, title, description, status, author_id, due_date, client_visible, task_type_id)
  values (v_project_id, v_title, v_body, 'todo', v_user_id, v_desired_by, true, v_task_type_id)
  returning id into v_task_id;

  update public.client_requests
     set status = 'accepted',
         decline_reason = null,
         converted_task_id = v_task_id,
         reviewed_by = v_user_id,
         reviewed_at = now()
   where id = p_request_id;

  return query select v_task_id;
end;
$function$;

revoke all on function public.accept_client_request_atomic(p_request_id uuid) from public;
revoke all on function public.accept_client_request_atomic(p_request_id uuid) from anon;
grant execute on function public.accept_client_request_atomic(p_request_id uuid) to authenticated;
grant execute on function public.accept_client_request_atomic(p_request_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.send_change_request_quote_atomic(p_request_id uuid, p_scope_verdict text, p_severity text DEFAULT NULL::text, p_quoted_hours numeric DEFAULT NULL::numeric, p_quoted_amount numeric DEFAULT NULL::numeric, p_quote_currency text DEFAULT NULL::text, p_quote_note text DEFAULT NULL::text, p_quote_valid_until date DEFAULT NULL::date, p_track text DEFAULT NULL::text, p_track_overridden boolean DEFAULT false, p_track_override_reason text DEFAULT NULL::text, p_portal_url text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, scope_verdict text, approval_request_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_status text;
  v_caller_role text;
  v_approval_id uuid;
  v_prior_approval_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_scope_verdict not in ('in_scope', 'change_request', 'warranty') then
    raise exception 'send_change_request_quote_atomic: invalid scope_verdict %', p_scope_verdict
      using errcode = '22023';
  end if;

  select cr.project_id, cr.title, cr.status, p.workspace_id, cr.approval_request_id
    into v_project_id, v_title, v_status, v_workspace_id, v_prior_approval_id
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  if v_status = 'accepted' then
    raise exception 'this request has already been accepted';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null);

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'caller cannot access this project'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if p_scope_verdict = 'change_request' and (p_quoted_amount is null or p_quote_valid_until is null) then
    raise exception 'a change request quote needs an amount and a validity date'
      using errcode = '22023';
  end if;

  -- F016f's own Defect 3a, preserved: a fresh quote makes the PRIOR
  -- approval moot. Withdraw it if it is still awaiting a decision.
  if v_prior_approval_id is not null then
    update public.approval_requests
       set state = 'withdrawn'
     where id = v_prior_approval_id
       and state = 'pending';
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  update public.client_requests
     set scope_verdict = p_scope_verdict,
         severity = p_severity,
         quoted_hours = p_quoted_hours,
         quoted_amount = p_quoted_amount,
         quote_currency = p_quote_currency,
         quote_note = p_quote_note,
         quote_valid_until = p_quote_valid_until,
         track = p_track,
         track_overridden = coalesce(p_track_overridden, false),
         track_override_reason = case when coalesce(p_track_overridden, false) then p_track_override_reason else null end,
         client_decision = case when p_scope_verdict = 'change_request' then 'pending' else client_decision end,
         status = case when v_status = 'submitted' then 'in_review' else v_status end,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         approval_request_id = null,
         -- F025b: unsent until the branch below (re)sends it — a fresh
         -- quote, or a verdict change away from 'change_request', is not
         -- a quote the client has seen.
         quote_sent_at = null
   where id = p_request_id;

  if p_scope_verdict = 'change_request' then
    insert into public.approval_requests (
      project_id, subject_type, subject_id, artifact_url, title, description,
      decision_type, requested_by, due_at
    )
    values (
      v_project_id, 'artifact', p_request_id,
      coalesce(p_portal_url, 'about:blank'),
      'Quote: ' || v_title,
      p_quote_note,
      'commercial', v_user_id,
      case when p_quote_valid_until is not null then p_quote_valid_until::timestamptz else null end
    )
    returning id into v_approval_id;

    update public.client_requests
       set approval_request_id = v_approval_id,
           -- F025b: this is the one moment "sent" means — the same
           -- statement that raises the client-facing approval.
           quote_sent_at = now()
     where id = p_request_id;
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select p_request_id, p_scope_verdict, v_approval_id;
end;
$function$;

revoke all on function public.send_change_request_quote_atomic(p_request_id uuid, p_scope_verdict text, p_severity text, p_quoted_hours numeric, p_quoted_amount numeric, p_quote_currency text, p_quote_note text, p_quote_valid_until date, p_track text, p_track_overridden boolean, p_track_override_reason text, p_portal_url text) from public;
revoke all on function public.send_change_request_quote_atomic(p_request_id uuid, p_scope_verdict text, p_severity text, p_quoted_hours numeric, p_quoted_amount numeric, p_quote_currency text, p_quote_note text, p_quote_valid_until date, p_track text, p_track_overridden boolean, p_track_override_reason text, p_portal_url text) from anon;
grant execute on function public.send_change_request_quote_atomic(p_request_id uuid, p_scope_verdict text, p_severity text, p_quoted_hours numeric, p_quoted_amount numeric, p_quote_currency text, p_quote_note text, p_quote_valid_until date, p_track text, p_track_overridden boolean, p_track_override_reason text, p_portal_url text) to authenticated;
grant execute on function public.send_change_request_quote_atomic(p_request_id uuid, p_scope_verdict text, p_severity text, p_quoted_hours numeric, p_quoted_amount numeric, p_quote_currency text, p_quote_note text, p_quote_valid_until date, p_track text, p_track_overridden boolean, p_track_override_reason text, p_portal_url text) to service_role;

CREATE OR REPLACE FUNCTION public.raise_change_request_from_assumption_atomic(p_assumption_id uuid)
 RETURNS TABLE(request_id uuid, project_id uuid, title text, body text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_note text;
  v_state text;
  v_flagged_at timestamptz;
  v_caller_role text;
  v_client_id uuid;
  v_request_id uuid;
  v_title text;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: not authenticated'
      using errcode = '28000';
  end if;

  select pa.project_id, pa.text, pa.flagged_note, pa.state, pa.flagged_by_client_at, p.workspace_id
    into v_project_id, v_text, v_note, v_state, v_flagged_at, v_workspace_id
    from public.project_assumptions pa
    join public.projects p on p.id = pa.project_id
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: assumption not found'
      using errcode = 'P0002';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null);

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'caller cannot access this project'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if v_flagged_at is null or v_state <> 'assumed' then
    raise exception 'this assumption has not been flagged by the client'
      using errcode = 'CR050';
  end if;

  select wm.user_id into v_client_id
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.role = 'client'
     and wm.status = 'active'
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
   order by wm.user_id
   limit 1;

  if v_client_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: no active client on this workspace'
      using errcode = 'P0002';
  end if;

  v_title := left(v_text, 200);

  -- F016j: wrap this insert in the same bypass flag every other
  -- legitimate writer of the guarded columns uses, so this function's
  -- exemption from the allow-list guard is explicit rather than
  -- incidental to created_by never equalling auth.uid() here.
  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  insert into public.client_requests (
    project_id, created_by, title, body, kind, scope_verdict, origin_assumption_id
  )
  values (
    v_project_id, v_client_id, v_title, v_note, 'change', 'change_request', p_assumption_id
  )
  returning client_requests.id, client_requests.created_at into v_request_id, v_created_at;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select v_request_id, v_project_id, v_title, v_note, v_created_at;
end;
$function$;

revoke all on function public.raise_change_request_from_assumption_atomic(p_assumption_id uuid) from public;
revoke all on function public.raise_change_request_from_assumption_atomic(p_assumption_id uuid) from anon;
grant execute on function public.raise_change_request_from_assumption_atomic(p_assumption_id uuid) to authenticated;
grant execute on function public.raise_change_request_from_assumption_atomic(p_assumption_id uuid) to service_role;


-- ---------------------------------------------------------------------
-- 3. Team-only predicates (owner/admin/member[/viewer]); never guest/client.
-- ---------------------------------------------------------------------

create or replace function public.is_workspace_team_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member', 'viewer')
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
  );
$$;

create or replace function public.is_workspace_team_writer(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member')
      and not exists (select 1 from public.workspaces w_del where w_del.id = wm.workspace_id and w_del.deleted_at is not null)
  );
$$;

revoke all on function public.is_workspace_team_member(uuid) from public;
revoke all on function public.is_workspace_team_member(uuid) from anon;
grant execute on function public.is_workspace_team_member(uuid) to authenticated;
grant execute on function public.is_workspace_team_member(uuid) to service_role;
revoke all on function public.is_workspace_team_writer(uuid) from public;
revoke all on function public.is_workspace_team_writer(uuid) from anon;
grant execute on function public.is_workspace_team_writer(uuid) to authenticated;
grant execute on function public.is_workspace_team_writer(uuid) to service_role;

-- Staff calendars and PTO are team data.
drop policy if exists calendar_blocks_select_visible on public.calendar_blocks;
create policy calendar_blocks_select_visible on public.calendar_blocks
  for select to authenticated
  using (public.is_workspace_team_member(workspace_id));

drop policy if exists calendar_blocks_insert_visible on public.calendar_blocks;
create policy calendar_blocks_insert_visible on public.calendar_blocks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_workspace_team_member(workspace_id))
    )
  );

drop policy if exists calendar_blocks_update_own on public.calendar_blocks;
create policy calendar_blocks_update_own on public.calendar_blocks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_workspace_team_member(workspace_id))
    )
  );

drop policy if exists time_off_entries_select_active_members on public.time_off_entries;
create policy time_off_entries_select_active_members on public.time_off_entries
  for select to authenticated
  using (public.is_workspace_team_member(workspace_id));

drop policy if exists time_off_entries_insert_own on public.time_off_entries;
create policy time_off_entries_insert_own on public.time_off_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_workspace_team_member(workspace_id)
  );

-- Creating / renaming projects is a team-writer action (createProject and
-- updateProject gate on canTeamWrite in the app).
drop policy if exists projects_insert_active_members on public.projects;
create policy projects_insert_active_members on public.projects
  for insert to authenticated
  with check (public.is_workspace_team_writer(workspace_id));

drop policy if exists projects_update_active_members on public.projects;
create policy projects_update_active_members on public.projects
  for update to authenticated
  using (deleted_at is null and public.is_workspace_team_writer(workspace_id))
  with check (public.is_workspace_team_writer(workspace_id));

-- Workspace-wide channels are created by team members; project channels by
-- anyone who can see the project (unchanged).
drop policy if exists channels_insert_active_members on public.channels;
create policy channels_insert_active_members on public.channels
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_active_workspace_member(workspace_id)
    and (
      (project_id is null and public.is_workspace_team_member(workspace_id))
      or (project_id is not null and public.is_project_visible_to(project_id))
    )
  );

-- Shared-view membership must not leak to clients (saved_views_select
-- already hides workspace-level shared views from them).
drop policy if exists view_tasks_select_visible on public.view_tasks;
create policy view_tasks_select_visible on public.view_tasks
  for select to authenticated
  using (
    exists (
      select 1
      from public.saved_views sv
      where sv.id = view_tasks.view_id
        and (
          sv.owner_id = (select auth.uid())
          or (
            sv.scope = 'shared'
            and (
              (sv.project_id is not null and public.is_project_visible_to(sv.project_id))
              or (sv.project_id is null and public.is_active_workspace_member(sv.workspace_id)
                  and not public.is_workspace_client(sv.workspace_id))
            )
          )
        )
    )
  );

-- ---------------------------------------------------------------------
-- 4. Task child tables: writes need a task writer, not just visibility.
-- ---------------------------------------------------------------------

drop policy if exists task_assignees_insert_visible on public.task_assignees;
create policy task_assignees_insert_visible on public.task_assignees
  for insert to authenticated
  with check (
    public.is_task_visible_to(task_id)
    and exists (select 1 from public.tasks t where t.id = task_assignees.task_id and public.is_project_workspace_writer(t.project_id))
  );

drop policy if exists task_assignees_update_visible on public.task_assignees;
create policy task_assignees_update_visible on public.task_assignees
  for update to authenticated
  using (
    public.is_task_visible_to(task_id)
    and exists (select 1 from public.tasks t where t.id = task_assignees.task_id and public.is_project_workspace_writer(t.project_id))
  )
  with check (
    public.is_task_visible_to(task_id)
    and exists (select 1 from public.tasks t where t.id = task_assignees.task_id and public.is_project_workspace_writer(t.project_id))
  );

drop policy if exists task_assignees_delete_visible on public.task_assignees;
create policy task_assignees_delete_visible on public.task_assignees
  for delete to authenticated
  using (
    public.is_task_visible_to(task_id)
    and exists (select 1 from public.tasks t where t.id = task_assignees.task_id and public.is_project_workspace_writer(t.project_id))
  );

drop policy if exists task_dependencies_insert_active_members on public.task_dependencies;
create policy task_dependencies_insert_active_members on public.task_dependencies
  for insert to authenticated
  with check (
    public.is_task_visible_to(blocking_task_id)
    and public.is_task_visible_to(blocked_task_id)
    and exists (select 1 from public.tasks t where t.id = task_dependencies.blocking_task_id and public.is_project_workspace_writer(t.project_id))
    and exists (select 1 from public.tasks t where t.id = task_dependencies.blocked_task_id and public.is_project_workspace_writer(t.project_id))
  );

drop policy if exists task_dependencies_delete_active_members on public.task_dependencies;
create policy task_dependencies_delete_active_members on public.task_dependencies
  for delete to authenticated
  using (
    public.is_task_visible_to(blocking_task_id)
    and public.is_task_visible_to(blocked_task_id)
    and exists (select 1 from public.tasks t where t.id = task_dependencies.blocking_task_id and public.is_project_workspace_writer(t.project_id))
    and exists (select 1 from public.tasks t where t.id = task_dependencies.blocked_task_id and public.is_project_workspace_writer(t.project_id))
  );

-- ---------------------------------------------------------------------
-- 5. tasks cross-reference guard (session roles only; service_role and
--    SECURITY DEFINER RPCs owned by postgres are not affected).
-- ---------------------------------------------------------------------

create or replace function public.tasks_guard_cross_refs()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: current_user must be the session role for the
-- authenticated/anon check below to mean anything.
set search_path = public, pg_temp
as $$
declare
  v_old_ws uuid;
  v_new_ws uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- A task may only move between projects of the SAME workspace (RLS
  -- with-check already demands write access to the destination project).
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    select workspace_id into v_old_ws from projects where id = old.project_id;
    select workspace_id into v_new_ws from projects where id = new.project_id;
    if v_old_ws is distinct from v_new_ws then
      raise exception 'tasks: a task cannot be moved to a project in another workspace'
        using errcode = '42501';
    end if;
  end if;

  -- Status must belong to the task's own project. (sync_task_status_and_status_id
  -- runs first and already re-resolves a foreign status_id; this is the
  -- backstop.)
  if new.status_id is not null
     and (tg_op = 'INSERT' or new.status_id is distinct from old.status_id or new.project_id is distinct from old.project_id)
     and not exists (
       select 1 from project_statuses ps
       where ps.id = new.status_id and ps.project_id = new.project_id
     ) then
    raise exception 'tasks: status_id does not belong to the task''s project'
      using errcode = '42501';
  end if;

  if new.phase_id is not null
     and (tg_op = 'INSERT' or new.phase_id is distinct from old.phase_id)
     and not exists (
       select 1 from project_phases ph
       where ph.id = new.phase_id and ph.project_id = new.project_id
     ) then
    raise exception 'tasks: phase_id does not belong to the task''s project'
      using errcode = '42501';
  end if;

  -- parent_task_id / same-project is enforced by enforce_task_parent_rules.
  return new;
end;
$$;

revoke all on function public.tasks_guard_cross_refs() from public;
revoke all on function public.tasks_guard_cross_refs() from anon;
grant execute on function public.tasks_guard_cross_refs() to authenticated;
grant execute on function public.tasks_guard_cross_refs() to service_role;

drop trigger if exists zz_tasks_guard_cross_refs on public.tasks;
create trigger zz_tasks_guard_cross_refs
  before insert or update on public.tasks
  for each row execute function public.tasks_guard_cross_refs();

-- ---------------------------------------------------------------------
-- 6. Doc-approval snapshots are uploaded as text/markdown.
-- ---------------------------------------------------------------------

update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'text/markdown')
 where id = 'task-attachments'
   and allowed_mime_types is not null
   and not ('text/markdown' = any (allowed_mime_types));
