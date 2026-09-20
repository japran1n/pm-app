# F013: exclude deactivated blocks

**Milestone:** M3 — Data layer
**Estimated worker time:** 15 minutes
**Depends on:** F012

## Assertion IDs covered
- AS-031: A deactivated member's blocks are not rendered even when their id is present in `?people=`.

## Draft scope
- An id belonging to a deactivated member yields none of their blocks.
- Handled where the selection is resolved, so every caller inherits it.

## Files (approximate)
- `lib/queries/calendar-blocks.ts`
- `lib/calendar/people-selection.ts`

## Notes for clarification
Pairs with F014: such a person is not offerable in the switcher either.
