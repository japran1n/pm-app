# F118 — Fix AS-162: make SortableContext assertion falsifiable

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F048_

## Problem

The test in `tests/unit/f048-component-panel-dnd.test.tsx` mocks `@dnd-kit/core`'s `DndContext` to a pass-through and relies on the false premise that `useSortable` throws outside a `SortableContext`. `@dnd-kit/sortable` ships a default context value, so deleting `SortableContext` entirely leaves every assertion green. The assertion is protected by nothing.

## Fix

Remove the mock of `@dnd-kit/core`'s `DndContext` in the AS-162 test. Instead either:

**Option A** (preferred): Use the real `DndContext` and `SortableContext` from dnd-kit. Assert that the rendered output contains elements that would only exist if `SortableContext` is properly configured — e.g. use `screen.getAllByRole` or a `data-testid` on the sortable item wrapper that proves each component row is a sortable context child. Or introspect that a `GripVertical` drag handle is rendered for each component (proving `useSortable` was actually called with an item in context).

**Option B**: Query the rendered tree for `SortableContext` explicitly by checking that the `items` prop received by `SortableContext` matches the component ids in order, using `jest.spyOn` on SortableContext or a wrapper component approach.

The test must go **RED** if `SortableContext` is deleted from `component-panel.tsx`. Prove this by mutation (comment out `SortableContext`, run the test, confirm it fails) and document in the handoff.

## Assertion covered

- AS-162: component panel has DndContext with SortableContext

## Clarified implementation

- Touches: `tests/unit/f048-component-panel-dnd.test.tsx`
- May need to provide mock for dnd-kit internals (sensors, etc.) to make real render work in jsdom
- Check how `sortable-section-list.tsx` tests handle dnd-kit mocking if those tests exist

## Definition of done

- Test goes RED when `SortableContext` is removed from component-panel.tsx
- Test is GREEN with current implementation
- Mutation-proof claim documented in handoff
