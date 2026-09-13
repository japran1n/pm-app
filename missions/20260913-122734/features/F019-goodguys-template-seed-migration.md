# F019: Data migration — seed Webflow handover template into goodguys-demo

**Milestone:** M4 — Templates UI
**Estimated worker time:** 25 minutes
**Depends on:** F007, F008

## Assertion IDs covered
- AS-036, AS-037, AS-038

## Draft scope
- New migration: insert the Webflow handover template into `doc_templates` for the goodguys-demo workspace
- Insert the 8 `doc_template_links` (video IDs verified: Lq2bC2aXoT4, brrC1W6LXRk, RY1h1qiLwCM, tzHGENaYebM, dVXnB9c-XWs, M7uJEbDD-_8, 1E7a1EGXIgE, oK3CV1c0MKE)
- In the same migration: delete the old doc (aaa3e571-04a9-4df5-94c1-5ea025a40e0c) and its doc_links
- Seed a new `docs` row for the same project by calling `createDocFromTemplate` logic inline (or duplicating the insert pattern)
- Idempotent: wrap in a DO $$ block that checks for existence before inserting

## Files (approximate)
- `supabase/migrations/<ts>_seed_goodguys_handover_template.sql`

## Notes for clarification
- MCP at run: Supabase MCP (apply_migration)
- Workspace id for goodguys-demo: e0b89b59-da49-4e34-9455-37c15d7c27b6
- Project id: a1b2c3d4-0000-4000-8000-000000000001
