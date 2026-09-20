# F011: rls tests block visibility

**Milestone:** M2 — Database
**Estimated worker time:** 45 minutes
**Depends on:** F010

## Assertion IDs covered
- AS-028: Someone who is not an active member of the workspace cannot read any of its calendar blocks.
- AS-032: A member cannot insert, update, or delete a calendar block owned by another member; the database rejects the write.

## Draft scope
- Test: an active member reads another member's block.
- Test: an active member's update of another member's block is refused.
- Test: a non-member reads nothing.

## Files (approximate)
- `tests/integration/planner-block-rls.test.ts`

## Notes for clarification
Proves the widening in F008 widened reads only, and left writes owner-only.
