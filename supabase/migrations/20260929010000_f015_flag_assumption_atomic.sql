-- F015 (missions/20260903-portal, M3 — scope, decisions, assumptions,
-- both sides): the one write path a portal client has anywhere on the
-- three tables F012 built. "Not correct" on an unconfirmed assumption
-- calls this RPC — it never touches `state` (invalidating an assumption
-- is the team's call, after they read the client's note, per this
-- feature's own spec), only `flagged_by_client_at`/`flagged_note`
-- (columns F012's own migration already reserved exactly for this).
--
-- Shape mirrors `mark_deliverable_delivered_atomic` (20260928010000) and
-- `accept_client_request_atomic` (20260921010000): SECURITY DEFINER,
-- `search_path` pinned to `public, pg_temp` (20260908010000's lesson),
-- re-select the caller's real membership from workspace_members (this
-- function bypasses RLS as its owner, so nothing else enforces this),
-- row lock via `for update`, `is_project_visible_to` +
-- `is_project_portal_enabled` gates.
--
-- Unlike `mark_deliverable_delivered_atomic` (any active project member,
-- team included), this one is deliberately narrower — "callable only by
-- a client of that project" is this feature's own explicit spec line —
-- because flagging is a client-only signal into the team's process; a
-- team member who disagrees with their own assumption edits the row
-- directly in the Record panel (F015's team-side UPDATE path, gated on
-- `is_project_workspace_writer` same as every other write on this
-- table), they don't need a second, client-shaped path to the same
-- columns.
create or replace function public.flag_assumption_atomic(
  p_assumption_id uuid,
  p_note text
)
returns table (assumption_id uuid, flagged_by_client_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_state text;
  v_flagged_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'flag_assumption_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'flag_assumption_atomic: a note is required' using errcode = '22023';
  end if;

  select pa.project_id, pa.text, pa.state
    into v_project_id, v_text, v_state
    from project_assumptions pa
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  if not public.is_project_client(v_project_id) then
    raise exception 'flag_assumption_atomic: only a client of this project may flag an assumption' using errcode = '42501';
  end if;

  if not public.is_project_visible_to(v_project_id) then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  if not public.is_project_portal_enabled(v_project_id) then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'flag_assumption_atomic: project not found' using errcode = 'P0002';
  end if;

  -- Deliberately does NOT touch `state` — see this migration's own header
  -- comment. Re-flagging (already flagged, still unconfirmed) just
  -- overwrites the note/timestamp with the client's latest word; there is
  -- no separate "already flagged" error, since the client re-explaining
  -- themselves is not a failure case.
  update project_assumptions
     set flagged_by_client_at = v_flagged_at,
         flagged_note = p_note
   where id = p_assumption_id;

  perform public.write_audit_log_entry(
    v_workspace_id,
    'project_assumption.flagged_by_client',
    'project_assumption',
    p_assumption_id,
    jsonb_build_object('project_id', v_project_id, 'note', p_note)
  );

  -- Team notification: every active, non-viewer, non-client member of
  -- this project's workspace — there is no single "owner" of an
  -- assumption the way `decide_approval_atomic` has a single
  -- `requested_by` to notify, so this reaches the whole team the same
  -- way the spec's own "audit row and team notification" (plural
  -- "team") reads, rather than guessing at one recipient.
  perform public.create_notification(
    p_user_id => wm.user_id,
    p_workspace_id => v_workspace_id,
    p_kind => 'assumption_flagged',
    p_actor_id => v_user_id,
    p_task_id => null,
    p_comment_id => null,
    p_payload => jsonb_build_object(
      'assumption_id', p_assumption_id,
      'project_id', v_project_id,
      'text', v_text,
      'note', p_note
    )
  )
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.status = 'active'
    and wm.role not in ('viewer', 'client');

  return query select p_assumption_id, v_flagged_at;
end;
$$;

revoke all on function public.flag_assumption_atomic(uuid, text) from public;
grant execute on function public.flag_assumption_atomic(uuid, text) to authenticated;

-- `notifications_kind_check` (20260823020000, last widened by
-- 20260916010000 for 'approval_decided') is a closed list; this is a
-- new kind of notification this schema has never produced before.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon',
    'watcher_update', 'approval_decided', 'assumption_flagged'
  )
);
