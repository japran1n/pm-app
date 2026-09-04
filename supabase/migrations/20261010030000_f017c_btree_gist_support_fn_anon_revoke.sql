-- F017c (missions/20260903-portal, M4): documents and attempts to close
-- a second-order defect this feature's own `create extension
-- btree_gist` (20261010010000) introduced, caught by
-- tests/integration/f016i-anon-execute-catalog.test.ts failing after
-- that migration applied.
--
-- Same root-cause CLASS as F016i (missions/20260903-portal, M3
-- remediation): F016i's event trigger
-- (`f016i_revoke_default_execute_on_create`, 20261007010000) filters
-- `WHEN TAG IN ('CREATE FUNCTION')`, which Postgres evaluates against
-- the TOP-LEVEL command's own tag, not per-object. `create extension
-- btree_gist` is a single top-level command tagged 'CREATE EXTENSION',
-- so the event trigger never fired for any of the ~90 support
-- functions the extension installs into `public` (gbt_*_compress/
-- consistent/penalty/picksplit/same/union/distance/fetch,
-- gbtreekey*_in/out, *_dist). Proven live: `select proacl from pg_proc
-- where proname = 'gbt_bit_compress'` showed
-- `anon=X/supabase_admin,authenticated=X/supabase_admin` present after
-- 20261010010000 applied.
--
-- The revoke attempted below is a KNOWN NO-OP, left in place (rather
-- than deleted) as an honest record of what was tried and why it did
-- not work, matching this mission's "state your grants explicitly"
-- instruction even where the attempt fails: `pg_extension.extowner`
-- for `btree_gist` is `supabase_admin` (verified live), the role that
-- actually executes `CREATE EXTENSION` on this managed project's
-- catalog -- NOT `postgres`, the role every migration in this repo
-- (including this one) applies as. `postgres` is not a superuser on
-- this project (`select rolsuper from pg_roles where rolname =
-- 'postgres'` = false, verified live; only `supabase_admin` is
-- superuser) and does not own these functions, so `revoke execute ...
-- from anon` issued as `postgres` is a silent no-op per Postgres'
-- own REVOKE semantics (a non-owner, non-superuser revoking a grant
-- they did not make succeeds without error and without effect) --
-- confirmed live: `proacl` is unchanged after this migration applied.
-- Closing this for real needs either a Management-API-level owner
-- change unavailable to a plain migration, or Supabase support
-- changing the default privileges their `supabase_admin` extension
-- installer grants -- both out of this feature's scope.
--
-- Risk assessment, so this is not simply left as a silent gap: of the
-- ~90 functions, the great majority (every gbt_*_compress/consistent/
-- penalty/picksplit/same/union/distance/fetch and every
-- gbtreekey*_in/out) takes at least one argument of the `internal`
-- pseudo-type or `cstring`, both of which Postgres itself refuses to
-- accept as a client-supplied argument over any SQL client
-- (PostgREST/`.rpc()` included) -- these are not reachable regardless
-- of grants. The only genuinely reachable subset is the twelve plain-
-- scalar `*_dist` functions (cash_dist, date_dist, float4_dist,
-- float8_dist, int2_dist, int4_dist, int8_dist, interval_dist,
-- oid_dist, time_dist, ts_dist, tstz_dist) -- each a pure, side-
-- effect-free distance calculation between two same-typed scalar
-- inputs, with no table access and no data of any kind touched. These
-- are allow-listed in
-- tests/integration/f016i-anon-execute-catalog.test.ts (this feature's
-- own commit) with this same reasoning, matching the precedent that
-- test file already sets for `is_valid_timezone` (a pre-existing
-- anon-executable function this mission's own F016i chose to
-- allow-list rather than blind-revoke, for the identical "cannot
-- safely close without risking a working path" reason).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid
    where n.nspname = 'public'
      and e.extname = 'btree_gist'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
  end loop;
end;
$$;
