# Handoff: F07 — nav + query unit tests

## Status
COMPLETE

## Assertions covered
SP-052: PASS — added `test_SP_052_preview_row_renders_between_site_map_and_your_site` to `components/portal/portal-sidebar.test.tsx`, asserting the rendered anchor order (architecture < staging < site) at the `PortalSidebar` component level. Presence/absence and `buildPortalProjectNavItems`-level order were already covered by F06's `test_SP_041_*` tests in the same file; verified those still pass.
SP-053: PASS — created `lib/queries/project-site.test.ts` with filter-honouring mock tests proving `getClientVisibleStagingLinks` applies both `.eq("client_visible", true)` and `.in("kind", ["staging","live"])` (each tested independently and together), plus SP-003 coverage that a Supabase error returns `{ ok: false }` and is explicitly distinguished from the legitimate empty-list case.

## Files changed
components/portal/portal-sidebar.test.tsx
lib/queries/project-site.test.ts

## Commands run
`npx vitest run components/portal lib/queries/project-site` (0) — 33 test files, 291 tests passed
`git commit` (0)

## Decisions made
- Used the existing filter-honouring mock pattern from `tests/unit/portal-phases-query.test.ts` and the shared `tests/unit/helpers/query-filter-mock.ts` (`eqFilter`/`inFilter`/`applyFilters`) rather than a naive mock that ignores filter arguments — a mock that discards `.eq()`/`.in()` args can't prove the real query's filters are applied, only that the chain shape exists. This matches the project's established convention for this kind of test.
- Found `getClientVisibleStagingLinks` already implemented in `lib/queries/project-site.ts` (from F01) with the correct `.eq("client_visible", true)` + `.in("kind", ["staging","live"])` double filter — no production code changes were needed, only tests.
- Found SP-041 presence/absence/order tests already added to `components/portal/portal-sidebar.test.tsx` by F06. Added one additional test at the rendered-HTML (`PortalSidebar` component) level rather than duplicating the `buildPortalProjectNavItems`-array-level order test F06 already wrote, since SP-052 specifically calls for verifying the nav item as it appears in the UI.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Since F06 already fully implemented SP-041 behavior and wrote array-level order tests, I did not duplicate that coverage; I added a distinct, non-redundant test asserting order in the actual rendered sidebar markup to satisfy SP-052's explicit "position check" requirement at the level a user would actually observe (the DOM), not just the data structure.

## Notes for the next worker
- `components/portal/portal-sidebar.tsx` lines ~117-138 contain the `buildPortalProjectNavItems` function with the `hasStagingPreview` param (default `false`) and the SP-041 ordering comment.
- `lib/queries/project-site.ts` lines ~275-295 contain `getClientVisibleStagingLinks`.
- No MCP tools were used — this feature is pure unit-test authoring against already-implemented code, no live external state to verify.
