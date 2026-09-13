# F009: RLS policies — doc_templates and doc_template_links

**Milestone:** M3 — Templates DB
**Estimated worker time:** 25 minutes
**Depends on:** F007, F008

## Assertion IDs covered
- AS-020, AS-021, AS-022, AS-023

## Draft scope
- Enable RLS on both tables
- doc_templates SELECT: `is_active_workspace_member(workspace_id)` (reuse existing helper)
- doc_templates INSERT: same membership check; `created_by = auth.uid()`
- doc_templates DELETE: creator OR workspace admin (`is_workspace_admin(workspace_id)`)
- doc_templates UPDATE (rename): same as DELETE
- doc_template_links SELECT/INSERT/UPDATE/DELETE: inherit via `template_id → doc_templates` parent check (join or subquery)
- Migration file adds the policies inline with the table creation or as a follow-on

## Files (approximate)
- `supabase/migrations/<ts>_doc_templates_rls.sql`

## Notes for clarification
- MCP at run: Supabase MCP (apply_migration, execute_sql for verification)
- Check `is_workspace_admin` function exists; if not, use the equivalent pattern from existing migrations
