-- F275 (AS-207): profiles.timezone had no CHECK constraint at all (M10
-- scrutiny, major finding under AS-207's write-up) — the UPDATE policy on
-- `profiles` lets a user write any column of their own row via a direct
-- PostgREST PATCH, so an invalid value was one client-side bug (or one
-- crafted request) away from landing in the column. Once there,
-- `get_overdue_count`'s `now() AT TIME ZONE p_timezone` (20260818210500_
-- rpc_overdue_count_timezone.sql) raises 22023 (invalid_parameter_value)
-- and the dashboard silently renders 0 overdue while the board renders
-- nothing overdue — both wrong in the same reassuring direction, with no
-- error surfaced anywhere. This closes that gap at the DB layer, per
-- tech-decisions.md's "DB is the last line, not the only line" validation
-- convention — the app's own Zod check
-- (lib/validation/profile.ts's isValidTimeZone) already guards the
-- updateProfile Server Action path; this is the backstop for every other
-- write path (direct PostgREST, a future Server Action, a bulk import).
--
-- CHECK constraints cannot contain subqueries in Postgres, so a direct
-- membership test against the `pg_timezone_names` view isn't usable here.
-- Instead this defines `is_valid_timezone(text)`, a small function that
-- attempts the exact conversion `get_overdue_count` and
-- lib/time/user-timezone.ts both already rely on (`... AT TIME ZONE tz`)
-- against a FIXED anchor timestamp (never `now()` — so the function has
-- no runtime dependency and is safe to mark IMMUTABLE), catching the
-- `invalid_parameter_value` error an unrecognized zone raises and
-- returning false instead of aborting the transaction. This accepts
-- exactly the same set of values Postgres's own `AT TIME ZONE` accepts —
-- including the bare "UTC" alias (profiles.timezone's own not-null
-- default, per 20260818200946_create_profiles.sql), so every existing
-- row already satisfies it.
create or replace function public.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  perform timestamp '2000-01-01 00:00:00' at time zone tz;
  return true;
exception
  when invalid_parameter_value then
    return false;
end;
$$;

comment on function public.is_valid_timezone(text) is
  'F275 (AS-207): true iff `tz` is a zone Postgres''s AT TIME ZONE recognizes -- the gate behind profiles_timezone_valid.';

alter table public.profiles
  add constraint profiles_timezone_valid check (public.is_valid_timezone(timezone));
