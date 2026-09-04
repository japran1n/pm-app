# Handoff: F016k — Three more tests that cannot fail, and one state nothing can reach

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `getDeliverablesPastDueCount` (lib/queries/deliverables.ts) now calls `isDeliverablePastDue` itself instead of re-expressing its condition as three PostgREST filters; the badge/view agreement test now calls the real `getDeliverablesPastDueCount` (mocked DB seam) and the real `classifyBucket`, and fails when either is mutated independently (verified, see Decisions made).
AS-030: PASS — `swept_at`'s accept/waive clearing branch is now covered by two dedicated integration tests (verified to fail when the trigger's clause is removed, then reverted); `state = 'waived'` is now reachable via `accept_deliverable_atomic(p_decision => 'waived')` and the "Waive" button in `components/project/deliverables-panel.tsx`, covered by two new integration tests.

## Files changed
lib/queries/deliverables.ts
lib/validation/deliverables.ts
lib/actions/deliverables.ts
components/project/deliverables-panel.tsx
supabase/migrations/20261009010000_f016k_waive_deliverable.sql
lib/supabase/database.types.ts (regenerated; no diff — RPC signature unchanged)
tests/unit/portal-overview-queries.test.ts
tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts
tests/integration/f013-deliverables-review-and-sweep.test.ts
tests/integration/f016-change-request-quote-gate.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261009010000_f016k_waive_deliverable.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/unit/portal-overview-queries.test.ts tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts` (0)
`npx vitest run tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/f016-change-request-quote-gate.test.ts tests/unit/f016f-client-gate-revert-guard.test.ts` (0, live DB, 71 tests)
`npx vitest run tests/unit` (0, 218 files / 1703 tests)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, only pre-existing unrelated warnings)

## Decisions made
- **Item 1 (badge/view tautology).** `getDeliverablesPastDueCount` used to ask PostgREST to re-express `isDeliverablePastDue`'s condition (`not in (accepted,waived)`, `due_at not null`, `due_at < today`) as three separate filters — a second, independently-typed copy of the same predicate. It now selects the bare `state`/`due_at` columns for the project and calls `isDeliverablePastDue` in TypeScript, once. The badge/view agreement test in `tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts` now mocks `@/lib/supabase/server` with a real row set and calls the REAL `getDeliverablesPastDueCount`, comparing its result to the REAL `classifyBucket`'s "blocked" count over the same rows — two independently-written code paths, not one function compared to itself. **Verified the mutation catches both directions**: (a) temporarily made `isDeliverablePastDue` always return `false` — 4 tests failed including the joint one, reverted; (b) temporarily made `classifyBucket`'s past-due branch always return `"waiting"` — 6 tests failed including the joint one, reverted. `git diff --stat` confirmed only the intended source changes remained after each revert.
- **Item 2 (untested swept_at branches).** Added two integration tests (`tests/integration/f013-deliverables-review-and-sweep.test.ts`) that directly UPDATE a swept deliverable's `state` to `'accepted'` and, separately, to `'waived'` (bypassing the RPC, to isolate the trigger itself), asserting `swept_at` clears in both cases. **Verified the mutation catches it**: temporarily replaced `clear_client_deliverable_swept_at`'s body with only the `due_at is distinct from old.due_at` clause (removed the whole `or (new.state in ('accepted','waived') and old.state not in (...))` branch) via a direct SQL apply against the live project (not a committed migration) — both new tests failed as expected. Restored by reapplying `20261006010000_f016h_swept_at_per_pair.sql`, `20261007010000`, `20261008010000`, and this feature's own `20261009010000` in order (reapplying only the 2006h file first accidentally reverted `sweep_overdue_blocking_deliverables` to its pre-F016h, per-task-not-per-pair form too — caught by a full-suite rerun, fixed by reapplying every migration since in original order). Final state verified via `pg_proc.prosrc` to match the repo's migration files exactly, and the full 71-test set passes clean.
- **Item 3 (dead `waived` state) — DECISION: gave it the action, did not remove it.** Per the feature spec's own framing ("a real thing a PM does"), and because `isDeliverablePastDue`, the sweep's `not in ('accepted','waived')` filter, and the swept_at-clearing trigger already correctly treat `waived` as settled (all three since F013/F016h) — removing the enum value would mean deleting the one thing that could ever *produce* a state three other pieces of code already correctly *consume*, the same "dead code future readers must reason about" shape in reverse. New migration `20261009010000_f016k_waive_deliverable.sql` extends `accept_deliverable_atomic` to accept `p_decision = 'waived'`: sets `state = 'waived'`, clears `accepted_at`/`accepted_by` (a waive is not an acceptance), stores an optional note in `review_note` (no note required, unlike `'returned'` — a PM waiving their own team's obligation does not owe the client an explanation). `lib/validation/deliverables.ts`'s `decideDeliverableSchema` and `lib/actions/deliverables.ts`'s `decideDeliverable` input type both extended to `"accepted" | "returned" | "waived"`. `components/project/deliverables-panel.tsx` gained a "Waive — we won't chase this" button, available whenever a deliverable is not already `accepted`/`waived` (independent of the `canReview`/"delivered" gate — waiving is not a review outcome). Covered by two new integration tests: the RPC produces `state = 'waived'` with no `accepted_at`/`accepted_by`, and a waived deliverable's overdue-ness no longer blocks its task via the sweep.
- **Item 4 (F016f's grep-only guard).** Left the existing static test (`tests/unit/f016f-client-gate-revert-guard.test.ts`) in place as a fast, credential-free first line, and added a genuinely behavioural test in `tests/integration/f016-change-request-quote-gate.test.ts`: a second fixture project with `portal_enabled: false`, and a new test asserting `send_change_request_quote_atomic` refuses (42501, "portal is not enabled") a caller who passes every OTHER check (active workspace writer, valid `scope_verdict`) on that project, and that the row is left unchanged. **Verified the mutation catches it**: temporarily replaced the live function with a version whose `client_gate(...)` call passes `p_require_portal_enabled => false` (flags neutered, not deleted — the exact class the grep test cannot see) via a direct SQL apply — the new test failed (`expected null not to be null`). Restored by reapplying `20261005010000_f016f_insert_hole_and_reverts.sql`; verified via full-suite rerun (71 tests green).
- All live-DB mutation verification was done via direct SQL against the connected Supabase project (not committed as migrations), then reverted by reapplying the relevant real migration files in their original order — no mutation was left in the database or in a migration file.

## Out-of-scope work needed
None identified beyond this feature's own four items.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For item 3, chose "give `waived` its action" over "remove it everywhere," per the feature spec's own explicit preference ("which is a real thing a PM does") and because three other pieces of code (isDeliverablePastDue, the sweep, the swept_at trigger) already correctly handle a waived row — removal would have required touching all three to no benefit, and would leave correct-but-now-dead handling behind instead of a dead write path. No note is required to waive (unlike "returned"), on the reasoning that a PM waiving their own team's internal obligation does not owe the client the same explanation a returned/rejected client-visible deliverable does; this is an interpretation of the spec's silence on the point, not stated explicitly in the spec.

## Notes for the next worker
- `getDeliverablesPastDueCount`'s new shape (`select("state, due_at").eq("project_id", ...)` then filter in JS) means the mock for `client_deliverables` in `tests/unit/portal-overview-queries.test.ts` changed shape too (single `.eq()` terminal returning raw rows, not a `.not().not().lt()` chain returning a pre-filtered `count`). If a future feature adds a filter to this query, update that mock's `eq` handler, not the removed `not`/`lt` handlers (they're gone).
- The "Waive" button reuses the same `reviewNoteDraft` textarea/state as "Return with note" for its optional note — there is no second note field. If a future feature wants the waive note to be independently composable while an accept/return note is also drafted, that will need its own state.
- No MCP tools were used for this feature — all live-DB verification (schema/function inspection, mutation testing) went through the repo's existing `npm run db:apply` / a raw SQL query against the Management API using `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from `.env`, matching this repo's own `scripts/apply-migration.mjs` convention (per mission instructions: "Supabase MCP is not authorised — use the CLI").
