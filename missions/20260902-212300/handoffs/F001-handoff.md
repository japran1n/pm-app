# Handoff: F001 — Migration drift guard

## Status
COMPLETE

## Assertions covered
AS-001: PASS — checkDrift returns exit code 0 for a clean fixture (mocked subprocess); confirmed against the live project too (`npm run migrations:check` exited 0, "No migration drift" for all 145 migrations).
AS-002: PASS — checkDrift returns a non-zero code and names the exact drifted version (e.g. `20260103999999`) in its message when a fixture has one migration with an empty `remote`.
AS-003: PASS — dedicated test asserts no credential value (mock access token, mock project ref) ever appears in checkDrift's returned message across the missing-env, subprocess-failure, and success paths, and that spawnSync is never called with the token in argv (it goes through env only).
AS-004: PASS — checkDrift returns code 1 with the plain message "Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env" when either is undefined, verified to not match a stack-trace pattern, and confirmed the subprocess is never spawned in that case.

## Files changed
scripts/check-migration-drift.mjs
package.json
tests/unit/check-migration-drift.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, 15 pre-existing warnings, 0 errors, none new)
`npx vitest run tests/unit/check-migration-drift.test.ts` (0, 11/11 passed)
`npm run migrations:check` (0, live project — confirmed "No migration drift" against all 145 local migrations, matching the spec's note that a passing first run is expected)

## Decisions made
- Structured the script with two exported pure functions: `findDrift(payload)` (pure array filter, no I/O) and `checkDrift({ accessToken, projectRef, env })` (orchestrates the env check + subprocess call + drift check, returns `{ code, message, isError }` without touching `process.exit`/`console` directly). `main()` is a thin wrapper that calls `checkDrift()` and translates the result to real exit codes and console output. This lets tests assert on outcomes without needing to mock global process state, and satisfies the spec's instruction that drift-detection logic must be testable without spawning a subprocess.
- `runMigrationList` wraps `child_process.spawnSync`, passing credentials via the `env` option (never argv), and the test suite mocks `node:child_process` entirely — no test shells out to the real Supabase CLI.
- Followed `scripts/apply-migration.mjs`'s house style: read `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from `process.env` at module scope, plain-English error messages via `console.error` + `process.exit(1)`, no new dependency.
- Added `"migrations:check": "node --env-file=.env scripts/check-migration-drift.mjs"` immediately after `"db:apply"` in package.json, matching its invocation style exactly.
- AS-003 test also exercises the missing-env path with a mock project ref present (token absent) to confirm the guard never echoes even a partial credential.

## Out-of-scope work needed
None identified — F001 is self-contained per spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Exported `checkDrift` as an additional pure orchestration function beyond `findDrift` (which the spec explicitly required to be exported) so that AS-001/AS-002/AS-004 could be tested end-to-end without mocking `process.exit`/`console`, keeping test setup simpler and avoiding brittle spy-based assertions on global state. This does not change the spec's required exit-code/message behavior of the CLI entry point.

## Notes for the next worker
- No MCP tools were used for this feature — it only needed a local `npx supabase migration list` invocation against the already-linked project, using SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF from `.env`. `mcp-registry.md` was reviewed; Supabase MCP was not needed since the CLI already provides the drift-detection primitive from the local machine.
- The real `npm run migrations:check` run confirmed zero drift across all 145 migrations, consistent with the spec's note — this is a passing, correct state, not evidence of a broken guard.
