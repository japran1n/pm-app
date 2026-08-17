# F021: delete workspace action

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F017

## Assertion IDs covered
- AS-020
- AS-021

## Draft scope
- Server Action: owner-only, soft-deletes workspace + cascades soft-delete to its projects and tasks

## Files (approximate)
lib/actions/workspaces.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
