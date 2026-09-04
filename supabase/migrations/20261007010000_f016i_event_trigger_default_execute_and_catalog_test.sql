-- F016i (missions/20260903-portal, M3 remediation — blocker for starting
-- M4): F016g's forward-looking half is a no-op.
--
-- `alter default privileges in schema public revoke execute on
-- functions from public, anon, authenticated` (F016g,
-- 20261004010000:89-90) does NOT prevent a function created after that
-- migration from being EXECUTE-able by `anon`. Proven live, not
-- inferred: `public.clear_client_deliverable_swept_at()` (F016h,
-- 20261006010000:37 — the only function created from scratch since
-- F016g) has `proacl = {=X/postgres,postgres=X/postgres,
-- service_role=X/postgres}` and `has_function_privilege('anon', …,
-- 'EXECUTE') = true` in the applied catalog, despite F016g's default-
-- privilege revoke being in place the entire time F016h was written.
-- Root cause, confirmed by a rolled-back probe against the live
-- project (`create function public.zz_acl_probe_tmp() …` inside a `DO`
-- block that raises at the end): Postgres computes a new function's
-- effective ACL as the BUILT-IN default (`EXECUTE TO PUBLIC`) MERGED
-- WITH the stored default ACL, not replaced by it. The stored default
-- ACL for `(postgres, public, f)` genuinely has no PUBLIC entry after
-- F016g's `alter default privileges` — `select defaclacl from
-- pg_default_acl where defaclnamespace = 'public'::regnamespace and
-- defaclobjtype = 'f'` shows `{postgres=X/postgres,
-- service_role=X/postgres}` — but the merge with the built-in default
-- still grants PUBLIC (and therefore `anon`) EXECUTE on every function
-- Postgres creates from that point on. `alter default privileges` can
-- only ever narrow what gets merged in; it can never suppress the
-- built-in PUBLIC grant itself. This is a documented Postgres
-- limitation (there is no "default default privilege" override for the
-- built-in), not a mistake in how F016g wrote the statement.
--
-- Fix, in order:
--   1. An event trigger on `ddl_command_end` for `CREATE FUNCTION`,
--      scoped to schema `public`, that revokes EXECUTE from `public`,
--      `anon` and `authenticated` on every function this project
--      creates for the FIRST time from now on — "safe by construction"
--      rather than "someone must remember to add a revoke line to
--      their migration." Verified permitted on this Supabase project
--      by the same rolled-back-probe technique: `create event trigger
--      … on ddl_command_end when tag in ('CREATE FUNCTION') execute
--      function …` inside a `DO` block that raises after creating it
--      succeeded (no permission error), so this project's `postgres`
--      role — the role every migration in this repo applies as, per
--      `scripts/apply-migration.mjs` and F016g's own migration header
--      — has the privilege. No fallback to a weaker mechanism was
--      needed.
--
--      The trigger must NOT touch `CREATE OR REPLACE FUNCTION` on an
--      already-existing function — Postgres preserves that function's
--      existing ACL verbatim across a replace (confirmed live: granting
--      `authenticated` on a scratch function, then replacing its body
--      with `create or replace function` and NOT re-issuing the grant,
--      leaves `has_function_privilege('authenticated', …, 'EXECUTE') =
--      true` afterward), and every existing migration in this schema's
--      history relies on exactly that preservation — none of them
--      re-states a function's grants on every body-only edit. An
--      unconditional revoke on every `CREATE FUNCTION` DDL event
--      (`ddl_command_end`'s tag does not distinguish "create" from
--      "replace an existing object") would silently strip those
--      preserved grants the next time any of this schema's ~100
--      existing functions is replaced by a future migration — the
--      exact "quietly broke two things" failure mode this feature's
--      own Definition of Done warns about, reproduced with F016g's own
--      mechanism if left unguarded.
--
--      `pg_proc.proacl IS NULL` cannot distinguish "genuinely new" from
--      "existing, never explicitly touched" either: confirmed live
--      that once F016g's `alter default privileges` customized the
--      default away from the pure built-in, `proacl` is materialized
--      non-null immediately at `CREATE FUNCTION` time (the merge
--      itself becomes the stored ACL), so a brand-new function's
--      `proacl` is already non-null before this migration's trigger
--      ever runs.
--
--      What actually distinguishes them, confirmed live with a
--      rolled-back-then-committed probe: `CREATE OR REPLACE FUNCTION`
--      keeps the same `pg_proc.oid` the function already had; a
--      genuinely new function gets an oid this project has never seen.
--      So the trigger function maintains a permanent table of oids it
--      has already gated once (backfilled below with every function
--      that exists in `public` at migration time, so nothing already
--      covered by F016g's per-function revoke/grant convention is
--      touched); on each `CREATE FUNCTION` ddl event it revokes and
--      records the oid only if the oid is not already in that table.
--      A function's FIRST creation is gated exactly once, permanently;
--      every subsequent `create or replace` on that same signature is
--      left alone, exactly matching this schema's existing "revoke
--      from public once, grant back deliberately" convention — now
--      enforced instead of merely conventional.
--
--   2. Retro-fix the one function proven anon-executable today:
--      `clear_client_deliverable_swept_at()`. It returns `trigger` and
--      cannot be called over PostgREST, so today's exposure is nil, but
--      it should not carry `=X/postgres` (PUBLIC) in its `proacl`.
--
--   3. `raise_change_request_from_assumption_atomic` (F016b,
--      20261003010000:190-191) was re-checked live: it already issues
--      its own `revoke all … from public` followed by `grant execute
--      … to authenticated` in its own migration, so its `proacl` today
--      is `{postgres=X/postgres,service_role=X/postgres,
--      authenticated=X/postgres}` with `anon_exec = false` — no PUBLIC
--      entry, nothing to fix. Confirmed by direct query against the
--      live catalog, not inferred from the migration text.
--
--   4. The real deliverable per this feature's scope: a catalog-derived
--      test (`tests/integration/f016i-anon-execute-catalog.test.ts`)
--      that queries every function in `public` and its
--      `has_function_privilege('anon', …, 'EXECUTE')`/`('public', …)`
--      result directly, fails if any function not on an explicit
--      allow-list is anon-executable, and — per the Definition of
--      Done's manual-verification bullet — is proven to fail by
--      actually granting `anon` EXECUTE on a scratch function inside
--      the test itself and asserting the test's own detection query
--      would flag it (see that file for the live "grant, detect,
--      revoke" round-trip).

-- ---------------------------------------------------------------------
-- 1. Event trigger: gate every function's FIRST creation, permanently.
-- ---------------------------------------------------------------------

create table if not exists public.f016i_gated_function_oids (
  oid oid primary key,
  gated_at timestamptz not null default now()
);

comment on table public.f016i_gated_function_oids is
  'F016i: permanent record of which pg_proc oids in schema public have already had their first-creation EXECUTE-from-PUBLIC/anon/authenticated revoke applied by f016i_revoke_default_execute_on_create(). A CREATE OR REPLACE FUNCTION keeps the same oid, so an oid already in this table is a replace, not a genuinely new function, and is left alone -- Postgres preserves an existing function''s ACL verbatim across a replace, and every migration in this schema relies on that preservation without re-stating grants on body-only edits.';

-- Backfill: every function that exists in `public` right now was
-- created before this mechanism existed and is already covered (or
-- knowingly not covered) by F016g's per-function revoke/grant
-- convention. None of them should be gated retroactively by this
-- migration -- gating an existing granted function here would revoke
-- privileges this migration has no authority to remove silently.
insert into public.f016i_gated_function_oids (oid)
select p.oid
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
on conflict do nothing;

create or replace function public.f016i_revoke_default_execute_on_create()
returns event_trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() loop
    if obj.object_type = 'function' and obj.schema_name = 'public' then
      if not exists (
        select 1 from public.f016i_gated_function_oids where oid = obj.objid
      ) then
        execute format(
          'revoke execute on function %s from public, anon, authenticated',
          obj.object_identity
        );
        insert into public.f016i_gated_function_oids (oid)
        values (obj.objid)
        on conflict do nothing;
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.f016i_revoke_default_execute_on_create() is
  'F016i: fires on every CREATE FUNCTION ddl_command_end in schema public. Revokes EXECUTE from public/anon/authenticated on a function the FIRST time its oid is ever seen (a genuinely new function), then records the oid so every later CREATE OR REPLACE of that same function is left untouched. Makes F016g''s forward-looking claim -- "every function created from now on is safe by default" -- actually true; `alter default privileges ... revoke execute on functions from public` alone is a no-op because Postgres merges the stored default ACL with the built-in EXECUTE TO PUBLIC grant.';

drop event trigger if exists f016i_revoke_default_execute;
create event trigger f016i_revoke_default_execute
  on ddl_command_end
  when tag in ('CREATE FUNCTION')
  execute function public.f016i_revoke_default_execute_on_create();

-- No EXECUTE grant needed on the event trigger function itself --
-- event triggers are invoked by the DDL machinery, not called via a
-- role-checked RPC, same reasoning this schema already applies to
-- ordinary trigger functions (e.g. clear_client_deliverable_swept_at
-- itself, F016h's own comment). It was, however, created by THIS
-- migration's own `create or replace function` statement above --
-- before the event trigger that would have gated it existed -- so it
-- is exactly as exposed to the built-in PUBLIC-merge bug as any other
-- new function would be. Caught live by this feature's own catalog
-- test (tests/integration/f016i-anon-execute-catalog.test.ts), which
-- flagged `f016i_revoke_default_execute_on_create` as anon-executable
-- on the first real run -- proof the mechanism and the test are doing
-- their job, including on the very migration that introduces them.
revoke execute on function public.f016i_revoke_default_execute_on_create()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Retro-fix: the one function proven anon-executable today.
-- ---------------------------------------------------------------------
revoke execute on function public.clear_client_deliverable_swept_at()
  from public, anon, authenticated;
