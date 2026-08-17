# F033: db schema tasks

**Milestone:** M4 — Tasks core
**Estimated worker time:** 35 minutes
**Depends on:** F025

## Assertion IDs covered
- AS-047
- AS-048
- AS-049
- AS-050
- AS-058
- AS-059
- AS-065
- AS-066

## Draft scope
- Migration: tasks table with CHECK constraint on status (todo/in_progress/in_review/done) and priority (urgent/high/medium/low/backlog)
- tags text[] default '{}'; timestamps; deleted_at; position double precision

## Files (approximate)
supabase/migrations/xxxx_tasks.sql

## Notes for clarification
Use CHECK constraints per tech-decisions.md, not a native Postgres enum type (avoids ALTER TYPE transaction limitations).
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification
