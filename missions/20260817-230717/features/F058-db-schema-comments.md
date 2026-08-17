# F058: db schema comments

**Milestone:** M6 — List, search, comments, attachments
**Estimated worker time:** 25 minutes
**Depends on:** F034

## Assertion IDs covered
- AS-104

## Draft scope
- Migration: comments table (task_id, user_id, text, created_at, deleted_at) + RLS scoped through task -> project -> workspace

## Files (approximate)
supabase/migrations/xxxx_comments.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
