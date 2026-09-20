# Handoff: F085 — Fix AS-052 — test only active members appear (not pending)

## Status
COMPLETE

## Assertions covered
AS-052: PASS — new source-scan test asserts page.tsx's `peopleSwitcherMembers` prop is derived from `workspaceMembers.active.map(...)` and that its line never references `.pending`. Verified by mutating `page.tsx` (`active` → `pending`) locally: the test failed as expected, then the file was restored to its original state and the test passes again.

## Files changed
tests/unit/f029-switcher-url-wiring.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0 — 16/16 passed)

## Decisions made
- Added the source-level test to the existing `tests/unit/f029-switcher-url-wiring.test.tsx` file (spec's primary suggestion) rather than `people-switcher.test.tsx`, since this is purely a page.tsx call-site scan, consistent with the existing F075/F080 source-guard tests already living in that file.
- The regex matches both `key: value` and JSX `key={value}` syntax (`peopleSwitcherMembers[:=]\s*\{?\s*workspaceMembers\.\w+\.map`) since the actual call site in page.tsx uses JSX prop syntax (`peopleSwitcherMembers={workspaceMembers.active.map(...)}`), not an object-literal colon. Confirmed working with a manual mutation test (active→pending caused failure; restored afterward).
- Per the spec, only the source-scan test (not the `PeopleSwitcher` component-render test in `tests/unit/people-switcher.test.tsx`) was added — the spec's Gate section only required the vitest command for the source-scan file, and the "component renders only active members" half already appears to be covered by pre-existing tests in that other file (not touched here per out-of-scope note below).

## Out-of-scope work needed
- The spec also asked for a render-level test in `tests/unit/people-switcher.test.tsx` (rendering `PeopleSwitcher` with only-active members, asserting exactly those rows appear). The task instructions given to this worker explicitly scoped the work to the source-scan test in `f029-switcher-url-wiring.test.tsx` only, so that render-level test was not added here. If not already covered by existing tests in `people-switcher.test.tsx`, a follow-up should add it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Task instructions (not the original feature spec) narrowed scope to only the source-scan test in `f029-switcher-url-wiring.test.tsx`; followed those explicit instructions over the full original spec text, and logged the remainder as out-of-scope above.

## Notes for the next worker
No MCP tools were needed — this is a pure static source-scan test with no external service interaction.
