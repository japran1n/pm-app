# F088: ssr audit

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 20 minutes
**Depends on:** F073

## Assertion IDs covered
- AS-155

## Draft scope
- Audit pass: workspace, project, and task views render primary content server-side (visible in initial HTML), not client-fetched-only

## Files (approximate)
app/(workspace)/**/*

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
