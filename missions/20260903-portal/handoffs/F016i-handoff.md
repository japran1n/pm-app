# Handoff: F016i — The forward-looking half of F016g does nothing

## Status
COMPLETE

## Assertions covered
None directly assigned (same class as F016g and F006d, its M1/M3
siblings — this closes a schema-wide authorisation defect, not a named
assertion). Unblocks M4 per the milestone's own instruction: "M4 adds
functions, and nothing would surface the exposure" until this landed.

## Files changed
supabase/migrations/20261007010000_f016i_event_trigger_default_execute_and_catalog_test.sql
tests/integration/f016i-anon-execute-catalog.test.ts
lib/supabase/database.types.ts (regenerated — new table `f016i_gated_function_oids`)

## Commands run
`npm run db:apply -- supabase/migrations/20261007010000_f016i_event_trigger_default_execute_and_catalog_test.sql` (0)
Ad-hoc Management API SQL calls (rolled-back probes to prove the premise and the mechanism, then live committed statements — all folded back into the committed migration file so a fresh project reproduces the exact final state in one pass; see Decisions made): probe that `alter default privileges` is a no-op, probe that event triggers are permitted on this project, probe that `CREATE OR REPLACE` preserves an existing function's ACL, probe that `pg_proc.proacl IS NULL` cannot distinguish new-vs-replace, live verification of the applied migration's four cases, and one delta fix (`revoke execute on function public.f016i_revoke_default_execute_on_create() from public, anon, authenticated`) applied directly and folded into the committed file.
`npm run migrations:check` (0)
`npm run db:gen-types` (0 — new table only, no other signature change)
`npx vitest run tests/integration/f016i-anon-execute-catalog.test.ts` (0 — 4/4 passed; this is the "primary success test" and the "manual verification" bullet, both in one file)
`npx vitest run tests/integration/f016i-anon-execute-catalog.test.ts tests/integration/f016g-default-acl-hardening.test.ts` (0 — 9/9 passed)
`npx vitest run tests/integration/purge-trash-item.test.ts tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/overdue-notification-sweep.test.ts tests/integration/project-time-totals.test.ts tests/integration/trash-exclusion-dashboard.test.ts tests/integration/status-counts-rpc.test.ts tests/integration/dashboard-rls-cross-workspace.test.ts tests/integration/workspace-time-by-person.test.ts tests/integration/workspace-time-by-person-archived-project-exclusion.test.ts tests/integration/search-archived-project-exclusion.test.ts tests/integration/trash-exclusion-search.test.ts tests/integration/priority-counts-rpc.test.ts tests/integration/f006n-unguarded-task-rpcs.test.ts tests/integration/f016-change-request-quote-gate.test.ts tests/integration/rls-profiles.test.ts` (0 — 103/103 passed; this is the DoD's "failure test" — every function known to legitimately need `authenticated`/`anon` still works, run not reasoned about, same suite set F016g's own DoD used plus the two F016 suites this feature's retro-fix and allow-list changes could plausibly have touched)
`npx tsc --noEmit` (0)
`npx eslint tests/integration/f016i-anon-execute-catalog.test.ts` (0 errors, 0 warnings after removing an unused `beforeAll` import; the `.sql` file produced only the pre-existing "no matching configuration" warning eslint gives every migration file)
Full vitest suite deliberately NOT run, per this feature's own instruction.

## Decisions made

- **Verified the premise myself before building on it, per the mission
  instructions.** A rolled-back `DO` block probe against the live
  linked project — `create function public.zz_acl_probe_tmp() ...;
  raise exception 'PROBE_ACL=%', proacl` — reproduced the reviewer's
  finding exactly: a brand-new function's `proacl` still carries
  `=X/postgres` (PUBLIC) even with F016g's `alter default privileges
  ... revoke execute on functions from public` already applied. The
  premise holds; proceeded.

- **Event triggers ARE permitted on this Supabase project/plan** —
  verified with a second rolled-back probe: `create event trigger ...
  on ddl_command_end when tag in ('CREATE FUNCTION') execute function
  ...` inside a `DO` block that raised after succeeding, no permission
  error. This project's migrations all apply as `postgres` via the
  Management API (same role F016g's own migration documents), and that
  role has `CREATE EVENT TRIGGER` here. No fallback to a weaker
  mechanism was needed — the spec's preferred mechanism (item 1) is
  what shipped.

- **The event trigger must gate a function's FIRST creation only, not
  every `CREATE OR REPLACE`.** `ddl_command_end`'s tag is `'CREATE
  FUNCTION'` for both a genuine create and a replace of an existing
  function — it does not distinguish them. Verified live that `CREATE
  OR REPLACE FUNCTION` on an already-granted function preserves its
  exact `proacl` (byte-for-byte) if the body-only edit doesn't restate
  grants — which is the norm in this schema's own migration history
  (e.g. `sweep_overdue_blocking_deliverables` in F016h's own migration,
  whose comment says exactly this: "this CREATE OR REPLACE does not
  change the function's signature or SECURITY DEFINER-ness, so its
  existing grants ... are untouched"). An unconditional revoke on every
  `CREATE FUNCTION` ddl event would have silently stripped every such
  preserved grant the next time any of this schema's ~100 existing
  functions is replaced by a future migration — reproducing, with
  F016i's own mechanism, the exact "quietly broke two things" failure
  mode this feature's Definition of Done warns against.

  `pg_proc.proacl IS NULL` cannot distinguish new-vs-replace either —
  verified live that once F016g customized the schema's default
  privileges away from the pure Postgres built-in, a BRAND NEW
  function's `proacl` is already materialized non-null at `CREATE
  FUNCTION` time (the merge itself becomes the stored ACL), so `IS
  NULL` is never true for any function created after F016g, new or not.

  What actually works, verified live with committed (non-rolled-back)
  probes: `CREATE OR REPLACE FUNCTION` keeps the function's existing
  `pg_proc.oid`; a genuinely new function gets an oid the project has
  never had. The migration's event-trigger function therefore maintains
  a permanent table, `public.f016i_gated_function_oids`, backfilled at
  migration time with every oid that already exists in `public` (so
  none of F016g's ~100 already-covered functions are touched
  retroactively — this migration has no standing to silently revoke
  grants it didn't audit). On each `CREATE FUNCTION` ddl event the
  trigger function revokes `public`/`anon`/`authenticated` and records
  the oid ONLY if the oid is not already in that table. Four live cases
  proved this before and after applying the real migration (see the
  migration file's own header comment for the exact probes): (a) a
  genuinely new function with no grant → not anon/authenticated
  executable; (b) a new function immediately followed by an explicit
  `grant ... to authenticated` in the same migration → authenticated
  only, matching this schema's existing "revoke then grant back"
  convention; (c) replacing a genuinely pre-existing, already-granted
  function (`is_active_workspace_member`, live) WITHOUT restating its
  grant → grant survives untouched; (d) a scratch function with a
  deliberate `grant ... to anon` afterward → still detected as
  anon-executable (proves the mechanism doesn't defeat its own
  detectability).

- **The event trigger function's OWN grants were caught by the new
  catalog test on the very first real run** — a genuine, not
  hypothetical, proof the mechanism works. `public.f016i_revoke_default
  _execute_on_create()` is itself created by this migration's `create
  or replace function` statement, before the event trigger that would
  gate it exists yet, so it was exactly as exposed to the PUBLIC-merge
  bug as any other function. The catalog test flagged it on its first
  real run against the live project; fixed with an explicit `revoke
  execute ... from public, anon, authenticated` on it (it needs none —
  only the DDL machinery invokes event trigger functions, same
  reasoning this schema already applies to ordinary trigger functions).
  Documented inline in the migration.

- **Retro-fixed exactly the one function the milestone named**:
  `clear_client_deliverable_swept_at()` (F016h) — confirmed
  `anon_exec`/`authenticated_exec` both `true` before, both `false`
  after, via `has_function_privilege` against the live catalog.

- **Re-checked F016b live, not just by reading the migration text**:
  `raise_change_request_from_assumption_atomic` already issues its own
  `revoke all ... from public` followed by `grant execute ... to
  authenticated` in its own migration (20261003010000:190-191). Queried
  the live `proacl` directly: `{postgres=X/postgres,
  service_role=X/postgres, authenticated=X/postgres}`, `anon_exec =
  false`. Nothing to fix — recorded in the migration's header comment
  as a verified-not-broken check, not skipped silently.

- **The catalog test surfaced a real, pre-existing, out-of-scope
  finding: `is_valid_timezone` carries an explicit `anon=X/postgres`
  grant in the live catalog** that F016g's migration text never
  restored (it is in F016g's `authenticated_fns` array but NOT in
  `anon_fns`), so this grant predates or was applied outside what
  F016g's committed migration file describes. This is exactly the kind
  of thing "someone must remember" was supposed to prevent, and the
  catalog test caught it — but revoking it blind, without first proving
  no anon-role write path to `profiles.timezone` exists (the function
  backs the `profiles_timezone_valid` CHECK constraint, evaluated as
  the querying role per F016g's own comment), risks reproducing the
  exact "quietly broke two things" regression this feature's own DoD
  warns against, and is outside this feature's stated scope (which
  names F016h and F016b, not a general audit of every historical
  grant). AUTONOMOUS_DECISION: allow-listed `is_valid_timezone` in the
  catalog test with an inline comment documenting exactly this
  reasoning, rather than silently revoking or silently ignoring it, and
  flagged it below as an out-of-scope finding for a follow-up.

## Out-of-scope work needed

- **Investigate `is_valid_timezone`'s pre-existing `anon` grant.**
  `supabase/migrations/20260818225500_profiles_timezone_check.sql`
  never issues an explicit grant; F016g's migration
  (20261004010000)'s `anon_fns` array does not include it either — yet
  the live catalog shows `anon=X/postgres` on it today. Either (a) some
  anon-reachable write path to `profiles.timezone` genuinely needs it
  (find it and document it, the same way F016g documented each of its
  restorations), or (b) it is a leftover nobody explains and should be
  revoked with the same live-suite-run verification F016g/F016i both
  used (run `tests/integration/rls-profiles.test.ts` and anything else
  touching profile creation/signup before and after). This feature
  allow-listed it rather than resolve it, to avoid guessing at
  production authorization outside its stated scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: allow-listed `is_valid_timezone` in the new
catalog-derived test instead of revoking its pre-existing `anon` grant,
because that grant predates this feature's scope (F016h/F016b only,
per the spec), removing it without first proving no anon-role write
path needs it risks a regression the DoD explicitly warns against, and
this feature's mandate is the forward-looking mechanism + the two
named retro-fixes, not a full historical grant audit. Documented as an
out-of-scope follow-up above.

## Notes for the next worker

- The mechanism (`public.f016i_gated_function_oids` +
  `public.f016i_revoke_default_execute_on_create()` + the
  `f016i_revoke_default_execute` event trigger) requires no ongoing
  action from future migrations for genuinely NEW functions — they are
  safe by construction. A future migration that does `create or replace
  function` on an EXISTING function and wants to CHANGE its grants
  (e.g. add `anon`) must still issue its own explicit `grant`/`revoke`
  statements after the `create or replace`, exactly as this schema's
  migrations already do — the event trigger deliberately does not
  touch replaces of already-gated functions, so this half is still
  "someone must remember," but it is the half that was already a
  working convention (F016g's own audit found the "revoke then grant
  back" pattern already used inconsistently but present), not the half
  that was silently broken (brand-new functions, which this feature
  fixes).
- No MCP tools were used — the mission's registry marks the Supabase
  MCP as not authorised for this worker; all schema introspection and
  migration application went through the Management API directly
  (`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from `.env`, same
  mechanism `scripts/apply-migration.mjs` and
  `tests/integration/overdue-notification-sweep.test.ts` already use),
  per this feature's own instructions.
- Rolled-back `DO ... RAISE EXCEPTION` probes only surface their
  output in the transaction's final ERROR message when queried through
  the Management API's `database/query` endpoint — `RAISE NOTICE`
  inside a rolled-back block is silently dropped by that endpoint (no
  psql session to display it to). Build up a single result string and
  raise it in the final exception if you need to inspect intermediate
  state from a rolled-back probe against this project.
