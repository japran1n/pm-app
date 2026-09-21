# Handoff: F021 — TOC scroll-spy uses the real scroll container

## Status
COMPLETE

## Assertions covered
BR-031: PASS — sticky TOC tests unchanged and green
BR-032: PASS — new container-scrolled fixture proves last short section becomes active; one aria-current
BR-033: PASS — mobile bar tests green
BR-034: PASS — single-section no TOC green

## Files changed
components/brief/brief-toc.tsx
tests/unit/f014-toc-scrollspy.test.tsx

## Commands run
`npx vitest run` f014-toc-scrollspy, brief-toc, brief-sectioned-view (0; 17 tests)
`npx tsc --noEmit` (baseline LayoutProps error only)
`npx eslint` changed files (0)

## Decisions made
- findScrollParent walks up from the first section element checking computed overflowY auto/scroll; null falls back to window/document.
- Scroll listener, at-bottom check (scrollTop+clientHeight >= scrollHeight-4, scrollTop>0) and IntersectionObserver root all use that container.
- scrollIntoView click path unchanged; it scrolls the nearest scrollable ancestor natively.
- brief-sectioned-view.tsx and slugify-section.ts needed no change.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions

## Notes for the next worker
The container fixture stubs scrollTop via getter and dispatches scroll on the container; window.scrollY stays 0.
