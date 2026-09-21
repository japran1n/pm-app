# Handoff: F014 — TOC unique ids, single active entry, last-section scroll-spy

## Status
COMPLETE

## Assertions covered
BR-031: PASS — desktop sticky TOC (nav, lg:sticky) with name + mono counter
BR-032: PASS — unique ids (collision counter, non-Latin preserved), exactly one aria-current, bottom-of-page fallback, reduced-motion aware scroll
BR-033: PASS — mobile horizontal bar (overflow-x-auto) precedes content
BR-034: PASS — single section renders no TOC

## Files changed
lib/brief/slugify-section.ts
components/brief/brief-toc.tsx
components/brief/brief-sectioned-view.tsx
tests/unit/brief-toc.test.tsx
tests/unit/brief-sectioned-view.test.tsx
tests/unit/f014-toc-scrollspy.test.tsx

## Commands run
`npx vitest run` brief toc/sectioned-view/f014 files (0)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint` changed files (0)

## Decisions made
- Replaced the duplicate aside + nav (two aria-current elements in DOM) with ONE responsive nav > ul > li; horizontal bar below lg, sticky column at lg. Existing tests that asserted aside were updated.
- slugifySection keeps Latin diacritic folding but preserves other scripts (\p{L}\p{N}); "section" only for names with no letters/digits.
- uniqueSectionIds(names) computed once in BriefSectionedView and passed as `id` to BriefToc and section elements; BriefToc computes its own if id omitted.
- Bottom fallback: scroll listener activates last section when at page bottom and scrollY > 0 (so a non-scrollable page keeps first active).
- Tested in jsdom with stubbed IntersectionObserver.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: merged aside/nav into one nav to guarantee a single active entry.

## Notes for the next worker
slugifySection is still re-exported from brief-toc.tsx.
