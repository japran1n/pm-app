-- DB-RLS-04 (audit 2026-09-24): unsent quote prices reached portal clients.
--
-- F025b (20261018010000) masked quoted_hours / quoted_amount /
-- quote_currency / quote_note / quote_valid_until in the
-- `client_requests_client_read` view until `quote_sent_at` is set — but
-- the mask only held for callers who CHOSE to read through the view. The
-- base table `public.client_requests` stayed directly readable by a
-- client: `client_requests_select_author_or_team` hands them the row, and
-- the table-wide SELECT grant hands them every column on it. Two ways in:
--
--   1. PostgREST: `GET /rest/v1/client_requests?select=quoted_amount`
--      with a client's own JWT returned the draft price.
--   2. Realtime: `client_requests` is in `supabase_realtime` with all of
--      its columns, and the portal's request list subscribes to `*` on it
--      (components/portal/request-list.tsx) — so the raw row, draft price
--      included, was pushed into the client's browser the moment the team
--      typed it, before the quote was ever sent.
--
-- ---------------------------------------------------------------------
-- The fix: column privileges, not a new table or a definer view.
--
-- Row-level security decides WHICH ROWS; it cannot hide columns. Column
-- privileges can, and both leak paths honour them:
--   * PostgREST runs as `authenticated`, so a select naming a quote
--     column on the base table is now `permission denied`.
--   * Realtime's `realtime.apply_rls` drops every column the subscribing
--     role lacks `has_column_privilege(..., 'SELECT')` on before it
--     builds the payload — so the portal's `*` subscription keeps
--     working and simply never carries the five quote columns again.
--
-- Nobody legitimately reads the quote columns off the base table with a
-- user session after this change:
--   * every function that reads/writes them (send_change_request_quote_
--     atomic, accept_client_request_atomic, raise_change_request_from_
--     assumption_atomic, client_requests_sync_decision_from_approval, the
--     allow-list guard) is SECURITY DEFINER owned by postgres;
--   * the team inbox (lib/queries/client-requests.ts) moves to the view
--     in the same commit as this migration — the view already returns
--     the quote unmasked to a team caller.
--
-- The view keeps `security_invoker = true`, so row visibility for every
-- reader is still the real `client_requests_select_author_or_team` RLS
-- policy, not a copy of it. Only the five quote values are now fetched
-- through a SECURITY DEFINER helper (the invoker no longer holds SELECT
-- on those columns), and that helper is self-gated so calling it
-- directly as an RPC reveals nothing the view would not.
--
-- Rejected alternatives:
--   * Move the quote to a 1:1 team-only table — correct, but it rewrites
--     six SECURITY DEFINER functions and the F016j allow-list guard for no
--     extra protection over a column grant.
--   * Make the view SECURITY DEFINER and drop the client SELECT policy —
--     the view would have to re-implement the row policy by hand, and the
--     Realtime list would lose its live updates entirely.
--
-- Fail-closed note for whoever adds a column next: `authenticated` no
-- longer holds a table-wide SELECT on client_requests. A new column is
-- therefore NOT readable by a user session until it is granted below-style
-- (`grant select (new_col) on public.client_requests to authenticated`).
-- That is the point — decide per column whether a client may see it.
-- ---------------------------------------------------------------------

-- 1. The grant. Table-wide SELECT out; every column except the five quote
--    values back in. `anon` gets nothing: no policy targets it, so it
--    could never see a row anyway.
revoke select on table public.client_requests from anon, authenticated;

grant select (
  id,
  project_id,
  created_by,
  title,
  body,
  desired_by,
  status,
  decline_reason,
  converted_task_id,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at,
  kind,
  severity,
  scope_verdict,
  client_decision,
  decided_by,
  decided_at,
  track,
  track_overridden,
  track_override_reason,
  approval_request_id,
  origin_assumption_id,
  quote_sent_at
) on table public.client_requests to authenticated;

-- 2. The quote, for a caller entitled to it — and nobody else.
--
--    The gate is the row policy AND the F025b mask in one predicate:
--      team  = is_project_visible_to and not is_project_client
--              (the policy's team branch; the draft is theirs to see)
--      client = is_project_client and is_project_visible_to and
--               is_project_portal_enabled (the policy's client branch)
--               AND quote_sent_at is not null (the mask).
--    Called through the view the row filter has already run; called
--    directly it still returns nothing a caller could not see in the view.
create or replace function public.client_request_quote_for_caller(p_request_id uuid)
returns table (
  quoted_hours numeric,
  quoted_amount numeric,
  quote_currency text,
  quote_note text,
  quote_valid_until date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    cr.quoted_hours,
    cr.quoted_amount,
    cr.quote_currency,
    cr.quote_note,
    cr.quote_valid_until
  from public.client_requests cr
  where cr.id = p_request_id
    and public.is_project_visible_to(cr.project_id)
    and (
      not public.is_project_client(cr.project_id)
      or (
        cr.quote_sent_at is not null
        and public.is_project_portal_enabled(cr.project_id)
      )
    );
$$;

comment on function public.client_request_quote_for_caller(uuid) is
  'DB-RLS-04: the only user-session path to client_requests quote columns (authenticated holds no SELECT on them). Returns the quote for a team caller who can see the project, or for a client on a portal-enabled project once quote_sent_at is set; otherwise no row. Used by client_requests_client_read.';

revoke all on function public.client_request_quote_for_caller(uuid) from public, anon;
grant execute on function public.client_request_quote_for_caller(uuid) to authenticated;

-- 3. The view: same columns, same order, same types, same
--    security_invoker — only the source of the five quote values changes.
--    `create or replace` keeps its existing grant.
create or replace view public.client_requests_client_read
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
    q.quoted_hours,
    q.quoted_amount,
    q.quote_currency,
    q.quote_note,
    q.quote_valid_until,
    cr.quote_sent_at,
    cr.client_decision,
    cr.decided_by,
    cr.decided_at,
    cr.track,
    cr.track_overridden,
    cr.track_override_reason,
    cr.approval_request_id,
    cr.origin_assumption_id
  from public.client_requests cr
  left join lateral public.client_request_quote_for_caller(cr.id) q on true;

comment on view public.client_requests_client_read is
  'F025b + DB-RLS-04: security_invoker read of client_requests (row visibility = client_requests_select_author_or_team under the calling user). The five quote columns come from client_request_quote_for_caller: unmasked for the team, NULL for a client until quote_sent_at is set. authenticated holds no SELECT on those columns of the base table, so this view is the ONLY way any user session — team or client — reads a quote.';
