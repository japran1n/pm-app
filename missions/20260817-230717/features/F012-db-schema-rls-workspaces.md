# F012: db schema rls workspaces

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F011

## Assertion IDs covered
- AS-010
- AS-011
- AS-137
- AS-138
- AS-139

## Draft scope
- RLS enabled on workspaces + workspace_members
- Policy: only members can SELECT their workspace
- Policy: only members can SELECT workspace_members rows for their own workspace(s)

## Files (approximate)
supabase/migrations/xxxx_rls_workspaces.sql

## Notes for clarification
This is the foundational RLS pattern every later table's policies will copy (join through workspace_members on auth.uid()). Get this one right first.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
