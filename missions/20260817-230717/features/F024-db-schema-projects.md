# F024: db schema projects

**Milestone:** M3 — Projects
**Estimated worker time:** 25 minutes
**Depends on:** F012

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- Migration: projects table (workspace_id, name, description, start_date, end_date, created_at, updated_at, created_by, deleted_at)

## Files (approximate)
supabase/migrations/xxxx_projects.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
