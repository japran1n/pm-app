-- Audit ARCH-007: per-user rate limiting for the QA extension API routes
-- (app/api/extension/{tasks,context,attachments}). The three routes call
-- public.bump_extension_rate_limit via the service-role admin client
-- (lib/api/extension-auth.ts) after bearer auth succeeds; the routes fail
-- OPEN if this RPC errors, so applying this migration enables enforcement
-- and rolling it back merely disables it.
--
-- Design: fixed windows aligned to epoch multiples of p_window_seconds,
-- one counter row per (user, bucket, window). The upsert is atomic — the
-- ON CONFLICT DO UPDATE increments under the row lock, so concurrent
-- requests cannot lose counts.

create table public.extension_rate_limits (
  user_id uuid not null,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket, window_start)
);

-- RLS on with NO policies: default-deny for anon and authenticated via
-- PostgREST. Only the service-role (RLS-bypassing) admin client touches
-- this table, matching the workspace_members bootstrap precedent
-- (supabase/migrations/20260817222822_rls_workspaces.sql).
alter table public.extension_rate_limits enable row level security;

-- Atomically bump the current window's counter for (p_user_id, p_bucket)
-- and report whether this call is within p_limit. SECURITY DEFINER with a
-- pinned search_path (same hardening as
-- 20261120020000_function_search_path_hardening.sql) and body references
-- schema-qualified anyway.
create or replace function public.bump_extension_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  -- Window start aligned to epoch multiples of p_window_seconds, so the
  -- caller can compute Retry-After as the time to the next boundary.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.extension_rate_limits as rl
    (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = rl.count + 1
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Service-role/admin only, same posture as
-- 20261120060000_revoke_anon_execute_on_time_report_fns.sql and the
-- SEC-003 revokes: never callable through PostgREST by end users (which
-- would let a caller reset or race their own limits with chosen args).
revoke execute on function
  public.bump_extension_rate_limit(uuid, text, int, int) from public;
revoke execute on function
  public.bump_extension_rate_limit(uuid, text, int, int) from anon;
revoke execute on function
  public.bump_extension_rate_limit(uuid, text, int, int) from authenticated;
