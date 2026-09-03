# Handoff: F012 — Migration: deliverables, scope, decisions, assumptions

## Status
COMPLETE

## Assertions covered
AS-028: PASS — `client_deliverables` holds kind/owner_name/due_at/blocking/state; covered by tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts "AS-028" describe block (7 tests).
AS-043: PASS — `project_scope_items` holds included/excluded rows with source; covered by "AS-043" describe block (2 tests).
AS-044: PASS — `project_decisions` holds rationale/decision_type/decided_on/client_visible; covered by "AS-044/AS-045" describe block.
AS-045: PASS — a `client_visible = false` decision is absent from a direct id lookup, a project-scoped list, and a count; covered by the same describe block.
AS-046: PASS — `project_assumptions` holds a confirmation `state`; covered by "AS-046" describe block, plus regression that a team member still sees a hidden row and that a client has no UPDATE path.

## Files changed
supabase/migrations/20260926010000_deliverables_scope_decisions_assumptions.sql
lib/queries/deliverables.ts
lib/queries/project-records.ts
lib/queries/portal.ts
lib/supabase/database.types.ts
tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts
tests/unit/portal-overview-queries.test.ts
tests/unit/helpers/query-filter-mock.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260926010000_deliverables_scope_decisions_assumptions.sql` (0)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/deliverables.ts lib/queries/project-records.ts lib/queries/portal.ts tests/unit/portal-overview-queries.test.ts tests/unit/helpers/query-filter-mock.ts tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts` (0, one pre-existing unrelated warning in portal.ts on an unused `_projectId` param not touched by this feature)
`npx vitest run tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts` (0, 23 passed)
`npx vitest run tests/integration/portal-phases-rls.test.ts tests/integration/client-requests-rls.test.ts tests/integration/f007-approvals-rls.test.ts tests/unit/portal-overview-queries.test.ts tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts` (0, 103 passed — side-effect verification per definition of done)

## Decisions made
- `client_deliverables` and `project_scope_items` get NO `client_visible` column, despite the spec's shared-shape intro line naming `client_visible` as common to "the four tables." Their own per-table column lists in the spec (section 1 and 2) do not include it, and everything in either table is a client-facing artefact by definition (an obligation the client owes; a scope statement made to the client) — there is no internal-only variant to hide. `project_decisions` and `project_assumptions` DO carry it (their column lists explicitly include it), matching AS-044/AS-045's own text about a visibility flag on decisions. Followed the explicit per-table column lists over the shared-shape summary sentence where they conflicted.
- `project_risks` is not built, per the spec's own explicit section 5 — grepped `supabase/migrations/` and confirmed no `project_risks` table exists anywhere in this repo before or after this change.
- `flag_assumption_atomic` is not built here — it is F015's, named explicitly out of scope in this feature's spec. `project_assumptions.flagged_by_client_at`/`flagged_note` exist as columns (per the spec's own column list) but have no write path at all yet (no client UPDATE policy, no RPC) — a client attempting to set them directly gets 0 rows updated, verified by a dedicated test.
- `getPortalBadgeCounts` (`lib/queries/portal.ts`, F009's own function) now computes `deliverablesPastDue` for real via `getOverdueBlockingDeliverableCount` (new, in `lib/queries/deliverables.ts`) instead of the hardcoded `0` the spec called "honest until the deliverables table exists." A failed deliverables-count read degrades that one field to 0 (logged) rather than failing the whole badge read, because `deliverablesPastDue`'s own type is a plain `number`, not a `PortalQueryResult` — matches the type's own pre-existing contract, unchanged by this feature.
- Rewrote (did not delete) the one pre-existing unit test that asserted `deliverablesPastDue` is "honestly zero until the table exists" — that premise is now false, so keeping the test unchanged would have been asserting a stale contract. Replaced with a test that exercises the real filter logic (blocking + overdue + not accepted/waived + has a due date, project-scoped) and added a companion failure-degrades-to-zero test. Added `notInFilter`/`notNullFilter`/`ltFilter` to the shared `tests/unit/helpers/query-filter-mock.ts` so this mock, like its siblings, genuinely filters an in-memory row set rather than discarding its arguments.
- `client_deliverables_project_id_blocking_due_idx` is a partial index matching the exact predicate `getOverdueBlockingDeliverableCount` filters on (`blocking and state not in ('accepted','waived')`), so the query and the index are written from the same source of truth in the migration's own comment, not independently guessed twice.
- Migration filename `20260926010000` continues this mission's own sequence (last existing migration was `20260925010000_f009b_close_second_approval_path.sql`).

## Out-of-scope work needed
- F013 (Team UI: client obligations) and F014 (Portal: Your list view) need `client_deliverables` CRUD UI and the client-facing list — not built here, per this feature's own scope (migration + read side only).
- F015 (Team UI + portal: scope, decisions, assumptions) needs: `flag_assumption_atomic` RPC (the "Not correct" button), the team-side create/edit UI for all three remaining tables, and the portal Scope view that reads `lib/queries/project-records.ts`.
- F014's overview risk banner ("wired in M3" per plan.md F006) can now be wired against `getOverdueBlockingDeliverableCount` — the query exists; the banner component itself is out of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Resolved the shared-shape-vs-per-table-column-list conflict on `client_visible` (see Decisions made above) by following each table's own explicit column list, since that is the more specific and more recently-stated source within the same spec section, and it is consistent with AS-044/AS-045's assertion text mentioning a visibility flag only for decisions.
AUTONOMOUS_DECISION: `getPortalBadgeCounts`'s deliverables-count failure degrades to 0 (logged) rather than turning the whole return into a `PortalQueryResult`-shaped failure, to avoid widening `PortalBadgeCounts.deliverablesPastDue`'s existing type (a plain `number`) as a side effect of this feature — that type was set by F009/F006f and changing it would ripple into every caller of `getPortalBadgeCounts`, which is out of this feature's stated scope (`lib/queries/deliverables.ts`, `lib/queries/project-records.ts`, `getPortalBadgeCounts` gains the real count — not "getPortalBadgeCounts's return type changes").

## Notes for the next worker
- The leak-test pattern this feature's tests follow (absent from select, absent from count, portal-disabled project's rows absent from every RPC-backed predicate) is `tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts`'s "a portal-disabled project's rows are invisible..." describe block — reuse this shape for F015's assumption-flagging tests rather than reinventing it.
- No MCP was used for this feature — the registry's Supabase row is `Worker use: yes` but per this mission's own explicit instruction ("The Supabase MCP is not authorised — use the CLI"), all schema work went through `npm run db:apply` / `npm run db:gen-types` against the CLI-linked project, and schema/RLS verification was done by reading applied policies back through the same authenticated test sessions the integration test uses (not through MCP introspection tools).
- Ran only the tests specified (this feature's own integration test + the definition of done's named side-effect suites), not the full vitest suite, per instructions.
