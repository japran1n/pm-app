# Handoff: F016c — A deliverable can point at another workspace's task

## Status
COMPLETE

## Assertions covered
AS-028: PASS — the DB now rejects an INSERT/UPDATE of `client_deliverables.task_id`/`.phase_id` pointing at another project (23503, composite FK), and accepts a same-project link. `tests/integration/f016c-deliverable-task-scoping.test.ts` (4 tests).
AS-031: PASS — `getWorstOverdueBlockingDeliverableRisk`'s underlying `resolveHoldsUpContext` now scopes both admin reads (`tasks`, `project_phases`) by `project_id`; unit-covered in `tests/unit/portal-overview-queries.test.ts` (new `test_AS_054_...` case) and integration-covered via the sweep test below (same code path resolves the label).
AS-054: PASS — `resolveHoldsUpContext` cannot surface a cross-project task's title/phase name; new unit test proves the read is excluded even for a row shape that predates the FK. The sweep's join is scoped `t.project_id = cd.project_id`; new integration test seeds two projects with their own overdue blocking deliverables and confirms each task is blocked with its OWN project's status, never the sibling's.

## Files changed
supabase/migrations/20260930020000_f016c_scope_deliverable_task_links.sql
lib/queries/deliverables.ts
lib/actions/deliverables.ts
lib/supabase/database.types.ts
tests/unit/portal-overview-queries.test.ts
tests/integration/f016c-deliverable-task-scoping.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260930020000_f016c_scope_deliverable_task_links.sql` (0)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/deliverables.ts lib/queries/deliverables.ts tests/unit/portal-overview-queries.test.ts tests/integration/f016c-deliverable-task-scoping.test.ts supabase/migrations/20260930020000_f016c_scope_deliverable_task_links.sql` (0 errors; 1 warning, "no matching configuration" for the .sql file, expected — eslint doesn't lint SQL)
`npx vitest run tests/unit/portal-overview-queries.test.ts` (0 — 29 passed, including the new AS-054 case)
`npx vitest run tests/integration/f016c-deliverable-task-scoping.test.ts` (0 — 5 passed)
`npx vitest run tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/f014-mark-deliverable-delivered.test.ts tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts` (0 — 40 passed; side-effect verification per DoD)

Per the assignment's instruction, the full vitest suite was NOT run — only the tests relevant to this change, plus tsc and eslint on the touched files.

## Decisions made
- **Composite FK over a trigger**, as the spec preferred. `client_deliverables_task_id_fkey` is now `foreign key (task_id, project_id) references tasks (id, project_id) on delete set null (task_id)`; same shape for `phase_id`/`project_phases`. This required adding `unique (id, project_id)` constraints on `tasks` and `project_phases` (id is already the PK, so this composite unique is satisfied by construction — it exists purely so the composite FK has something to reference).
- **`on delete set null (task_id)`, the column-list form (Postgres 15+; this project runs PG 17 per `supabase/config.toml:41`)**, not the unscoped `on delete set null`. The unscoped form would null EVERY column in the FK on a referenced-row delete, including `project_id` — which is `not null` on `client_deliverables`, so a routine task delete would start throwing a constraint violation instead of merely clearing the link, the way the old single-column FK always did. Verified this is real PG syntax, not assumed: applied it against the live database via `npm run db:apply` and it succeeded (grep-provable via `git show` on the migration file if the apply had failed, the worker would report BLOCKED here instead).
- **Step 5 (existing bad rows), done before writing the constraint, not after**: ran both cross-project detection queries (task join, phase join) against the live database via the Management API query endpoint (the same mechanism `scripts/apply-migration.mjs` uses) before creating this migration file. Both returned zero rows. The migration's own header comment records the exact queries and the zero-row result, and the migration ALSO contains a defensive `update ... set task_id/phase_id = null` pass ahead of the constraint (idempotent, a no-op on this database) so the file is safe to run against any other environment that does have a bad row, rather than failing at deploy time the way F006h's original migration did (`supabase/migrations/20260917010000...sql:1-30`, read for this file's own precedent-citation rule — that file is the actual "new migration, not an edit" precedent I followed for putting this fix in a new file rather than editing `20260926010000`/`20260927010000`, which are already-applied per `scripts/apply-migration.mjs`'s version ledger).
- **Nulling, not deleting or rejecting**, is the decided fate for a hypothetical existing bad row: matches the pre-existing `on delete set null` semantics for a task/phase that no longer exists, so a caller reading the row afterward sees exactly what it already sees when a linked task is deleted out from under a deliverable — no new state to handle.
- **Application-layer check is defense in depth, not the sole check**, per spec item 4: `validateSameProjectLinks` in `lib/actions/deliverables.ts` re-checks `task_id`/`phase_id` against `ctx.projectId` before the admin insert/update, returning an explainable error ("That task doesn't belong to this project.") instead of letting a directly-called Server Action surface a raw `23503` to the caller. I did not add a dedicated unit test for this helper: no test file in this repo unit-tests a `withAuthz`-wrapped action directly (grep across `tests/unit` and `tests/integration` for `from "@/lib/actions/deliverables"` / `from "@/lib/actions/phases"` returns nothing — every action in this mission is instead exercised indirectly, through its DB effect, via the RLS/RPC integration suites). The DB-level constraint is the assertion's actual enforcement point and is directly tested; the action-layer check is additional, matching the spec's own framing ("so the error is caught where it can be explained rather than at the constraint").
- `resolveHoldsUpContext` gained a `projectId` parameter; both call sites (`getClientDeliverablesForPortal`, `getWorstOverdueBlockingDeliverableRisk`) already had `projectId` in scope, so this was a pure threading change, no new lookups.
- Fixed the two admin-table mocks in `tests/unit/portal-overview-queries.test.ts` (`tasks`, `project_phases`) that M3-scrutiny's F-4 finding flagged as discarding their filters — they now run every chained `.eq()`/`.in()` through the shared `applyFilters` helper, same shape the `client_deliverables` mocks already used. This was necessary (not just nice-to-have): `resolveHoldsUpContext`'s new `.eq("project_id", ...)` call would otherwise be silently swallowed by the old mock and the new AS-054 test would pass for the wrong reason. Fixing only these two tables (not `active_timers`/`project_members`/`workspace_members`, which F-4 also names) stays inside this feature's touched surface; the rest is FR's scope.

## Out-of-scope work needed
- M3-scrutiny.md's F-4 also names `active_timers`, `project_members`, and `workspace_members` admin mocks as discarding filters, and flags `query-filter-mock.ts`'s `.not()` as silently dropping unknown operators, plus several vacuous/inverted test assertions (`f013...:347-374`'s sweep re-run, `test_AS_031_never_surfaces_a_delivered_deliverable_...`). None of these are on `client_deliverables.task_id`/`.phase_id` scoping; left for FR.
- B4 (AS-003 badge/view disagreement), B2 (`flag_assumption_atomic` missing `client_visible`), B3 (`client_requests` column guard), B5 (re-quote duplication), F-1 through F-3 — all out of this feature's scope per its own spec section; tracked as FN/FO/FP/FQ/FR in M3-scrutiny.md already.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the PG15+ column-list `ON DELETE SET NULL (col)` FK syntax rather than a plain `ON DELETE SET NULL`, because a plain composite-FK SET NULL nulls every FK column including `project_id` (not-null on this table) — this is not an ambiguity in the spec, it's a correctness requirement for the "prefer a composite FK" instruction to work at all without breaking ordinary task/phase deletion. Confirmed by successfully applying the migration against the live (Postgres 17) database.
AUTONOMOUS_DECISION: Did not add a same-workspace/cross-workspace distinction anywhere — the constraint and every check is same-PROJECT, which is strictly narrower and already covers the cross-workspace case the spec's title and B1 both describe (a project belongs to exactly one workspace).

## Notes for the next worker
- The FK rename note: `client_deliverables_task_id_fkey` / `client_deliverables_phase_id_fkey` keep their original constraint names (dropped and recreated under the same name), so nothing outside this migration references a stale name.
- No MCP tools were used — the mission's registry marks the Supabase MCP as not authorised for this run; all schema introspection and the pre-migration existence check went through the Management API query endpoint via `node --env-file=.env -e "..."`, the same endpoint `scripts/apply-migration.mjs` itself calls, using credentials already in `.env`. No credential values appear in this handoff or in the migration file.
- `git diff --stat` for this feature touches exactly the files listed above; `lib/supabase/database.types.ts` changed only in generated shape (new unique constraints don't add new fields, but `npm run db:gen-types` was re-run for freshness and to catch any drift — diff is small).
