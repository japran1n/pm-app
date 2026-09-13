# F002: Markdown renderer component (server-safe, sanitized)

**Milestone:** M2 — Rendering
**Estimated worker time:** 30 minutes
**Depends on:** F001

## Assertion IDs covered
- AS-001, AS-002, AS-003, AS-004, AS-005, AS-006, AS-007, AS-008, AS-061

## Draft scope
- Create `components/portal/markdown-content.tsx` — a React Server Component
- Use `react-markdown` + `remark-gfm` plugin (tables, strikethrough, blockquotes)
- Sanitize rendered HTML with `sanitize-html` before passing to ReactDOM (strip script, event handlers)
- Apply `@tailwindcss/typography` prose classes for heading/list/table styling consistent with Supabase DS
- Props: `{ content: string; className?: string }`

## Files (approximate)
- `components/portal/markdown-content.tsx`

## Notes for clarification
- MCP at run: none
- Must be a Server Component — no `"use client"` — sanitize-html runs in Node/edge
- Do NOT apply prose styles that override Supabase DS tokens (colors come from CSS variables)
