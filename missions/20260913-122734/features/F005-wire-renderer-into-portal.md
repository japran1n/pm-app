# F005: Wire markdown renderer and new link cards into how-we-work list

**Milestone:** M2 — Rendering
**Estimated worker time:** 20 minutes
**Depends on:** F002, F004

## Assertion IDs covered
- AS-001, AS-002, AS-003, AS-004, AS-005, AS-006, AS-008, AS-015, AS-016, AS-017, AS-069

## Draft scope
- In `components/portal/how-we-work-list.tsx`:
  - Replace `<p className="whitespace-pre-line">` with `<MarkdownContent content={entry.content} />`
  - Replace inline `<li>` link card rendering with `<DocLinkCard link={link} />`
- No layout changes — only the rendering of content and link cards changes
- Verify existing plain-text docs look acceptable under the markdown renderer

## Files (approximate)
- `components/portal/how-we-work-list.tsx`

## Notes for clarification
- MCP at run: none
- This is a surgical swap — no query changes, no DB changes
