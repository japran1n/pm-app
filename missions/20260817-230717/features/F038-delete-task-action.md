# F038: delete task action

**Milestone:** M4 — Tasks core
**Estimated worker time:** 25 minutes
**Depends on:** F035

## Assertion IDs covered
- AS-055
- AS-056
- AS-057

## Draft scope
- Server Action: soft delete, removed from all views immediately, comments/attachments not orphan-browsable

## Files (approximate)
lib/actions/tasks.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
