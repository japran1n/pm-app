-- F116 (missions/20260903-portal, AS-056..AS-063): fills the task_types
-- mechanism (20260903040000) with the taxonomy the business actually
-- needs -- six system-keyed rows, one axis ("nature of the work"), so
-- time_entries/estimate_minutes can finally answer "how much of a
-- project went into fixing our own mistakes." See docs/task-types.md for
-- the full table and separation rules this migration seeds.
--
-- Per this feature's own warning, every object touched here is
-- re-created from its CURRENT definition, read out of the source
-- immediately before writing this file, not from memory:
--   - task_types_system_key_check: 20260912010000, currently
--     `system_key is null or system_key in ('page', 'qa', 'component',
--     'content', 'seo')`. Widened below to ALSO allow 'delivery',
--     'client_request', 'change_request', 'improvement' -- 'component',
--     'content', 'seo' are kept verbatim (existing rows survive; they
--     are a different, unrelated axis and are never seeded).
--   - create_workspace_with_owner: last redefined by 20260912010000,
--     currently inserts exactly one row (the 'page' type). Recreated
--     below with the same shape (auth check, workspace insert, owner
--     membership insert, `set search_path = public, pg_temp`,
--     `security definer`) plus five more seed inserts.
--   - accept_client_request_atomic: last redefined by
--     20261001010000_f016d_one_client_gate.sql. Recreated below with its
--     full body unchanged except the task insert, which now also sets
--     task_type_id.

-- ---------------------------------------------------------------------
-- 1. New columns.
-- ---------------------------------------------------------------------

alter table task_types
  add column if not exists is_billable boolean not null default true;

alter table task_types
  add column if not exists default_client_visible boolean not null default false;

comment on column task_types.is_billable is
  'F116: whether time logged against this type is normally billable. Fixed (not workspace-editable) for a system-keyed row -- see task_types_lock_system_flags below. Orthogonal to time_entries.billable, which stays the per-entry override.';
comment on column task_types.default_client_visible is
  'F116: read ONLY at task INSERT, to seed that task''s own tasks.client_visible initial value. Never read anywhere else -- tasks.client_visible remains the single, sole gate on portal exposure (AS-061). Do not add a read path here.';

-- ---------------------------------------------------------------------
-- 2. Widen the system_key check constraint (current definition read
-- from 20260912010000_task_type_system_key.sql immediately above).
-- ---------------------------------------------------------------------

alter table task_types drop constraint if exists task_types_system_key_check;
alter table task_types add constraint task_types_system_key_check
  check (
    system_key is null
    or system_key in (
      'page', 'qa', 'component', 'content', 'seo',
      'delivery', 'client_request', 'change_request', 'improvement'
    )
  );

-- ---------------------------------------------------------------------
-- 3. Lock system flags (AS-059): a system-keyed row's `is_billable` and
-- `system_key` itself can never be changed by a workspace write, even
-- though task_types_write_admins otherwise lets an owner/admin update
-- any column on any of their workspace's types. Enforced as a trigger
-- (not a `with check` on the RLS policy) because the invariant depends
-- on OLD.system_key, which a `with check` on an UPDATE policy cannot see
-- -- `with check` only evaluates the NEW row.
-- ---------------------------------------------------------------------

