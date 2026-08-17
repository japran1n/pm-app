# F042: board columns render

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 25 minutes
**Depends on:** F033

## Assertion IDs covered
- AS-067
- AS-068

## Draft scope
- Board renders exactly 4 fixed columns in order: To Do, In Progress, In Review, Done
- Each column filters tasks by status + current project

## Files (approximate)
app/(workspace)/.../board/page.tsx, components/board/board-column.tsx

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
