# F015: Template link editor (add/remove video cards in a template)

**Milestone:** M4 — Templates UI
**Estimated worker time:** 30 minutes
**Depends on:** F011, F012

## Assertion IDs covered
- AS-029, AS-030, AS-037

## Draft scope
- A expandable section inside the template detail view listing `doc_template_links`
- "Add link" form: title (required), url (required), description (optional), thumbnail_url (optional)
- Each link shows title + url; remove button calls `removeDocTemplateLink`
- Matches the style/pattern of `doc-links-editor.tsx` (already exists for docs)

## Files (approximate)
- `components/templates/doc-template-link-editor.tsx`

## Notes for clarification
- MCP at run: none
- Can reuse the existing `doc-links-editor.tsx` component as reference — same field set, same UX pattern
