# F031: project notfound handling

**Milestone:** M3 — Projects
**Estimated worker time:** 20 minutes
**Depends on:** F030

## Assertion IDs covered
- AS-039
- AS-040

## Draft scope
- Invalid/deleted project id shows not-found
- Project belonging to a different workspace than the active one redirects or shows not-found, never partial data

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
