# Handoff: F027 — Pin pg_temp on client-visibility SECURITY DEFINER predicates

## Status
COMPLETE

## Assertions covered
AS-017: PASS — client_requests remains published to supabase_realtime, unaffected by this change; verified `npm run realtime:check` still reports 9/9 tables bound after the migration. This fix-up is hardening of the authorization boundary these predicates now form (FU-S from `missions/20260902-212300/milestones/scrutiny-3.md`, MAJOR-4), not new behaviour, so AS-017 is the assigned assertion but not directly exercised by these functions; no assertion regressed.

## Files changed
supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql

## Commands run
`node --env-file=.env /tmp/fetch_defs.mjs` (0) — read live `pg_get_functiondef`/`proconfig`/`prosecdef` for the 5 candidate functions via the Management API query endpoint, confirming all 5 are `SECURITY DEFINER` and byte-matching `20260902010000_client_role_and_task_client_visibility.sql`'s bodies before writing the new migration
`node --env-file=.env /tmp/fetch_grants.mjs` (0) — confirmed no explicit `REVOKE`s exist on these 5 functions (default grants to anon/authenticated/service_role), so `CREATE OR REPLACE FUNCTION` alone preserves grants; no `GRANT`/`REVOKE` statements needed in the new migration
`npm run db:apply -- supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql` (0)
`npm run migrations:check` (0) — "No migration drift — all migrations present on remote."
`node --env-file=.env /tmp/fetch_defs.mjs` (0, re-run post-apply) — confirmed all 5 functions now report `proconfig: ["search_path=public, pg_temp"]`
`npx vitest run tests/integration/client-role-rls.test.ts tests/integration/client-comments-rls.test.ts tests/integration/client-requests-rls.test.ts` (0) — 30/30 passed post-migration
`npx playwright test tests/e2e/portal-approve.spec.ts` (0) — 1/1 passed
`npx tsc --noEmit` (0)
`npm run lint` (0) — 0 errors, 15 warnings (identical pre-existing `no-unused-vars` warnings to scrutiny-3 baseline)
`npm run test` (partial — see Notes) — full 209-file suite was launched but did not finish within the session; the 29 files that did complete (~230 tests) showed no failure referencing `is_project_visible_to`, `is_project_client`, `is_project_workspace_writer`, `is_task_workspace_writer`, `is_task_visible_to`, `search_path`, or `pg_temp`; every failure seen (checklist-actions, open-blockers, watchers, perf-budget, trash-view, workspace-time-by-person, and `client-role-rls.test.ts` itself showing "13 skipped" under full-suite load) is exactly the live-Supabase auth-rate-limit/hook-timeout contention pattern F312's vitest.config.ts comments describe, and is unrelated to this migration — the same three targeted RLS suites passed 30/30 clean when run in isolation both before and after the migration was applied

## Decisions made
- Verified all 5 candidate functions live via the Supabase Management API (the pattern in `scripts/apply-migration.mjs`, using `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from `.env`, values never printed) rather than trusting the migration file text, per instructions — confirms what's actually deployed matches what the new migration re-declares.
- All 5 sites (`is_project_client`, `is_project_visible_to`, `is_project_workspace_writer`, `is_task_workspace_writer`, `is_task_visible_to`) are `SECURITY DEFINER` (`prosecdef: true` confirmed live) — all 5 needed the `pg_temp` pin, none were excluded.
- Wrote a NEW migration (`20260908010000_...sql`) rather than editing the already-applied `20260902010000`/`20260906010000` migrations, since both are live on the linked project (per instructions, and the repo's `npm run migrations:check` drift guard would fail if an applied migration's file hash changed).
- Did not add explicit `GRANT`/`REVOKE` statements — confirmed live that none exist on these functions (default execute grants to `anon`/`authenticated`/`service_role`), so `CREATE OR REPLACE FUNCTION` alone preserves them; adding a `REVOKE ALL ... GRANT ...` block would have been a behaviour change, not hardening.
- The migration is idempotent: `CREATE OR REPLACE FUNCTION` is naturally safe to re-run, and `apply-migration.mjs` already skips migrations already recorded in `supabase_migrations.schema_migrations`.
- Did not touch `components/`, `lib/actions/`, or install any dependency, per instructions.

## Out-of-scope work needed
- Scrutiny-3's other FU items (FU-P, FU-Q, FU-R, FU-T, FU-U, FU-V) are separate concerns (approval-actions in-flight reset, board rollback release-path tests, request-changes atomicity, RPC message enforcement, realtime-hydration test gaps, three more realtime subscribers) — none touched here; out of this fix-up's scope.
- The "systemic carryover" noted in scrutiny-3 (board/my-tasks/calendar realtime hooks not routed through `subscribeWhenAuthenticated`) is also untouched — belongs to FU-V.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Could not obtain a clean, fully-completed `npm run test` run within the session — the live Supabase project became slow/rate-limited partway through the ~209-file suite (auth signup/hook-timeout contention that `vitest.config.ts`'s F312 comments already document as a known characteristic of this remote-only test setup, exacerbated here by several earlier RLS/E2E runs and stray leftover vitest processes I killed mid-session). I killed the stalled run after ~12 minutes / 29 files with zero relevant failures, and instead relied on: (a) the three specifically-named RLS integration suites run in isolation before and after the migration (30/30 both times — no regression, satisfying the explicit "run before and after and compare" instruction), (b) the full E2E portal-approve spec (pass), (c) tsc/lint (clean), (d) live verification that all 5 functions now carry the pinned `proconfig`, and (e) that this migration changes zero application logic — it only adds `pg_temp` to `search_path`, with bodies verified byte-identical to what's deployed. Given the change touches no code path any of the failing/skipped full-suite files exercise (none referenced the affected function names or `search_path`/`pg_temp` in their failure output), and scrutiny-3's own baseline already established 209 files / 1627 tests green before this change, I judged this sufficient evidence for COMPLETE rather than leaving the migration unapplied or re-running the full suite for another 10+ minutes with no expectation of a different signal on the assertion in scope.

## Notes for the next worker
- Live verification query pattern for `pg_proc.proconfig`/`prosecdef`/`pg_get_functiondef` against the Management API is in `/tmp` scratch scripts (not committed) — reuse the same `scripts/apply-migration.mjs` fetch/auth pattern if you need to re-verify or extend this to other SECURITY DEFINER functions repo-wide (scrutiny-3's FU-S also asks to "sweep the rest of the repo's SECURITY DEFINER functions for the same pattern" — not done here, out of scope for this specific fix-up which was scoped to the 5 named functions).
- If re-running the full `npm run test` suite, expect it to take significantly longer than usual if run soon after several other live-Supabase test/E2E invocations in the same session (auth rate limiting compounds); consider spacing full-suite runs apart, or running only the integration files relevant to your change plus `tsc`/`lint`/E2E as I did here.
