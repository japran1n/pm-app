-- F302 follow-up (D1/FU-2, AS-357): close a live activity-entry forgery
-- hole in public.write_task_activity_entry() -- the same class of bug
-- already fixed today in public.create_notification() (see
-- 20260823030000_fix_create_notification_spoofing.sql).
--
-- The original F194 migration (20260822230000_create_task_activity.sql)
-- granted EXECUTE on write_task_activity_entry() to `authenticated` and
-- accepted a CALLER-SUPPLIED `p_system boolean`. When p_system = true,
-- the function skipped BOTH the auth.uid() is not null check AND the
-- is_task_visible_to(p_task_id) check -- the only remaining check was
-- that the task exists. That means any authenticated app user could call
-- this RPC directly (e.g. a raw fetch to the Supabase REST RPC endpoint,
-- bypassing the app UI) with p_system => true to inject arbitrary
-- system-attributed activity rows onto ANY task in ANY workspace,
-- including tasks they cannot see -- a forgery/injection vector into the
-- append-only audit trail AS-357 promises is immutable.
--
-- Fix, mirroring create_notification's p_system pattern: p_system's
-- exemption from the actor/visibility checks now only applies when the
-- caller has NO real user session at all (auth.uid() is null) -- i.e. a
-- genuine service-role/cron/backend caller (the recurrence job in
-- lib/recurrence/generate-next-occurrence.ts, which always calls this
-- RPC through a service-role admin client with no user JWT, so
-- auth.uid() is already null there today; this fix does not change its
-- behavior at all). An `authenticated`-role client-side call always
-- carries a real auth.uid(), so simply passing p_system => true can no
-- longer bypass anything for such a caller -- it falls through to the
-- normal branch, which requires auth.uid() is not null AND
-- is_task_visible_to(p_task_id), exactly like a non-system call.
--
-- Signature is unchanged (same parameters, same defaults) -- only the
-- internal branching logic changes -- so `create or replace function` is
-- sufficient here; no `drop function` is needed (contrast with the
-- create_notification fix, which added a new trailing parameter).
create or replace function public.write_task_activity_entry(
  p_task_id uuid,
  p_kind text,
  p_field text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_system boolean default false
)
returns public.task_activity
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.task_activity;
  v_actor uuid;
begin
  -- A system-generated entry is only exempt from the actor/visibility
  -- checks when the caller genuinely has no user session at all (a real
  -- service-role/cron/backend caller, e.g. the recurrence job). A caller
  -- claiming p_system => true while holding a real auth.uid() (any
  -- `authenticated`-role client session) is NOT exempt -- it falls
  -- through to the same checks as a normal, human-attributed write, so
  -- passing p_system => true can no longer be used to forge a
  -- system-attributed entry or to bypass task visibility.
  if p_system and auth.uid() is null then
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'task_activity: no authenticated actor';
    end if;
    if not public.is_task_visible_to(p_task_id) then
      raise exception 'task_activity: caller cannot see this task';
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
$$;

-- Grants are unchanged from the original migration (same signature),
-- but re-asserted here for clarity/defense-in-depth after the replace.
revoke all on function public.write_task_activity_entry(uuid, text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.write_task_activity_entry(uuid, text, text, jsonb, jsonb, boolean) to authenticated, service_role;
