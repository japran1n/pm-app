# F031: page layout derivation

**Milestone:** M7 — Stacked
**Estimated worker time:** 45 minutes
**Depends on:** F004,F012,F016

## Assertion IDs covered
- AS-001: Opening the Planner with no query parameters shows only the signed-in member's own calendar blocks.
- AS-002: Opening the Planner with no query parameters renders the full-day week grid, covering all 24 hours across 7 days.
- AS-014: A Planner URL opened by a second member with the same access rights renders the same selection of people and the same week.
- AS-023: Narrowing the selection to a single person from the stacked layout returns the Planner to the full-day week grid for that person.

## Draft scope
- Page resolves the selection, derives the layout, and fetches blocks for all selected people.
- No params means the caller alone, on the week grid.
- Narrowing to one person from stacked returns the full-day week grid.
- The same URL renders identically for another member with the same access.

## Files (approximate)
- `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`

## Notes for clarification
One fetch for all selected people, then bucket by person in memory; not one query per row.
