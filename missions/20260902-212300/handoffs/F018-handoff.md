# Handoff: F018 — Fix-up: verifier script credential redaction + AS-006 real-tree pin

## Status
COMPLETE

## Assertions covered
AS-003: PASS — new tests plant a token in the fixture stderr/error body of both scripts (`check-migration-drift.test.ts`, `check-realtime-publication.test.ts`) and assert the printed message never contains it; both fail against the pre-fix code (verified via mutation-revert) and pass against the fix.
AS-006: PASS — new test calls the real `discoverSubscribedTables()` against the actual `components/`/`lib/` trees, asserts it contains the known table set, cross-checks the count against an independent grep scan, and asserts it differs from a hardcoded stand-in array. Verified this test fails when `discoverSubscribedTables`'s body is mutated to `return ["tasks","comments"]` (mutation-revert run), and passes against the real implementation.

## Files changed
scripts/check-migration-drift.mjs
scripts/check-realtime-publication.mjs
tests/unit/check-migration-drift.test.ts
tests/unit/check-realtime-publication.test.ts

## Commands run
`npx vitest run tests/unit/check-migration-drift.test.ts tests/unit/check-realtime-publication.test.ts` (0)
`npx vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**" --exclude "missions/**"` (0, 1590/1590 passed — up from 1572 baseline)
`npx tsc --noEmit` (0 for my files; one pre-existing error in `components/board/board.tsx` from an in-progress, uncommitted change by another worker — out of scope, not touched)
`npm run lint` (0 errors, 15 pre-existing warnings, none in my files)
`npm run migrations:check` (0) — ran for real against the linked Supabase project: "No migration drift"
`npm run realtime:check` (0) — ran for real against the linked Supabase project: "All 9 subscribed table(s) are present in the supabase_realtime publication"
Mutation verification (both reverted after, not committed):
- Reverted both script files to pre-fix state, reran the two unit test files: 5 new/changed tests FAILED as expected (redactSecrets/buildChildEnv undefined, AS-003 planted-token assertions failed on raw output).
- Restored fix, replaced `discoverSubscribedTables` body with `return ["tasks","comments"]`: 3 AS-006 tests FAILED as expected (missing tables, count assertion, hardcoded-equality assertion). Restored real implementation afterward — confirmed via `git diff --stat` showing no residual change.

## Decisions made
- Added `redactSecrets(text, env)` in `check-migration-drift.mjs` and `redactSecrets(text, secrets[])` in `check-realtime-publication.mjs` (different signatures because one script has direct env access and the other only has `accessToken`/`projectRef` params passed through `checkRealtimePublication`). Both strip any occurrence of the known secret value(s) and replace with `[REDACTED]` before the message is ever printed to stderr.
- Redaction list for the migration script: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` — covers the current `.env` vars plus plausible near-term additions, per "any other secret-looking env value the script has access to" in the spec.
- Also added `buildChildEnv()` to narrow the migration CLI's child `spawnSync` env to an allowlist (`PATH`, `HOME`, the two Supabase vars it needs, plus a couple of platform vars npm/npx commonly require) instead of handing over the full `process.env` — the stronger fix suggested in the spec, reducing the surface for any credential (not just the ones we know to redact) to reach the child in the first place.
- For `check-realtime-publication.mjs`, applied redaction to the `queryPublishedTables` error path (a non-JSON or error API response body wrapped in `Error(body)`), since that's the equivalent "raw external output surfaced to stderr" risk on this script, per the spec's explicit instruction to apply the same review there.
- AS-006 test cross-checks the real scan two ways: containment of the known table set, and a count assertion using an independently-computed `grep -rlo '"postgres_changes"'` file count as a sanity bound, so the test isn't just re-deriving the same regex the production code uses.
- Did not touch `extractSubscribedTables`'s parenthesis-bounded window parsing (the AS-005 minor gap noted in scrutiny — false-PASS on a paren before `table:`) since it's out of scope for the AS-003/AS-006 fix-up assigned here.

## Out-of-scope work needed
- Scrutiny's AS-005 minor note (false PASS when a paren precedes `table:` in a binding, e.g. `filter: \`id=in.(${ids})\``) is not addressed here — it's a different assertion and was marked PASS/minor, not assigned to this fix-up.
- `components/board/board.tsx` currently has an uncommitted, in-progress change (by another worker per git status) that fails `npx tsc --noEmit`. Not touched per the explicit "do not touch components/" instruction for this feature; flagging so it isn't mistaken for a regression introduced here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a fixed allowlist for `buildChildEnv` (PATH, HOME, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, npm_config_cache, TMPDIR, APPDATA) rather than trying to enumerate exactly what `npx supabase` needs on every OS, since the spec said "only the few variables the CLI requires" without naming them precisely; verified `npm run migrations:check` still succeeds against the real linked project with this narrowed env, confirming it's sufficient in practice.

## Notes for the next worker
- Both scripts' redaction is string-replace based (`split(value).join('[REDACTED]')`), not regex, so it's safe against arbitrary secret characters and handles repeated occurrences.
- No MCP tools were needed for this fix-up (no live schema/policy changes) — verification of AS-006 and both `npm run *:check` scripts was done by actually invoking them against the linked Supabase project via the existing `.env`, per the spec's "run for real" instruction.
