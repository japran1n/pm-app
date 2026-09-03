-- F013 (missions/20260903-portal, M3 — client obligations): the review
-- RPC (AS-032) and the blocking sweep (AS-030) on top of F012's
-- `client_deliverables` table.
--
-- Every SECURITY DEFINER function this migration adds pins `search_path`
-- to `public, pg_temp` from the start — 20260908010000's lesson, restated
-- every time since: an unqualified `set search_path = public` implicitly
-- searches pg_temp FIRST, and `authenticated` has TEMP privileges by
-- default, so a caller could shadow a table this function reads with a
-- same-named pg_temp table inside the function body without the explicit
-- pin.

-- ---------------------------------------------------------------------
-- 1. accept_deliverable_atomic(p_deliverable_id, p_decision, p_note)
-- ---------------------------------------------------------------------
-- AS-032: a team member accepts a deliverable or returns it with a
-- required comment; AS-030 lives here too — `delivered` is not
-- `accepted`, and only `accepted` stops a deliverable counting against
-- the project (F012's `getOverdueBlockingDeliverableCount` already
-- excludes `accepted`/`waived`, never `delivered`, from its overdue
-- count).
--
-- 'accepted': sets state/accepted_at/accepted_by, writes an audit row.
-- 'returned': sets state back to 'in_progress' (not 'delivered' — the
-- client must re-deliver, this is not merely un-reviewing), stores
-- review_note, writes an audit row. An empty/whitespace note is rejected
-- — "send it again" with no reason is how a client learns to ignore the
-- portal (this feature's own spec, verbatim).
--
-- Authorization: `client_deliverables_update_team`
-- (20260926010000) already restricts UPDATE to
-- `is_project_workspace_writer`, but this function is SECURITY DEFINER
-- and so bypasses RLS as its owner (same as every other atomic RPC in
-- this schema, e.g. decide_approval_atomic) — the actual enforcement
-- point has to be inside the function body, checked explicitly, exactly
-- like decide_approval_atomic's own AS-022 ownership check
-- (20260916010000). `is_project_workspace_writer` already excludes both
-- `viewer` and `client` (20260902010000's own header comment: "client
-- role (`is_project_workspace_writer()` explicitly excludes `client`)"),
-- so this one call satisfies this feature's Definition of done ("a
-- viewer and a client are rejected by every mutation") without a second,
-- hand-rolled role check.
--
-- Audit: via the existing `write_audit_log_entry` RPC (20260821211226),
-- not a direct insert — that table has no INSERT policy for any role by
-- design. Same choice decide_approval_atomic already made for its own
-- decision writes.
create or replace function public.accept_deliverable_atomic(
  p_deliverable_id uuid,
  p_decision text,
  p_note text default null
)
returns table (
  deliverable_id uuid,
  state text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_new_state text;
begin
  if v_user_id is null then
    raise exception 'accept_deliverable_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('accepted', 'returned') then
    raise exception 'accept_deliverable_atomic: invalid decision %', p_decision using errcode = '22023';
  end if;

  if p_decision = 'returned' and (p_note is null or btrim(p_note) = '') then
    raise exception 'accept_deliverable_atomic: a note is required when returning a deliverable' using errcode = '22023';
  end if;

  select cd.project_id, cd.title
    into v_project_id, v_title
    from client_deliverables cd
   where cd.id = p_deliverable_id
     for update of cd;

  if v_project_id is null then
    raise exception 'accept_deliverable_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.is_project_workspace_writer(v_project_id) then
    raise exception 'accept_deliverable_atomic: you do not have permission to review this deliverable' using errcode = '42501';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'accept_deliverable_atomic: project not found' using errcode = 'P0002';
  end if;

  if p_decision = 'accepted' then
    v_new_state := 'accepted';

    update client_deliverables
       set state = 'accepted',
           accepted_at = now(),
           accepted_by = v_user_id,
           review_note = null
     where id = p_deliverable_id;
  else
    v_new_state := 'in_progress';

    -- A returned item goes back to 'in_progress', not 'delivered': the
    -- client has to re-deliver, this is not merely un-reviewing the same
    -- upload. accepted_at/accepted_by/delivered_at are cleared for the
    -- same reason a returned item's history shouldn't still claim an
    -- acceptance or a still-current delivery timestamp that this
    -- decision just superseded.
    update client_deliverables
       set state = 'in_progress',
           delivered_at = null,
           accepted_at = null,
           accepted_by = null,
           review_note = p_note
     where id = p_deliverable_id;
  end if;

  perform public.write_audit_log_entry(
    v_workspace_id,
    case when p_decision = 'accepted' then 'client_deliverable.accepted' else 'client_deliverable.returned' end,
    'client_deliverable',
    p_deliverable_id,
    jsonb_build_object('title', v_title, 'note', p_note)
  );

  return query select p_deliverable_id, v_new_state;
end;
$$;

revoke all on function public.accept_deliverable_atomic(uuid, text, text) from public;
grant execute on function public.accept_deliverable_atomic(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Blocking sweep: overdue blocking deliverables move their linked
--    task into the project's 'blocked'-bucket column.
-- ---------------------------------------------------------------------
-- Follows the pg_cron precedent in
-- 20260823050000_overdue_notification_sweep.sql — same hourly cadence,
-- same "SECURITY DEFINER + explicit grant to postgres/service_role"
-- shape, same reasoning for why a scheduled job attributes its writes to
-- 'system' rather than a human actor.
--
-- Which column is "Blocked"? `project_statuses.client_bucket`
-- (20260911010000) is the one place this schema already expresses "which
-- board column reads as Blocked to the client", via the closed
-- vocabulary `('waiting', 'progress', 'blocked', 'done')` — reused here
-- rather than matching on a column's NAME (a renamed/localised "Blocked"
-- column must still work, and a column literally named "Blocked" whose
-- bucket is something else must not be matched by name alone, same
-- reasoning status-category.ts's isDoneCategory doc comment gives for
-- 'done'). A project with no column tagged `client_bucket = 'blocked'`
-- at all is skipped entirely for that project's deliverables — there is
-- nowhere to move the task, and inventing one here would be a second,
-- silent source of truth for what "Blocked" means, on top of the
-- board-columns settings screen (F004) that is the one place a PM
-- actually picks it.
--
-- Two rules, per this feature's spec, verbatim:
--   - The sweep only ever moves a task INTO the blocked bucket. It never
--     moves one out — a human decides when something is unblocked,
--     because the arrival of a file is not the same as the work being
--     unstuck. There is no branch anywhere in this function that can set
--     status/status_id to anything other than the resolved blocked
--     status.
--   - It is idempotent: a task already sitting in a 'blocked'-bucket
--     column (whether THIS sweep put it there, a human moved it there
--     independently, or an earlier run already did) is excluded by the
--     query's own `t.status_id is distinct from` filter — left alone,
--     no second update, no second task_activity row. This also covers
--     the case where the SAME task has two different overdue blocking
--     deliverables: `distinct on (t.id)` (ordered by the earliest due
--     date, then position, for a deterministic pick) guarantees at most
--     one update and one activity row per task per run, not one per
--     deliverable.
--
-- Audit trail: `write_task_activity_entry` (20260822230000), the
-- per-TASK activity log a PM/client already reads on the task itself —
-- not `audit_log` (workspace-level, owner/admin-only reading, F139),
-- because "why did this task move to Blocked" is exactly the kind of
-- fact `task_activity` exists to answer for a field change, and it is
-- visible to whoever can already see the task (including, per that
-- table's own RLS, a client on a portal-enabled project) rather than
-- being locked to workspace owners/admins the way `audit_log` is.
-- `p_system => true` (the same sanctioned no-human-session path F212's
-- own sweep uses for `create_notification`) writes a null actor_id,
-- rendered as "System" per that table's own doc comment.
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
    join tasks t on t.id = cd.task_id
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
      and t.deleted_at is null
      and p.deleted_at is null
      and t.status_id is distinct from ps_blocked.id
    order by t.id, cd.due_at asc, cd.position asc
  loop
    update tasks
       set status_id = v_row.blocked_status_id,
           status = v_row.blocked_status_name
     where id = v_row.task_id;

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
  'F013 (AS-030): hourly sweep moving a task into its project''s client_bucket = ''blocked'' column when a blocking client_deliverable linked to it is overdue and not yet accepted/waived. Only ever moves a task INTO blocked, never out; idempotent per task (see this migration''s header comment).';

revoke all on function public.sweep_overdue_blocking_deliverables() from public;
grant execute on function public.sweep_overdue_blocking_deliverables() to postgres, service_role;

select cron.schedule(
  'sweep-overdue-blocking-deliverables',
  '0 * * * *',
  $$select public.sweep_overdue_blocking_deliverables();$$
);
