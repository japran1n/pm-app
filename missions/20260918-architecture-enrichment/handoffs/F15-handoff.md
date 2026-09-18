# Handoff: F15 — Architecture Details toggle button

## Status
COMPLETE

## Assertions covered
No assertions were explicitly assigned to F15 in the task prompt; this feature is UI scaffolding (toggle button + prop threading) for later M5 features that will implement the details display itself.

## Files changed
components/architecture/architecture-view-toggle.tsx
components/architecture/board.tsx
components/architecture/canvas-board.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Default state is OFF (`false`), read from `localStorage` key `pm-app:architecture-details:${projectId}` on mount via lazy `useState` initializer, matching the spec exactly.
- Details data is fetched via `getNodeDetailsForToggle(projectId)` only once per session — guarded by `detailsData !== null` in the `useEffect` dependency check — and cached in `detailsData` state; toggling off/on again does not re-fetch.
- Added a thin `bg-border` separator between the view-mode buttons and the new Details button to visually group it as a distinct control, per the provided markup.
- `board.tsx` and `canvas-board.tsx` accept the new optional `showDetails` / `detailsData` props but do nothing with them yet (display logic is explicitly out of scope, reserved for later M5 features). Used `_showDetails` / `_detailsData` parameter naming in `board.tsx`'s destructure to avoid unused-variable lint noise; `canvas-board.tsx`'s `CanvasBoard` merely widens its prop type and spreads `{...props}` into `SitemapCanvas`, which ignores the extra keys (no unused-var issue since it's not destructured there).
- Did not modify `client-board.tsx` per explicit instruction.

## Out-of-scope work needed
- Actually rendering the details data (estimates, copy brief) inside `board.tsx` / `canvas-board.tsx` / their child node/column components — reserved for later M5 features per the task spec.
- `SitemapCanvas` (the inner component in canvas-board.tsx) also doesn't destructure `showDetails`/`detailsData` yet since it doesn't use them — a future worker implementing the display should add them to that destructure too.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — followed the spec's exact code verbatim)

## Notes for the next worker
- `getNodeDetailsForToggle` lives in `lib/actions/architecture.ts` (re-exported from `./architecture/node-details`) and returns a `{ ok, data }`-shaped result where `data` is an `ArchitectureNodeDetails` (a `Map`, per `lib/architecture/types.ts`).
- The toggle button uses `SlidersHorizontal` (lucide-react) as its icon, swapping to the existing `Loader2` spinner while `detailsLoading` is true.
- No MCP tools were used for this feature — it is pure client-side UI/state work with no live external service interaction.
