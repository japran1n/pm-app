# Handoff: F068 — db fts setup

## Status
COMPLETE

## Assertions covered
AS-117: PASS — `search_tasks` RPC (ts_rank over `search_vector`, `@@ plainto_tsquery`) returns tasks whose term appears in either title or description; verified with a live query against a title-only and a description-only fixture.
AS-123: PASS — searching "URGENT" against a task titled "urgent fix" returns a match, via a real query (`admin.rpc('search_tasks', { p_query: 'URGENT' })`) against the live linked Supabase project, not assumed.
AS-124: PASS — `ts_rank` against the weighted `search_vector` (title 'A', description 'B') orders a title-only match before a description-only match for the same search term, verified via the `search_tasks` RPC's real ORDER BY on live data.

## Files changed
supabase/migrations/20260818050200_fts_tasks.sql
supabase/migrations/20260818050300_fts_tasks_search_fn.sql
lib/supabase/database.types.ts
tests/unit/fts-tasks.test.ts

## Commands run
`supabase db push --yes` (0) — applied both migrations to linked project qcipqonnqajmazdbysow
`supabase gen types typescript --project-id <ref>` (0) — regenerated lib/supabase/database.types.ts
`npx vitest run tests/unit/fts-tasks.test.ts` (0) — 3/3 passed
`npm run test` (0) — 370/370 tests passed (66 files)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)

## Decisions made
- Split the feature into two migrations: `20260818050200_fts_tasks.sql` (generated `search_vector` tsvector column + GIN index) and `20260818050300_fts_tasks_search_fn.sql` (the `search_tasks(p_project_id, p_query)` ranked-search function). This was a mechanical consequence of `supabase db push` already recording the first file's checksum before I added the ranking function to it — rather than force a mismatched re-push, I moved the addition into a second, later-timestamped migration. Net effect on schema is identical to a single migration; both are additive.
- Added a `search_tasks(p_project_id uuid, p_query text) returns setof tasks` SQL function so AS-124's ranking requirement (ts_rank needs the query's own tsquery, not just `@@` presence) has one canonical implementation, callable via `supabase-js` `.rpc()`, instead of every caller re-deriving `plainto_tsquery`/`ts_rank` by hand. `language sql stable`, default `security invoker` — it runs under the calling role, so existing RLS on `tasks` still applies; this function grants no additional access.
- Weighted the generated vector with `setweight(..., 'A')` for title and `setweight(..., 'B')` for description (per the spec's explicit instruction) so title matches always out-rank description-only matches for the same term, satisfying AS-124 without any application-side re-ranking.
- Scoped indexing to title + description only, per discovery round-2 Q13's answer ("matches the reference app's `/search` endpoint scope... where most searchable content actually is") — no other columns (tags, status, etc.) are included in `search_vector`.
- Confirmed AS-123 (case-insensitivity) is inherent to `to_tsvector`/`plainto_tsquery` normalization (lexemes are lower-cased) rather than assuming it — the AS-123 test issues a real "URGENT" query against a lower-case-stored title and asserts a match.
- Test creates and tears down real rows (a Supabase Auth user, workspace, project, three tasks) against the live linked project via the admin/service-role client, matching this repo's "real DB, not mocked" pattern for schema-level assertions; the `describe.skip` guard keeps `npm run test` green in an environment without Supabase env vars.

## Out-of-scope work needed
- No Server Action or UI yet calls `search_tasks` — that's the actual search feature (search box, results list, debouncing, etc.), presumably a later feature (not in this spec's scope, which was schema-only: "tsvector generated column + GIN index... Ranking favors title matches").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Exposed ranking via a `search_tasks` Postgres RPC function rather than leaving callers to hand-write `ts_rank`/`plainto_tsquery` themselves. The spec only asked for the column + index + weighting, but AS-124 ("results are ranked") is not testable end-to-end without something computing and ordering by rank, and a shared DB function is the natural, RLS-respecting place for that logic to live once weighting exists.

## Notes for the next worker
- `search_tasks(p_project_id uuid, p_query text)` is available via `supabase.rpc('search_tasks', { p_project_id, p_query })` — returns `tasks` rows already ordered by rank (best match first), already filtering `deleted_at is null`.
- No MCP was used for this feature (Supabase CLI path only, per `mcp-registry.md`'s guidance to not block on MCP approval); all schema work went through `supabase db push`.
- Regenerated types are in `lib/supabase/database.types.ts` — `search_tasks` now appears there too, so a typed `.rpc<'search_tasks'>(...)` call is available to whichever feature builds the actual search UI/Server Action.
