# F023: readonly block popover

**Milestone:** M5 — Read-only
**Estimated worker time:** 45 minutes
**Depends on:** F020

## Assertion IDs covered
- AS-044: Clicking a block owned by another member opens a read-only detail view.
- AS-045: The read-only detail view for another member's block offers no save and no delete control.

## Draft scope
- Clicking another member's block opens a read-only detail view.
- That view carries no save and no delete control.
- It shows the real title, per AS-027.

## Files (approximate)
- `components/calendar/calendar-block-popover-form.tsx`

## Notes for clarification
Discovery 3 asked to see everything on someone else's block that you see on your own. Read-only means non-editable, not redacted.
