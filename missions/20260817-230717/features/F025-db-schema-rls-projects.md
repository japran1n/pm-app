# F025: db schema rls projects

**Milestone:** M3 — Projects
**Estimated worker time:** 20 minutes
**Depends on:** F024

## Assertion IDs covered
- AS-028

## Draft scope
- RLS: only workspace members can SELECT/INSERT/UPDATE projects in their workspace

## Files (approximate)
supabase/migrations/xxxx_rls_projects.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
