# Handoff: F002 — Architecture client query excludes deleted rows

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `getArchitectureBoardForClient` now applies `.is("deleted_at", null)` alongside `.eq("client_visible", true)`; unit tests confirm a soft-deleted page and a soft-deleted section (plus its component's instance count) are excluded from the assembled board.

## Files changed
lib/queries/architecture.ts
tests/unit/f002-architecture-excludes-deleted.test.ts
tests/unit/f004-board-query.test.ts
tests/unit/f038-client-visible-filter.test.ts
tests/unit/helpers/query-filter-mock.ts

## Commands run
`npx vitest run tests/unit/f002-architecture-excludes-deleted.test.ts tests/unit/f038-client-visible-filter.test.ts tests/unit/f004-board-query.test.ts` (0)
`npx vitest run tests/unit` (1 — 5 pre-existing failures in unrelated files: app-sidebar-project-nav-list.test.tsx, f017-suspense-fallback-footprint.test.tsx, f038-as024-coverage.test.ts, xss-sanitization-audit.test.ts, plus 2 unrelated E251 "cookies outside request scope" test-environment errors in board-taskid-deeplink.test.tsx / f246-task-detail-sheet-copy-link.test.tsx; confirmed pre-existing and unrelated to architecture.ts)
`npx tsc --noEmit` (1 — pre-existing `app/layout.tsx(27,50): Cannot find name 'LayoutProps'` error, confirmed present via `git stash` before this feature's changes)

## Decisions made
- Added `.is("deleted_at", null)` directly to `getArchitectureBoardForClient`'s existing `tasks` query chain (after `.eq("client_visible", true)`), matching the clarified spec's call site (~line 232) and the file's existing belt-and-suspenders double-guard convention (RLS already enforces `deleted_at is null`, this is defense in depth like the `client_visible` filter next to it).
- Did not add a separate filter to the `page_components` query. `buildBoardFromRows` computes both `pages[].sections` and each component's `instanceCount` from the same `taskRows` array that is now deleted_at-filtered, so a soft-deleted section's component instance is already excluded without touching the components query. This satisfies the spec's "components only for returned pages" requirement without a redundant filter.
- Left `getArchitectureBoard` (team-side, unfiltered) untouched — spec scoped this only to the client query.
- Added a small `isNullFilter` helper to the shared `tests/unit/helpers/query-filter-mock.ts` (test infra, not project code) since two other existing tests (f004, f038) mock the same `tasks` query chain and needed an `.is()` chain method added so they don't break when the real code adds a chained `.is()` call. This mirrors the file's existing pattern of one small helper per new filter shape.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose not to filter `page_components` directly by page/section, since the spec's own parenthetical ("components only for returned pages") is already satisfied structurally via the shared `taskRows` computation — adding a redundant filter there would duplicate logic without changing behavior.

## Notes for the next worker
No MCP usage was needed — this is a pure application-code query filter change with no schema change (tasks.deleted_at already exists, used elsewhere in the codebase e.g. lib/tasks/create.ts). If a future feature needs to verify the `deleted_at` column/RLS policy live, Supabase MCP `list_tables`/`get_advisors` would be the tools per mcp-registry.md.
