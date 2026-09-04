# Handoff: F016l — The table that guards the guard has no guard

## Status
COMPLETE

## Assertions covered
None directly assigned in `validation-contract.md` (same class as F016g/F016i/F006d — a schema-wide authorisation defect fix, not a named assertion). The Definition of Done's four bullets are covered by tests below instead.

## Files changed
supabase/migrations/20261011010000_f016l_gated_function_oids_rls.sql
tests/integration/f016l-public-table-rls-catalog.test.ts
lib/supabase/database.types.ts (regenerated — no schema-visible signature change, table already existed)

## Commands run
`npm run db:apply -- supabase/migrations/20261011010000_f016l_gated_function_oids_rls.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/integration/f016l-public-table-rls-catalog.test.ts` (0 — 7/7 passed)
`npx vitest run tests/integration/f016i-anon-execute-catalog.test.ts tests/integration/f016j-client-requests-allowlist-guard.test.ts tests/integration/f016l-public-table-rls-catalog.test.ts` (0 — 21/21 passed; this is the DoD's "side-effect verification" bullet)
`npx tsc --noEmit` (0)
`npx eslint tests/integration/f016l-public-table-rls-catalog.test.ts` (0 errors, 0 warnings)
Full vitest suite deliberately NOT run, per this feature's own instruction.

## Decisions made

- **RLS enabled with zero policies (default-deny), not a permissive policy for `postgres`.** Nothing outside the table owner should ever read or write `f016i_gated_function_oids` — it is internal bookkeeping for a `security invoker` event trigger function that runs as whichever role applies the DDL (this schema's migrations always apply as `postgres`, which owns the table). Owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set; the local convention (grep-verified: `supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql:63-65`, "No FORCE ROW LEVEL SECURITY: same rationale as time_entries ... the app never connects as the table owner for reads") is to not force it, since nothing legitimate connects as owner over PostgREST anyway. Followed that same convention here rather than inventing a new one.

- **Also revoked raw table grants (`revoke all ... from public, anon, authenticated`) in addition to enabling RLS.** RLS with no policies already default-denies PostgREST access, but an explicit revoke closes the underlying GRANT layer too rather than relying solely on RLS as the only barrier — matches this migration's own comment ("neither RLS-gated access nor a raw table privilege to fall back on"). Verified via `information_schema.role_table_grants` in the new test that no anon/authenticated grant remains.

- **Catalog test derives from `pg_class.relrowsecurity` joined to `pg_namespace`, not a list of table names** — same shape as F016i's `pg_proc`/`has_function_privilege` catalog test (`tests/integration/f016i-anon-execute-catalog.test.ts`), which is the shape the spec explicitly asks to match ("the same shape as F016i's own function test, which is what made that one useful"). It queries every `relkind = 'r'` table in `public` live and fails on ANY of them lacking RLS — a future migration that creates a table and forgets `enable row level security` fails this suite regardless of the table's name. Confirmed it is not vacuously green: it currently passes against ~45 existing tables (all already RLS-enabled, grep-verified none of this mission's pre-existing tables were the defect — `f016i_gated_function_oids` was the only exception) plus the freshly-fixed one.

- **Primary success test proves the exact four requests the reviewer proved** — anon-key `fetch` directly against `/rest/v1/f016i_gated_function_oids`, same convention as `tests/integration/f006k-projects-column-role-gate.test.ts`'s anon-key REST calls (grep-verified: that file builds `PUBLISHABLE_KEY`/`SUPABASE_URL` from `.env` the same way). INSERT uses the exact reviewer payload (`{"oid": 999999}`); SELECT/UPDATE/DELETE all target the same probe oid. SELECT is asserted as "zero rows" rather than a specific status code, because default-deny RLS with no policies returns PostgREST `200` with an empty array for SELECT (not a 401/403) — asserting only a status code here would have been the wrong shape and could pass on the old, broken table if it happened to have no rows at the moment of the test.

- **Failure test uses a rolled-back `DO` block probe against the live project** (`create function ...; raise exception 'F016L_PROBE_RESULT ...'`), same rolled-back-probe technique F016i's own migration header documents and that this worker verified reproduces `t`/`f` (not `true`/`false`) in the Management API's error message — the first version of this test used a `true|false` regex and failed for that exact reason; fixed to accept both.

## Out-of-scope work needed

- **Item 3 of the spec ("check whether anything else this mission created is an object no test covers") — findings, with an honest boundary on the claim:**
  - Checked (grep across `supabase/migrations/*.sql` for `create table`, `create view`/`create or replace view`/`create materialized view`, `create sequence`, `create type`): this mission (F001–F017 in `missions/20260903-portal/`) created two new tables besides the one this feature fixes — `project_budgets` (F017, `20261010010000`, RLS enabled per that migration's own text, grep-verified line 63) and used the pre-existing `time_entries`/`f016i_gated_function_oids` tables (no other new table). It created no new views, sequences, or types — the only two `create view`/`create or replace view` statements in the whole migration history (`20260822010000_active_project_tasks_view_and_time_report_fix.sql`, `20260824060000_status_category_semantics.sql`) predate this mission's ID range and are not this mission's output.
  - The new catalog test in this feature (item 1 above) now covers every table in `public`, including `project_budgets` and any table a future feature adds — so "a table with no RLS" is now a class of defect CI catches going forward, not just this one instance.
  - **Boundary of this claim:** this check was a `create table`/`create view`/`create sequence`/`create type` grep across migration files, not a live catalog diff against a pre-mission baseline, and it does not cover: (a) whether every new *column* added to a pre-existing table (e.g. `time_entries`'s work-category column from F017) is itself checked by a test — this feature's scope is "tables, views, sequences, types" per the spec, not columns; (b) RPCs/functions, which F016i's own catalog test already covers; (c) whether `project_budgets`'s RLS *policies* (not just RLS being enabled) are individually correct — F017's own handoff should be consulted for that, this feature only confirms RLS is *on*, which the new catalog test would already have caught being off. This is a name-derived, migration-file-grep survey of object *creation*, not a full live-schema audit of every object's individual correctness.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: chose "RLS enabled, zero policies, explicit revoke of table grants" over "RLS enabled plus a permissive policy scoped to `service_role`/`postgres`" for `f016i_gated_function_oids`, because nothing in this schema's application code (grep-verified: no reference to this table outside the migration that created it and this feature's own test) ever needs to read or write it except the event trigger function itself, which runs as the table owner and bypasses RLS entirely without needing a policy. A policy would be dead code adding surface area for no behavioural gain.

## Notes for the next worker

- No MCP tools were used — same as F016i, the Supabase MCP is not authorised for this mission's workers; all schema introspection and migration application went through the Management API directly (`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from `.env`) and `npm run db:apply`.
- The rolled-back `DO ... RAISE EXCEPTION` probe technique returns PL/pgSQL boolean literals as `t`/`f` in the Management API's error text, not JavaScript's `true`/`false` — this bit the first draft of the failure test in this feature; worth remembering for any future worker copying this pattern.
- `has_function_privilege`/`pg_class.relrowsecurity`/`information_schema.role_table_grants` are all read through the Management API's `database/query` endpoint (not PostgREST/`.rpc()`), same as F016i's suite, because none of them are reachable through a Supabase client.
