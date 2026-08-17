# F079: rls audit all tables

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 30 minutes
**Depends on:** F072

## Assertion IDs covered
- AS-137
- AS-138
- AS-139

## Draft scope
- Audit pass: every workspace-scoped table has RLS enabled; anon-key-only requests return zero rows; cross-workspace joins are blocked

## Files (approximate)
supabase/migrations/ (audit + any missing policy fixes)

## Notes for clarification
This is a review-and-fix feature, not new functionality — read every prior migration's RLS policy and close any gap found.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
