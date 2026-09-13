# F024: Team side — highlight unresolved placeholders

**Milestone:** M6 — Placeholders UI
**Estimated worker time:** 25 minutes
**Depends on:** F021

## Assertion IDs covered
- AS-054, AS-055

## Draft scope
- The workspace docs view of how-we-work (if it exists) or any team-side doc preview uses mode='team'
- `<mark data-unresolved>` elements styled via globals.css: yellow background, dashed underline, cursor-help
- Tooltip on hover: "This value hasn't been set — add it in Project Settings → Placeholder values"
- Tooltip via Radix/base-ui Tooltip (already a dep via shadcn/base-ui) or title attribute fallback

## Files (approximate)
- `app/globals.css` (or component-level styles for `[data-unresolved]`)
- `components/portal/markdown-content.tsx` (extend to handle `<mark>` passthrough)

## Notes for clarification
- MCP at run: none
- `sanitize-html` must allowlist `<mark>` with `data-unresolved` attribute to let team-mode marks survive sanitization; client mode never produces `<mark>` so client is unaffected
