# F072: db rpc status counts

**Milestone:** M7 — Dashboard
**Estimated worker time:** 25 minutes
**Depends on:** F033

## Assertion IDs covered
- AS-126
- AS-127
- AS-128
- AS-129

## Draft scope
- Postgres RPC/view: task counts grouped by status, same exclusion rules as F071

## Files (approximate)
supabase/migrations/xxxx_rpc_status_counts.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
