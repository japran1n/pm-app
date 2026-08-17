# F020: remove member action

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F017

## Assertion IDs covered
- AS-016
- AS-017
- AS-018

## Draft scope
- Server Action: owner/admin removes a member
- Sole-owner guard: cannot remove/demote the only owner

## Files (approximate)
lib/actions/workspaces.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
