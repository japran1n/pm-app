# F125 — Fix canvas-board.tsx missing projectId prop (AS-163/164)

_Mission: 20260919-150607_ _Milestone: M8_ _Parent: F048_ _From: M8-ux.md RED_

## Problem

`canvas-board.tsx` renders `ComponentPanel` but does NOT pass `projectId`. 
The prop defaults to `""`, so `reorderComponents("", ...)` is called on drag — 
which fails with "Invalid UUID". Column view (`board.tsx`) passes `projectId` correctly.

## Fix

1. Read `components/architecture/canvas-board.tsx` to find where `ComponentPanel` is rendered and where `projectId` is available (it's a prop or derived from context).

2. Pass `projectId` to `ComponentPanel` in canvas-board.tsx.

3. In `components/architecture/component-panel.tsx`, make `projectId` required (remove the `= ""` default and the `?` from the prop type) so future omissions are a compile error rather than a runtime toast.

4. Check `board.tsx` still compiles — it already passes `projectId`.

5. Run:
   - `npx tsc --noEmit` — exit 0
   - `npx eslint components/architecture/canvas-board.tsx components/architecture/component-panel.tsx --max-warnings=0`
   - `npx vitest run tests/unit/f048-component-panel-dnd.test.tsx tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`

6. Commit and write handoff to `missions/20260919-150607/handoffs/F125-handoff.md`

## Assertion covered

- AS-163: drag reorders components (canvas view was failing with "Invalid UUID")
- AS-164: router.refresh() called after successful reorder (canvas view)

## Definition of done

- Canvas view no longer shows "Invalid UUID" toast on drag
- `projectId` prop on ComponentPanel is required (compile error if omitted)
- tsc + lint clean
