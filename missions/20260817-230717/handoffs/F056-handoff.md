# Handoff: F056 — list view empty state

## Status
COMPLETE

## Assertions covered
AS-092: PASS — a filtered result set of zero rows renders an explicit "No tasks match your filters." message (not a blank table) plus a "Clear filters" link that navigates back to the base pathname; a genuinely empty project (zero tasks, no filters active) keeps F053's original "No tasks yet in this project." copy and shows no clear-filters link. Tests in `tests/unit/list-view-empty-state.test.ts`.

## Files changed
components/task/task-list-table.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx
tests/unit/list-view-empty-state.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/task/task-list-table.tsx "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx" tests/unit/list-view-empty-state.test.ts` (0)
`npx vitest run tests/unit/list-view-empty-state.test.ts` (0 — 3/3 passed)
`npm run test` (0 — 306/306 unit tests passed)
`npm run build` (0)

## Decisions made
- **Distinguished the two zero-row cases**, per the task's "your call — document" instruction: `<TaskListTable>` now takes an optional `hasActiveFilters` boolean (computed in `page.tsx` from whether any of F054's `status`/`priority`/`assigneeId` filters are set) and branches on it. `hasActiveFilters === true` → "No tasks match your filters." + a Clear filters link. `hasActiveFilters === false` (or omitted) → F053's original "No tasks yet in this project." with no link, since there's nothing to clear. This directly closes the gap F054's own handoff flagged as "small future polish."
- **Clear-filters action reused as a plain server-rendered `next/link`, not `<ListFilters>`'s client `router.push`.** `<TaskListTable>` is a Server Component (clarified spec: smallest possible client boundary, primary content server-rendered per AS-155) and stays one — adding `"use client"` just to reuse `useRouter` would have promoted the whole table unnecessarily. `page.tsx` instead computes `clearFiltersHref` (`/w/${workspaceSlug}/projects/${projectId}/list`, i.e. the same "base pathname, no query params" target `<ListFilters>`'s own Clear filters button pushes to) and passes it down as a plain href. Same destination, same effect, no client boundary added.
- **Test renders `<TaskListTable>` directly with `renderToStaticMarkup`**, matching the existing `board-empty-state.test.ts` pattern, rather than a DB-backed integration test through the page — the branching logic under test (`hasActiveFilters` → which message/link renders) lives entirely in the component and needs no Supabase round-trip. `next/navigation` is mocked (same pattern as `onboarding-membership-gate.test.ts`) only because the "populated list" comparison test renders the full table including F055's `<DueDateSortHeader>`, which calls `useRouter`.

## Out-of-scope work needed
None identified. AS-093 (inline status edit) and any future list-view features are untouched — `<TaskListTable>`'s two new props are optional and default to the pre-F056 behavior (`hasActiveFilters` defaults `false`, `clearFiltersHref` is only rendered when both it and `hasActiveFilters` are truthy).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated "zero tasks, no filters active" and "zero tasks, filters active" as requiring visibly different copy (per the task's explicit invitation to make this call) rather than a single generic "no tasks" message for both — a filtered-to-nothing state without any indication that filters are the cause, and without an easy way out, would read as "this project has no tasks" even when it's fully populated.

## Notes for the next worker
- `getProjectListTasks`'s query layer (`lib/queries/tasks.ts`) needed no changes — AS-092 is purely a presentation-layer gap; the query already correctly returns zero rows for a filter combination that matches nothing (proven by F054/F055's own tests), this feature only changes what the UI shows for that already-correct empty result.
- No DB/Supabase env is required to exercise AS-092's behavior — `tests/unit/list-view-empty-state.test.ts` is a plain component-render test, unlike the DB-backed `tests/integration/list-view-*.test.ts` suite.
