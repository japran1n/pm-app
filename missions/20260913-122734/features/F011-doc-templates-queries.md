# F011: Query layer — getDocTemplates, getDocTemplate, getDocTemplateLinks

**Milestone:** M4 — Templates UI
**Estimated worker time:** 20 minutes
**Depends on:** F010

## Assertion IDs covered
- AS-020, AS-024

## Draft scope
- Create `lib/queries/doc-templates.ts`
- `getDocTemplates(workspaceId)` → `DocTemplate[]` ordered by position, then created_at
- `getDocTemplate(templateId)` → `DocTemplate | null`
- `getDocTemplateLinks(templateId)` → `DocTemplateLink[]` ordered by position
- Use `createClient` server pattern matching existing query files

## Files (approximate)
- `lib/queries/doc-templates.ts`

## Notes for clarification
- MCP at run: none (queries use server Supabase client)
