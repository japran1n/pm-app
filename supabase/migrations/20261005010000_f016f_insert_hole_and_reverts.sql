-- F016f (missions/20260903-portal, M3-scrutiny-2 remediation — blocker):
-- three defects the second scrutiny pass found in F016d/F016c/F016e.
--
-- ---------------------------------------------------------------------
-- Defect 1 (AS-047, B2) — F016d's column guard was `before update` only.
-- `client_requests_insert_own`'s `with check` (20260902030000:109-120)
-- pins `status`, `converted_task_id` and `reviewed_by`, but none of the
-- thirteen triage/quote/decision columns F016d's UPDATE guard protects:
-- `scope_verdict`, `quoted_hours`, `quoted_amount`, `quote_currency`,
-- `quote_note`, `quote_valid_until`, `client_decision`, `decided_by`,
-- `decided_at`, `track`, `track_overridden`, `track_override_reason`,
-- `approval_request_id`. A client could `POST /client_requests` with
-- `client_decision = 'approved'` and defeat AS-047's gate outright at
-- creation, since `accept_client_request_atomic` never moves a
-- self-declared-approved row through the UPDATE path the trigger
-- guards. They could also point a fabricated `approval_request_id` at
-- an existing pending commercial approval and hijack
-- `client_requests_sync_decision_from_approval`'s `select into` (which
-- silently takes one row on a multi-row match) into writing their own
-- `title`/`body` into `project_scope_items`.
--
-- This is the sixth appearance in this mission of a rule applied on one
-- path (UPDATE) and absent on its sibling (INSERT) — see F016d's own
-- header. Fix, per this feature's own instruction: extend the existing
-- trigger to `before insert or update` rather than duplicating the rule
-- a second time in the INSERT policy's `with check` — one place, both
-- verbs. `OLD` does not exist on INSERT, so the INSERT branch compares
-- `NEW` against each column's own schema default instead of `OLD`
-- (`client_decision` defaults to `'pending'`, `track_overridden`
-- defaults to `false`, every other guarded column defaults to `NULL`) —
-- an author is allowed to insert a row that reads exactly like a freshly
-- filed one, and nothing else.
-- ---------------------------------------------------------------------

create or replace function public.enforce_client_requests_triage_columns_immutable_by_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if coalesce(current_setting('app.client_requests_triage_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.created_by = auth.uid() and (
      new.scope_verdict is not null
      or new.quoted_hours is not null
      or new.quoted_amount is not null
      or new.quote_currency is not null
      or new.quote_note is not null
      or new.quote_valid_until is not null
      or new.client_decision is distinct from 'pending'
      or new.decided_by is not null
      or new.decided_at is not null
      or new.track is not null
      or new.track_overridden is distinct from false
      or new.track_override_reason is not null
      or new.approval_request_id is not null
    ) then
      raise exception 'client_requests: a request cannot be filed already carrying triage, quote or decision fields'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (
    new.scope_verdict is distinct from old.scope_verdict
    or new.quoted_hours is distinct from old.quoted_hours
    or new.quoted_amount is distinct from old.quoted_amount
    or new.quote_currency is distinct from old.quote_currency
    or new.quote_note is distinct from old.quote_note
    or new.quote_valid_until is distinct from old.quote_valid_until
    or new.client_decision is distinct from old.client_decision
    or new.decided_by is distinct from old.decided_by
    or new.decided_at is distinct from old.decided_at
    or new.track is distinct from old.track
    or new.track_overridden is distinct from old.track_overridden
    or new.track_override_reason is distinct from old.track_override_reason
    or new.approval_request_id is distinct from old.approval_request_id
  ) then
    if new.created_by = auth.uid() then
      raise exception 'client_requests: the request''s own author cannot change its triage, quote or decision fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_client_requests_triage_columns_immutable_by_author() is
  'F016d/F016f: pins the thirteen triage/quote/decision columns on client_requests against author writes on BOTH insert and update — an author cannot file a request that already carries client_decision=''approved'' or a foreign approval_request_id (F016f/AS-047), and cannot edit those columns after filing it (F016d). Bypassed only by service_role and by the transaction-local app.client_requests_triage_guard_bypass flag the two legitimate writers set around their own single UPDATE.';

drop trigger if exists client_requests_enforce_triage_columns_immutable_by_author on public.client_requests;
create trigger client_requests_enforce_triage_columns_immutable_by_author
  before insert or update on public.client_requests
  for each row
  execute function public.enforce_client_requests_triage_columns_immutable_by_author();

-- ---------------------------------------------------------------------
-- Defect 2a (B6) — F016e silently routed `send_change_request_quote_
-- atomic` off `client_gate` and back onto an inline
-- `is_project_portal_enabled` check, one migration after F016d put it
-- on the shared predicate specifically because it "shares
-- accept_client_request_atomic's exact preamble" (F016d's own header).
-- Harmless today only by coincidence (the RPC bars the `client` role,
-- so `created_by = auth.uid()` can never hold for its caller) — restore
-- the routing, and restore the transaction-local bypass flag around its
-- own UPDATE of the guarded columns, matching every other legitimate
-- writer of those columns (this file's Defect 1, and
-- client_requests_sync_decision_from_approval). A future worker who
-- reintroduces "a team member quoting their own filed request" as a
-- reachable path needs this bypass in place already, not bypassed by
-- coincidence a second time.
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

  -- Defect 3a (F016e, preserved): a fresh quote makes the PRIOR approval
  -- moot. Withdraw it if it is still awaiting a decision.
  if v_prior_approval_id is not null then
    update public.approval_requests
       set state = 'withdrawn'
     where id = v_prior_approval_id
       and state = 'pending';
  end if;

  -- F016d/F016f: this function writes exactly the columns the guard
  -- trigger pins, as the caller's own authenticated session -- see this
  -- file's Defect 2a header. The bypass covers this single UPDATE only.
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
         -- A fresh quote reopens the decision: any earlier approve/reject
         -- on a previous quote no longer speaks to the new price.
         client_decision = case when p_scope_verdict = 'change_request' then 'pending' else client_decision end,
         status = case when v_status = 'submitted' then 'in_review' else v_status end,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         -- Cleared here too (F016e), not just left to be overwritten a
         -- few lines down -- if scope_verdict is no longer
         -- 'change_request' this update is never reached below, and the
         -- row would otherwise keep pointing at a withdrawn approval.
         approval_request_id = null
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
       set approval_request_id = v_approval_id
     where id = p_request_id;
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select p_request_id, p_scope_verdict, v_approval_id;
end;
$$;

