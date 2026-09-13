# F006: Tests — markdown renderer and YouTube detection

**Milestone:** M2 — Rendering
**Estimated worker time:** 30 minutes
**Depends on:** F002, F003, F004

## Assertion IDs covered
- AS-063, AS-065

## Draft scope
- Unit tests for `MarkdownContent`: heading renders as h2, table rows render as tr, script tag is stripped
- Unit tests for `isYouTubeUrl`: all three positive patterns, two non-YouTube negatives
- Unit tests for `extractYouTubeId`: correct ID extracted from each URL form
- Use Vitest + @testing-library/react (already in project)

## Files (approximate)
- `tests/unit/markdown-renderer.test.tsx`
- `tests/unit/youtube-detection.test.ts`

## Notes for clarification
- MCP at run: none
