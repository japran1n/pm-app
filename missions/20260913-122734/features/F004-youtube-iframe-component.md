# F004: YouTube iframe component

**Milestone:** M2 — Rendering
**Estimated worker time:** 30 minutes
**Depends on:** F003

## Assertion IDs covered
- AS-009, AS-010, AS-011, AS-012, AS-013, AS-014, AS-015, AS-068

## Draft scope
- Create `components/portal/doc-link-card.tsx` — replaces the inline rendering in `how-we-work-list.tsx`
- If `isYouTubeUrl(link.url)` → render `<iframe>` with: `src` = embed URL, `loading="lazy"`, `title` = link.title, `youtube-nocookie.com` domain
- Show `thumbnail_url` as a poster image (`<img>` above the iframe with `object-cover`) before iframe paint
- If not YouTube → render existing card UI (thumbnail + title + description + ExternalLink icon)
- Responsive: `aspect-video w-full` on the iframe wrapper

## Files (approximate)
- `components/portal/doc-link-card.tsx`

## Notes for clarification
- MCP at run: none
- The component is client-agnostic (no hooks needed) — can be a Server Component
- `allowFullScreen` and standard YouTube embed params (rel=0, modestbranding) on the iframe src
