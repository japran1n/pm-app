# Handoff: F048 — Component panel drag reorder (dnd-kit)

## Status
COMPLETE

## Assertions covered
AS-162: PASS — ComponentPanel renders DndContext + SortableContext; each row mounts useSortable successfully and exposes a "Reorder <name>" drag handle (test: `f048-component-panel-dnd.test.tsx`)
AS-163: PASS — onDragEnd computes the new order with arrayMove and calls `reorderComponents(projectId, newOrder)` from the barrel
AS-164: PASS — onDragEnd calls `router.refresh()` after `reorderComponents` resolves successfully

## Files changed
components/architecture/component-panel.tsx
tests/unit/f048-component-panel-dnd.test.tsx

## Commands run
`npx vitest run tests/unit/f048-component-panel-dnd.test.tsx tests/unit/m8-reorder-components.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, 8/8 tests passed)
`npx tsc --noEmit` (0)
`npx eslint components/architecture/component-panel.tsx --max-warnings=0` (0)
`git commit` (0)

## Decisions made
- Kept the DndContext/SortableContext local to `ComponentPanel` rather than lifting it to `board.tsx` — unlike sections, the component list is a single flat list with no cross-container drag target, so `sortable-section-list.tsx`'s cross-column pattern doesn't apply here; a self-contained DndContext matches `SortableSectionCard`'s per-row `useSortable` + grip-handle pattern instead.
- Removed the F047 move-up/move-down buttons and their `orderedComponentIds`/`index` props entirely per the spec ("these are a TEMPORARY caller placeholder").
- No optimistic UI: on `onDragEnd` the row visually snaps to the drop position via dnd-kit's own transform during the drag, then `reorderComponents` + `router.refresh()` commits the real order server-side, per the clarified spec ("No optimistic UI needed").
- Drag handle uses the same visual/accessibility pattern as `SortableSectionCard` (`GripVertical`, `aria-label="Reorder <name>"`, `touch-none`, cursor-grab/grabbing), but placed inline (not absolutely positioned) since the panel row already has room for it, unlike section cards.
- Test simulates `onDragEnd` by mocking `@dnd-kit/core`'s `DndContext` to capture and directly invoke the `onDragEnd` prop, since jsdom cannot perform real pointer drag sequences — this is the same technique feasible for dnd-kit-based components in this codebase's test suite (no prior test file did this exact trick, but it follows the same "mock the library boundary, assert on the callback" approach used elsewhere for actions/router).

## Out-of-scope work needed
None identified. Keyboard-driven reordering also works via dnd-kit's `KeyboardSensor` (same sensor config as `board.tsx`), but no dedicated assertion was assigned for keyboard interaction here, so no separate test was added.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to scope the DndContext to `ComponentPanel` itself (not lift to `board.tsx`) because the spec's "same pattern as sortable-section-list.tsx" refers to the useSortable/SortableContext/GripVertical mechanics, not the specific cross-container DndContext-lives-in-parent architecture, which only exists in board.tsx to support drags *between* page columns — a scenario that doesn't exist for the flat component list.

## Notes for the next worker
- `ComponentListItem` no longer takes `orderedComponentIds`/`index` props — if any other caller referenced those, they would need updating (none found in this codebase).
- The unit test mocks `@dnd-kit/core`'s `DndContext` to intercept `onDragEnd`; if `ComponentPanel` is refactored to use a different dnd-kit context boundary, this test's mock will need to move with it.
