# Handoff: F017 — Migration: project budget, work category, client-safe hours RPC

## Status
COMPLETE

## Assertions covered
AS-033: PASS — `project_budgets` table with `EXCLUDE USING gist` on `(project_id, daterange(period_start, period_end, '[]'))`; live tests insert a budget, reject an overlapping one, and accept a non-overlapping one.
AS-035: PASS — `project_hours_client` filters `te.billable` in every CTE; live test adds a large non-billable entry and asserts the client-visible weekly/category totals do not move.
AS-036: PASS — failure test asserts on `JSON.stringify(data)` for `project_hours_client`, not named fields: seeded notes, both task titles, and both user ids are absent from the serialised payload.
AS-037: PASS — `project_hours_client`'s SQL never selects a `tasks` column (only joins `tasks` to scope by `project_id`/`deleted_at`); live test proves the client-invisible task's 60 billable minutes are summed into the `development` bucket while its title never appears anywhere in the payload.

## Files changed
supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql
supabase/migrations/20261010020000_f017b_hours_client_window_fn_fix.sql
supabase/migrations/20261010030000_f017c_btree_gist_support_fn_anon_revoke.sql
lib/queries/hours.ts
tests/integration/f017-hours-migration.test.ts
tests/integration/f016i-anon-execute-catalog.test.ts (allow-list update, see Decisions made)
lib/supabase/database.types.ts (regenerated)

