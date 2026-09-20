# F027: switcher multiselect

**Milestone:** M6 — Switcher
**Estimated worker time:** 30 minutes
**Depends on:** F026

## Assertion IDs covered
- AS-054: The switcher allows several members to be selected at once.
- AS-055: The switcher's closed state shows the current selection as a group of avatars with an overflow count when it does not fit.

## Draft scope
- Several members can be selected at once.
- The closed trigger shows an avatar group with an overflow count.

## Files (approximate)
- `components/calendar/people-switcher.tsx`

## Notes for clarification
The trigger is the only always-visible indicator of who is on screen.
