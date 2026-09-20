# F014: switcher member source

**Milestone:** M3 — Data layer
**Estimated worker time:** 15 minutes
**Depends on:** none

## Assertion IDs covered
- AS-030: A member who has been deactivated or removed from the workspace does not appear in the people switcher.

## Draft scope
- Resolve active workspace members with id, display name, and avatar for the switcher.
- Deactivated and removed members are excluded.

## Files (approximate)
- `lib/queries/members.ts`

## Notes for clarification
getWorkspaceMembers already splits active from pending; reuse rather than add a query.
