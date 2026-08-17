# F029: archive project action

**Milestone:** M3 — Projects
**Estimated worker time:** 30 minutes
**Depends on:** F026

## Assertion IDs covered
- AS-030
- AS-031
- AS-032
- AS-033

## Draft scope
- Server Action: admin/owner-only archive (soft delete)
- Archived project hidden from default list but directly navigable with tasks intact
- member role rejected server-side

## Files (approximate)
lib/actions/projects.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
