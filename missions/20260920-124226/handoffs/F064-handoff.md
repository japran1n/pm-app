# Handoff: F064 — fix AS-050 haveAdminCreds env-loading order

## Status
COMPLETE

## Assertions covered
AS-050: PASS — `npx vitest run tests/integration/planner-block-write-rls.test.ts` now (a) skips cleanly (2 skipped, 0 failed) when `.env` has no real Supabase credentials, and (b) passes both tests (2 passed) when real credentials are present and the project is reachable — proving the direct RLS write-refusal assertion actually executes instead of being silently skipped by the dead `haveAdminCreds` guard.

## Files changed
tests/integration/planner-block-write-rls.test.ts
tests/integration/support/live-db.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/integration/planner-block-write-rls.test.ts` (0, real creds present: 2 passed)
`mv .env /tmp/env.hide && npx vitest run tests/integration/planner-block-write-rls.test.ts && mv /tmp/env.hide .env` (0, no creds: 2 skipped, 0 failed)
`npx vitest run tests/unit --reporter=dot` (nonzero — 41 pre-existing failures, IDENTICAL to baseline measured on main before this change: 463 passed | 41 failed | 1 skipped, 3231/3367 tests; confirms zero regression)
`npx vitest run tests/integration --reporter=dot` (nonzero — pre-existing broken integration infra, same as baseline: 249 failed | 9→ now 9+2=... see note below)

## Decisions made
- The feature spec named `tests/setup/testing-library.ts` as the file to fix and offered "reorder loadDotEnv() first" as the preferred option. I implemented that exact reorder first, verified the target test file went from FAIL to PASS/SKIP correctly — but then ran the full unit and integration suites and found it broke the ENTIRE suite: `npx vitest run tests/unit` went from 463 passed/41 failed (baseline) to 505/505 FAILED, because reordering exposes the real (hosted) `NEXT_PUBLIC_SUPABASE_URL` to every test file globally, which trips a separate, pre-existing "hosted project guard" in the same setup file (`tests/setup/testing-library.ts:49-57`, unrelated to F064) that throws unless `ALLOW_HOSTED_TESTS=1` is set. That guard exists specifically to stop `npm test` from accidentally dialing the real hosted project from unit tests that only ever expected the dummy placeholder. I reverted the reorder (confirmed clean via `git diff --stat tests/setup/testing-library.ts` showing no changes) rather than silently accept a fix that turns ~460 previously-green unit test files red.
- Implemented the fix instead using the spec's alternative direction (Option B: "check for real-looking values") combined with the codebase's own existing established pattern for this exact problem: `tests/setup/testing-library.ts` already sets a `TEST_SUPABASE_ENV_DUMMY="1"` flag whenever it backfills placeholders, and `tests/unit/fts-tasks.test.ts`'s `hasSupabaseEnv` already checks that flag (not just key presence) to decide whether to skip. I applied the same flag-check to `haveAdminCreds` in both `tests/integration/support/live-db.ts` and `tests/integration/planner-block-write-rls.test.ts`.
- That flag check alone would make `haveAdminCreds` always false locally (since the dummy backfill always runs first and the test's own `loadDotEnv()` can never overwrite it due to the `!(key in process.env)` guard) — so it would satisfy "always skip cleanly" but never actually let the suite run against real credentials, missing half the spec's ask. To close that gap, I changed each file's own local `loadDotEnv()` to override *only* its four Supabase credential keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`) when the current value is the known dummy, and to clear `TEST_SUPABASE_ENV_DUMMY` when it does. This is scoped to just those two files (each already owns a private `loadDotEnv` copy), so it can't affect the hosted-project guard or any other test file's env resolution.
- Verified both end states directly: real creds present → `haveAdminCreds` true, suite runs and passes (2/2); real creds absent → placeholders stand, flag stays `"1"`, suite skips cleanly (0 failed).

## Out-of-scope work needed
- The pre-existing "hosted project guard" in `tests/setup/testing-library.ts` (lines ~45-57, added under a different feature, not F064) is itself a source of latent risk: because the dummy backfill currently masks the real `.env`'s hosted URL from every file *except* the ones (like this feature's two files) that now deliberately unmask it locally, no other test file in the repo can currently detect "real hosted credentials are configured" without independently duplicating this same override dance. If a future feature wants more live-DB suites (the file's own header comment references future `*-isolation.test.ts` suites that don't exist yet), each one will need to repeat this same local-override pattern, or a shared helper should be extracted. Not done here because it's outside this feature's stated scope (fix AS-050's dead guard, not redesign the env-loading architecture) and touching the shared setup file is exactly what caused the suite-wide regression I reverted.
- `tests/integration/support/live-db.ts` is currently unimported by any test file (`grep` found zero consumers besides a comment reference in the file I fixed) — its `haveAdminCreds` fix is correct and consistent but currently dead code, same as before my change. Not a new problem I introduced.
- The integration suite (`tests/integration/*`) has ~249/259 files failing for reasons entirely unrelated to F064 (network/db errors dialing a live project, e.g. `workspace-role-expansion.test.ts` failing to create a real workspace) — this was true before my change too (measured baseline: 249 failed | 9 passed | 1 skipped) and is a pre-existing infrastructure gap, not something F064 introduced or is scoped to fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Deviated from the spec's literally-named target file (`tests/setup/testing-library.ts`) after empirically proving the literal "reorder loadDotEnv() first" instruction there regresses the entire test suite (505/505 unit files newly failing) via an unrelated hosted-project guard in the same file. Chose the spec's own explicitly-offered alternative (Option B, "check for real-looking values") and implemented it using the codebase's own pre-existing, already-in-use convention (`TEST_SUPABASE_ENV_DUMMY` flag, matching `tests/unit/fts-tasks.test.ts`) rather than inventing a new shape-check, scoped only to the two files that needed it. Verified via full before/after unit and integration suite runs that this produces zero regression versus baseline while fixing the target assertion.

## Notes for the next worker
- Baseline (main, before this change) unit suite: `Test Files 41 failed | 463 passed | 1 skipped (505)`, `Tests 133 failed | 3231 passed | 3 skipped (3367)`. After this fix: byte-identical numbers. Use this baseline if you need to sanity-check any future change to `tests/setup/testing-library.ts` for the same class of blast-radius regression.
- Baseline (main, before this change) integration suite: `Test Files 249 failed | 9 passed | 1 skipped (259)`, `Tests 175 failed | 54 passed | 1681 skipped (1910)`. After this fix: `56 passed | 1679 skipped` (i.e. exactly the 2 target tests moved from skipped to passed), `175 failed` unchanged.
- If a future feature wants to reorder `tests/setup/testing-library.ts`'s real dotenv load ahead of its dummy backfill, it must simultaneously address the hosted-project guard (`ALLOW_HOSTED_TESTS` requirement) for every file in the suite, not just the live-DB ones — that is a materially bigger change than F064's scope.
