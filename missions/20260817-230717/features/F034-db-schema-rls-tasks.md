# F034: db schema rls tasks

**Milestone:** M4 — Tasks core
**Estimated worker time:** 25 minutes
**Depends on:** F033

## Assertion IDs covered
- AS-062

## Draft scope
- RLS: tasks readable/writable only by members of the task's project's workspace (join tasks -> projects -> workspace_members)

## Files (approximate)
supabase/migrations/xxxx_rls_tasks.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
