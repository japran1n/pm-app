# F014: Create doc template form (title, doc_kind, content)

**Milestone:** M4 — Templates UI
**Estimated worker time:** 25 minutes
**Depends on:** F012

## Assertion IDs covered
- AS-021, AS-025, AS-062

## Draft scope
- Sheet/dialog component: `components/templates/create-doc-template-sheet.tsx`
- Fields: title (text input), doc_kind (select: onboarding / feedback / portal_guide / handover), content (textarea — same as current markdown editor in docs, i.e. plain markdown text)
- Submit calls `createDocTemplate` server action
- Validation errors displayed inline
- Closes on success, revalidates template list

## Files (approximate)
- `components/templates/create-doc-template-sheet.tsx`

## Notes for clarification
- MCP at run: none
