# F018: revoke invite action

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 15 minutes
**Depends on:** F017

## Assertion IDs covered
- AS-024

## Draft scope
- Server Action: owner/admin can delete a pending (status=invited) workspace_members row

## Files (approximate)
lib/actions/workspaces.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
