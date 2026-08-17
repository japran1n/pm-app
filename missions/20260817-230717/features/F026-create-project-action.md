# F026: create project action

**Milestone:** M3 — Projects
**Estimated worker time:** 30 minutes
**Depends on:** F025

## Assertion IDs covered
- AS-025
- AS-026
- AS-035
- AS-036

## Draft scope
- Server Action with Zod schema: name required, end_date >= start_date if both set
- Sets created_at/created_by automatically

## Files (approximate)
lib/actions/projects.ts, lib/validation/projects.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
