# F077: dashboard rls verification

**Milestone:** M7 — Dashboard
**Estimated worker time:** 20 minutes
**Depends on:** F071

## Assertion IDs covered
- AS-133

## Draft scope
- Confirm the RPCs themselves are workspace-scoped and cannot be called cross-workspace via direct API manipulation

## Files (approximate)
supabase/migrations/xxxx_rpc_priority_counts.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
