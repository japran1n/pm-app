# F116 — Fix tsc errors in f048 test (AS-006 gate)

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F048_

## Problem

`npx tsc --noEmit` exits 2 with two errors in `tests/unit/f048-component-panel-dnd.test.tsx`:

1. TS2556 at line 26: spread argument is neither a tuple nor a rest parameter — the captured `onDragEnd` is invoked with a spread that TypeScript can't type-check
2. TS2322 at line 65: fixture has `position?: number | undefined` but `BoardComponent.position` requires `number`

## Fix

1. In `tests/unit/f048-component-panel-dnd.test.tsx`:
   - Line 26: type the captured `onDragEnd` invocation with an explicit `DragEndEvent` argument (import `DragEndEvent` from `@dnd-kit/core`) rather than spreading
   - Line 65: give the fixture a concrete `position: 0` (or whatever integer is appropriate for that test)

2. Run `npx tsc --noEmit` — must exit 0
3. Run `npx vitest run tests/unit/f048-component-panel-dnd.test.tsx --reporter=verbose` — must pass
4. Commit

## Assertion covered

- AS-006: tsc exits 0 (gate for every milestone)

## Clarified implementation

- Touches: `tests/unit/f048-component-panel-dnd.test.tsx` only
- No production code changes needed
- Read the file first to find the exact lines before editing

## Definition of done

- `npx tsc --noEmit` exits 0
- f048 tests still pass after the type fix
