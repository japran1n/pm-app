# F062: comment soft delete realtime

**Milestone:** M6 — List, search, comments, attachments
**Estimated worker time:** 20 minutes
**Depends on:** F061

## Assertion IDs covered
- AS-101
- AS-102

## Draft scope
- Soft-deleted comment removed from all live views via Realtime, and stays gone after reload

## Files (approximate)
components/task/use-comments-realtime.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
