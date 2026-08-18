-- F111: start_timer_atomic / stop_timer_atomic RPCs (AS-164, AS-165, AS-166,
-- AS-167, AS-168).
--
-- F109's active_timers table has a UNIQUE constraint on user_id, so a
-- caller who already has a running timer cannot simply INSERT a second
-- active_timers row for a different task. Per this feature's Clarified
-- implementation, starting a new timer while one is running must first
-- auto-stop the old one: compute its elapsed minutes, insert a
-- time_entries row for the OLD task, delete the OLD active_timers row,
-- then insert a NEW active_timers row for the requested task.
--
-- That "read started_at, compute minutes, insert time_entries, delete
-- active_timers, insert active_timers" sequence has to be atomic — if the
-- app crashes mid-sequence after the delete but before the new insert (or
-- after the time_entries insert but before the delete), a naive
-- three-round-trip implementation could either lose the old timer's
-- elapsed time or leave the user with zero *or* two active timers. Same
-- rationale as create_workspace_with_owner
-- (20260817234323_workspace_create_rpc.sql): a single SECURITY DEFINER
-- PL/pgSQL function body runs inside one implicit transaction, so any
-- exception rolls back every write the function made, and no other
-- connection observes an intermediate state.
--
-- Both functions run as the calling user (source the caller's id from
-- auth.uid(), never from an argument) so a caller can never stop or start
-- a timer on someone else's behalf. Both are invoked through the
-- publishable-key client carrying the caller's session, not the
-- admin/service client — membership on the target task's workspace is
-- re-checked in application code (requireActiveMembership) before either
-- RPC is called, same defense-in-depth convention as logTimeEntry
-- (F110); the RPC itself additionally re-validates via the active_timers/
-- time_entries RLS-equivalent join (is_task_workspace_member) implicitly
-- through the FK constraints, but the actual gate is the app-level
-- membership re-check plus the fact that a SECURITY DEFINER function only
-- does exactly what its body says, nothing caller-supplied beyond
-- p_task_id.
--
-- Elapsed minutes are computed server-side from the row's own
-- `started_at` against `now()`, never from client input (anti-tampering,
-- AS-168/AS-167) — this is the mechanism, not just app-level trust.
-- Minutes are rounded to the nearest minute with a 1-minute floor, per
-- this feature's Clarified implementation.

-- ---------------------------------------------------------------------------
-- stop_timer_atomic: stop the caller's own active timer (if any), logging
-- it as a completed time_entries row. Returns the created time_entries row,
-- or no rows if the caller had no active timer (the app layer treats an
-- empty result as a clean "no active timer" outcome, not an error).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- start_timer_atomic: start a new active timer for the caller on
-- p_task_id. If the caller already has a running timer (on any task), it
-- is auto-stopped first (logged as a time_entries row) in the same
-- transaction (AS-166), then the new active_timers row is inserted.
-- Returns the new active_timers row.
--
-- Membership/task-existence is expected to already have been re-checked
-- by the caller (application code, requireActiveMembership) before
-- invoking this RPC — the function itself will simply fail the INSERT
-- (FK violation) if p_task_id does not exist, which the app layer
-- translates into a generic error.
-- ---------------------------------------------------------------------------
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
