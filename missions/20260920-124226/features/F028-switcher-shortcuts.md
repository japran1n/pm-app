# F028: switcher shortcuts

**Milestone:** M6 — Switcher
**Estimated worker time:** 15 minutes
**Depends on:** F027,F006

## Assertion IDs covered
- AS-056: The switcher offers a "just me" shortcut that returns the Planner to the signed-in member alone.
- AS-057: The switcher offers a "whole team" shortcut that selects every active member.

## Draft scope
- 'Just me' returns to the caller alone.
- 'Whole team' selects every active member using F006's ordering.

## Files (approximate)
- `components/calendar/people-switcher.tsx`

## Notes for clarification
These two are the paths that actually get used daily; they must be one click.
