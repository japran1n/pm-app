# F007: DB migration — doc_templates table

**Milestone:** M3 — Templates DB
**Estimated worker time:** 20 minutes
**Depends on:** none

## Assertion IDs covered
- AS-018

## Draft scope
- New migration file: `supabase/migrations/YYYYMMDDHHMMSS_doc_templates.sql`
- Create `doc_templates` table: id uuid PK default gen_random_uuid(), workspace_id uuid FK workspaces, title text not null, doc_kind text not null, content text default '', position int default 0, created_by uuid FK auth.users, created_at timestamptz default now(), updated_at timestamptz default now()
- updated_at trigger (reuse existing pattern from docs table)
- CHECK constraint: doc_kind in ('onboarding','feedback','portal_guide','handover')

## Files (approximate)
- `supabase/migrations/<ts>_doc_templates.sql`

## Notes for clarification
- MCP at run: Supabase MCP (apply_migration)
