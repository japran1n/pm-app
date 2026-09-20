# F022: No drag-to-move on another member's block

**Milestone:** M5 — Read-only
**Estimated worker time:** 15 minutes
**Depends on:** F020

## Assertion IDs covered
- AS-043: A block owned by another member cannot be dragged to a new time.

## Context

F020 threaded `currentUserId` into the grid and created `isOwnBlock(block, currentUserId)` in
`lib/calendar/ownership.ts`. This feature applies the same ownership gate F021 applied to the
resize handles, but to drag-to-move.

## Clarified implementation

- **Pattern:** Same as F021's `canResize` gate — `canDrag && isOwnBlock(block, currentUserId)`,
  computed inline where the draggable affordance is wired up.
- **Where:** `components/calendar/calendar-block-chip.tsx` is the block chip that implements
  drag-to-move via `@dnd-kit/core`'s `useDraggable`. It already accepted a `canDrag` boolean;
  this feature adds a `currentUserId` prop and computes `canMove = canDrag && isOwnBlock(block,
  currentUserId)`, then passes `disabled: !canMove` to `useDraggable` (instead of `!canDrag`).
  `week-time-grid.tsx`'s own block chip (`WeekBlockChip`) does not implement drag-to-move at all
  (only resize and create) — no change needed there for this assertion.
- **Drag listeners:** `{...listeners}` (dnd-kit's pointer/keyboard drag handlers) are now only
  spread onto the chip's trigger button when `canMove` is true, so a non-owner sees no drag
  affordance at the DOM level, not just a disabled `useDraggable` hook.
- **Cursor:** `cursor-grab active:cursor-grabbing` when `canMove`, `cursor-default` otherwise.
- **Touches:** `components/calendar/calendar-block-chip.tsx` only.

## Definition of done

- `tsc --noEmit`, `eslint --max-warnings=0`, and the new unit test all pass.
- Unit test renders the chip once with `block.userId === currentUserId` (draggable, grab cursor)
  and once with `block.userId !== currentUserId` (not draggable, default cursor), asserting on
  the rendered `data-draggable` attribute and className rather than dnd-kit internals.
- No other component/behaviour is touched.

## Tests

`tests/unit/f022-no-drag-other-blocks.test.tsx`:
- Render a block where `block.userId === currentUserId` → block is draggable
- Render a block where `block.userId !== currentUserId` → block is not draggable

## Gate

```bash
npx tsc --noEmit
npx eslint --max-warnings=0
npx vitest run tests/unit/f022-no-drag-other-blocks.test.tsx
```
