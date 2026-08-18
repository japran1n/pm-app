-- F117: explicit in-RPC workspace membership assertion for
-- start_timer_atomic / stop_timer_atomic (AS-175, AS-176 hardening).
--
-- M9-scrutiny.md flagged that both functions (F111,
-- 20260818153433_create_stop_and_start_timer_rpc.sql) are SECURITY DEFINER
-- but relied entirely on the calling Server Action's requireActiveMembership
-- pre-check for workspace scoping, not on anything inside the RPC body
-- itself. That makes safety contingent on every future caller routing
-- through the guarded Server Action — a direct RPC call (e.g. from a new
-- client-side hook that forgets the check) would run with elevated
-- privileges and bypass workspace isolation entirely.
--
-- Fix: both functions now call public.is_task_workspace_member(target_task_id)
-- (defined in 20260818040214_create_comments.sql; already checks
-- wm.user_id = auth.uid() and wm.status = 'active') as the very first thing
-- they do with a caller-supplied/derived task id, and RAISE EXCEPTION before
-- any read or write if the caller is not an active member of that task's
-- workspace. This makes the RPCs safe to call directly, not just
-- safe-by-convention.
--
-- start_timer_atomic: p_task_id is a direct argument, so the check runs
-- before anything else in the body.
--
-- stop_timer_atomic: there is no task_id argument (it operates on the
-- caller's own active timer, found by auth.uid()). The membership check is
-- therefore performed against v_active.task_id, immediately after the
-- active timer row is found and before any write (delete/insert). If the
-- caller has no active timer, the function still returns its existing
-- "no active timer" empty-result behavior — there is nothing to authorize
-- against.

create or replace function public.stop_timer_atomic()
returns table (
  id uuid,
  task_id uuid,
  user_id uuid,
  minutes integer,
  billable boolean,
  entry_date date,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_active active_timers%rowtype;
  v_minutes integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_active
  from active_timers
  where active_timers.user_id = v_user_id
  limit 1;

  if not found then
    return;
  end if;

  if not public.is_task_workspace_member(v_active.task_id) then
    raise exception 'not an active member of this task''s workspace';
  end if;

  v_minutes := greatest(
    1,
    round(extract(epoch from (now() - v_active.started_at)) / 60.0)
  );

  delete from active_timers where active_timers.id = v_active.id;

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
$$;

revoke all on function public.stop_timer_atomic() from public;
grant execute on function public.stop_timer_atomic() to authenticated;

create or replace function public.start_timer_atomic(p_task_id uuid)
returns table (
  id uuid,
  task_id uuid,
  user_id uuid,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_active active_timers%rowtype;
  v_minutes integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_task_workspace_member(p_task_id) then
    raise exception 'not an active member of this task''s workspace';
  end if;

  select * into v_active
  from active_timers
  where active_timers.user_id = v_user_id
  limit 1;

  if found then
    v_minutes := greatest(
      1,
      round(extract(epoch from (now() - v_active.started_at)) / 60.0)
    );

    delete from active_timers where active_timers.id = v_active.id;

    insert into time_entries (task_id, user_id, minutes, billable, entry_date, note)
    values (v_active.task_id, v_user_id, v_minutes, true, current_date, null);
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
$$;

revoke all on function public.start_timer_atomic(uuid) from public;
grant execute on function public.start_timer_atomic(uuid) to authenticated;
