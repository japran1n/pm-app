# F121 — Fix AS-163/164: drag handler error path and pending state

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F048_

## Problem

`handleDragEnd` fires `void reorderComponents(...).then(...)` with no `.catch`. A rejected server action is an unhandled promise rejection and the user sees nothing — no toast, no explanation. Also no `useTransition`, so a second drag mid-flight recomputes from the stale `components` prop. No test for `success: false` branch.

## Fix

In `components/architecture/component-panel.tsx`:

1. Add `useTransition` — wrap the `reorderComponents` call in `startTransition` so the component shows a pending state and concurrent drags are serialized
2. Add a `.catch` or try/catch around the server action call that fires `toast.error(...)` on failure
3. On `result.success === false`, also fire `toast.error(result.error ?? "Failed to reorder components")` and do NOT call `router.refresh()`

In `tests/unit/f048-component-panel-dnd.test.tsx`:

4. Add test for `success: false` path: mock `reorderComponents` to return `{ success: false, error: "..." }`, trigger a drag, assert that `toast.error` was called and `router.refresh()` was NOT called

## Assertion covered

- AS-163: drag-and-drop changes component order (strengthen: test the failure path doesn't silently succeed)
- AS-164: successful reorder calls router.refresh() — and failure path does NOT call it

## Clarified implementation

- Touches: `components/architecture/component-panel.tsx`, `tests/unit/f048-component-panel-dnd.test.tsx`
- Use existing toast import pattern from the component file
- `useTransition` from React

## Definition of done

- `success: false` fires `toast.error` and does NOT call `router.refresh()`
- Test for the failure path passes
- tsc + lint clean
