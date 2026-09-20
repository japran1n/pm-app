# F026: people switcher shell

**Milestone:** M6 — Switcher
**Estimated worker time:** 45 minutes
**Depends on:** F014

## Assertion IDs covered
- AS-052: The switcher lists active workspace members with their avatar and name.
- AS-053: Typing in the switcher narrows the listed members.

## Draft scope
- Combobox listing active members with avatar and name.
- Typing narrows the list.

## Files (approximate)
- `components/calendar/people-switcher.tsx`

## Notes for clarification
cmdk is already a dependency and is the repo's combobox primitive; no new package.
