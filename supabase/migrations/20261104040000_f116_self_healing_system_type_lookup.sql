-- F116 follow-up (same session): a real gap surfaced by running this
-- mission's existing integration-test suite against the migrations
-- above — a large number of this repo's own test fixtures (and,
-- plausibly, any workspace ever created by a path other than
-- `create_workspace_with_owner`) build a `workspaces` row with a
-- straight `admin.from("workspaces").insert(...)`, bypassing the RPC
-- entirely, so they never receive the six-row seed at all. Once
-- `tasks.task_type_id` is NOT NULL (20261104010000), any task creation
-- against such a workspace — including `tasks_default_task_type`'s own
-- fallback and `accept_client_request_atomic`'s specific-key lookup —
-- resolves to a row that doesn't exist and fails outright.
--
-- Fix: `public.ensure_task_type`, a small SECURITY DEFINER helper that
-- looks up a workspace's row for a given system_key and, if none
-- exists, creates it on the spot with this feature's own seed values.
-- Both call sites below use it instead of a plain SELECT, so a
-- workspace that was never seeded (however that happened) is repaired
-- lazily on first use rather than failing. Idempotent via the same
-- partial unique index (`task_types_workspace_id_system_key_idx`,
-- 20260912010000) the seed itself relies on: a concurrent double-create
-- races into an `on conflict ... do nothing`, then re-selects.
create or replace function public.ensure_task_type(
  p_workspace_id uuid,
  p_system_key text,
  p_name text,
  p_color text,
  p_is_billable boolean,
  p_default_client_visible boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.task_types
   where workspace_id = p_workspace_id
     and system_key = p_system_key;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.task_types (workspace_id, name, color, system_key, is_billable, default_client_visible)
  values (p_workspace_id, p_name, p_color, p_system_key, p_is_billable, p_default_client_visible)
  on conflict (workspace_id, system_key) where system_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from public.task_types
     where workspace_id = p_workspace_id
       and system_key = p_system_key;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ensure_task_type(uuid, text, text, text, boolean, boolean) from public;

-- tasks_default_task_type: use ensure_task_type instead of a plain
-- SELECT, so a workspace with no seeded 'delivery' row still gets a
-- valid task_type_id rather than failing the NOT NULL constraint.
create or replace function public.tasks_default_task_type()
returns trigger
language plpgsql
as $$
declare
  v_workspace_id uuid;
begin
  if NEW.task_type_id is not null then
    return NEW;
  end if;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = NEW.project_id;

  if v_workspace_id is null then
    return NEW;
  end if;

  NEW.task_type_id := public.ensure_task_type(
    v_workspace_id, 'delivery', 'Delivery', '#6b7280', true, false
  );
  return NEW;
end;
$$;

-- accept_client_request_atomic: same ensure_task_type call in place of
-- the plain SELECT, for the same reason — recreated in full from
-- 20261104010000's version, unchanged apart from that one lookup.
create or replace function public.accept_client_request_atomic(
  p_request_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
     and wm.status = 'active';

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if v_caller_role = 'client' then
    raise exception 'a client cannot accept their own request'
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
$$;

revoke all on function public.accept_client_request_atomic(uuid) from public;
grant execute on function public.accept_client_request_atomic(uuid) to authenticated;