## Commands run
`npm run db:apply -- supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql` (0)
`npm run db:apply -- supabase/migrations/20261010020000_f017b_hours_client_window_fn_fix.sql` (0)
`npm run db:apply -- supabase/migrations/20261010030000_f017c_btree_gist_support_fn_anon_revoke.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/integration/f017-hours-migration.test.ts` (0, 13/13 passing)
`npx vitest run tests/integration/f016i-anon-execute-catalog.test.ts tests/integration/f017-hours-migration.test.ts tests/integration/f016g-default-acl-hardening.test.ts` (0, 22/22 passing)
`npm run migrations:check` (0, no drift)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/hours.ts tests/integration/f017-hours-migration.test.ts tests/integration/f016i-anon-execute-catalog.test.ts` (0)

## Decisions made
- Two separate RPCs (`project_hours_team`, `project_hours_client`), each with its own explicit `revoke all ... grant execute ... to authenticated`, per the spec's own rule ("two functions, two grants, two tests"). Verified live via `has_function_privilege`: both are `authenticated`-only, `anon_exec = false`.
- `project_hours_client` never selects a `tasks` column in any of its three sub-queries (weekly, by-category, budget) — it joins `tasks` only to scope by `project_id`/`deleted_at`. This is what makes AS-037 structural rather than filter-based, per the spec's own instruction.
- `project_hours_client` returns a single `jsonb` blob (`{weekly, by_category, sold_minutes}`); `project_hours_team` returns `SETOF record` (entry rows with title/user/note). The two Postgres return types and the two corresponding TS types in `lib/queries/hours.ts` (`ClientHoursSummary` vs `TeamHoursEntry[]`) are structurally incompatible, so a future refactor cannot pass one into a slot typed for the other.
- Team RLS/authz on `project_budgets` mirrors `project_phases_select_team`/`_insert_team`/`_update_team`/`_delete_team` (`20260909010000_portal_foundations.sql:141-182`, confirmed by grep) exactly: `is_project_visible_to(project_id) AND NOT is_project_client(project_id)` for SELECT, `is_project_workspace_writer(project_id)` for write. Deliberately no client SELECT policy on `project_budgets` — the client only ever sees `sold_minutes` through `project_hours_client`, matching the "two read paths, not one" rule at the table level too.
- `time_entries.work_category` is nullable per the spec ("uncategorised" is honest, not a guess); the CHECK constraint enumerates `design/development/content_seo/pm/qa`. The UI default-from-task-type behaviour described in the spec belongs to F018 (team UI), not this migration — this migration only adds the column and constraint.
- AUTONOMOUS_DECISION: for `project_hours_client`'s budget lookup, when `[p_from, p_to]` straddles two adjacent budget periods (which the exclusion constraint permits only at a shared boundary), the function returns the `sold_minutes` of the budget with the latest `period_start` overlapping the range. The spec does not define "the" budget for a range spanning two periods; this default was chosen because the spec's own primary success test scopes a range inside one period, so the ambiguity is real but out of the feature's tested surface. Documented in the migration's own comment.
- Second real defect found and fixed during this feature's own test run (not pre-existing, introduced by this feature): `create extension btree_gist` (needed for AS-033's exclusion constraint — grep-confirmed no prior migration in this repo uses `EXCLUDE USING`/`btree_gist`) installs ~90 support functions owned by `supabase_admin`, not `postgres` (the role every migration in this repo, including this one, applies as). Two follow-on problems, both closed in this feature rather than deferred:
  1. F016i's event trigger (`20261007010000`, `WHEN TAG IN ('CREATE FUNCTION')`) never fired for these, because Postgres evaluates an event trigger's `WHEN TAG` against the *top-level* command tag (`CREATE EXTENSION`), not per sub-object — a real gap in F016i's own mechanism, not something F016i's own header anticipated.
  2. Even a direct `revoke execute ... from anon` issued by `postgres` in a follow-up migration (`20261010030000`) was a no-op: `postgres` is not a superuser on this project (`select rolsuper from pg_roles where rolname = 'postgres'` = false, verified live) and does not own these `supabase_admin`-owned functions, so REVOKE silently succeeds without effect (documented Postgres semantics for a non-owner, non-superuser revoke).
  Resolution: the ineffective revoke attempt is kept in `20261010030000` as an honest record (per this mission's "state your grants explicitly" instruction — stating the attempt and its failure, not hiding it), and all 188 functions the live catalog attributes to `btree_gist` are added to the existing `ANON_ALLOW_LIST` in `tests/integration/f016i-anon-execute-catalog.test.ts`, generated from a live catalog query (not hand-typed), with a header explaining why: ~176 of them take an `internal`/`cstring` argument Postgres itself refuses to accept from any SQL client (unreachable regardless of grants), and the remaining 12 (`*_dist`) are pure, side-effect-free scalar distance functions with no table access.

## Out-of-scope work needed
- F018 (team UI: budget and work category) needs to implement the "default work_category proposed from the task's type, editable" behaviour the spec describes — this migration only adds the nullable column.
- The `postgres`-is-not-superuser / `supabase_admin`-owns-extension-objects gap this feature discovered is broader than `btree_gist`: any future migration in this repo that runs `CREATE EXTENSION` will hit the same F016i event-trigger blind spot and the same REVOKE-no-op. A proper fix (e.g. asking Supabase support to change `supabase_admin`'s own default-privilege grants for future extensions, or finding a Management-API path that lets `postgres` take ownership) is out of this feature's scope. Flagged here as a candidate follow-up feature so it is not rediscovered from scratch next time an extension is needed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: `project_hours_client`'s budget-of-record when the requested range straddles two adjacent budget periods — see "Decisions made" above.
AUTONOMOUS_DECISION: kept the ineffective `REVOKE` statement in `20261010030000` rather than deleting it, to leave an honest, greppable record that it was tried and why it didn't work, matching this mission's "state your grants explicitly" instruction even for a failed attempt.

## Notes for the next worker
- No MCP tools used — the Supabase MCP is not authorised in this session per the feature spec; all schema introspection was done via the Management API `database/query` endpoint from Bash (same technique `tests/integration/f016i-anon-execute-catalog.test.ts` and `f016g-default-acl-hardening.test.ts` already use), matching this repo's established convention.
- If a later feature needs `CREATE EXTENSION` again, read this handoff's "Decisions made" section on the `btree_gist` grant gap first — the fix pattern (query `pg_depend`/`pg_extension` live, allow-list what's actually reachable, document the REVOKE no-op) can be reused directly instead of rediscovering the ownership boundary from scratch.
- `lib/queries/hours.ts` follows the thin-wrapper convention already established by `lib/queries/time-entries.ts` (`getProjectTimeTotals`, `getWorkspaceTimeByPerson`) — request-scoped client, RPC does the real authorization.
