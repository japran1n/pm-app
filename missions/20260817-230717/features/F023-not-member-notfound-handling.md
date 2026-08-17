# F023: not member notfound handling

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 25 minutes
**Depends on:** F012

## Assertion IDs covered
- AS-144

## Draft scope
- Non-member accessing a workspace URL sees a generic not-found, never a state that confirms the workspace's existence

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/layout.tsx

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
