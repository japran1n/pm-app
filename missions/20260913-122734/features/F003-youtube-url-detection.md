# F003: YouTube URL detection utility

**Milestone:** M2 — Rendering
**Estimated worker time:** 15 minutes
**Depends on:** none

## Assertion IDs covered
- AS-009, AS-010, AS-011, AS-063

## Draft scope
- Create `lib/docs/youtube.ts`
- Export `isYouTubeUrl(url: string): boolean` — matches youtube.com/watch, youtu.be/, youtube-nocookie.com/embed/
- Export `extractYouTubeId(url: string): string | null` — returns the video ID
- Export `buildEmbedUrl(id: string): string` — returns `https://www.youtube-nocookie.com/embed/{id}`
- Export `buildThumbnailUrl(id: string): string` — returns `https://i.ytimg.com/vi/{id}/hqdefault.jpg`

## Files (approximate)
- `lib/docs/youtube.ts`
- `tests/unit/youtube-detection.test.ts`

## Notes for clarification
- MCP at run: none
- Pure functions, no network calls, trivially testable
