# F050: board soft delete filter

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 15 minutes
**Depends on:** F049

## Assertion IDs covered
- AS-081

## Draft scope
- Board query and Realtime payload both exclude deleted_at IS NOT NULL tasks, including mid-drag

## Files (approximate)
app/(workspace)/.../board/page.tsx

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none
