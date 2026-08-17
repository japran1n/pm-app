# F065: upload attachment action

**Milestone:** M6 — List, search, comments, attachments
**Estimated worker time:** 35 minutes
**Depends on:** F064

## Assertion IDs covered
- AS-105
- AS-108
- AS-112
- AS-113

## Draft scope
- Server Action: upload to private bucket, issue signed URL, enforce size limit and allowed MIME types

## Files (approximate)
lib/actions/attachments.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
