# F011: db schema workspaces

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F003

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- Migration: workspaces table (id, name, slug, created_at, deleted_at)
- Migration: workspace_members table (workspace_id, user_id, role enum owner/admin/member, status enum invited/active, invited_email)

## Files (approximate)
supabase/migrations/xxxx_workspaces.sql

## Notes for clarification
MCP at run: Supabase MCP for applying/inspecting the migration against the linked project.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
