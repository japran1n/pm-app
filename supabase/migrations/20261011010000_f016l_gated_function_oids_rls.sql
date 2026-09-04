-- F016l (missions/20260903-portal, M3 remediation — blocker): the table
-- that guards the guard has no guard.
--
-- public.f016i_gated_function_oids (F016i, 20261007010000) is the
-- bookkeeping table F016i's event trigger uses to tell "genuinely new
-- function" from "create or replace of an existing function" by oid.
-- Proven live by the M3 fourth-gate reviewer, not inferred: it is the
-- only RLS-less table in `public`, and PostgREST exposes it to anon
-- with SELECT/INSERT/UPDATE/DELETE all live -- an anon-key
-- `POST /rest/v1/f016i_gated_function_oids` with `{"oid": 999999}`
-- returned 201, and the probe row was deleted again over the wire.
--
-- Two consequences, both undoing the exact feature that created the
-- table:
--   - anon INSERT of a plausible future oid pre-populates the table, so
--     when a later migration's CREATE FUNCTION actually allocates that
--     oid, the event trigger sees it already "gated" and skips the
--     revoke -- the function stays anon-executable. This reopens,
--     through F016i's own state, precisely the hole F016i was built to
--     close.
--   - anon DELETE of an existing row makes the next `create or replace`
--     of that function look like a first sighting to the trigger, which
--     then strips a live function's grants (a functional/availability
--     regression, not a privilege-escalation one, but still an anon
--     write with a real effect on production behaviour).
--
-- Fix: enable RLS on the table (no policies -- default-deny is exactly
-- right for postgres-owned bookkeeping nothing outside the owner should
-- ever read or write) and revoke the PostgREST-facing grants explicitly
-- so `anon`/`authenticated` have neither RLS-gated access nor a raw
-- table privilege to fall back on. The event trigger function itself
-- runs as the migration-applying `postgres` role (it is `security
-- invoker` by default, invoked by DDL machinery as the role executing
-- the DDL -- every migration in this schema applies as `postgres`, per
-- F016i's own migration header), which is the table owner and is
-- therefore unaffected by RLS (owners bypass RLS unless FORCE ROW LEVEL
-- SECURITY is set, and there is no reason to force it here -- nothing
-- legitimate ever connects as the table owner over PostgREST).
alter table public.f016i_gated_function_oids enable row level security;

revoke all on public.f016i_gated_function_oids from public, anon, authenticated;

comment on table public.f016i_gated_function_oids is
  'F016i: permanent record of which pg_proc oids in schema public have already had their first-creation EXECUTE-from-PUBLIC/anon/authenticated revoke applied by f016i_revoke_default_execute_on_create(). A CREATE OR REPLACE FUNCTION keeps the same oid, so an oid already in this table is a replace, not a genuinely new function, and is left alone -- Postgres preserves an existing function''s ACL verbatim across a replace, and every migration in this schema relies on that preservation without re-stating grants on body-only edits. F016l: RLS enabled with no policies (default-deny) and anon/authenticated table grants revoked -- this table is internal bookkeeping for a postgres-owned event trigger and was proven anon-writable over PostgREST before this fix (an anon POST could pre-poison a future oid or DELETE an existing gate).';
