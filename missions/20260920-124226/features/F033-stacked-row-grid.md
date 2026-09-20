# F033: stacked row grid

**Milestone:** M7 — Stacked
**Estimated worker time:** 45 minutes
**Depends on:** F032,F005

## Assertion IDs covered
- AS-018: The stacked layout renders the hours 08:00 to 16:00 only.
- AS-019: The stacked layout renders Monday through Friday only, as five day columns.
- AS-020: A block lying entirely outside 08:00–16:00 is not rendered in the stacked layout.
- AS-021: A block falling on a Saturday or Sunday is not rendered in the stacked layout.
- AS-022: A block that partly overlaps 08:00–16:00 is rendered in the stacked layout clipped to the visible window.

## Draft scope
- Five day columns, Monday to Friday.
- The 08:00-16:00 window only.
- Blocks clipped by F005; a block with nothing visible is not rendered.

## Files (approximate)
- `components/calendar/stacked-person-row.tsx`

## Notes for clarification
Deliberately a different window from the week grid's 24h/7-day view; this is the answer to A1, not an oversight.
