# Handoff: F016j — the seventh instance, on a column added after the sixth was fixed

## Status
COMPLETE

## Assertions covered
AS-047: PASS — a client cannot insert or update `origin_assumption_id`, `kind`, or `severity` on `client_requests` directly (both the deny-list gaps M3-scrutiny-3 named), the eight previously-untested guarded columns (`quoted_hours`, `quote_currency`, `quote_note`, `quote_valid_until`, `decided_at`, `track`, `track_overridden`, `track_override_reason`) are now covered by the same allow-list mechanism (INSERT and UPDATE), the assumption-invalidation write is project-scoped as defense in depth, and a live-DB test proves a column added after this migration is protected by default without editing the guard function. Verified with `npx vitest run` against the live Supabase project (10/10 new tests pass) plus the full set of side-effect suites named below.

## Files changed
supabase/migrations/20261008010000_f016j_client_requests_allowlist_guard.sql
tests/integration/f016j-client-requests-allowlist-guard.test.ts
missions/20260903-portal/handoffs/F016j-handoff.md

## Commands run
`npm run db:apply -- supabase/migrations/20261008010000_f016j_client_requests_allowlist_guard.sql` (0)
`npm run db:gen-types` (0 — no diff; no new columns)
`npx vitest run tests/integration/f016j-client-requests-allowlist-guard.test.ts` (0 — 10/10 pass)
`npx vitest run tests/integration/f016-change-request-quote-gate.test.ts tests/unit/f016f-client-gate-revert-guard.test.ts` (0 — 15/15 pass, F016's and F016f's own suites)
`npx vitest run tests/integration/f016b-raise-change-request-from-assumption.test.ts tests/integration/client-requests-rls.test.ts tests/integration/f015-flag-assumption-atomic.test.ts tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts tests/integration/f016g-default-acl-hardening.test.ts tests/integration/f016i-anon-execute-catalog.test.ts tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/f016c-deliverable-task-scoping.test.ts` (0 — 80/80 pass; every other suite touching `client_requests`, `project_assumptions`, or function grants on this table)
`npx tsc --noEmit` (0)
`npx eslint tests/integration/f016j-client-requests-allowlist-guard.test.ts` (0)

