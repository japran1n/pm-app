# Handoff: F026 — debounced live preview iframe

## Status
COMPLETE

## Assertions covered
AS-017: PASS — iframe renders and srcDoc contains the combined HTML+CSS+JS content
AS-018: PASS — preview updates 300ms after the last change; rapid changes reset the debounce timer; verified with vitest fake timers
AS-019: PASS — iframe sandbox attribute is exactly "allow-scripts"; no allow-same-origin, allow-forms, or allow-top-navigation

## Files changed
components/webflow-tool/converter-preview.tsx
components/webflow-tool/converter-preview.test.tsx

## Commands run
`npx vitest run components/webflow-tool/converter-preview.test.tsx` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Followed the same "use client" + cn() styling pattern used in components/webflow-tool/converter-editor.tsx for consistency.
- Used a single useEffect with setTimeout(300ms) keyed on [html, css, js]; cleanup clears the pending timeout so rapid edits reset the debounce window, satisfying AS-018.
- Initial srcDoc is computed synchronously via useState initializer (not debounced) so the first render already shows content instead of a blank iframe; subsequent updates go through the debounce.
- sandbox="allow-scripts" set as a static string (no allow-same-origin/allow-forms/allow-top-navigation) per AS-019 and the spec's explicit exclusion list.
- Tests use vi.useFakeTimers() + @testing-library/react's `act()` to flush the setState triggered by the timer, since React 18+ requires act() around timer-driven state updates when using fake timers.

## Out-of-scope work needed
None identified. The iframe styling (min-h-[400px], border, bg-white) is a reasonable default per the spec; if the consuming page (converter page/layout) needs different height behavior (e.g. flex-fill), that's part of whatever feature assembles converter-editor + converter-preview into the page layout, not this component.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to seed initial srcDoc synchronously (not delayed by 300ms on first mount) since AS-017 requires the iframe to render the preview and there was no existing content to debounce against; debounce only applies to subsequent prop changes, which matches "updates are debounced ~300ms after the last change."

## Notes for the next worker
No MCP usage — this is a pure UI component with no external service dependency. Test file follows the same describe/it naming and setup pattern as components/webflow-tool/converter-editor.test.tsx (jsdom environment, @testing-library/react, jest-dom matchers).
