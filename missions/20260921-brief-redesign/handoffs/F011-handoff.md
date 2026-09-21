# Handoff: F011 — Wire sections + TOC into workspace brief page

## Status
COMPLETE

## Assertions covered
BR-030: PASS — questions grouped under h2 section headings in order (SSR test)
BR-031: PASS — BriefToc receives per-section answered/total; desktop aside rendered
BR-032: PASS — sections carry id section-<slug> with scroll-mt; scroll-spy behaviour itself not browser-tested
BR-033: PASS — mobile nav precedes content in flex-col, lg:flex-row layout
BR-034: PASS — single section renders plain TeamAnswersView, no TOC/headings

## Files changed
components/brief/brief-sectioned-view.tsx
components/brief/brief-toc.tsx
lib/brief/slugify-section.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx
tests/unit/brief-sectioned-view.test.tsx
missions/20260921-brief-redesign/handoffs/F011-handoff.md

## Commands run
`npx vitest run` brief-sectioned-view, brief-toc, brief-header, brief-actions-header, brief-group-by-section, f054 (0)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint` on changed files (0)

## Decisions made
- Moved slugifySection to lib/brief/slugify-section.ts (re-exported from brief-toc) because brief-toc is "use client" and a server component cannot call functions imported from a client module.
- New server wrapper BriefSectionedView; TeamAnswersView API unchanged.

## Out-of-scope work needed
None. Full suite not run.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Single-section brief skips headings entirely (not just the TOC), keeping layout identical to before.

## Notes for the next worker
Mobile bar is not sticky (only in-flow above content).
