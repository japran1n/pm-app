-- F084 (missions/20260903-portal): two defects.
--
-- ---------------------------------------------------------------------
-- Defect 1 -- "Request changes" is byte-identical to "Approve".
--
-- `approve_portal_task_atomic` and `request_portal_task_changes_atomic`
-- (20260906010000, unchanged by 20260925010000_f009b which only touched
-- their shared gate `assert_portal_task_actionable_by_client`) both do
-- nothing but `update tasks set pending_client_approval = false`. Verified
-- by grep: no migration after 20260906010000 replaces either function
-- body. A client rejecting a task is recorded identically to one
-- approving it -- no distinguishable, durable record of the rejection
-- exists at the database layer.
--
-- The sibling surface (`decide_approval_atomic`, hardened by
-- 20260923010000_f011) already gets this right for its own subject (an
-- `approval_requests` row): a `changes_requested` decision creates a
-- follow-up task and writes `approval_request.changes_requested` to
-- `audit_log`. This task-page path has a different subject -- a `tasks`
-- row, not an `approval_requests` row, and per 20260925010000_f009b's own
-- header, retiring the legacy boolean toggle in favour of a real
-- `approval_requests` row is a separate, larger feature this one does not
-- authorise. The equivalent record here is therefore an `audit_log` entry
-- keyed on the task itself -- `write_audit_log_entry` is the existing,
-- already-audited mechanism every other atomic RPC in this schema uses
-- for exactly this purpose (20260916010000, 20260920010000,
-- 20260923010000, 20260929010000, 20261001010000, 20261009010000), and a
-- `tasks` row has no analogue of `approval_requests.resulting_task_id` to
-- set, so a queryable, append-only, un-deletable trail is the closest
-- match to what that column gives the approval-request flow. The
-- client's own note is not threaded through this RPC (it never was --
-- `p_task_id` is its only argument, and `lib/actions/portal-approval.ts`
-- already posts the client's note as a comment on the task, atomically
-- ordered "comment first, then flag" before ever calling this RPC) --
-- this migration adds the missing distinguishing *event* record, not a
-- second, competing copy of the note.
--
-- `approve_portal_task_atomic` gains the mirror-image entry
-- (`task.approved`) for the same reason 20260925010000's own decision RPC
-- logs `approval_request.approved` alongside `approval_request.
-- changes_requested`: one function that logs only its "interesting"
-- branch and not its "boring" one is a drift risk the next worker has to
-- rediscover from scratch, exactly like this defect itself.
-- ---------------------------------------------------------------------

create or replace function public.approve_portal_task_atomic(
  p_task_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_workspace_id uuid;
begin
  select a.project_id into v_project_id
    from public.assert_portal_task_actionable_by_client(p_task_id) a;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = v_project_id;

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  perform public.write_audit_log_entry(
    v_workspace_id,
    'task.approved',
    'task',
    p_task_id,
    jsonb_build_object('project_id', v_project_id)
  );

  return query select p_task_id;
end;
$$;

revoke all on function public.approve_portal_task_atomic(uuid) from public;
grant execute on function public.approve_portal_task_atomic(uuid) to authenticated;

create or replace function public.request_portal_task_changes_atomic(
  p_task_id uuid
)
returns table (task_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_workspace_id uuid;
begin
  select a.project_id into v_project_id
    from public.assert_portal_task_actionable_by_client(p_task_id) a;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = v_project_id;

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  -- Defect 1 fix: the one statement that actually distinguishes this
  -- function from approve_portal_task_atomic above. A future scrutiny
  -- pass (or a test) can now tell the two calls apart from their durable
  -- side effects alone, not merely from which RPC name was invoked.
  perform public.write_audit_log_entry(
    v_workspace_id,
    'task.changes_requested',
    'task',
    p_task_id,
    jsonb_build_object('project_id', v_project_id)
  );

  return query select p_task_id;
end;
$$;

revoke all on function public.request_portal_task_changes_atomic(uuid) from public;
grant execute on function public.request_portal_task_changes_atomic(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Defect 2 -- no portal event ever notifies the team.
--
-- `lib/actions/portal-approval.ts`'s two task-page actions, `lib/actions/
-- client-requests.ts`'s `createClientRequest`, and `lib/actions/
-- portal-deliverables.ts`'s `deliverPortalDeliverable` are wired (this
-- migration's companion TypeScript changes) to call `createNotification`
-- with three kinds this schema has never stored before. Per this
-- feature's own warning (missions/20260903-portal/SUMMARY.md's
-- notifications_kind_check incident, repeated by 20261012010000 and
-- fixed by 20261019010000_f025c): widen from the full, grep-verified
-- union of every kind literal any migration or call site has ever used,
-- never retyped from the migration happened to be open.
--
-- Verified union (grep -n "kind in (\|p_kind =>\|kind:" across
-- supabase/migrations/*.sql and lib/notifications/*.ts,
-- lib/actions/*.ts): mention, comment_reply, task_assigned,
-- task_due_soon, watcher_update (20260823020000); approval_decided
-- (20260916010000); assumption_flagged (20260929010000);
-- budget_threshold_80, budget_threshold_100 (20261012010000). Plus this
-- migration's three new kinds: portal_task_decided,
-- client_request_submitted, client_deliverable_submitted.
-- ---------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update',
    'approval_decided', 'assumption_flagged',
    'budget_threshold_80', 'budget_threshold_100',
    'portal_task_decided', 'client_request_submitted', 'client_deliverable_submitted'
  )
);

comment on constraint notifications_kind_check on public.notifications is
  'F084: widened from 20261019010000_f025c''s nine-kind union to add portal_task_decided (client approves/rejects on the task page), client_request_submitted (client files a client_requests row) and client_deliverable_submitted (client uploads a deliverable) -- the three new fan-out call sites this feature adds in lib/actions/portal-approval.ts, lib/actions/client-requests.ts and lib/actions/portal-deliverables.ts. Union re-derived from every p_kind => / kind in ( call site at the time of writing, not copied from any single prior migration.';
