# F002: people param parse

**Milestone:** M1 — Pure logic
**Estimated worker time:** 30 minutes
**Depends on:** none

## Assertion IDs covered
- AS-003: `?people=me` resolves to the signed-in member.
- AS-004: `?people=all` resolves to every active member of the workspace.
- AS-005: `?people=<memberId>` shows that member's blocks and no one else's.
- AS-006: A comma-separated list of member ids in `?people=` shows exactly those members' blocks.
- AS-009: The sequence of ids in `?people=` is preserved exactly as given; it is neither alphabetised nor reordered by the parser.
- AS-010: An id repeated in `?people=` produces exactly one selected person.
- AS-015: The Planner honours no `?view=` parameter; supplying one changes nothing about what is rendered.

## Draft scope
- parsePeopleParam(raw, {selfId, activeMemberIds}) -> ordered list of member ids.
- Handles the literals `me` and `all`, and a comma-separated id list.
- Preserves the given order; dedupes by keeping the first occurrence.
- serializePeopleParam(ids, selfId) -> the canonical string for the URL.
- No `?view=` is read or produced anywhere.

## Files (approximate)
- `lib/calendar/people-selection.ts`

## Notes for clarification
Order significance is the whole point; a Set round-trip silently breaks AS-009 and AS-063.