comment on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) is
  'F016/F016d/F016e/F016f: the team''s triage + quote write path. Routes its portal-enabled check through client_gate (F016d), restored here after F016e silently reverted it to an inline check one migration later (F016f/B6). Wraps its own UPDATE of the guard-pinned columns in the transaction-local bypass flag, also restored here.';

revoke all on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) from public;
grant execute on function public.send_change_request_quote_atomic(
  uuid, text, text, numeric, numeric, text, text, date, text, boolean, text, text
) to authenticated;

-- ---------------------------------------------------------------------
-- Defect 2b (B6, round-1 F1 in M3-scrutiny-2) — F016c added
-- `and t.project_id = cd.project_id` to the sweep's join
-- (20260930020000:132), on top of (not instead of) the composite FK
-- that enforces the same fact at write time. F016e's `create or
-- replace` of the same function dropped the predicate. Round-2 scrutiny
-- confirmed it is unreachable today (the composite FK holds), but a
-- join predicate that is cheap, still true, and matches the sweep's own
-- prior migration is worth keeping as defense in depth rather than
-- relying solely on the FK never having a gap opened in it later —
-- restored below. (F016e's own function comment, applied after F016c's,
-- never claimed the predicate was present, so there was no comment/code
-- disagreement to resolve on the comment side — only the predicate
-- itself needed restoring.)
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

    update client_deliverables
       set swept_at = now()
     where task_id = v_row.task_id
       and blocking
       and state not in ('accepted', 'waived')
       and due_at is not null
       and due_at < (now() at time zone 'utc')::date
       and swept_at is null;

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
  'F013/F016c/F016e/F016f (AS-030): hourly sweep moving a task into its project''s client_bucket = ''blocked'' column when a blocking client_deliverable linked to it is overdue and not yet accepted/waived. Only ever moves a task INTO blocked, never out; idempotent per task within a run, and per deliverable across runs via swept_at. Join is same-project only (t.project_id = cd.project_id, F016c, restored by F016f after F016e dropped it), on top of the composite FK that enforces this at write time.';

-- This CREATE OR REPLACE does not change the function's signature or
-- SECURITY DEFINER-ness, so its existing grants (postgres, service_role
-- only -- F016g's blanket public/anon/authenticated revoke, applied to
-- the function that already existed at that migration) are untouched.
