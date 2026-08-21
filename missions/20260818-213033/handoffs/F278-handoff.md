# Handoff: F278 — make CI actually execute the test suite

## Status
COMPLETE

## Assertions covered
none directly assigned to this feature (it is the evidence layer every other assertion's CI execution depends on, and a precondition for AS-530 in M18 — per the feature spec).

## Files changed
.github/workflows/ci.yml
package.json
vitest.config.ts (testTimeout addition merged into F277's already-committed version of this file — see Notes)
tests/integration/*.test.ts (80 files — added a CI hard-fail guard next to each existing `have*Creds` credential check)
tests/e2e/*.spec.ts (7 files — same guard next to each `haveAdminCreds` check)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 1 pre-existing unused-var warning in lib/queries/search.ts, unrelated to this feature)
`npm run test` (0) — first run overlapped with a concurrent worker (F277) actively editing components/user-avatar.tsx and lib/user-color.ts, producing 20 unrelated transient failures (board-*.test.ts, keyboard-a11y-pass.test.ts, new-task-dialog.test.ts) plus known Supabase-auth-rate-limit flakiness (change-member-role, delete-workspace, invite-member, remove-member, perf-budget, comment-delete-broadcast, extension-attachments) — all matching gotchas already documented in run-log.md, not caused by this feature's changes.
`npx vitest run --no-file-parallelism` x2, run sequentially after F277 finished and committed (0 both times) — 140/140 test files, 874/874 tests, exit 0, twice in a row. This is the determinism check required by the DoD.
`CI=true NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= SUPABASE_SECRET_KEY= npx vitest run tests/integration/rls-workspaces.test.ts` (1, expected) — confirmed hard failure ("F278: missing Supabase credentials required to run this suite in CI...") instead of skip/green when CI=true and creds are absent.
`env -u CI NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= SUPABASE_SECRET_KEY= npx vitest run tests/integration/rls-workspaces.test.ts` (with .env temporarily renamed out of the way) (0) — confirmed the suite still SKIPS (not fails) locally when CI is unset and creds are absent, preserving contributor-without-.env dev experience.

## Decisions made
- Chose a per-file `if (process.env.CI && !haveXCreds) { throw new Error(...) }` guard placed immediately after each existing credential-boolean declaration, rather than refactoring all ~87 files onto one shared helper module. The spec's Touches list says "tests/integration/* (skip guards)" (mechanical edit to existing guards), not "introduce a new shared test-infra module" — a shared helper would be a larger structural change than "make CI run the tests that already exist" calls for, and every file already computes its own `have*Creds` boolean(s) independently (some files have two, e.g. `haveCoreCreds`/`haveAdminCreds`), so a single shared signature wouldn't fit all of them without its own refactor. This kept the change mechanical and auditable (each file's diff is 4-6 lines).
- Applied the guard to EVERY `have*Creds`/`haveCreds` variable found in a file (not just the one used in the outermost `describe.skipIf`), so a file with both `haveCoreCreds` (anon-key-only tests) and `haveAdminCreds` (admin-seeded tests) fails loudly on whichever specific credential set is actually missing, rather than only checking the first one found.
- Extension tests use `haveCreds` (not `have<X>Creds`) — caught by grep after the main scripted pass and given the same treatment.
- Did NOT touch `tests/integration/proxy-auth-guard.test.ts` or `tests/integration/task-detail-sheet-time-total.test.ts` — verified via grep that neither references Supabase credentials or `skipIf` at all; they run unconditionally already.
- Did NOT touch `tests/unit/**` — verified via grep no unit test file uses `skipIf` or credential gating; F278's DoD is about the integration/e2e suites specifically.
- Playwright CI step: removed the `@playwright/test`/`tests/e2e` existence guard entirely (it was a stale placeholder from before F090 landed — the dependency and the `tests/e2e` directory both exist now), so `npx playwright test` runs unconditionally, same as any other CI step that's expected to work.
- `vitest.config.ts`'s `testTimeout: 30_000` was added by me but the file was concurrently edited and committed by another in-flight worker (F277, environment/jsdom change) before I could commit mine — verified after the fact that my `testTimeout` line survived intact in F277's committed version of the file, so no separate edit/commit was needed from me for that file.

## Out-of-scope work needed
- The spec's draft scope names three env vars (URL, publishable key, secret key); this feature does not add `SUPABASE_PROJECT_REF` (present in `.env.example` but not consumed by any test file I found) to CI secrets — no test reads it, so it wasn't wired.
- Vite prints a benign warning on every run ("ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)... `configLoader: 'native'`"). Harmless today, unrelated to this feature's scope, but will need `"type": "module"` in package.json or a `.mjs` config eventually. Not fixed here — out of scope (narrow CI-only feature).
- Per this feature's explicit scope cut: no new test coverage, no monitoring/alerting on CI failures, no deployment changes were made.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: kept the CI hard-fail scoped to `process.env.CI` (GitHub Actions sets this by default) rather than inventing a new env var, since the clarified spec's own language ("only CI should fail loudly on missing creds") maps directly onto the platform-provided `CI` variable and no tech-decisions.md entry specified an alternative flag.

## Notes for the next worker

### ACTION REQUIRED FROM A HUMAN — CI will not go green without this
This worker cannot add GitHub repository secrets (no push/admin access to repo settings). A human must add these three secrets under the repo's **Settings > Secrets and variables > Actions > Repository secrets**, using the same values already present in this project's local `.env` (do not paste values into any mission markdown or chat — set them directly in the GitHub UI):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

These exact names are what `.github/workflows/ci.yml`'s new `env:` block reads via `${{ secrets.<NAME> }}`, and exactly match the variable names the test suite itself already reads from `.env` locally (confirmed via `tests/integration/rls-workspaces.test.ts` and dozens of sibling files). Once set, a CI run will exercise the full integration and e2e suites (not skip them); until set, CI will fail loudly on the first credentialed test file rather than silently reporting green — this is the intended behavior per the DoD, not a bug.

### Gotchas encountered (for future workers, not just this one)
- Running the full suite in parallel (the vitest default) against the real remote Supabase project produces genuine flakiness from Supabase Auth sign-in rate limiting under concurrent test-created users — this is pre-existing and already documented in run-log.md (2026-08-19T06:55Z entry). `npx vitest run --no-file-parallelism` is more reliable for a from-scratch full-suite verification; CI's default (parallel) may occasionally need a rerun for this reason, which is a known, disclosed limitation, not something this feature's scope covers fixing.
- I ran the suite once while another worker (F277) was mid-edit on `components/user-avatar.tsx`/`lib/user-color.ts`; that produced ~20 unrelated failures that vanished on rerun after F277 committed. Not a regression from this feature.
