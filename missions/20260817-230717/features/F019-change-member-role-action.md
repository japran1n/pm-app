# F019: change member role action

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 25 minutes
**Depends on:** F017

## Assertion IDs covered
- AS-014
- AS-015
- AS-019

## Draft scope
- Server Action: owner changes a member's role between member/admin
- Rejects the change server-side if caller is not owner, even if UI is bypassed

## Files (approximate)
lib/actions/workspaces.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
