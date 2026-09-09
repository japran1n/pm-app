# Handoff: F004 — Tool: search_docs

## Status
COMPLETE

## Assertions covered
AS-022: PASS — `run({ query })` returns `ToolOk<SearchDocsData>` with `results: Array<{ docId, title, folderName, snippet }>`, capped at 10, for docs the caller's RLS session can see; covered by `test_AS_022_happy_path_returns_shaped_results_capped_at_10`.
AS-023: PASS — every returned row comes from a query scoped only by RLS (`docs_select_active_members`) plus the optional explicit `projectId` narrowing; a doc belonging to another workspace can never appear because it never satisfies the RLS-scoped read in the first place; covered by `test_AS_023_AS_008_doc_in_another_workspace_never_appears`.
AS-008: PASS — same mechanism as AS-023 (RLS makes a foreign-workspace doc simply not present in the query result, never surfaced as a distinguishable case); a query that matches nothing returns the generic `empty`/`no_results` shape with no title/content leaked; covered by the same isolation test plus `test_AS_no_results_returns_empty_no_results`.
AS-028: PASS — all three required tests present and passing: happy path (`test_AS_022_...`), empty/no_results (`test_AS_no_results_returns_empty_no_results`), and isolation (`test_AS_023_AS_008_doc_in_another_workspace_never_appears`). Two extra tests cover `projectId` narrowing and the title-only-match snippet fallback, plus one for empty-query rejection.

## Files changed
lib/ai/tools/search-docs.ts
lib/ai/tools/__tests__/search-docs.test.ts

