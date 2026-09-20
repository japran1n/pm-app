# F012: blocks query people filter

**Milestone:** M3 — Data layer
**Estimated worker time:** 30 minutes
**Depends on:** F002,F010

## Assertion IDs covered
- AS-005: `?people=<memberId>` shows that member's blocks and no one else's.
- AS-006: A comma-separated list of member ids in `?people=` shows exactly those members' blocks.
- AS-029: The set of people is applied as a database-level restriction on the blocks query, not by discarding rows after fetching them.

## Draft scope
- getCalendarBlocks accepts an ordered userIds list.
- The restriction is applied with an `in` clause in the query itself.
- Omitting the list keeps the existing whole-workspace behaviour for any other caller.

## Files (approximate)
- `lib/queries/calendar-blocks.ts`

## Notes for clarification
This is also the fix for the live defect: today the Planner fetches everyone's blocks and renders them unlabelled.
