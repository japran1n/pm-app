# Handoff: F074 — dashboard empty state

## Status
COMPLETE

## Assertions covered
AS-130: PASS — `test_AS_130_zero_task_workspace_shows_explicit_empty_state_not_charts`, `test_AS_130_error_state_takes_priority_over_empty_state`, `test_AS_130_populated_workspace_renders_charts_not_empty_state` in `tests/unit/dashboard-empty-state.test.ts` (all 3 pass; full suite 393/393 pass).

## Files changed
components/dashboard/dashboard-content.tsx (new)
app/(workspace)/w/[workspaceSlug]/page.tsx
tests/unit/dashboard-empty-state.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm test` (0) — 393/393 passing, incl. the 3 new AS-130 tests
`npm run build` (0) — compiles, typechecks, and generates all routes including `/w/[workspaceSlug]`

## Decisions made
- F073 had already added an inline `isEmpty` branch to the dashboard page (a defensive design choice made ahead of this feature, per its own handoff notes on AS-135's "Performance" answer), so the core behaviour asked for by AS-130 already existed in `page.tsx`. This feature's real gap was **test coverage**: the branching logic lived inline inside an async, Supabase-backed Server Component, which can't be unit-tested without a DB. I extracted the three-way error/empty/populated branch into a new pure, props-only component (`components/dashboard/dashboard-content.tsx`) so it can be rendered directly with `renderToStaticMarkup`, following the exact pattern already used by `tests/unit/list-view-empty-state.test.ts` and `tests/unit/board-empty-state.test.ts`. `page.tsx` is now a thin Server Component that fetches data and hands it to `<DashboardContent>` — no behavioural change to what a user sees, only a refactor for testability.
- Updated the empty-state copy from F073's original "No tasks yet — charts will appear here once this workspace has tasks." to "No tasks yet — create your first project to get started." to match the exact wording called for in the feature spec's task description, while keeping the same "View projects" link target (`/w/${workspaceSlug}/projects`).
- Added `data-testid` attributes (`dashboard-error-state`, `dashboard-empty-state`, `dashboard-charts`) purely to make the three states unambiguous in tests without relying on prose-matching alone; these have no visual/behavioural effect.
- Verified the error branch is checked before the empty branch in `<DashboardContent>` (an RPC failure must never be misread as "zero tasks") and added an explicit test for that ordering.

## Out-of-scope work needed
None identified specific to this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Refactored the empty-state branch out of the Server Component into a new pure component rather than attempting to unit-test the Server Component directly (which would require mocking Supabase's RPC calls end-to-end) or skipping automated coverage — this matches the codebase's established convention (list/board empty-state tests) for testing presentational branching independent of data-fetching.

## Notes for the next worker
Recharts' `<ResponsiveContainer>` renders an empty/awkward shell under Node's non-DOM test environment even with the current `renderToStaticMarkup` approach — this is exactly why `isEmpty` is computed and checked *before* either chart component ever mounts, both in production and in the new tests (the "populated" test intentionally still uses `count: 0` priority data to prove the charts branch is chosen based on the `isEmpty` flag, not on inspecting the data itself).