-- 'page' is deliberately exempt from the system_key half of this lock:
-- F006c (20260912010000/20260915010000) already built and tested a
-- dedicated admin affordance (updateTaskType's `systemKey` field,
-- lib/actions/task-types.ts) for a team to tag or re-tag which of their
-- OWN workspace types plays the portal's "page" role, precisely because
-- a workspace names its own types and F116 does not get to relitigate
-- that. AS-059 itself only requires the BILLABLE flag be fixed ("Each
-- system task type carries a fixed billable flag..."); is_billable is
-- therefore locked on every system-keyed row including 'page' (a page
-- task genuinely is always billable, per this feature's own table), but
-- system_key reassignment is only locked for the five NEW keys this
-- feature introduces (delivery/qa/client_request/change_request/
-- improvement), whose stability accept_client_request_atomic and
-- rpc_project_time_totals now depend on by-key.
create or replace function public.task_types_lock_system_flags()
returns trigger
language plpgsql
as $$
begin
  if OLD.system_key is not null then
    if NEW.is_billable is distinct from OLD.is_billable then
      raise exception 'task_types: is_billable is fixed on a system task type'
        using errcode = '42501';
    end if;
    if OLD.system_key <> 'page' and NEW.system_key is distinct from OLD.system_key then
      raise exception 'task_types: system_key is fixed on this system task type'
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists task_types_lock_system_flags_trigger on task_types;
create trigger task_types_lock_system_flags_trigger
  before update on task_types
  for each row
  execute function public.task_types_lock_system_flags();

-- ---------------------------------------------------------------------
-- 4. Default a task's type at insert (AS-057, AS-058): every insert
-- path into `tasks` (app code, RPCs, templates, recurrence generation)
-- is a lot of surface to audit and keep in sync by hand. A single
-- BEFORE INSERT trigger is the one place that can guarantee "no live
-- task is ever left without a type" regardless of which path created
-- it, without editing every insert site individually. A caller that
-- already supplies task_type_id (accept_client_request_atomic,
-- raise_change_request_from_assumption_atomic's own sibling, the create
-- form) is left untouched -- this only fires when task_type_id is null.
-- ---------------------------------------------------------------------

create or replace function public.tasks_default_task_type()
returns trigger
language plpgsql
as $$
declare
  v_workspace_id uuid;
  v_delivery_id uuid;
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

  select id into v_delivery_id
    from public.task_types
   where workspace_id = v_workspace_id
     and system_key = 'delivery';

  NEW.task_type_id := v_delivery_id;
  return NEW;
end;
$$;

drop trigger if exists tasks_default_task_type_trigger on tasks;
create trigger tasks_default_task_type_trigger
  before insert on tasks
  for each row
  execute function public.tasks_default_task_type();

-- ---------------------------------------------------------------------
-- 5. Seed the six system types on new workspaces.
--
-- create_workspace_with_owner recreated in full (CREATE OR REPLACE
-- replaces the whole body) -- carries forward 20260912010000's page
-- seed, `pg_temp` search_path pin, and auth/insert shape unchanged, adds
-- five more seed inserts.
-- ---------------------------------------------------------------------

create or replace function public.create_workspace_with_owner(
  p_name text,
  p_slug text
)
returns table (id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into workspaces (name, slug)
  values (p_name, p_slug)
  returning workspaces.id into v_workspace_id;

  insert into workspace_members (workspace_id, user_id, role, status)
  values (v_workspace_id, v_user_id, 'owner', 'active');

  insert into task_types (workspace_id, name, color, position, system_key, is_billable, default_client_visible)
  values
    (v_workspace_id, 'Page', '#3670e1', 0, 'page', true, true),
    (v_workspace_id, 'Delivery', '#6b7280', 1000, 'delivery', true, false),
    (v_workspace_id, 'QA issue', '#ef4444', 2000, 'qa', false, false),
    (v_workspace_id, 'Client request', '#f59e0b', 3000, 'client_request', true, true),
    (v_workspace_id, 'Change request', '#8b5cf6', 4000, 'change_request', true, true),
    (v_workspace_id, 'Improvement', '#10b981', 5000, 'improvement', false, false)
  on conflict (workspace_id, system_key) where system_key is not null do nothing;

  return query select v_workspace_id, p_slug;
end;
$$;

revoke all on function public.create_workspace_with_owner(text, text) from public;
grant execute on function public.create_workspace_with_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Backfill existing workspaces with the five new rows (create_
-- workspace_with_owner does not run retroactively). `page` is left
-- alone here -- every workspace already has it, seeded by 20260912010000
-- or backfilled by its own migration.
-- ---------------------------------------------------------------------

insert into task_types (workspace_id, name, color, position, system_key, is_billable, default_client_visible)
select w.id, v.name, v.color, v.position, v.system_key, v.is_billable, v.default_client_visible
from workspaces w
cross join (
  values
    ('Delivery', '#6b7280', 1000::double precision, 'delivery', true, false),
    ('QA issue', '#ef4444', 2000::double precision, 'qa', false, false),
    ('Client request', '#f59e0b', 3000::double precision, 'client_request', true, true),
    ('Change request', '#8b5cf6', 4000::double precision, 'change_request', true, true),
    ('Improvement', '#10b981', 5000::double precision, 'improvement', false, false)
) as v(name, color, position, system_key, is_billable, default_client_visible)
on conflict (workspace_id, system_key) where system_key is not null do nothing;

-- ---------------------------------------------------------------------
-- 7. Backfill existing live tasks with a null task_type_id (AS-057):
-- each gets ITS OWN workspace's 'delivery' row. Tasks already carrying
-- `page` (or any other type) are untouched -- this only targets NULL.
-- Soft-deleted tasks are included too: leaving a deleted row typeless
-- forever, only to have the trigger above silently give a *restored*
-- copy of it a type later, would be a worse inconsistency than typing
-- it now.
-- ---------------------------------------------------------------------

update tasks t
set task_type_id = d.id
from projects p
join task_types d
  on d.workspace_id = p.workspace_id
 and d.system_key = 'delivery'
where t.project_id = p.id
  and t.task_type_id is null;

-- ---------------------------------------------------------------------
-- 8. Type becomes required (AS-058). The trigger above (step 4) plus
-- the backfill above (step 7) make every row satisfy this already; NOT
-- NULL is added so the database is the last line of enforcement, not
-- only the trigger + application layer.
-- ---------------------------------------------------------------------

alter table tasks alter column task_type_id set not null;

-- Now that task_type_id is required, `on delete set null` (its original
-- FK action, 20260903040000) can no longer be honoured -- setting it
-- null on delete would itself violate the NOT NULL constraint just
-- added. Changed to `on delete restrict`: deleting a task type still in
-- use on any task is now rejected outright (a team must re-type those
-- tasks first), rather than silently leaving a task typeless.
-- lib/actions/task-types.ts's deleteTaskType turns the resulting 23503
-- into a friendly message, same pattern its 23505 branch already uses.
alter table tasks drop constraint if exists tasks_task_type_id_fkey;
alter table tasks add constraint tasks_task_type_id_fkey
  foreign key (task_type_id) references task_types (id) on delete restrict;

-- ---------------------------------------------------------------------
-- 9. accept_client_request_atomic now types the task it creates
-- (AS-063): 'client_request' when the request's own scope_verdict is
-- NOT 'change_request' (the common, in-scope-or-unreviewed case), or
-- 'change_request' when it is -- resolved by workspace + system_key,
-- never by name, per this feature's own instruction. Recreated in full
-- from 20261001010000_f016d_one_client_gate.sql's current body, which
-- is unchanged here except the `insert into tasks` statement.
-- ---------------------------------------------------------------------

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
  v_task_type_key := case when v_scope_verdict = 'change_request' then 'change_request' else 'client_request' end;

  select id into v_task_type_id
    from public.task_types
   where workspace_id = v_workspace_id
     and system_key = v_task_type_key;

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

-- ---------------------------------------------------------------------
-- 10. rpc_project_time_totals (AS-062): tracked and estimated minutes,
-- grouped by task type, for a project. Read-only, SECURITY DEFINER only
-- to re-derive access the same way every other project-scoped RPC in
-- this schema does (active workspace member + project-visible), never
-- to bypass anything. One row of numbers, no charts.
-- ---------------------------------------------------------------------

create or replace function public.rpc_project_time_totals(
  p_project_id uuid
)
returns table (
  task_type_id uuid,
  task_type_name text,
  system_key text,
  is_billable boolean,
  tracked_minutes bigint,
  estimated_minutes bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_visibility text;
  v_caller_role text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select p.workspace_id, p.visibility into v_workspace_id, v_visibility
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if v_workspace_id is null then
    raise exception 'project not found';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  if v_caller_role is null then
    raise exception 'not a member of this workspace'
      using errcode = '42501';
  end if;

  if v_visibility <> 'workspace'
     and v_caller_role not in ('owner', 'admin')
     and not exists (
       select 1 from public.project_members pm
       where pm.project_id = p_project_id and pm.user_id = v_user_id
     ) then
    raise exception 'you do not have access to this project'
      using errcode = '42501';
  end if;

  return query
    select
      tt.id,
      tt.name,
      tt.system_key,
      tt.is_billable,
      coalesce(sum(te.minutes), 0)::bigint as tracked_minutes,
      coalesce(sum(t.estimate_minutes), 0)::bigint as estimated_minutes
    from public.task_types tt
    left join public.tasks t
      on t.task_type_id = tt.id
     and t.project_id = p_project_id
     and t.deleted_at is null
    left join public.time_entries te
      on te.task_id = t.id
    where tt.workspace_id = v_workspace_id
    group by tt.id, tt.name, tt.system_key, tt.is_billable
    having coalesce(sum(te.minutes), 0) > 0 or coalesce(sum(t.estimate_minutes), 0) > 0
       or exists (
         select 1 from public.tasks t2
         where t2.task_type_id = tt.id and t2.project_id = p_project_id and t2.deleted_at is null
       )
    order by tt.position;
end;
$$;

revoke all on function public.rpc_project_time_totals(uuid) from public;
grant execute on function public.rpc_project_time_totals(uuid) to authenticated;
