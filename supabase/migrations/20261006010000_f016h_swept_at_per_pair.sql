-- F016h (missions/20260903-portal, M3 remediation): F016e's `swept_at`
-- fix traded an hourly-nag defect (round 1) for permanent suppression
-- (round 2, B3/AS-030). Two bugs, same column:
--
--   B3a — nothing ever reset `swept_at`. Once set, a deliverable never
--   blocks again even after its due date moves into the future and back
--   into the past, or after it is accepted and a fresh due date is set
--   on a replacement obligation.
--
--   B3b — the sweep's second UPDATE stamped EVERY overdue blocking
--   deliverable on the swept task, not just the one `distinct on (t.id)`
--   picked as the cause. Two overdue deliverables D1/D2 on task T: the
--   sweep blocks T citing D1, and stamps D1 *and* D2. D1 is accepted, a
--   human unblocks T. D2 is still overdue and blocking — and the sweep
--   will never re-block T for D2, because D2 was stamped for something
--   it didn't cause.
--
-- Fix, per this feature's clarified scope:
--   1. Stamp only the deliverable the loop iteration actually chose
--      (`v_row.deliverable_id`), not every overdue row on the task.
--   2. Clear `swept_at` via a trigger whenever the row is accepted (or
--      waived) or its `due_at` changes — from ANY writer (the review
--      RPC, `updateDeliverable`, a future writer), not just the ones
--      known today. This keeps the "cleared on acceptance / due-date
--      change" contract enforced at the one place all writes pass
--      through, rather than duplicated into every RPC and action that
--      touches the row.

-- ---------------------------------------------------------------------
-- 1. Trigger: clear swept_at on acceptance/waiver or on a due_at change.
-- ---------------------------------------------------------------------
-- Not a SECURITY DEFINER function and not directly callable — Postgres
-- invokes trigger functions as part of the statement that fires them,
-- not via a role-checked RPC call, so this needs no EXECUTE grant of
-- its own (same as `enforce_client_requests_triage_columns_immutable_
-- by_author`, 20261005010000, which also has none).
create or replace function public.clear_client_deliverable_swept_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.swept_at is not null and (
    new.due_at is distinct from old.due_at
    or (new.state in ('accepted', 'waived') and old.state not in ('accepted', 'waived'))
  ) then
    new.swept_at := null;
  end if;
  return new;
end;
$$;

comment on function public.clear_client_deliverable_swept_at() is
  'F016h (AS-030): resets client_deliverables.swept_at whenever the row is accepted/waived or its due_at changes, so a deliverable that legitimately becomes overdue again -- a new due date that is missed, or a re-opened obligation -- can re-trigger sweep_overdue_blocking_deliverables. Fires on every writer (accept_deliverable_atomic, updateDeliverable, any future one) because it lives on the table, not duplicated per-caller.';

drop trigger if exists client_deliverables_clear_swept_at on public.client_deliverables;
create trigger client_deliverables_clear_swept_at
  before update on public.client_deliverables
  for each row
  execute function public.clear_client_deliverable_swept_at();

-- ---------------------------------------------------------------------
-- 2. Sweep: stamp only the deliverable the loop actually acted on.
-- ---------------------------------------------------------------------
create or replace function public.sweep_overdue_blocking_deliverables()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_blocked_count integer := 0;
begin
  for v_row in
    select distinct on (t.id)
      t.id as task_id,
      cd.id as deliverable_id,
      cd.title as deliverable_title,
      t.status as previous_status,
      ps_blocked.id as blocked_status_id,
      ps_blocked.name as blocked_status_name
    from client_deliverables cd
    join tasks t on t.id = cd.task_id and t.project_id = cd.project_id
    join projects p on p.id = cd.project_id
    join lateral (
      select ps.id, ps.name
      from project_statuses ps
      where ps.project_id = cd.project_id
        and ps.client_bucket = 'blocked'
      order by ps.position asc
      limit 1
    ) ps_blocked on true
    where cd.blocking
      and cd.state not in ('accepted', 'waived')
      and cd.due_at is not null
      and cd.due_at < (now() at time zone 'utc')::date
      and cd.swept_at is null
      and t.deleted_at is null
      and p.deleted_at is null
      and t.status_id is distinct from ps_blocked.id
    order by t.id, cd.due_at asc, cd.position asc
  loop
    update tasks
       set status_id = v_row.blocked_status_id,
           status = v_row.blocked_status_name
     where id = v_row.task_id;

    -- Per-pair, not per-task: only the deliverable this iteration chose
    -- as the cause is stamped. A second overdue deliverable on the same
    -- task that this run did NOT cite (because the task was already
    -- moving into Blocked for the first one) stays unstamped, and can
    -- independently cause a future sweep after this one is accepted and
    -- a human unblocks the task.
    update client_deliverables
       set swept_at = now()
     where id = v_row.deliverable_id;

    perform public.write_task_activity_entry(
      p_task_id => v_row.task_id,
      p_kind => 'field_changed',
      p_field => 'status',
      p_old_value => to_jsonb(v_row.previous_status),
      p_new_value => jsonb_build_object(
        'status', v_row.blocked_status_name,
        'reason', 'client_deliverable_overdue',
        'deliverable_id', v_row.deliverable_id,
        'deliverable_title', v_row.deliverable_title
      ),
      p_system => true
    );

    v_blocked_count := v_blocked_count + 1;
  end loop;

  return v_blocked_count;
end;
$$;

comment on function public.sweep_overdue_blocking_deliverables() is
  'F013/F016c/F016e/F016f/F016h (AS-030): hourly sweep moving a task into its project''s client_bucket = ''blocked'' column when a blocking client_deliverable linked to it is overdue and not yet accepted/waived. Only ever moves a task INTO blocked, never out; idempotent per task within a run, and per DELIVERABLE-TASK PAIR across runs via swept_at -- only the deliverable a run actually cited is stamped (F016h; F016e/F016f stamped every overdue deliverable on the task), and client_deliverables_clear_swept_at (F016h) resets the stamp on acceptance/waiver or a due_at change so a legitimately re-missed obligation can block again. Join is same-project only (t.project_id = cd.project_id, F016c), on top of the composite FK that enforces this at write time.';

-- This CREATE OR REPLACE does not change the function's signature or
-- SECURITY DEFINER-ness, so its existing grants (postgres, service_role
-- only, per F016g's audit and F016f's own note) are untouched.
