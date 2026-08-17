# F014: workspace switcher ui

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F013

## Assertion IDs covered
- AS-012
- AS-013
- AS-042

## Draft scope
- Switcher component listing all of the user's workspaces
- Selecting one navigates to /w/[workspaceSlug]/... and updates all workspace-scoped queries

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/layout.tsx, components/workspace-switcher.tsx

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
