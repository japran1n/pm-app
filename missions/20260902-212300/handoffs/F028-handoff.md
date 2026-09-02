# Handoff: F028 — scrutiny-4 fix-up (secret-key leak in realtime:check + AS-006 test-net gap)

## Status
COMPLETE

## Assertions covered
AS-003: PASS — added a regression test (`checkRealtimePublication` end-to-end) that plants a `SUPABASE_SECRET_KEY` value in a simulated query-failure message and asserts it never appears in output. Mutation-verified: reverting `check-realtime-publication.mjs`'s redaction call to the old `[accessToken, projectRef]` array made this new test fail with the exact leak text from the scrutiny report (`db error: password=sb_secret_LEAKED_VALUE_123 rejected`); restoring the fix made it pass again. `npm run migrations:check` and `npm run realtime:check` both run for real against the linked project and pass (exit 0).
AS-006: PASS — replaced the non-discriminating "independent grep" test and the weak `!== hardcoded` test with (a) a real independently-derived-set comparison and (b) a fresh test that scans a throwaway temp directory containing a table name invented at test time (`discoverSubscribedTables({ dirs: [tmpDir] })`), which no hardcoded literal can possibly reproduce. Mutation-verified: replacing `discoverSubscribedTables`'s body with a 9-element literal (the exact real, correct output) now makes the new temp-dir test FAIL (`expected [...9 real tables] to deeply equal ["zzz_test_only_dynamic_table_never_hardcoded"]`); restoring the real implementation makes all tests pass again.

## Files changed
scripts/lib/redact-secrets.mjs (new — single shared, env-keyed redactor)
scripts/check-migration-drift.mjs (drops its local redactSecrets definition, imports + re-exports the shared one)
scripts/check-realtime-publication.mjs (drops its local array-based redactSecrets, imports + re-exports the shared one; call site now passes an env-like object covering every SUPABASE_* credential, not just accessToken/projectRef)
tests/unit/check-realtime-publication.test.ts (new AS-003 regression test for the SUPABASE_SECRET_KEY leak; AS-006 test net replaced with a real independent-derivation comparison plus a temp-dir "novel table" test that kills the hardcoded-literal mutant)

## Commands run
`npx vitest run tests/unit/check-realtime-publication.test.ts tests/unit/check-migration-drift.test.ts --reporter=verbose` (0, 30 passed)
`npx vitest run --reporter=verbose` (full suite; 346 files / 2622 tests passed, 56 files / 85 tests failed — all 85 failures are pre-existing `Request rate limit reached` errors from Supabase Auth on live-project integration tests, unrelated to this feature; none touch scripts/, scripts/lib/, or the two files I edited)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 15 pre-existing warnings unrelated to this feature)
`npm run migrations:check` (0 — "No migration drift")
`npm run realtime:check` (0 — "All 9 subscribed table(s) are present")
Mutation test 1 (AS-003): temporarily reverted the realtime script's redact call to `redactSecrets(rawMessage, [accessToken, projectRef])` — new SUPABASE_SECRET_KEY test FAILED with the leaked value visible; reverted, test PASSED.
Mutation test 2 (AS-006): temporarily replaced `discoverSubscribedTables`'s body with the exact correct 9-element sorted literal — new temp-dir "novel table" test FAILED; reverted, all 16 tests in the file PASSED.

## Decisions made
- Unified redaction into `scripts/lib/redact-secrets.mjs`, env-keyed (any env var whose *name* matches `/TOKEN|SECRET|KEY|PASSWORD/i` has its value redacted wherever found), so a new secret env var is covered automatically by both scripts without needing to remember to add it to a hand-list at each call site — this is what let `SUPABASE_SECRET_KEY` leak in the first place (it wasn't in the realtime script's local 2-element array).
- Kept the function backward-compatible with an `Array<string>` argument (used by the existing `redactSecrets(text, ["sbp_secret123"])` unit test) alongside the env-object form, so no existing test needed rewriting for that call shape.
- For AS-006, replaced the shell `grep`-based "independent" scan (which never compared its output to anything) with two things: (1) a pure-JS independently-implemented scan (different algorithm — indexOf-based window search, not the script's own regex walker) compared by exact set equality against `discoverSubscribedTables()`'s real output, and (2) a temp-directory test using the function's existing `dirs` injection point with a table name invented at test-run time. Only (2) can distinguish a hardcoded literal that happens to be correct today from genuine tree-walking, since (1) necessarily produces the same *value* as any correct-today literal — mutation-verified this directly (see Commands run).
- Did not touch `discoverSubscribedTables`'s own implementation — scrutiny found it "genuinely correct today," only the test coverage was insufficient.

## Out-of-scope work needed
None identified beyond the two findings in scrutiny-4.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose an env-*name*-pattern-keyed redactor (`/TOKEN|SECRET|KEY|PASSWORD/i`) over a hand-maintained key list, per the task's explicit instruction ("env-keyed so it covers every secret-looking variable rather than a hand-listed pair"). This is broader than the old migration-drift script's 4-key list but strictly a superset, so no existing redaction behavior regresses.

## Notes for the next worker
- `scripts/lib/redact-secrets.mjs` is now the single source of truth for secret redaction across guard scripts; any new `scripts/check-*.mjs` guard that might echo CLI/API output should import from there rather than writing its own redactor.
- The harness note about `vitest run --reporter=basic` exiting 1 unconditionally on vitest 4.1.10 was confirmed true (`--reporter=basic` fails to load as a reporter name at all on this install — it's actually not a valid built-in name in 4.1.10, `basic` isn't registered). `--reporter=verbose` was used throughout for both normal and mutation-testing runs, as instructed.
- The full suite's 85 failures are all `Request rate limit reached` from Supabase Auth's `signInWithPassword` in live-project integration tests (rls-saved-views, rls-project-favorites, workspace-members-list, open-blockers, recurrence-scheduled-generation, etc.) — a test-account rate-limiting/infra issue, not a regression from this change. None of the failing files are under `scripts/` or `scripts/lib/`, and both files I touched (`tests/unit/check-realtime-publication.test.ts`, `tests/unit/check-migration-drift.test.ts`) are 100% green.
