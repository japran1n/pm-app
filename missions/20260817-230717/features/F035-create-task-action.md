# F035: create task action

**Milestone:** M4 — Tasks core
**Estimated worker time:** 30 minutes
**Depends on:** F034

## Assertion IDs covered
- AS-043
- AS-044
- AS-045
- AS-046

## Draft scope
- Server Action with Zod schema: title required, defaults status=todo if omitted

## Files (approximate)
lib/actions/tasks.ts, lib/validation/tasks.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
