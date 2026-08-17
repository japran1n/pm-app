# F068: db fts setup

**Milestone:** M6 — List, search, comments, attachments
**Estimated worker time:** 25 minutes
**Depends on:** F033

## Assertion IDs covered
- AS-117
- AS-123
- AS-124

## Draft scope
- tsvector generated column + GIN index on tasks(title, description)
- Ranking favors title matches over description-only matches

## Files (approximate)
supabase/migrations/xxxx_fts.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
