-- F025b (missions/20260903-portal, M5 remediation — found by F025's leak
-- sweep on its first real run): `client_requests.quoted_amount` (and its
-- sibling quote columns) had no read-side gate separating a price the
-- team has priced INTERNALLY from one actually SENT to the client. A row
-- with scope_verdict = 'change_request', client_decision = 'pending' and
-- no approval_request_id is a draft the PM is still deciding on, and the
-- client could already read it.
--
-- ---------------------------------------------------------------------
-- 1. What "sent" means (F025b's own item 1) — an explicit column, not an
--    inferred one.
--
-- `approval_request_id is not null` is the de facto signal today, but it
-- is a foreign key whose job is "which approval carries this quote", not
-- "has this quote been shown to the client" — those two facts happen to
-- move together today only because `send_change_request_quote_atomic`
-- writes both in the same statement. They are not the same fact:
-- `20261005010000` (F016f, "Defect 3a") already withdraws and NULLs a
-- STALE `approval_request_id` on re-quote for a reason that has nothing
-- to do with whether the client saw a price — and a future feature that
-- adds a second way to raise a commercial approval for the same request
-- (or clears `approval_request_id` for some other bookkeeping reason)
-- would silently re-expose an already-sent quote, or hide a still-sent
-- one, with no line of code that says so. `quote_sent_at`, written by
-- the one function that actually puts a price in front of the client
-- (`send_change_request_quote_atomic`, and ONLY when scope_verdict =
-- 'change_request' — the branch that raises the approval), is a fact
-- about client-visibility itself: testable in isolation (`is null` /
-- `is not null`), and immune to any future change in how approvals are
-- modelled. Per this feature's own instruction ("prefer making the state
-- explicit in the data ... unless you find a concrete reason not to"),
-- and no such reason turned up on reading F016/F016f/F016j.
-- ---------------------------------------------------------------------

alter table public.client_requests
  add column if not exists quote_sent_at timestamptz;

comment on column public.client_requests.quote_sent_at is
  'F025b: set by send_change_request_quote_atomic, and only on its scope_verdict = ''change_request'' branch (the one that raises the client-facing approval) — the explicit "this price has been shown to the client" signal client_requests_client_read masks quoted_hours/quoted_amount/quote_currency/quote_note/quote_valid_until on. NULLed alongside approval_request_id whenever a fresh quote supersedes an unsent or superseded one, so a re-quote is unsent again until the team re-sends it. Never inferred from approval_request_id''s presence — see this column''s own migration header for why those two facts are not interchangeable.';

-- This is a NEW column: F016j's allow-list guard
-- (`enforce_client_requests_triage_columns_immutable_by_author`,
-- 20261008010000) computes its INSERT reference row and its UPDATE
-- comparison generically from the catalog / OLD, with no per-column
-- enumeration — so `quote_sent_at` is already protected against an
-- author write on both verbs with no edit to that trigger required. The
-- non-author writer below (send_change_request_quote_atomic) already
-- wraps its UPDATE of the guarded columns in
-- app.client_requests_triage_guard_bypass; the assignment added here
-- rides inside that same statement and bypass window, not a new one.

-- ---------------------------------------------------------------------
-- 2. send_change_request_quote_atomic writes quote_sent_at.
--
-- Same two-statement shape F016f already uses for approval_request_id:
-- the first UPDATE clears it (a fresh quote, or a verdict change away
-- from 'change_request', is unsent until proven otherwise); the second,
-- reached only on the 'change_request' branch that raises the approval,
-- sets it to now() in the same statement that records the new
-- approval_request_id — one INSERT/UPDATE pair, one moment "sent" means.
-- ---------------------------------------------------------------------

create or replace function public.send_change_request_quote_atomic(
  p_request_id uuid,
  p_scope_verdict text,
  p_severity text default null,
  p_quoted_hours numeric default null,
  p_quoted_amount numeric default null,
  p_quote_currency text default null,
  p_quote_note text default null,
  p_quote_valid_until date default null,
  p_track text default null,
  p_track_overridden boolean default false,
  p_track_override_reason text default null,
  p_portal_url text default null
)
returns table (
  request_id uuid,
  scope_verdict text,
  approval_request_id uuid
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
  v_status text;
  v_caller_role text;
  v_approval_id uuid;
  v_prior_approval_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_scope_verdict not in ('in_scope', 'change_request', 'warranty') then
    raise exception 'send_change_request_quote_atomic: invalid scope_verdict %', p_scope_verdict
      using errcode = '22023';
  end if;

  select cr.project_id, cr.title, cr.status, p.workspace_id, cr.approval_request_id
    into v_project_id, v_title, v_status, v_workspace_id, v_prior_approval_id
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  if v_status = 'accepted' then
    raise exception 'this request has already been accepted';
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

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if p_scope_verdict = 'change_request' and (p_quoted_amount is null or p_quote_valid_until is null) then
    raise exception 'a change request quote needs an amount and a validity date'
      using errcode = '22023';
  end if;

  -- F016f's own Defect 3a, preserved: a fresh quote makes the PRIOR
  -- approval moot. Withdraw it if it is still awaiting a decision.
  if v_prior_approval_id is not null then
    update public.approval_requests
       set state = 'withdrawn'
     where id = v_prior_approval_id
       and state = 'pending';
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  update public.client_requests
     set scope_verdict = p_scope_verdict,
         severity = p_severity,
         quoted_hours = p_quoted_hours,
         quoted_amount = p_quoted_amount,
         quote_currency = p_quote_currency,
         quote_note = p_quote_note,
         quote_valid_until = p_quote_valid_until,
         track = p_track,
         track_overridden = coalesce(p_track_overridden, false),
         track_override_reason = case when coalesce(p_track_overridden, false) then p_track_override_reason else null end,
         client_decision = case when p_scope_verdict = 'change_request' then 'pending' else client_decision end,
         status = case when v_status = 'submitted' then 'in_review' else v_status end,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         approval_request_id = null,
         -- F025b: unsent until the branch below (re)sends it — a fresh
         -- quote, or a verdict change away from 'change_request', is not
         -- a quote the client has seen.
         quote_sent_at = null
   where id = p_request_id;

  if p_scope_verdict = 'change_request' then
    insert into public.approval_requests (
      project_id, subject_type, subject_id, artifact_url, title, description,
      decision_type, requested_by, due_at
    )
    values (
      v_project_id, 'artifact', p_request_id,
      coalesce(p_portal_url, 'about:blank'),
      'Quote: ' || v_title,
      p_quote_note,
      'commercial', v_user_id,
      case when p_quote_valid_until is not null then p_quote_valid_until::timestamptz else null end
    )
    returning id into v_approval_id;

    update public.client_requests
       set approval_request_id = v_approval_id,
           -- F025b: this is the one moment "sent" means — the same
           -- statement that raises the client-facing approval.
           quote_sent_at = now()
     where id = p_request_id;
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select p_request_id, p_scope_verdict, v_approval_id;
end;
$$;

comment on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) is
  'F016/F016d/F016e/F016f/F025b: the team''s triage + quote write path. Sets quote_sent_at (F025b) in the same statement it raises the client-facing approval_request_id, and clears both together on a fresh or superseded quote, so quote_sent_at is not null if and only if the CURRENT quote has actually been sent.';

revoke all on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) from public;
grant execute on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) to authenticated;

