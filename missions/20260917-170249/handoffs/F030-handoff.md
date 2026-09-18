# Handoff: F030 — collapsed-by-default help section

## Status
COMPLETE

## Assertions covered
AS-124: PASS — help content hidden by default via native `<details>`, toggling via clicking "How this works" summary reveals class-selector, breakpoint-mapping, and empty-image-block explanations; verified via 3 render/interaction tests.

## Files changed
components/webflow-tool/converter-help.tsx
components/webflow-tool/converter-help.test.tsx
components/webflow-tool/converter-page.tsx

## Commands run
`npx vitest run components/webflow-tool/converter-help.test.tsx` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run components/webflow-tool` (0)

## Decisions made
- Used a native `<details>/<summary>` element instead of React state — satisfies "collapsed by default" and toggle requirements with zero JS state, and jsdom/testing-library support `toBeVisible()` checks against `<details>` open/closed state out of the box.
- Styled with existing design-system tokens (`bg-secondary/30`, `text-muted-foreground`, `border-border`) to keep it subtle per the Supabase design system rules (muted, small text, no new colors).
- Placed `<ConverterHelp />` below the F031-F036 placeholder comment at the bottom of the page, as a footer-style element, so it doesn't compete visually with the editor/preview panes.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `<details>/<summary>` over a React state toggle since the spec explicitly allows either, and it minimizes code while still passing all three required test scenarios (hidden by default, click to reveal, content correctness).

## Notes for the next worker
No MCP usage was needed — this is a pure UI feature with no live external data. The converter-page.tsx placeholder comment for F031-F036 (Convert button, copy buttons, results panel) remains untouched and is now positioned above the new `<ConverterHelp />` element.
