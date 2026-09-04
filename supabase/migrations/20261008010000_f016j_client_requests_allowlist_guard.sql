-- F016j (missions/20260903-portal, M3 remediation): the seventh instance
-- of one class in this mission, on a column added after the sixth was
-- fixed.
--
-- ---------------------------------------------------------------------
-- Defect (AS-047's own shape, on a sibling column) — `client_requests.
-- origin_assumption_id` (F016b, 20261003010000) is:
--   - writable by a client at INSERT (absent from F016f/F016d's guard),
--   - absent from that guard's UPDATE column list too,
--   - dereferenced with no project predicate at
--     `client_requests_sync_decision_from_approval`'s final `update
--     project_assumptions ... where id = v_request.origin_assumption_id`
--     (20261003010000:280-285-ish) -- the exact hijack shape F016f
--     closed for `approval_request_id` one migration earlier: a client
--     could file a request pointing `origin_assumption_id` at an
--     assumption belonging to a DIFFERENT project the client cannot
--     touch, and if the team later quotes and the client approves it,
--     that foreign assumption gets silently invalidated.
--
-- This is the seventh occurrence of one class in this mission (F006b,
-- F006i, F006k, F006l, F009b, F016d, and this). F016d fixed the RPC
-- side structurally (no RPC has regressed since); F016f extended the
-- table guard to INSERT and that held too. Neither made the guard's
-- COLUMN LIST self-maintaining -- it was still a hand-written
-- enumeration of forbidden columns, so any migration that added a
-- column to `client_requests` silently opted out of protection, and
-- F016b did exactly that within a day of F016f closing the previous
-- gap.
--
-- Fix, per this feature's own instruction:
--   1. Add a project predicate where origin_assumption_id is
--      dereferenced.
--   2. Invert the guard from a deny-list to an allow-list: enumerate
--      the few columns a client legitimately authors (title, body,
--      desired_by, plus the identity columns id/project_id/created_by/
--      created_at/updated_at at INSERT time only) and reject any write
--      by the row's own author to anything else, via a generic
--      to_jsonb() diff rather than a per-column named check. A column
--      added next year is then protected by default instead of exposed
--      by default -- the same inversion F009d (M2, non-blocking)
--      proposes for `approval_requests`' settled-row immutability
--      trigger. Not shared as one literal helper here: the two tables'
--      allow-lists, verbs (this one also gates INSERT) and default-row
--      construction differ enough that a shared function would need as
--      many branches as it saves; the technique (jsonb diff minus an
--      allow-list) is the reusable part, and F009d's own migration
--      should apply it the same way when that feature is picked up.
--   3. A regression test (tests/integration/f016j-...) that adds a
--      throwaway column to client_requests inside a rolled-back
--      transaction and proves the guard rejects an author write to it
--      without the guard's SQL being touched.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Project predicate on the origin_assumption_id dereference.
-- ---------------------------------------------------------------------

create or replace function public.client_requests_sync_decision_from_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
begin
  if NEW.decision_type <> 'commercial' or NEW.subject_type <> 'artifact' then
    return NEW;
  end if;
  if OLD.state = NEW.state then
    return NEW;
  end if;
  if NEW.state not in ('approved', 'changes_requested') then
    return NEW;
  end if;

  select cr.id, cr.project_id, cr.title, cr.body, cr.origin_assumption_id
    into v_request
    from public.client_requests cr
   where cr.id = NEW.subject_id
     and cr.approval_request_id = NEW.id;

  if v_request.id is null then
    return NEW;
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  update public.client_requests
     set client_decision = case when NEW.state = 'approved' then 'approved' else 'rejected' end,
         decided_by = NEW.decided_by,
         decided_at = NEW.decided_at
   where id = v_request.id;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  if NEW.state = 'approved' then
    insert into public.project_scope_items (
      project_id, title, description, included, source, change_request_id
    )
    values (
      v_request.project_id, v_request.title, v_request.body, true, 'change_request', v_request.id
    )
    on conflict (change_request_id)
      where (source = 'change_request' and change_request_id is not null)
      do nothing;

    -- F016j: added the project predicate. origin_assumption_id is a
    -- client-authored value at INSERT (until this migration's guard
    -- below closes that); without pinning the update to the SAME
    -- project as the request being approved, a foreign
    -- project_assumptions row could be invalidated by a client who
    -- never had visibility into it.
    if v_request.origin_assumption_id is not null then
      update public.project_assumptions
         set state = 'invalidated'
       where id = v_request.origin_assumption_id
         and project_id = v_request.project_id
         and state <> 'invalidated';
    end if;
  end if;

  return NEW;
end;
$$;

comment on function public.client_requests_sync_decision_from_approval() is
  'F016/F016b/F016j: mirrors a client''s decide_approval_atomic decision on a change-request quote back onto client_requests, and (F016b) invalidates the originating flagged assumption on approval -- now scoped to the SAME project as the request (F016j), since origin_assumption_id was client-writable at INSERT until this migration''s allow-list guard.';

-- ---------------------------------------------------------------------
-- 2. Invert the guard trigger to an allow-list.
--
-- INSERT: the author may set the identity columns Postgres/RLS already
-- attribute to them (id, project_id, created_by, created_at,
-- updated_at -- all four of the latter carry non-deterministic or
-- caller-supplied defaults, so they are excluded from the diff outright
-- rather than compared) plus the three fields the compose form actually
-- writes (title, body, desired_by -- lib/actions/client-requests.ts's
-- own createClientRequest). Every other column must equal that column's
-- own schema default, computed generically from pg_attrdef so a future
-- column is covered without editing this function.
--
-- UPDATE: the author may change only title, body, desired_by (matching
-- lib/actions/client-requests.ts -- no author-facing update touches
-- anything else; RLS's own client_requests_update_author_while_submitted
-- WITH CHECK already separately pins status/converted_task_id/
-- reviewed_by, and this guard now backs that up structurally instead of
-- by name, plus newly covers project_id and created_by, which the RLS
-- policy never pinned).
-- ---------------------------------------------------------------------

create or replace function public.enforce_client_requests_triage_columns_immutable_by_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_insert_allow constant text[] := array['id', 'project_id', 'created_by', 'created_at', 'updated_at', 'title', 'body', 'desired_by'];
  v_update_allow constant text[] := array['title', 'body', 'desired_by'];
  v_default_cols text;
  v_default_row public.client_requests;
  v_new_diff jsonb;
  v_ref_diff jsonb;
  v_key text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if coalesce(current_setting('app.client_requests_triage_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;

  -- Only the row's own author is restricted by this trigger. The
  -- team's triage/quote/decision writes go through RLS's writer-only
  -- policy or a SECURITY DEFINER RPC, neither of which is
  -- `new.created_by = auth.uid()` (F016's own design: a request is
  -- always authored by a client, triaged by someone else -- see
  -- 20261003010000's raise_change_request_from_assumption_atomic
  -- header for why that invariant is load-bearing).
  if new.created_by is distinct from auth.uid() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    -- Build the table's own current default for every column, computed
    -- from the catalog rather than hand-copied -- this is what makes
    -- the guard self-maintaining: a column added by a later migration
    -- gets a default entry here automatically, with no edit to this
    -- function required.
    select string_agg(
             coalesce(pg_get_expr(ad.adbin, ad.adrelid), 'NULL') || ' as ' || quote_ident(a.attname),
             ', '
           )
      into v_default_cols
      from pg_attribute a
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     where a.attrelid = 'public.client_requests'::regclass
       and a.attnum > 0
       and not a.attisdropped;

    execute 'select ' || v_default_cols into v_default_row;

    v_new_diff := to_jsonb(new) - v_insert_allow;
    v_ref_diff := to_jsonb(v_default_row) - v_insert_allow;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
        raise exception 'client_requests: a request cannot be filed already carrying a value for % (author-write not allowed on this column)', v_key
          using errcode = '42501';
      end if;
    end loop;

    return new;
  end if;

  -- UPDATE
  v_new_diff := to_jsonb(new) - v_update_allow;
  v_ref_diff := to_jsonb(old) - v_update_allow;

  for v_key in select jsonb_object_keys(v_new_diff)
  loop
    if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
      raise exception 'client_requests: the request''s own author cannot change % after filing it', v_key
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.enforce_client_requests_triage_columns_immutable_by_author() is
  'F016d/F016f/F016j: allow-list guard (F016j inverted this from a hand-enumerated deny-list) on client_requests -- the row''s own author may only ever set/change title, body and desired_by (plus, at INSERT only, the identity columns id/project_id/created_by/created_at/updated_at). Every other column, present or future, must match its own schema default at INSERT and cannot change at all at UPDATE, computed generically via pg_attrdef/to_jsonb so a column added later is covered without editing this function. Bypassed only by service_role and the transaction-local app.client_requests_triage_guard_bypass flag the legitimate non-author writers set around their own single UPDATE.';

drop trigger if exists client_requests_enforce_triage_columns_immutable_by_author on public.client_requests;
create trigger client_requests_enforce_triage_columns_immutable_by_author
  before insert or update on public.client_requests
  for each row
  execute function public.enforce_client_requests_triage_columns_immutable_by_author();

-- ---------------------------------------------------------------------
-- 3. `raise_change_request_from_assumption_atomic` (F016b) inserts
-- `kind`, `scope_verdict` and `origin_assumption_id` on the client's
-- behalf. It already never trips the guard above in practice --
-- `created_by` is resolved to an active client, never the calling team
-- member, and the guard only restricts `new.created_by = auth.uid()`
-- -- but that safety is incidental to who happens to be resolved as the
-- author, not a property this function asserts about itself. Wrap its
-- insert in the same transaction-local bypass flag every OTHER
-- legitimate non-author writer of these columns already uses
-- (send_change_request_quote_atomic, client_requests_sync_decision_
-- from_approval), so this function's own contract does not rely on that
-- coincidence either, matching M3-scrutiny-3's own note. Recreated here
-- in full (CREATE OR REPLACE replaces the whole body) with no other
-- change from 20261003010000's version.
-- ---------------------------------------------------------------------

create or replace function public.raise_change_request_from_assumption_atomic(
  p_assumption_id uuid
)
returns table (
  request_id uuid,
  project_id uuid,
  title text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_note text;
  v_state text;
  v_flagged_at timestamptz;
  v_caller_role text;
  v_client_id uuid;
  v_request_id uuid;
  v_title text;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: not authenticated'
      using errcode = '28000';
  end if;

  select pa.project_id, pa.text, pa.flagged_note, pa.state, pa.flagged_by_client_at, p.workspace_id
    into v_project_id, v_text, v_note, v_state, v_flagged_at, v_workspace_id
    from public.project_assumptions pa
    join public.projects p on p.id = pa.project_id
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: assumption not found'
      using errcode = 'P0002';
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

  if v_flagged_at is null or v_state <> 'assumed' then
    raise exception 'this assumption has not been flagged by the client'
      using errcode = 'CR050';
  end if;

  select wm.user_id into v_client_id
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.role = 'client'
     and wm.status = 'active'
   order by wm.user_id
   limit 1;

  if v_client_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: no active client on this workspace'
      using errcode = 'P0002';
  end if;

  v_title := left(v_text, 200);

  -- F016j: wrap this insert in the same bypass flag every other
  -- legitimate writer of the guarded columns uses, so this function's
  -- exemption from the allow-list guard is explicit rather than
  -- incidental to created_by never equalling auth.uid() here.
  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  insert into public.client_requests (
    project_id, created_by, title, body, kind, scope_verdict, origin_assumption_id
  )
  values (
    v_project_id, v_client_id, v_title, v_note, 'change', 'change_request', p_assumption_id
  )
  returning client_requests.id, client_requests.created_at into v_request_id, v_created_at;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select v_request_id, v_project_id, v_title, v_note, v_created_at;
end;
$$;

comment on function public.raise_change_request_from_assumption_atomic(uuid) is
  'F016b/F016j: raises a client_requests change request from a flagged project_assumptions row, attributed to an active client of the workspace (never the calling team member -- see this function''s own original 20261003010000 header for why). Wraps its insert in the transaction-local app.client_requests_triage_guard_bypass flag (F016j), matching every other legitimate writer of client_requests'' guarded columns.';
