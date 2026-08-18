-- F124 (AS-207): "due-date and overdue calculations use the user's
-- timezone, not the server's" — extends F075's `get_overdue_count` RPC
-- (supabase/migrations/20260818080000_rpc_overdue_count.sql) to accept the
-- caller's IANA timezone and compute "today" against it, instead of the
-- database server's own `current_date` (which is effectively UTC).
--
-- Decision (recorded per this feature's assignment — "decide explicitly
-- how the user's timezone reaches it"): a new `p_timezone text` parameter,
-- defaulting to `'UTC'` (matching F120's own `profiles.timezone` column
-- default and F123's validated-write fallback). The app-level caller
-- (lib/queries/dashboard.ts's `getOverdueCount`) always passes the real
-- caller's `profiles.timezone`, resolved once per request by
-- lib/queries/profile.ts's `getCurrentUserTimezone` — the default only
-- exists so callers that predate this migration (this suite's own
-- pre-existing RLS/perf tests, which call the RPC directly to prove
-- workspace-scoping and have nothing to do with timezone behavior) keep
-- working unchanged, per this mission's additive-migration convention.
--
-- `t.due_date < (now() AT TIME ZONE p_timezone)::date` replaces
-- `t.due_date < current_date`: `now()` is `timestamptz`; `AT TIME ZONE
-- p_timezone` converts it to the wall-clock `timestamp` in that zone
-- (Postgres's own IANA-timezone-database-aware conversion, DST included);
-- `::date` takes just the calendar date — i.e. "what day is it right now,
-- for this user", the exact same definition
-- lib/time/user-timezone.ts's `todayInTimeZone` computes in application
-- code. Both `t.status <> 'done'` and the implicit `due_date is not null`
-- exclusion (NULL < anything is NULL, not true) are unchanged from F075.
--
-- `create or replace function get_overdue_count(p_workspace_id uuid)`
-- cannot simply gain a trailing parameter in place — Postgres identifies a
-- function by its argument TYPE list, so appending `p_timezone` would
-- create a second, distinct `get_overdue_count(uuid, text)` overload
-- alongside the original `get_overdue_count(uuid)` rather than replacing
-- it, leaving two definitions of "overdue" disagreeing forever (the old
-- one still on server time). The explicit `drop function` below removes
-- the single-argument version first so there is exactly one
-- `get_overdue_count` in the database, with `p_timezone` optional.
drop function if exists get_overdue_count(uuid);

create function get_overdue_count(p_workspace_id uuid, p_timezone text default 'UTC')
returns bigint
language sql
stable
security invoker
as $$
  select count(*)::bigint
  from tasks t
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and p.deleted_at is null
    and t.due_date < (now() AT TIME ZONE p_timezone)::date
    and t.status <> 'done';
$$;

revoke all on function get_overdue_count(uuid, text) from public;
grant execute on function get_overdue_count(uuid, text) to authenticated, anon;
