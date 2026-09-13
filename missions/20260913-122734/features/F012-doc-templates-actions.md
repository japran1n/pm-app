# F012: Server actions — create, rename, delete template; add/remove template link

**Milestone:** M4 — Templates UI
**Estimated worker time:** 35 minutes
**Depends on:** F010

## Assertion IDs covered
- AS-021, AS-022, AS-025, AS-026, AS-027, AS-028, AS-029, AS-030

## Draft scope
- Create `lib/actions/doc-templates.ts`
- `createDocTemplate(input)` — validate title + doc_kind + content, insert, return new row
- `renameDocTemplate(input)` — check caller is creator or admin, update title
- `deleteDocTemplate(input)` — check caller is creator or admin, delete (CASCADE removes links)
- `addDocTemplateLink(input)` — validate url/title, insert into doc_template_links
- `removeDocTemplateLink(input)` — delete doc_template_link row
- All actions revalidate the relevant path (Next.js `revalidatePath`)
- Zod validation schemas for each action

## Files (approximate)
- `lib/actions/doc-templates.ts`
- `lib/validation/doc-templates.ts`

## Notes for clarification
- MCP at run: none
