# F023: Portal — resolve and strip placeholders in client view

**Milestone:** M6 — Placeholders UI
**Estimated worker time:** 25 minutes
**Depends on:** F021, F005

## Assertion IDs covered
- AS-049, AS-055, AS-056

## Draft scope
- In the portal how-we-work page server component: before passing `entry.content` to `<MarkdownContent>`, call `resolvePlaceholders({ content, projectId, mode: 'client' })`
- Client sees only resolved values or empty strings — never `{{key}}`
- Sanitization still applied after resolution (resolved values are team-entered, not user-entered, but defense in depth per AS-061)

## Files (approximate)
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/how-we-work/page.tsx`
- `lib/queries/placeholder-values.ts` (add fetch helper)

## Notes for clarification
- MCP at run: none
