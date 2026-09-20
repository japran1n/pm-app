# F003: people param invalid

**Milestone:** M1 — Pure logic
**Estimated worker time:** 15 minutes
**Depends on:** F002

## Assertion IDs covered
- AS-007: An id in `?people=` that is not an active workspace member is dropped, and the remaining valid ids still take effect.
- AS-008: A `?people=` value whose ids are all invalid falls back to the signed-in member's own planner rather than showing an error or an empty page.

## Draft scope
- An id that is not an active member is dropped; the rest still apply.
- If nothing survives, the result is the signed-in member alone.
- Never throws and never returns an empty list.

## Files (approximate)
- `lib/calendar/people-selection.ts`

## Notes for clarification
Same silent-drop posture resolveCalendarFilters used before it is deleted in F017.
