# F024: No create affordance and no drag-to-create on another member's column or row; own grid unaffected

**Assertions:** AS-047, AS-048, AS-049
**Depends on:** F020

## Context

This feature matters for the stacked layout (M7) where multiple people's rows are shown.
For now, the Planner shows only the signed-in user's blocks by default, so this is infrastructure
for the multi-person view that will be used in F032.

The create affordance is either:
- A click handler on empty grid cells that opens the "new block" form
- A drag-to-create gesture on empty grid cells

## What to do

1. Find where click-to-create and drag-to-create are implemented on the week grid.

2. If these operations don't currently check which user's column is being clicked:
   Add a `columnUserId` or `rowUserId` prop to the grid cells, and only allow create operations
   when `columnUserId === currentUserId`.

3. For the current single-user Planner view, this has no visible behavioral change
   (the only column is always the signed-in user's). The guard is infrastructure for M7.

4. If the grid cells don't have a concept of "which user's column" yet, add it — even as
   `selfUserId` on WeekTimeGrid that's passed to the cell create handlers.

## Tests

`tests/unit/f024-no-create-on-others.test.tsx`:
- AS-047: clicking empty grid area where `columnUserId === currentUserId` → create handler fires
- AS-048: clicking empty grid area where `columnUserId !== currentUserId` → create handler does NOT fire
- AS-049: drag gesture on another user's column area → create handler does NOT fire

Note: if the current single-column view doesn't expose `columnUserId` at the cell level,
add it as a prop with a sensible default (the signed-in user's id) and test the branching logic.

## Clarified implementation

- **Pattern:** `CalendarWeekDay` gains an optional `userId` field (F032's stacked layout is the
  expected producer of a real per-row value). `WeekTimeGrid` derives `columnUserId = day.userId ??
  currentUserId` per rendered column, so today's single-column-per-day view is unaffected
  (`columnUserId` always resolves to `currentUserId`).
- **Guard:** a single `canCreateInColumn(columnUserId)` predicate (`columnUserId === currentUserId`)
  gates both (a) whether the hover "+" create-affordance button renders at all, and (b) the shared
  `handleColumnPointerDown` handler that both the "+" trigger's click-start and any future
  press-and-drag gesture funnel through — one gate for both the click and the drag path, since the
  existing implementation already routes click-to-create and drag-to-create through the same
  pointerdown handler.
- **Touches:** `components/calendar/week-time-grid.tsx`, `lib/calendar/week-grid.ts` (adds the
  optional `userId` field to `CalendarWeekDay`). No other files.
- **Failure handling:** N/A — this is a pure client-side UI gate, no network call involved in the
  blocked path.
- **Empty state / validation / performance / access control:** no change to any of these; the guard
  only prevents rendering an affordance and short-circuits a handler, it does not alter data shape,
  validation, or performance budget.

## Definition of done

- All three assertions (AS-047, AS-048, AS-049) have a passing test in
  `tests/unit/f024-no-create-on-others.test.tsx`, using `CalendarWeekDay.userId` to simulate
  "another member's column" since no real multi-person column exists yet in the product.
- `npx tsc --noEmit`, `npx eslint --max-warnings=0`, and the targeted vitest run all pass.
- Existing F020/F021/F022 ownership-related tests (`week-time-grid.tsx` block-chip/resize/drag
  guards) continue to pass unmodified — this feature does not touch block-level ownership, only
  the column-level create affordance.
