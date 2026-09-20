# Handoff: F078 — Fix lint: remove unused fireEvent import

## Status
COMPLETE

## Assertions covered
No assertions assigned to this feature (lint-cleanup task). No AS-NNN IDs from plan.md are mapped to F078.

## Files changed
tests/unit/people-switcher-placement-a11y.test.tsx

## Commands run
`npx eslint tests/unit/people-switcher-placement-a11y.test.tsx` (0)
`npm run lint` (0)
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` (0, 4 passed)

## Decisions made
- Removed `fireEvent` from the `@testing-library/react` import list since it was unused in the file (the test uses `userEvent` for all interactions). No other changes needed — the import destructure was the only place `fireEvent` appeared.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none needed — the fix was mechanical and unambiguous)

## Notes for the next worker
Unrelated working-tree changes exist (app/(workspace)/w/[workspaceSlug]/calendar/page.tsx, missions/20260920-124226/plan.md, next-env.d.ts, various .playwright-mcp artifacts) — these were present before this task started and were not touched or committed by this worker.
