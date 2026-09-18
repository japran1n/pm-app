# Handoff: F19 — Canvas integracija: chip na SitemapNode, board-level popover

## Status
COMPLETE

## Assertions covered
No AS-NNN assertion IDs are assigned to F19 in this mission (no `plan.md` /
`validation-contract.md` file exists under `missions/20260918-architecture-enrichment/`
that maps assertions to features). The feature spec's "Definition of done"
checklist was used as the acceptance criteria instead — see Decisions made.

## Files changed
components/architecture/canvas-board.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Computed `rollups` once via `useMemo` inside `SitemapCanvas` (the actual
  stateful component; `CanvasBoard` is a thin `ReactFlowProvider` wrapper
  around it), keyed on `[showDetails, detailsData, pages]` — matches the
  spec's "computed once" rule.
- Threaded `showDetails`, `detailsData`, and `rollups` directly into each
  node's `data` object (`SitemapNodeData`) alongside the existing `node`,
  `actions`, `components` fields, rather than nesting `rollups` inside
  `NodeActions`. `actions` already carries only imperative callbacks; adding
  a data field to it would have mixed concerns. The `rollups` Map reference
  is stable across renders when neither pages nor detailsData change, so
  this doesn't add per-node instability.
- Page-level chip: rendered next to `PageColumnHeader` inside the page node
  header row, gated on `showDetails && rollup && rollup.source !== 'none'`
  — a fixed-height (`h-5`, from `EstimateChip`) chip or nothing, never a
  fluid block, so it does not perturb the `ResizeObserver` that measures
  card height for the tree layout.
- Section-level chips: `SectionCard` already had `showDetails`/`estimates`
  props from F17; wired `showDetails={showDetails}` and
  `estimates={detailsData?.get(section.id)?.estimates}` through the
  existing `page.sections.map(...)` loop in `SitemapNode`.
- No new per-node `useState`, `useContext`, or `useEffect` was added —
  `rollups` lookups are plain `Map.get` calls done inline during render.
- `SitemapNode` was not wrapped in `React.memo` before this change and
  still isn't (the codebase did not memoize it prior to F19), so the
  spec's "adding `rollups` prop doesn't ukida memoizaciju" note doesn't
  apply in practice; behavior is unchanged from before in that respect.

## Out-of-scope work needed
None identified specific to F19. General note: `SitemapNode` is currently
unmemoized (no `React.memo`), so at ~480 nodes any parent state change
(e.g. `heights` map updates during layout) re-renders every node. That
predates this feature and is out of scope here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No `plan.md`/`validation-contract.md` file exists in
this mission directory listing AS-NNN IDs for F19, so I treated the feature
spec's "Definition of done" checklist (rollups computed once, chip shows
only when showDetails+estimates present, chip hidden when showDetails
false, no new per-node state/effects, tsc passes) as the acceptance bar
instead of assertion IDs.

## Notes for the next worker
- `SitemapCanvas` (not `CanvasBoard`) is where all canvas state lives;
  `CanvasBoard` just wraps it in `ReactFlowProvider`. Both function
  signatures were updated to accept `showDetails`/`detailsData` consistently
  (`ArchitectureNodeDetails` type imported from `@/lib/architecture/types`,
  not `@/lib/architecture/estimate-rollup` — that module re-exports
  `computeRollups`/`computeSiteTotals`/`parseEstimateInput` but the
  `EstimateRollup` type itself lives in `lib/architecture/types.ts`; import
  it from there, not from `estimate-rollup.ts`, or `tsc` fails with
  TS2459.
- No automated test suite exercises this file (no `.test.tsx` alongside
  `canvas-board.tsx` in the repo); verification was `npx tsc --noEmit`
  only, per the task instructions.
