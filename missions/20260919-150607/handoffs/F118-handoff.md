# Handoff: F118 — Fix AS-162 sortable context falsifiable

## Status
COMPLETE

## Assertions covered
AS-162: PASS — `tests/unit/f048-component-panel-dnd.test.tsx` now spies on the real `SortableContext` export from `@dnd-kit/sortable` and asserts it is rendered with the component ids in `items`. Confirmed mutation-proof (see Notes).

## Files changed
tests/unit/f048-component-panel-dnd.test.tsx

## Commands run
`npx vitest run tests/unit/f048-component-panel-dnd.test.tsx --reporter=verbose` (0) — 3/3 pass
`npx tsc --noEmit` (0)
`git commit` (0)

## Decisions made
- Chose the "spy on the real `SortableContext`" approach over the "assert `GripVertical` handles render" approach from the spec, because the mutation test proved the handle-only approach (which the previous test already effectively did via `getByLabelText("Reorder ...")`) does NOT fail when `<SortableContext>` is deleted: `@dnd-kit/sortable`'s `useSortable` does not throw outside a `SortableContext` — it silently falls back to a default context value — so `ComponentListItem` still renders its grip button with all attributes/listeners intact even with no `SortableContext` present.
- The spy wraps the *actual* `SortableContext` implementation (`vi.importActual` + delegate) rather than replacing it with a stub, so `@dnd-kit`'s own sorting/DOM behaviour is unaffected — only an observation point is added. This keeps AS-163/AS-164 (which depend on real dnd-kit wiring via `DndContext`'s captured `onDragEnd`) unaffected.
- Left the existing `@dnd-kit/core` `DndContext` mock (capturing `onDragEnd`) in place since it isn't part of AS-162's falsifiability gap and AS-163/AS-164 depend on it.

## Out-of-scope work needed
None identified for this feature. Noted only as an observation: while running `tsc --noEmit` I observed transient, unrelated uncommitted changes to `lib/actions/architecture/components.ts`, `tests/unit/f010-create-page-action.test.ts`, `tests/unit/f046-create-page-schema-page-kind-optional.test.ts`, and `tests/unit/m8-reorder-components.test.ts` in the working tree (apparently other concurrent workers' in-progress edits, e.g. an `reorderComponents` atomicity change). These are untouched by me and were not committed by me — `git add`/`git commit` for this feature staged only `tests/unit/f048-component-panel-dnd.test.tsx`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the "spy on real SortableContext" alternative explicitly offered in the spec instead of the "assert GripVertical drag handle" alternative, because I verified via mutation testing (commenting out `<SortableContext>` in `component-panel.tsx`) that the drag-handle/DndContext-only assertions kept passing — i.e. that alternative was not actually mutation-proof, contrary to the spec's suggestion that `useSortable` throws outside a `SortableContext`. It does not throw; it falls back to a default context.

## Notes for the next worker
Mutation proof performed as directed:
1. Commented out `<SortableContext items=... strategy=...>...</SortableContext>` in `components/architecture/component-panel.tsx` (replacing it with an unwrapped `.map(...)`, no context boundary) and reran the AS-162 test only with the *old* assertions (drag handles + `capturedOnDragEnd` truthy) — it still PASSED. This confirmed the original test was not falsifiable, matching the mission's premise.
2. Restored `component-panel.tsx`, added the `sortableContextSpy` on `@dnd-kit/sortable`'s `SortableContext` export plus the new `expect(sortableContextSpy).toHaveBeenCalledWith(expect.objectContaining({ items: [...] }))` assertion, reran — PASSED.
3. Re-applied the same mutation (SortableContext removed) with the new spy-based assertion in place — the test correctly FAILED with `expected "vi.fn()" to be called with arguments... Number of calls: 0`.
4. Restored `component-panel.tsx` to its original committed state (verified via `diff` against the pre-mutation backup — clean, no diff) before running the final test/tsc/commit sequence. `component-panel.tsx` itself was never modified as part of this feature; only the test file changed.
