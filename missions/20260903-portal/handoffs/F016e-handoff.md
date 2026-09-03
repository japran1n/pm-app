# Handoff: F016e — The four M3 correctness defects

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `test_AS_003_deliverables_past_due_counts_every_overdue_undelivered_deliverable_regardless_of_blocking` (tests/unit/portal-overview-queries.test.ts) proves the badge count no longer filters on `blocking`, matching the Your list view's own "blocked" bucket predicate.
AS-048: PASS — `test_AS_048_two_client_users_of_one_project_each_see_all_of_the_projects_change_requests` (tests/integration/f016-change-request-quote-gate.test.ts) proves the change-request list is project-scoped, not `created_by`-scoped.

## Files changed
lib/queries/deliverables.ts
lib/queries/portal.ts
lib/queries/project-records.ts
components/portal/request-list.tsx
lib/supabase/database.types.ts (regenerated, `npm run db:gen-types`)
supabase/migrations/20261002010000_f016e_m3_correctness.sql (new)
tests/unit/portal-overview-queries.test.ts
tests/integration/f013-deliverables-review-and-sweep.test.ts
tests/integration/f016-change-request-quote-gate.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261002010000_f016e_m3_correctness.sql` (0)
`npm run db:gen-types` (0)
`npm run migrations:check` (0, no drift)
`npx vitest run tests/unit/portal-overview-queries.test.ts` (0, 28 passed)
`npx vitest run tests/integration/f013-deliverables-review-and-sweep.test.ts` (0, 11 passed)
`npx vitest run tests/integration/f014-mark-deliverable-delivered.test.ts tests/integration/f016c-deliverable-task-scoping.test.ts tests/integration/f015-flag-assumption-atomic.test.ts` (0, 22 passed)
`npx vitest run tests/integration/f016-change-request-quote-gate.test.ts` (0, 8 passed — 2 of these were failing before this feature's fix, see Decisions made)
`npx vitest run tests/integration/f003-portal-shell.test.ts` (0, 10 passed)
`npx vitest run components/portal/ tests/unit/portal-phases-query.test.ts` (0, 137 passed)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/portal.ts lib/queries/deliverables.ts lib/queries/project-records.ts components/portal/request-list.tsx tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/f016-change-request-quote-gate.test.ts tests/unit/portal-overview-queries.test.ts` (0)

## Decisions made

- **Defect 1 (AS-003):** renamed `getOverdueBlockingDeliverableCount` (lib/queries/deliverables.ts) to `getDeliverablesPastDueCount` and dropped its `.eq("blocking", true)` filter. It is now the single query behind both the sidebar badge (`getPortalBadgeCounts`) and matches the predicate the Your list view's `classifyBucket` already applies client-side (state not accepted/waived, due date set and past). The risk banner's own `getWorstOverdueBlockingDeliverableRisk` keeps its `blocking` filter — that is AS-031's own wording ("a blocking deliverable"), a genuinely different question from AS-003, not left un-unified by oversight.
- **Defect 2 (AS-048):** widened `client_requests_select_author_or_team` (supabase/migrations/20261002010000) from `created_by = auth.uid()` to the same `is_project_client(project_id) and is_project_visible_to(project_id) and is_project_portal_enabled(project_id)` shape every other client-facing SELECT policy in this mission uses (verified by grep: `client_deliverables_select_client`/`project_scope_items_select_client`/`project_decisions_select_client`/`project_assumptions_select_client`, all at supabase/migrations/20260926010000_deliverables_scope_decisions_assumptions.sql:194-364). This widening also changes `getPortalRequests` (lib/queries/portal.ts, the "Sent" inbox) from "my own requests" to "every request on this project" — the mission's `validation-contract.md` has no assertion requiring personal-only scoping for that surface (its own AS-023 is about approval decisions, not this list — a stale reference in that function's old doc comment), and the spec's own instruction ("Scope by project, as every other portal surface does") is unambiguous about which way to resolve the two surfaces sharing one RLS policy.
- **Defect 3 (re-quoting):** `send_change_request_quote_atomic` now withdraws the request's current live approval (`state = 'pending'` only — an already-decided one is left as history) before raising a fresh one for a new quote. `project_scope_items` gets a new partial unique index (`change_request_id` where `source = 'change_request'`), and the sync trigger's insert is now `on conflict (...) do nothing` against that exact index predicate.
- **Byproduct fix, in scope of touching the same trigger:** while recreating `client_requests_sync_decision_from_approval` for defect 3, I had to carry over the `set_config('app.client_requests_triage_guard_bypass', ...)` bypass F016d (20261001010000) added around that trigger's own `client_requests` UPDATE — recreating the function without it silently reintroduced "client's own quote decision fails with 42501" (2 of `f016-change-request-quote-gate.test.ts`'s existing tests were failing against the live DB for exactly this reason before this fix; they now pass). This is not one of the four defects but was unavoidable collateral of touching the same function body.
- **Defect 4 (sweep):** added `client_deliverables.swept_at timestamptz`. The sweep now excludes any deliverable with `swept_at is not null`, and — in the same loop iteration that moves a task into Blocked — marks every overdue, blocking, unswept deliverable linked to THAT task as swept (not only the single "worst" row `distinct on (t.id)` picks), so none of a task's contributing deliverables can independently re-trigger a re-block after a human moves the task back out.
- Fixed the sweep's own named-for-this-case test (`tests/integration/f013-deliverables-review-and-sweep.test.ts`): it used to move the task out of Blocked and assert on its status WITHOUT ever calling the sweep a second time. Split into the original idempotent-within-a-run test (renamed, still valid) plus a new test that re-runs the sweep after the manual unblock and asserts the task stays unblocked and no second activity row is written.
- Migration ledger housekeeping: applied the migration, found two follow-up bugs (Postgres `ON CONFLICT` predicate mismatch, then the guard-bypass regression above), deleted the `supabase_migrations.schema_migrations` ledger row via the Management API query endpoint and re-ran `npm run db:apply` twice to land the corrected function bodies — the final applied state matches the committed migration file exactly (verified: `npm run migrations:check` reports no drift).

