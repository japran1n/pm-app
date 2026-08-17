# F064: db schema attachments

**Milestone:** M6 — List, search, comments, attachments
**Estimated worker time:** 30 minutes
**Depends on:** F034

## Assertion IDs covered
- AS-106
- AS-107

## Draft scope
- Migration: attachments table (task_id, file_url, file_name, uploaded_by, created_at)
- Private Supabase Storage bucket + storage RLS policy scoped to workspace membership

## Files (approximate)
supabase/migrations/xxxx_attachments.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
