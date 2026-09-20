# F020: ownership predicate

**Milestone:** M5 — Read-only
**Estimated worker time:** 30 minutes
**Depends on:** F012

## Assertion IDs covered
- AS-046: The signed-in member's own blocks remain fully editable while another member's blocks are on screen.

## Draft scope
- Thread the signed-in member's id into the grid.
- Define the ownership predicate once and export it.
- Own blocks stay fully editable with other members' blocks on screen.

## Files (approximate)
- `components/calendar/week-time-grid.tsx`
- `lib/calendar/block-ownership.ts`

## Notes for clarification
Single source of truth for F021-F024; do not re-derive the comparison per affordance.
