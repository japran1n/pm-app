# F038: stacked a11y

**Milestone:** M8 — Polish
**Estimated worker time:** 30 minutes
**Depends on:** F032

## Assertion IDs covered
- AS-083: The stacked layout exposes its rows as a labelled region so a screen reader announces whose planner each row is.

## Draft scope
- Stacked rows form a labelled region so each row is announced with its person's name.

## Files (approximate)
- `components/calendar/stacked-planner.tsx`

## Notes for clarification
Without the label a screen reader hears an undifferentiated wall of blocks.
