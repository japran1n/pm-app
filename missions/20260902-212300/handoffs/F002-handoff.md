# Handoff: F002 — Realtime publication health verifier

## Status
COMPLETE

## Assertions covered
AS-005: PASS — `npm run realtime:check` queries the linked project's `supabase_realtime` publication via the Management API and exits non-zero naming any subscribed table absent from it; verified with an unpublished-table unit test (`checkRealtimePublication ... returns a non-zero code naming a subscribed table absent from the publication`) and confirmed against the live project (see Commands run).
AS-006: PASS — table discovery is derived purely from scanning `components/` and `lib/` source text for `postgres_changes` bindings (`extractSubscribedTables`/`discoverSubscribedTables`), never a hand-maintained list; covered by unit tests over fixture source strings including a multi-line binding and a binding with `table:` on its own line.

## Files changed
scripts/check-realtime-publication.mjs
tests/unit/check-realtime-publication.test.ts
package.json (added "realtime:check" script)

## Commands run
`npx vitest run tests/unit/check-realtime-publication.test.ts` (0, 9/9 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0, only pre-existing warnings in unrelated files)
`npm run realtime:check` (0) — real run against the live linked project: "✓ All 8 subscribed table(s) are present in the supabase_realtime publication." (client_requests correctly not yet discovered, since no source subscription for it exists yet — F006/F007 land it later)
`npx vitest run tests/unit` (2 files / 7 tests failed — both pre-existing failures in `tests/unit/personal-todo-list-realtime-wiring.test.tsx` and one board test unrelated to this feature; 197/199 files and 1536/1543 tests passed overall; none of the failing tests touch this feature's files)
`npm test` (full suite) — the pre-existing `tests/integration/**` failures (38 tests, live-Supabase dependent) are explicitly out of scope per `tech-decisions.md` line 121-125 ("No new test touches tests/integration/** ... that suite's 38 live-Supabase failures are pre-existing and explicitly out of scope")

## Decisions made
- Matched `scripts/apply-migration.mjs`'s Management API query pattern exactly (same endpoint, same Authorization header shape) for querying `pg_publication_tables`.
- Matched `scripts/check-migration-drift.mjs`'s structure: pure exported functions (`extractSubscribedTables`, `walkSourceFiles`, `discoverSubscribedTables`, `findUnpublishedTables`, `checkRealtimePublication`), a `main()` guarded by `import.meta.url` check, credential-silence (never print token/ref values), and a plain one-line message (not a stack trace) on missing env.
- `extractSubscribedTables` uses a bounded-window regex scan (from each `"postgres_changes"` occurrence to the next `)`) rather than a full parser, since bindings in this codebase are always `.on("postgres_changes", { ... table: "x" ... }, cb)` — single or multi-line. This keeps the extractor simple, dependency-free, and directly testable against fixture strings per the spec.
- Recursive directory walk (`walkSourceFiles`) skips `node_modules` and dot-directories; scans `.ts/.tsx/.js/.jsx/.mjs` under `components/` and `lib/` only, per spec scope.
- Did not add `client_requests` to the publication or touch any migration — per the spec's explicit instruction, that is F006's work landing separately. Confirmed live run currently finds 8 subscribed tables, all published (no client_requests subscription exists in source yet, so it correctly does not appear as missing at this point in the run order).

## Out-of-scope work needed
None identified beyond what the spec already flags (F006 adding client_requests to the publication, a later feature adding the client_requests subscription in source).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a bounded-window (occurrence-to-next-`)`) regex extraction strategy rather than a full JS/TS parser dependency, since the spec forbids installing new dependencies and all `postgres_changes` bindings in this codebase follow one of two consistent shapes (single-line object literal or multi-line with `table:` on its own line). Verified against real source files in `lib/` and `components/` during the live run (8 tables discovered correctly, matching the known set of subscribed tables in the codebase).

## Notes for the next worker
- No MCP tools were needed for this feature — it uses the Management API HTTP pattern already proven in F001/`apply-migration.mjs`, consistent with `tech-decisions.md`'s guidance for scripts hitting the linked Supabase project directly rather than through MCP.
- When F006/F007 land the `client_requests` publication + subscription, re-running `npm run realtime:check` will pick up the new table automatically — no edit to this verifier is needed, per its AS-006 design.
- The `tests/unit/personal-todo-list-realtime-wiring.test.tsx` and one board realtime test were already failing before this feature's changes (confirmed they don't reference `scripts/check-realtime-publication.mjs` or its test file); left untouched as out of scope per this feature's file boundary.