## Commands run
`npx vitest run lib/ai/tools/__tests__/search-docs.test.ts` (0) — 6/6 tests pass
`npx vitest run lib/` (0) — 51/51 tests pass across all `lib/` unit tests, no regressions (up from 45 at F003's handoff)
`npx tsc --noEmit` (0 new errors — same 3 pre-existing baseline errors in `components/ui/status-badge.tsx` and `tests/unit/docs-markdown-editor-export-import.test.tsx` that F003's handoff documented; nothing in `lib/ai/` or this file)
`npm run lint` (0 errors; 26 pre-existing warnings, identical set/count to F003's baseline, none in `lib/ai/`)
`npm test` (attempted; killed after ~4 min with no captured stdout before termination — same behavior F003's handoff documented: the full suite runs the entire live-Supabase integration suite and does not complete quickly in this sandbox. Used `npx vitest run lib/` as the scoped, deterministic gate per the spec's explicit instruction, which is fully green including this feature's 6 new tests.)

## Decisions made
- Looked for an existing doc-search helper before writing SQL, per spec instruction: checked `lib/actions/palette-search.ts` (searches projects/tasks/members, not docs — but its plain `.ilike()` query on the RLS-scoped session client, with no admin-client bypass for the query itself, is the convention this file mirrors), `lib/actions/chat-search.ts`/`lib/queries/chat.ts` (full-text search over a different table, `chat_messages`), and `lib/queries/search.ts` (task search via the `search_tasks` Postgres RPC from F068 — no equivalent `search_docs` RPC exists; grepped `supabase/migrations` for `search_docs`/doc full-text-search function and found none). Since no existing doc-search path exists anywhere in the app, wrote a new `.ilike()` query in `search-docs.ts` itself rather than adding a `lib/queries/docs-search.ts` helper, keeping the feature's file footprint exactly to spec's two listed files.
- `.ilike()` OR match across `title` and `content` (`.or("title.ilike.%q%,content.ilike.%q%")`) rather than a Postgres full-text-search (`tsvector`) column, since no FTS index/column exists on `docs` (unlike `tasks.search_vector` from F068's migration) and adding one would be new schema — out of scope for a tool-file-only feature per spec's "Files" list. Documented here so a later "add doc full-text search" feature has this exact gap on record instead of needing to re-discover it.
- Workspace scoping relies entirely on RLS (`docs_select_active_members`), with **no** explicit `.eq("workspace_id", ...)` added on top — matching F003's get_current_doc precedent (its handoff's "Notes for the next worker" explicitly recommends this for any table whose RLS SELECT policy already scopes by `is_active_workspace_member(workspace_id)`, which is true for `docs` per `20260904010000_docs_system.sql`). `projectId`, when given, is an *additional* narrowing filter within that already-scoped set, not a substitute for workspace scoping.
- Snippet construction: first case-insensitive `indexOf` of the query inside `content`, then ~200 chars centered on that match (100 chars either side) with `...` markers when truncated at either edge. If the query isn't found in `content` at all (i.e. it only matched via `title.ilike`), falls back to the document's first 200 characters instead, matching the spec's explicit rule.
- Empty-query input (`query: "   "`) is rejected as `err("invalid_input", ...)` before any Supabase call, consistent with F003's "validate before touching the database" pattern — not treated as a `no_results` empty state, since it's a malformed request rather than a legitimate search that happened to match nothing.
- Result cap enforced twice: once via `.limit(MAX_RESULTS)` in the query itself (so the database never returns more than needed) and once via `.slice(0, MAX_RESULTS)` on the mapped array as a defensive belt-and-suspenders measure, matching the redundant-safety style already used elsewhere in this codebase (e.g. `PALETTE_RESULT_CAP_PER_GROUP`'s `.limit()` + `.slice()` pairing in `lib/actions/palette-search.ts`).

## Out-of-scope work needed
- No Postgres full-text-search (`tsvector`) column/index exists for `docs.title`/`docs.content`; this tool uses `ilike` substring matching instead, which is adequate for the "keyword only" scope this feature specifies but will not rank results by relevance the way `search_tasks`'s FTS RPC does for tasks. A future "add doc full-text search" feature (analogous to F068 for tasks) would need a new migration adding a `search_vector` column/index and a `search_docs(p_workspace_id, p_query)` RPC, then this tool would swap its `.ilike()` call for that RPC.
- F006's tool registry needs to decide how `searchDocsTool`'s plain object shape maps onto `betaZodTool`/`toolRunner`'s expected tool declaration format, same open item F003's handoff flagged for `getCurrentDocTool` — not addressed here since this feature's scope is the tool file only.
- Semantic/vector search explicitly out of scope per this feature's own spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `.ilike()` substring matching across `title` OR `content` rather than building a new Postgres full-text-search function/column, since no FTS infrastructure exists for `docs` (unlike `tasks.search_vector`) and adding a migration/RPC is schema work outside this feature's "Files: lib/ai/tools/search-docs.ts + test file" scope. This satisfies the spec's explicit "keyword only" requirement and all four assigned assertions; ranking quality is a known limitation recorded above as out-of-scope follow-up work, not silently accepted as equivalent to real FTS.
AUTONOMOUS_DECISION: Ran `npx vitest run lib/` as the final gate in place of a full `npm test`, per the spec's explicit instruction and matching F003's precedent — the full suite runs live-Supabase integration tests that do not complete within a reasonable window in this sandbox and are unrelated to this feature's files.

## Notes for the next worker
- Query-builder mocking for a bare `.select().or().limit()` chain (no terminal `.maybeSingle()`) needs the mock's `limit()` return value to be a **thenable** object (has both `.eq()` for the optional narrowing chain and a `.then()` that resolves to the same result), since the production code sometimes awaits the object returned by `.limit()` directly and sometimes chains one more `.eq()` onto it first depending on whether `projectId` was passed. See `lib/ai/tools/__tests__/search-docs.test.ts`'s `mockLimit` for the pattern if a later tool needs a similarly optional filter chain.
- Confirmed via `grep -rn "search_docs\|doc.*search_vector" supabase/migrations` (empty result) that no doc full-text-search RPC or column exists yet — do not assume one exists without checking; this was the key "look first" finding for this feature.
- No MCP tools were used — this feature is pure application code against the existing `docs`/`doc_folders` schema and RLS policies already verified/migrated by earlier docs-system features; no live schema introspection was needed (the "no FTS column exists" check was a local `grep` of migration files, not a live-schema query).