## Decisions made
- Inverted `enforce_client_requests_triage_columns_immutable_by_author` from a hand-enumerated deny-list to a generic `to_jsonb()` diff against an allow-list: `title`/`body`/`desired_by` always, plus `id`/`project_id`/`created_by`/`created_at`/`updated_at` at INSERT only (identity columns with non-deterministic or caller-supplied defaults). Everything else must equal that column's own schema default at INSERT (computed live from `pg_attrdef`/`pg_get_expr`, not hard-coded, so a future column is covered with zero edits to this function) and cannot change at all at UPDATE.
- Left `id`/`created_at`/`updated_at`/`project_id`/`created_by` out of the UPDATE allow-list (narrower than INSERT): no author-facing code path updates them, and RLS's own `client_requests_update_author_while_submitted` policy never pinned `project_id` against `OLD.project_id` — this guard now closes that latent gap as a byproduct of the allow-list architecture, not as separate scope creep.
- Added the project predicate M3-scrutiny-3 specified verbatim: `client_requests_sync_decision_from_approval`'s assumption-invalidation UPDATE now also requires `project_id = v_request.project_id`. Kept as defense in depth even though the allow-list guard now makes `origin_assumption_id` entirely unwritable by an author at INSERT — the milestone note explicitly asked for both, "so the column cannot reach outside the request's own project even if the guard is later weakened."
- Wrapped `raise_change_request_from_assumption_atomic`'s own INSERT in the existing `app.client_requests_triage_guard_bypass` transaction-local flag, matching every other legitimate non-author writer of these columns. Not strictly load-bearing today (the function always resolves `created_by` to an active *client*, never the calling team member, so the guard's `new.created_by = auth.uid()` gate already skips it) — added because M3-scrutiny-3 asked for it explicitly and because the function's safety should not rest on that coincidence.
- Did NOT extract one shared helper with F009d's proposed `approval_requests` inversion (F009d is a separate, non-blocking M2 feature not assigned to me). The two tables' allow-lists, verbs (this guard also gates INSERT; F009d's is UPDATE-only on settled rows), and default-row construction differ enough that a shared function would need as many branches as it saves. The *technique* — `to_jsonb(NEW) - allow_list` diffed against a reference row — is what's reusable, and F009d's own migration should apply the same technique when picked up. Said so in the migration's own header comment per the spec's instruction.
- The self-maintaining test (definition of done item 3) runs one Postgres `DO` block via the Management API's raw-SQL query endpoint (the same mechanism `scripts/apply-migration.mjs` uses) that: `ALTER TABLE ADD COLUMN`, switches to `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims` (the same technique PostgREST itself uses to simulate a real client session), attempts an author INSERT setting the new column, asserts the guard's `42501` fires, then unconditionally raises to roll back the whole block — so neither the column nor the probe row ever persists. Verified working stand-alone against the live project before wiring it into the vitest suite (see Notes).

## Out-of-scope work needed
- F009d (M2, non-blocking): the same allow-list inversion for `approval_requests`' settled-row immutability trigger — not touched here, per scope. Worth reusing the `to_jsonb(NEW) - allow_list` diff technique this migration establishes.
- Not discovered here, but noticed in passing and out of scope: `client_requests_update_author_while_submitted`'s RLS `WITH CHECK` still doesn't pin `project_id`/`created_by` against `OLD` by name; this guard trigger now backs that up structurally for the author-write path, but the RLS policy text itself is unchanged. No behavioural gap remains (the trigger is unconditional and fires before the policy's own check on every row), so no follow-up feature is proposed for it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No clarification file exists for F016j (this is a milestone-remediation feature spec, not one that went through `/mission-tasks`). Used the feature spec plus M3-scrutiny-3's own remediation note (which is more specific than the feature spec alone — it names `severity`, `kind`, the eight untested columns, and the exact project-predicate SQL) as the source of truth, per the ambiguity priority order in `worker-mcp-usage`.
AUTONOMOUS_DECISION: Chose not to add `severity`/`kind` to any allow-list (client never authors them per `lib/actions/client-requests.ts`'s own INSERT payload), even though the old deny-list also never protected them — this closes exactly the gap M3-scrutiny-3 named.

## Notes for the next worker
- The self-maintaining-guard test's raw-SQL probe was validated stand-alone against the live project (via a scratch Node script hitting the same Management API endpoint `scripts/apply-migration.mjs` uses) before being wired into vitest, to de-risk the `SET LOCAL ROLE`/`request.jwt.claims` simulation independently of test-framework concerns. Confirmed: guard fires (`42501`), the `DO` block's own final `raise exception` rolls back the `ALTER TABLE` and the insert attempt together, and the probe column is absent from `information_schema.columns` afterward.
- MCP: the Supabase MCP is not authorised for this mission (per the task instructions); all schema work went through the CLI/`npm run db:apply` and the Management API's raw-SQL endpoint, matching `scripts/apply-migration.mjs`'s own established mechanism.
- `enforce_client_requests_triage_columns_immutable_by_author` and `client_requests_sync_decision_from_approval` were both `CREATE OR REPLACE`d on existing functions, so F016i's new-function EXECUTE-revoke event trigger does not apply (it only fires on `CREATE FUNCTION`, not `CREATE OR REPLACE FUNCTION` on something that already exists) — existing grants (`authenticated` on the guard is implicit via the trigger, not a direct grant; `raise_change_request_from_assumption_atomic`'s explicit `grant execute ... to authenticated` from 20261003010000) were confirmed untouched, no new grant statements needed.
