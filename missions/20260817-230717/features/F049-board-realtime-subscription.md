# F049: board realtime subscription

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 30 minutes
**Depends on:** F048

## Assertion IDs covered
- AS-076

## Draft scope
- Supabase Realtime subscription on tasks table scoped to project_id; incoming changes update board state for other viewers within a few seconds

## Files (approximate)
components/board/use-board-realtime.ts

## Notes for clarification
MCP at run: Supabase MCP useful for verifying the Realtime publication includes the tasks table.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
