# Handoff: F125 — Fix canvas board projectId

## Status
COMPLETE

## Assertions covered
AS-163: PASS — verified via tests/unit/f048-component-panel-dnd.test.tsx (onDragEnd calls reorderComponents with reordered id list); canvas-board.tsx now passes real projectId so the same code path works in canvas view, not just column view.
AS-164: PASS — verified via tests/unit/f048-component-panel-dnd.test.tsx (onDragEnd calls router.refresh() after reorderComponents resolves), same fix applies to both views.

## Files changed
components/architecture/canvas-board.tsx
components/architecture/component-panel.tsx
tests/unit/f034-component-panel.test.tsx
tests/unit/f035-component-detail.test.tsx
tests/unit/f036-rename-delete-panel.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/architecture/canvas-board.tsx components/architecture/component-panel.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f048-component-panel-dnd.test.tsx tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, 6/6 tests passed)
`npx vitest run` (0 exit, but 206/6461 tests failed — all pre-existing failures unrelated to this feature, e.g. `supabase.rpc is not a function` in tests/unit/watching-feed-query.test.ts; none touch canvas-board.tsx or component-panel.tsx)

## Decisions made
- Passed `projectId={projectId}` (already in scope in `SitemapCanvas`'s props) directly to `<ComponentPanel>` at its existing call site in canvas-board.tsx — no new data plumbing needed since projectId was already a prop of the enclosing component.
- Removed the `= ""` default and made `projectId: string` required (not `projectId?: string`) in component-panel.tsx per spec, so a future caller that forgets to pass it gets a compile error instead of a silent runtime UUID-validation toast.
- Fixed the three pre-existing test files (F034, F035, F036) that render `<ComponentPanel>` without `projectId` — they broke under `tsc --noEmit` once the prop became required. Added `projectId="proj-1"` to each render call; none of those tests assert on projectId's value, so this is a mechanical fix, not a scope change.

## Out-of-scope work needed
None identified. board.tsx already correctly passed projectId before this fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to fix the three unrelated test files' compile errors (adding projectId prop) rather than leaving them broken, since the spec's own required step ("tsc --noEmit must exit 0") could not pass otherwise and these are trivial prop additions with no behavioral assertion changes.

## Notes for the next worker
The full `npx vitest run` suite has 206 pre-existing failures unrelated to this feature (mostly `supabase.rpc is not a function` mock gaps in watching-feed-query.test.ts and similar files). These predate this change and are out of scope for F125.
