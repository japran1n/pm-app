# F006: whole team ordering

**Milestone:** M1 — Pure logic
**Estimated worker time:** 15 minutes
**Depends on:** none

## Assertion IDs covered
- AS-058: The "whole team" shortcut orders the signed-in member first, then the remaining members alphabetically by name.

## Draft scope
- orderPeopleForWholeTeam(members, selfId) -> self first, then the rest alphabetically by display name.
- Stable for members sharing a name.

## Files (approximate)
- `lib/calendar/people-selection.ts`

## Notes for clarification
Feeds the 'whole team' shortcut in F028 and the default stacked order.
