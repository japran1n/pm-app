# F046: reorder task position action

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 25 minutes
**Depends on:** F045

## Assertion IDs covered
- AS-070
- AS-078
- AS-079
- AS-080

## Draft scope
- Server Action: same-column reorder updates position only; new tasks append at end-of-column position

## Files (approximate)
lib/actions/tasks.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
