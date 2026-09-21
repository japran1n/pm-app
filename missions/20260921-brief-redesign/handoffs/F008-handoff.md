# Handoff: F008 — Sticky TOC + scroll-spy + mobile bar

## Status
COMPLETE

## Assertions covered
BR-031: PASS — desktop sticky aside (hidden lg:flex) with name and mono N/M counters
BR-032: PASS — click scrollIntoView smooth; IntersectionObserver scroll-spy; active styling (SSR-tested markup only, observer not exercised in a browser)
BR-033: PASS — lg:hidden nav with overflow-x-auto inside the bar only
BR-034: PASS — returns null for <=1 sections

## Files changed
components/brief/brief-toc.tsx
tests/unit/brief-toc.test.tsx
missions/20260921-brief-redesign/handoffs/F008-handoff.md

## Commands run
`npx vitest run tests/unit/brief-toc.test.tsx` (0)
`npx eslint` on both files (0)
`npx tsc --noEmit` filtered to brief-toc: no errors

## Decisions made
- Exported slugifySection (NFKD, strip diacritics, kebab, fallback "section"); page must use the same helper for ids `section-<slug>`.
- Active section = first section (in order) intersecting the top 40% of viewport (rootMargin 0 0 -60% 0).
- Both desktop aside and mobile nav are rendered in one fragment; CSS toggles visibility.

## Out-of-scope work needed
Page integration deferred to F011: in brief page.tsx / team-answers-view.tsx, put `id={"section-" + slugifySection(name)}` on each section header, compute sections {name, answeredCount, totalCount} from groupBySection (F007), wrap in flex container (TOC left on lg, mobile bar above content).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Scope limited to component and tests per orchestrator override; page.tsx untouched.

## Notes for the next worker
Parent layout should give the flex container items-start so the sticky aside works; aside already has self-start.
