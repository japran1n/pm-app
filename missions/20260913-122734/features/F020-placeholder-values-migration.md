# F020: DB migration — doc_placeholder_values table + RLS

**Milestone:** M5 — Placeholders DB
**Estimated worker time:** 25 minutes
**Depends on:** none

## Assertion IDs covered
- AS-039, AS-040, AS-041, AS-042, AS-043

## Draft scope
- New migration: `doc_placeholder_values` table: id uuid PK, project_id uuid FK projects, key text not null, value text not null, created_at, updated_at
- UNIQUE(project_id, key)
- Updated_at trigger
- RLS: SELECT/INSERT/UPDATE: `is_project_visible_to(project_id)` (team member — reuse existing helper); DELETE same
- Policy explicitly excludes `is_project_client` callers (clients get RLS denial)

## Files (approximate)
- `supabase/migrations/<ts>_doc_placeholder_values.sql`

## Notes for clarification
- MCP at run: Supabase MCP (apply_migration)
- Check whether `is_project_client` function exists in schema — it does (seen in database.types.ts grep)
