-- F009d (missions/20260903-portal, M2 non-blocking follow-up, item FN):
-- the legacy portal Approve control ("This is waiting on your review.",
-- `components/portal/approval-actions.tsx`, wired through
-- `approve_portal_task_atomic`/`request_portal_task_changes_atomic` via
-- `assert_portal_task_actionable_by_client`) tells a client whose project
-- has no decision owner configured the exact same "Something went wrong.
-- Please try again in a moment." it would show for a genuine crash. The
-- authorisation refusal itself is correct (F009b, 20260925010000, closed
-- this exact "owns nothing" hole); only the message is wrong.
--
-- Root cause, in two layers:
--   1. `assert_portal_task_actionable_by_client` (20260925010000:371-379)
--      raises the literal string `'task not found'` for EVERY rejection
--      branch — deleted task, non-member, portal-invisible, portal-off,
--      not-pending, AND "owns no decision type" — by deliberate design
--      (that migration's own header: "'portal off', 'not pending' and
--      'owns nothing' all remain indistinguishable to the caller"), so a
--      caller who can already SEE the pending Approve button (meaning the
--      task is client_visible, pending, and portal is on — the only
--      remaining branch left to fail is decision-ownership) still gets a
--      message written for a caller who might be probing a task they
--      cannot see at all.
--   2. `lib/actions/portal-approval.ts`'s `approvePortalTask` /
--      `requestPortalTaskChanges` then discard even that RPC error text
--      and hard-code "Something went wrong" for ANY error the RPC
--      returns (`if (updateError) { ... error: "Something went wrong...
--      "}`), unlike `decideApproval` (F009, same file, further down) for
--      the Approvals-view surface, which forwards the RPC's own
--      caller-safe message via `friendlyDecideApprovalError` — so the two
--      surfaces disagree on a refusal even where the underlying RPCs
--      could agree.
--
-- Fix, minimal and scoped to the one branch that is safe to name: split
-- the "owns no decision type" branch out of the shared "task not found"
-- oracle with its own message, WITHOUT touching the other four branches
-- (deleted/non-member, invisible-or-portal-off (F016d's own client_gate
-- consolidation), not-pending stay merged under "task not found" exactly
-- as F009b left them — revealing THOSE would
-- tell a caller whether a task/project exists or is visible to them at
-- all, which is the actual thing that oracle protects). The "owns
-- nothing" branch is different: by the time execution reaches it, the
-- caller has already proven active client membership, project
-- visibility, portal-enabled, and the task's own pending+visible state —
-- everything the earlier branches protect is already known to be true
-- from the button being on screen at all. Naming this one branch reveals
-- nothing the client's own UI didn't already show them.
--
-- Wording matches the Approvals view's own honest text for the identical
-- situation, `components/portal/approval-card.tsx`'s
-- `"No one is assigned to decide this yet."` (rendered there when
-- `!isOwner && !ownerName`) — so a client sees the same sentence whether
-- they hit this from the task page's legacy toggle or the dedicated
-- Approvals view.
-- ---------------------------------------------------------------------

-- Recreated in full from 20261001010000 (F016d)'s version -- the actual
-- current body (confirmed by grep: F016d's CREATE OR REPLACE is the last
-- one before this migration; F009b's own version, quoted in this
-- migration's header above for its comment history, was already
-- superseded by F016d's client_gate consolidation before this feature
-- was picked up). Only the final branch changes.
create or replace function public.assert_portal_task_actionable_by_client(
  p_task_id uuid
)
returns table (task_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_client_visible boolean;
  v_pending boolean;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select t.project_id, p.workspace_id, t.client_visible, t.pending_client_approval, t.deleted_at
    into v_project_id, v_workspace_id, v_client_visible, v_pending, v_deleted_at
    from tasks t
    join projects p on p.id = t.project_id
   where t.id = p_task_id
     for update of t;

  if v_project_id is null or v_deleted_at is not null then
    raise exception 'task not found';
  end if;

  if not exists (
    select 1
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = v_user_id
       and wm.status = 'active'
       and wm.role = 'client'
  ) then
    raise exception 'task not found';
  end if;

  -- F016d: visibility, portal_enabled and client_visible, one call.
  if not public.client_gate(v_project_id, v_client_visible, p_require_client_role => false) then
    raise exception 'task not found';
  end if;

  if not v_pending then
    raise exception 'task not found';
  end if;

  -- F009b (M2 remediation, B2): AS-022's actual bug -- a client who owns
  -- no decision type on this project succeeded here while the Approvals
  -- view correctly refused the same caller with 42501. Closed by the
  -- same predicate `decide_approval_atomic` uses, applied with
  -- `p_decision_type := null` ("owns at least one decision type"),
  -- since the legacy toggle this function guards carries no decision
  -- type of its own.
  --
  -- F009d: this is the one branch, of the five in this function, where
  -- naming the refusal is safe -- see this migration's own header. Every
  -- earlier branch still raises the shared 'task not found' oracle,
  -- unchanged.
  if not public.is_project_decision_owner(v_project_id, null, v_user_id) then
    raise exception 'assert_portal_task_actionable_by_client: no one is assigned to decide this yet'
      using errcode = '42501';
  end if;

  return query select p_task_id, v_project_id;
end;
$$;

revoke all on function public.assert_portal_task_actionable_by_client(uuid) from public;

comment on function public.assert_portal_task_actionable_by_client(uuid) is
  'F009b/F016d/F009d: the shared gate for approve_portal_task_atomic and request_portal_task_changes_atomic. Deleted/non-member/invisible/portal-off/not-pending all still raise the shared ''task not found'' oracle (F009b, deliberately indistinguishable). F009d split out the fifth branch, "caller owns no decision type on this project", into its own named message -- by the time that check runs, the caller has already proven every fact the oracle protects, so naming this refusal leaks nothing new, and its wording now matches approval-card.tsx''s own "No one is assigned to decide this yet." text for the identical Approvals-view situation.';
