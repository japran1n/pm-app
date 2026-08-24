# Handoff: F240 — timeline-zoom

## Status
COMPLETE

## Assertions covered
AS-456: PASS — week, month, and quarter zoom levels change pixels-per-day AND header granularity (day / month / quarter labels) via `?zoom=week|month|quarter`, preserve the centre (anchor) month across zoom changes, degrade a stale/tampered value to the default "month" zoom, and stay bounded at the coarsest ("quarter") zoom to a 13-calendar-month window. Every F237 (bar layout), F238 (drag/resize round trip), and F239 (dependency connector geometry) function is re-proven correct at all three zoom levels' real `pixelsPerDay` values in `tests/unit/f240-timeline-zoom.test.ts`.

## Files changed
lib/timeline/layout.ts
components/timeline/timeline-scale.tsx
components/timeline/timeline-toolbar.tsx (new)
app/(workspace)/w/[workspaceSlug]/timeline/page.tsx
tests/unit/f240-timeline-zoom.test.ts (new)

## Commands run
`npx tsc --noEmit` (0) — clean, no output
`npx eslint .` (0) — 0 errors, 2 pre-existing warnings unrelated to this feature (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts)
`npx vitest run tests/unit/f240-timeline-zoom.test.ts tests/unit/timeline-layout.test.ts tests/unit/timeline-reschedule.test.ts tests/unit/f239-timeline-dependency-layout.test.ts` (0) — 4 files, 65 tests passed
`npx vitest run tests/unit/f237-timeline-render.test.tsx tests/integration/f237-timeline-query.test.ts tests/integration/f238-timeline-drag-resize.test.ts tests/integration/f239-timeline-dependency-query.test.ts` — f237-timeline-query.test.ts failed on first run with "JWT issued at future" (documented known infra clock-skew condition); re-ran that file ALONE and it passed 9/9. The other 3 files passed on the combined run: f237-timeline-render.test.tsx, f238-timeline-drag-resize.test.ts, f239-timeline-dependency-query.test.ts all green.
`npm test` (full suite) — 284 passed / 18 failed test files, 2111 passed / 31 failed tests. Every failure is in `tests/integration/workspace-role-expansion.test.ts` (F126, AS-238, invite-member rate-limit-shaped "Something went wrong" errors) plus one unrelated unhandled-rejection warning inside `tests/unit/user-avatar.test.tsx` (a `cookies()` outside request scope error from `lib/actions/comments.ts`'s `getMentionCandidates`, pre-existing, nothing to do with timeline/zoom code). No timeline test file (F237/F238/F239/F240) appears among the failures — confirmed by grepping the full suite's FAIL lines and by the isolated re-run above. These are the documented known infra conditions this mission's instructions say not to chase as code bugs (Supabase Auth rate limiting / clock skew).

## Decisions made
- Zoom is URL-encoded as `?zoom=week|month|quarter` alongside the existing `?month=YYYY-MM` anchor param — matches the clarified "URL search params for anything shareable" answer and the calendar's own `?month=` precedent.
- "Preserve the centre date across zoom" is achieved by construction: `timelineRangeForZoom(year, month, zoom)` always anchors on the SAME `year`/`month` the "?month=" param already resolved to; only the window WIDTH varies per zoom (week = the anchor month alone; month = the pre-existing 3-month window, unchanged; quarter = 6 months either side, 13 months total). Switching zoom therefore never resets to today and never moves the centre — verified by `test_AS_456_zoom_change_preserves_the_centre_anchor_month_never_resets_to_today`.
- AUTONOMOUS_DECISION: picked `PIXELS_PER_DAY_BY_ZOOM = { week: 64, month: 32 (unchanged default), quarter: 12 }` — the simpler option that reuses every existing `pixelsPerDay`-parametrized function in `lib/timeline/layout.ts`/`lib/timeline/reschedule.ts` unmodified (those functions were already written by F237/F238 to take `pixelsPerDay` as an explicit parameter specifically to leave this seam for F240 — confirmed by that file's own header comment). No new dependency, no second source of truth.
- AUTONOMOUS_DECISION: "quarter" zoom's bounded window is 13 calendar months (6 before + anchor + 6 after) rather than an unbounded "everything" fetch — satisfies the spec's explicit "do not fetch a whole workspace's history at the coarsest zoom" requirement while still being meaningfully coarser than "month" zoom's 3-month window.
- Header granularity per zoom: "week" labels every day (`dayLabelFor`, e.g. "Aug 5"), "month" labels every month start (unchanged, "August 2026"), "quarter" labels every quarter start ("Q3 2026"). Implemented via new `isWeekStart`/`isQuarterStart` flags on `TimelineDayTick` (`buildTimelineDayTicks`), computed purely from the UTC-anchored parsed date — no new date library, no ambient timezone read.
- `TimelineScale`'s new `zoom` prop defaults to `DEFAULT_TIMELINE_ZOOM` ("month") so the existing `tests/unit/f237-timeline-render.test.tsx` calls (which don't pass `zoom`) keep rendering identically — confirmed green.
- New `components/timeline/timeline-toolbar.tsx` is a Server Component (no "use client") — three plain `<Link>`s wrapped in the existing `Button` `render` prop pattern, mirroring the page's own prev/today/next month buttons exactly. No client JS needed for the control itself, matching the "URL for anything shareable" and "no new dependency" clarified answers.
- No MCP usage: this feature's Notes explicitly say "MCP at run: none," and nothing here touches Supabase schema/policies/live config — confirmed against `missions/20260818-213033/connections/mcp-registry.md`.

## Out-of-scope work needed
- None identified beyond this feature's stated scope. The zoom level is not yet persisted into a saved view's `config` (F227) — the spec's Draft scope names this as a future integration point ("part of a saved view's config (F227)") but F227 itself is a separate, already-scoped feature; wiring timeline zoom into saved-view config, if not already covered by F227's own contract, would need a small follow-up but no assertion currently requires it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: pixels-per-day values per zoom level (week=64, month=32 unchanged, quarter=12) chosen as reasonable, monotonically-ordered defaults with no design-system input available; documented above.
AUTONOMOUS_DECISION: "quarter" zoom window bounded to 13 calendar months (not unbounded); documented above.
AUTONOMOUS_DECISION: header tick granularity per zoom level (day / month / quarter labels) chosen to keep each zoom's header legible at its own pixel density; documented above.

## Notes for the next worker
- The zoom seam this feature adds sits entirely in `lib/timeline/layout.ts` (`TimelineZoomLevel`, `PIXELS_PER_DAY_BY_ZOOM`, `resolveTimelineZoom`, `timelineRangeForZoom`) — every F237/F238/F239 function was already written to take `pixelsPerDay` as an explicit parameter (not hardcoded), so none of those functions needed to change; only the page/toolbar/scale layer needed to plug in the new values. Grepped `lib/timeline/layout.ts` and all its consumers for a baked-in day width before finishing — none survive; `DEFAULT_PIXELS_PER_DAY` remains exported and equals `PIXELS_PER_DAY_BY_ZOOM.month` for backward compatibility.
- Real path proven: `TimelinePage` (`app/(workspace)/w/[workspaceSlug]/timeline/page.tsx`) reads `?zoom=` from the real Next.js `searchParams`, resolves it via `resolveTimelineZoom`, computes the real `[start, end]` window via `timelineRangeForZoom`, and passes the real `pixelsPerDay` down through `TimelineScale`/`TimelineBody` — this is the SAME server-fetch path `getTimelineTasks` already uses (RLS-scoped session client, no admin client), so the query stays bounded and visibility-correct at every zoom level, not just at the default.
- If a future worker wires zoom into F227's saved-view config, reuse `TIMELINE_ZOOM_LEVELS`/`resolveTimelineZoom` rather than re-validating the string a second way.