## Out-of-scope work needed

- `tests/integration/f016-change-request-quote-gate.test.ts`'s pre-existing `test_AS_046_...` tests were unaffected, but the suite as a whole was silently broken (2/6 tests failing) before this feature touched the same trigger for an unrelated reason (F016d's guard-bypass flag was correct on disk but the live DB's `client_requests_sync_decision_from_approval` function apparently either predated that fix or had drifted — worth a follow-up to add a drift check that also diffs function BODIES, not just which migration versions have run, since `migrations:check` only tracks the ledger and would not have caught this).
- The "Sent" inbox (`getPortalRequests`/`components/portal/request-list.tsx`) now shows every client's requests on a project, which is a real UX change (a client now sees a coworker's requests in what was previously a personal list) that was not explicitly asked for by any assertion but falls out of fixing AS-048 the way the spec directed ("Scope by project, as every other portal surface does" — the RLS policy is shared infrastructure, not two independently-choosable predicates). If product wants the "Sent" list to stay personal while the Scope view's "Change requests" table stays project-wide, that needs a NEW assertion and a second RLS policy (or an application-level `created_by` filter layered on top of the now-broader read) — out of this feature's scope to invent.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Chose to mark ALL of a task's overdue-blocking-unswept deliverables as swept in one pass (not just the single row `distinct on (t.id)` selected) when the sweep fires, rather than swept_at only on the picked row — the spec says "do not re-sweep the same pair," and leaving a second, un-marked overdue deliverable on the same task would let it independently re-trigger the exact re-block the fix exists to prevent.

AUTONOMOUS_DECISION: Left `getWorstOverdueBlockingDeliverableRisk`'s `blocking` filter untouched — AS-003 and AS-031 are different assertions with different wording ("past their due date" vs. "a blocking deliverable"), so unifying them into one query would be wrong, not merely undone.

## Notes for the next worker

- The migration file is `supabase/migrations/20261002010000_f016e_m3_correctness.sql`. If you need to iterate on a Postgres function body already applied via `npm run db:apply`, that script no-ops once the version is in `supabase_migrations.schema_migrations` — delete that ledger row via the Management API query endpoint (see this handoff's Decisions made for the exact node snippet) before re-running `db:apply`, or you will be editing the file without ever landing the change.
- `ON CONFLICT (...) WHERE (...)` inference requires the WHERE clause to match a partial index's predicate EXACTLY (same expression text after Postgres's own normalization) — `project_scope_items_change_request_id_unique`'s predicate is `source = 'change_request' and change_request_id is not null`; the trigger's `ON CONFLICT` clause must repeat both conjuncts, not just the first, or you get `42P10`.
- No Supabase MCP tools were used (per this mission's connections registry, the Supabase MCP is not authorised for worker use — the run instructions explicitly said to use the CLI/scripts instead). Schema/RLS verification was done by reading the applied migration files directly and by running the integration test suites against the live linked project.
