# F004: planner layout derivation

**Milestone:** M1 — Pure logic
**Estimated worker time:** 15 minutes
**Depends on:** F002

## Assertion IDs covered
- AS-016: When exactly one person is selected, the Planner renders the full-day week grid.
- AS-017: When two or more people are selected, the Planner renders the stacked layout instead of the week grid.

## Draft scope
- resolvePlannerLayout(count) -> 'week' for one person, 'stacked' for two or more.
- Pure; takes a count, not a request or a component.

## Files (approximate)
- `lib/calendar/planner-layout.ts`

## Notes for clarification
Deliberately has no 'view' input: the layout is derived, never requested.
