-- F016k (missions/20260903-portal, M3 remediation round 2, item 3):
-- `client_deliverables.state`'s enum has always had a `'waived'` value
-- (20260926010000), the sweep and the swept_at trigger have always had
-- an `accepted/waived` branch (20260927010000, 20261006010000), and the
-- portal UI has always had copy for it (`deliverable-row.tsx`,
-- `deliverables-panel.tsx`'s STATE_LABELS/STATE_BADGE_CLASS) -- but no
-- code path anywhere has ever written `state = 'waived'`.
-- `accept_deliverable_atomic` only ever accepts `p_decision in
-- ('accepted', 'returned')`.
--
-- Decision (per this feature's own instruction to name it): give the
-- state its action, not remove it. "A team member decides not to chase
-- an obligation" is a real, common thing a PM does -- a deliverable that
-- turns out not to be needed (scope changed, the client handled it
-- another way), not a defect in the review flow that only has two
-- outcomes today. Removing the enum value/trigger branch/copy would also
-- touch `getDeliverablesPastDueCount`/`isDeliverablePastDue`/the sweep's
-- own `not in ('accepted', 'waived')` filters, which already correctly
-- treat "waived" as settled -- deleting the one thing that can PRODUCE
-- that state would leave that correct handling for a state nothing can
-- reach, the same "dead branch" shape this item exists to close, just
-- moved one level down.
--
-- `accept_deliverable_atomic` now accepts `p_decision = 'waived'`: sets
-- state = 'waived', clears delivered_at/accepted_at/accepted_by (an
-- item that was never accepted should not carry an acceptance
-- timestamp), stores the optional note in review_note (mirrors why it
-- was waived, same column "returned" already uses for why it was sent
-- back -- no new column for a second free-text reason). No note is
-- REQUIRED for a waive (unlike "returned"'s required note) -- a PM
-- waiving their own team's obligation does not owe the client an
-- explanation the way sending client-visible work back does; the note
-- is a private, optional annotation for teammates.
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

  if p_decision not in ('accepted', 'returned', 'waived') then
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
  elsif p_decision = 'waived' then
    v_new_state := 'waived';

    -- A waived deliverable was never accepted -- accepted_at/accepted_by
    -- stay null so "who accepted this and when" never lies about a
    -- decision that was actually "we decided not to chase it".
    -- delivered_at is left untouched: a deliverable can be waived either
    -- before or after the client ever delivered it, and if they already
    -- did, that timestamp is still a true fact about what happened.
    update client_deliverables
       set state = 'waived',
           accepted_at = null,
           accepted_by = null,
           review_note = p_note
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
    case
      when p_decision = 'accepted' then 'client_deliverable.accepted'
      when p_decision = 'waived' then 'client_deliverable.waived'
      else 'client_deliverable.returned'
    end,
    'client_deliverable',
    p_deliverable_id,
    jsonb_build_object('title', v_title, 'note', p_note)
  );

  return query select p_deliverable_id, v_new_state;
end;
$$;

comment on function public.accept_deliverable_atomic(uuid, text, text) is
  'F013/F016k (AS-032, AS-030): a team member accepts, returns (required note), or waives (optional note) a deliverable. Waiving is the action `state = ''waived''` -- present in the enum, the swept_at-clearing trigger and the sweep''s exclusion filter since F013/F016h -- always implied but, before F016k, nothing could ever produce; it is a PM deciding not to chase an obligation, not a defect. SECURITY DEFINER; the real authorization check (is_project_workspace_writer) lives in the body, same as every other atomic RPC in this schema.';

-- This CREATE OR REPLACE does not change the function's signature or
-- SECURITY DEFINER-ness, so its existing grants (authenticated only, per
-- 20260927010000's own grant line) are untouched.
