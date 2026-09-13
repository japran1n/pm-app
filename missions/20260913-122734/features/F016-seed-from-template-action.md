# F016: Server action — createDocFromTemplate

**Milestone:** M4 — Templates UI
**Estimated worker time:** 30 minutes
**Depends on:** F010, F012

## Assertion IDs covered
- AS-031, AS-032, AS-033, AS-034, AS-035

## Draft scope
- `createDocFromTemplate({ templateId, projectId, workspaceId })` in `lib/actions/doc-templates.ts`
- Fetch template + template links
- Insert new `docs` row: copy title, doc_kind, content; set project_id, workspace_id, position = last + 1, client_visible = false, created_by = caller
- Insert new `doc_links` rows for each template link, preserving position integer exactly
- Return new doc id for redirect
- Wrap in a Supabase transaction (or sequential inserts with error rollback)

## Files (approximate)
- `lib/actions/doc-templates.ts` (extend)

## Notes for clarification
- MCP at run: none
