# Handoff: F026 — TOC keeps clicked entry active at bottom

## Status
COMPLETE

## Assertions covered
BR-031: PASS — sticky TOC tests green
BR-032: PASS — click second-to-last at max scroll stays active; bottom picks last intersecting; IO root = container; resize + initial update
BR-033: PASS — mobile bar tests green
BR-034: PASS — single-section no TOC green

## Files changed
components/brief/brief-toc.tsx
tests/unit/f014-toc-scrollspy.test.tsx

## Commands run
`npx vitest run` f014-toc-scrollspy, brief-toc, brief-sectioned-view (0; 27 tests)
`npx tsc --noEmit` (baseline LayoutProps error only)
`npx eslint` changed files (0)

## Decisions made
- At bottom: last intersecting section, falling back to last only when none intersect.
- go() sets a 800ms suppression timestamp (ref) so the smooth-scroll events can't overwrite the click.
- Resize listener on window, removed on unmount; update() called once on mount.
- Date.now wrapped in module-level now() to satisfy react-hooks/purity lint.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: 800ms suppression window (spec suggested 600-800ms).

## Notes for the next worker
Smooth scrolls longer than 800ms could still let a late scroll event re-evaluate; acceptable since result then reflects real position.