-- ---------------------------------------------------------------------
-- 3. The read gate itself (F025b's item 2) — in the policy, not the
--    query, per this feature's own instruction and this mission's own
--    six prior repeats of "a rule applied in one query, forgotten in the
--    next" (F016f's own header names the count; this is the seventh
--    class, on a fourth-column shape RLS itself cannot express).
--
--    Plain row-level security cannot null four columns for one caller
--    while returning them whole for another on the SAME row — a USING
--    clause can only keep or drop the entire row, and hiding the whole
--    row would take the request itself away from the client who filed
--    it, not just its unsent price. `client_requests_select_author_or_
--    team` (20260902030000) is therefore left untouched: it still
--    decides which ROWS a caller may see at all, exactly as before.
--
--    The masking layer is a `security_invoker` view: it enforces no
--    permission of its own (the base table's own RLS policy still runs,
--    under the CALLING user's identity, for every row the view touches
--    — security_invoker = true is load-bearing here, not decorative),
--    it is the one and only place the four quote columns are computed
--    from `client_requests`, and every reader — team or client, this
--    migration or a query added next year — gets the same masking by
--    construction rather than by remembering to repeat a WHERE clause.
--    That is the closest a single Postgres object gets to "gate it in
--    the policy" for a fact RLS's own row-only grammar cannot encode.
-- ---------------------------------------------------------------------

drop view if exists public.client_requests_client_read;

create view public.client_requests_client_read
  with (security_invoker = true)
  as
  select
    cr.id,
    cr.project_id,
    cr.created_by,
    cr.title,
    cr.body,
    cr.desired_by,
    cr.status,
    cr.decline_reason,
    cr.converted_task_id,
    cr.reviewed_by,
    cr.reviewed_at,
    cr.created_at,
    cr.updated_at,
    cr.kind,
    cr.severity,
    cr.scope_verdict,
    -- F025b: the mask. A team caller (not a client on this project) sees
    -- the draft price unconditionally — "the team's own view is
    -- unaffected" is this feature's own item 3. A client caller sees it
    -- only once quote_sent_at is set.
    case
      when cr.quote_sent_at is not null or not public.is_project_client(cr.project_id)
        then cr.quoted_hours
      else null
    end as quoted_hours,
    case
      when cr.quote_sent_at is not null or not public.is_project_client(cr.project_id)
        then cr.quoted_amount
      else null
    end as quoted_amount,
    case
      when cr.quote_sent_at is not null or not public.is_project_client(cr.project_id)
        then cr.quote_currency
      else null
    end as quote_currency,
    case
      when cr.quote_sent_at is not null or not public.is_project_client(cr.project_id)
        then cr.quote_note
      else null
    end as quote_note,
    case
      when cr.quote_sent_at is not null or not public.is_project_client(cr.project_id)
        then cr.quote_valid_until
      else null
    end as quote_valid_until,
    cr.quote_sent_at,
    cr.client_decision,
    cr.decided_by,
    cr.decided_at,
    cr.track,
    cr.track_overridden,
    cr.track_override_reason,
    cr.approval_request_id,
    cr.origin_assumption_id
  from public.client_requests cr;

comment on view public.client_requests_client_read is
  'F025b: security_invoker read of client_requests that masks quoted_hours/quoted_amount/quote_currency/quote_note/quote_valid_until to NULL for a client caller until quote_sent_at is set. Row visibility is unchanged — still client_requests_select_author_or_team, evaluated under the calling user because security_invoker = true. The team''s own read is byte-for-byte unaffected (is_project_client is false for them). This is the one place these columns are read for any portal-facing (client-reachable) query; a team-only query may still read the base table directly when it has no client caller by construction (e.g. it lives under /w/* and the workspace layout already redirects clients out).';

grant select on public.client_requests_client_read to authenticated;
