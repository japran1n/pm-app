# F029: switcher url wiring

**Milestone:** M6 — Switcher
**Estimated worker time:** 30 minutes
**Depends on:** F027,F002

## Assertion IDs covered
- AS-011: Navigating to the previous, next, or current week preserves the `?people=` value.
- AS-012: Changing the selected people preserves the `?week=` value.
- AS-013: No Planner view state is written to `localStorage` or `sessionStorage`.
- AS-059: Deselecting every member leaves the Planner showing the signed-in member rather than an empty view.

## Draft scope
- Selection writes ?people=; ?week= is preserved.
- Week navigation preserves ?people=.
- Deselecting everyone falls back to the caller.
- Nothing is written to localStorage or sessionStorage.

## Files (approximate)
- `components/calendar/people-switcher.tsx`
- `components/calendar/week-view.tsx`

## Notes for clarification
Mirrors the filter-carrying link pattern the page used for its now-deleted task filters.
