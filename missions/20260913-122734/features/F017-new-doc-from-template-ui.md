# F017: "New from template" button in docs sidebar

**Milestone:** M4 — Templates UI
**Estimated worker time:** 25 minutes
**Depends on:** F011, F016

## Assertion IDs covered
- AS-031, AS-032, AS-033

## Draft scope
- Add "New from template" option to the existing `new-doc-button.tsx` dropdown (or alongside it)
- Opens a popover/sheet listing available workspace templates (title + doc_kind badge)
- Selecting one calls `createDocFromTemplate` and redirects to the new doc
- Empty state if no templates exist: "No templates yet — create one in Templates"

## Files (approximate)
- `components/docs/new-doc-button.tsx` (extend) or new `components/docs/new-doc-from-template-button.tsx`
- `components/docs/template-picker.tsx`

## Notes for clarification
- MCP at run: none
