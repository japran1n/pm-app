# F013: "Docs" tab in /templates route

**Milestone:** M4 — Templates UI
**Estimated worker time:** 25 minutes
**Depends on:** F011, F012

## Assertion IDs covered
- AS-024, AS-025, AS-026, AS-027, AS-028

## Draft scope
- Add a "Docs" tab to the existing templates page alongside the "Tasks" tab
- Fetch templates with `getDocTemplates` server-side
- `DocTemplateList` client component: displays title, doc_kind badge, created date
- Rename action via inline edit (same pattern as task template rename)
- Delete action with confirm dialog (same pattern)
- "New doc template" button → opens create form

## Files (approximate)
- `app/(workspace)/w/[workspaceSlug]/templates/page.tsx` (add tab)
- `components/templates/doc-template-list.tsx`
- `components/templates/new-doc-template-button.tsx`

## Notes for clarification
- MCP at run: none
