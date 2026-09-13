# F008: DB migration — doc_template_links table

**Milestone:** M3 — Templates DB
**Estimated worker time:** 15 minutes
**Depends on:** F007

## Assertion IDs covered
- AS-019

## Draft scope
- New migration: `doc_template_links` table: id uuid PK, template_id uuid FK doc_templates ON DELETE CASCADE, title text not null, description text, url text not null, thumbnail_url text, position int default 0, created_at, updated_at
- ON DELETE CASCADE so deleting a template removes its links

## Files (approximate)
- `supabase/migrations/<ts>_doc_template_links.sql`

## Notes for clarification
- MCP at run: Supabase MCP (apply_migration)
