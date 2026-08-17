# F047: board optimistic ui

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 30 minutes
**Depends on:** F046

## Assertion IDs covered
- AS-077

## Draft scope
- Optimistic local reorder on drag; rollback to server state if the Server Action call fails

## Files (approximate)
components/board/board-column.tsx

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
