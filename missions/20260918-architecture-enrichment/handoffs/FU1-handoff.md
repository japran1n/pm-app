# Handoff: FU-1 — wire showDetails+estimates through section card chain

## Status
COMPLETE

## Assertions covered
No new assertion IDs were assigned to this fix; it restores the unreachable
estimate write path that earlier F-series features (F06/F18 and friends)
depend on. No assertion regressed — verified via `npx tsc --noEmit` and by
reading through the full prop chain (see Files changed).

## Files changed
components/architecture/sortable-section-card.tsx
components/architecture/sortable-section-list.tsx
components/architecture/page-column.tsx
components/architecture/board.tsx
components/architecture/canvas-board.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- `page-column.tsx` builds `estimatesBySection` as a `Map<string, DisciplineEstimate[]>` from `orderedSectionIds` + `detailsData`, only when `showDetails && detailsData` are both truthy — matches the existing rollup-gating convention already used for `rollups` in board.tsx/canvas-board.tsx (avoid work in the default view).
- `board.tsx`: added `detailsData` to the props passed into each `PageColumn` alongside the existing `showDetails`/`rollup` — board.tsx already held `detailsData` in scope, so this is a pure plumbing addition, no new state.
- `canvas-board.tsx`: added `detailsData` and `showDetails` into `SitemapNodeData` type (spec asked for `showDetails`/`estimates`; I added `detailsData` too, since the canvas builds one `data` object per node covering an entire page's sections — passing the whole `detailsData` map down lets `SitemapNode` look up each section's own estimates by id rather than needing a second board-level map keyed by node, mirroring how it already receives `rollups` this same way). Removed the `as unknown as SitemapNodeData` double cast per the spec's "remove if possible" instruction — replaced with a direct `as SitemapNodeData` since the node's `data` shape stored in `computedNodes` now structurally satisfies the (widened) type.
- `SectionCard` itself needed no change — its `showDetails`/`estimates` props already existed per the bug report.

## Out-of-scope work needed
None identified beyond this fix's scope. The write path is now reachable end-to-end (board.tsx and canvas-board.tsx -> PageColumn/SitemapNode -> SortableSectionList -> SortableSectionCard -> SectionCard), but no caller of `ArchitectureBoard`/`CanvasBoard` was inspected for whether `showDetails`/`detailsData` themselves are ever set to non-default values at the page-route level — that's outside this fix's file scope (only the 6 files listed in the task were to be touched) and was not verified here. If the estimate UI still doesn't render in the browser after this fix, check the route/page component that renders `<ArchitectureBoard>`/`<CanvasBoard>` for whether it fetches and passes `detailsData`/`showDetails` at all.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Passed the whole `detailsData` map (rather than a pre-sliced per-node estimates array) into canvas-board.tsx's `SitemapNodeData`, since a sitemap node can represent a page with multiple sections, each needing its own estimates lookup by section id — a single flat `estimates` array wouldn't disambiguate between sections. `SitemapNode` looks up `detailsData?.get(section.id)?.estimates` per section when rendering, consistent with `page-column.tsx`'s per-section `estimatesBySection` Map approach for the column board.

## Notes for the next worker
No MCP tools were needed for this fix (pure client-component prop plumbing). `npx tsc --noEmit` was the only verification available in this worker context; no test file exercises the estimate render path yet, so a future feature adding a UI/unit test for "sections show their discipline estimates when showDetails is on" would close that gap.
