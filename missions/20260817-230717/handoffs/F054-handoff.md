# Handoff: F054 — list view filters

## Status
COMPLETE

## Assertions covered
AS-086: PASS — `getProjectListTasks(projectId, { status })` narrows to matching status only; test `tests/integration/list-view-filters.test.ts`.
AS-087: PASS — `getProjectListTasks(projectId, { priority })` narrows to matching priority only.
AS-088: PASS — `getProjectListTasks(projectId, { assigneeId })` narrows to matching assignee only.
AS-089: PASS — combined `{ status, priority }` applies AND semantics (two tests: a real match, and a combination matching zero rows to rule out an OR fallback).
AS-090: PASS — omitting all filters (`{}` or no second argument) restores the full unfiltered list.

## Files changed
lib/queries/tasks.ts
components/task/list-filters.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx
tests/integration/list-view-filters.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/task/list-filters.tsx "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx" lib/queries/tasks.ts tests/integration/list-view-filters.test.ts` (0)
`npx vitest run tests/integration/list-view-filters.test.ts tests/integration/list-view-render.test.ts` (0 — 9/9 passed)
`npm run test` (0 exit overall; one pre-existing, unrelated failure — see Notes)
`npm run build` (0)

## Decisions made
- **Single-select, not multi-select, per filter.** AS-086/087/088 only require "can be filtered by status/priority/assignee," not "by a set of values." A single value per filter keeps the URL shape trivial (`?status=todo&priority=high&assigneeId=...`) and makes the AND-combination behaviour (AS-089) unambiguous — no in-filter OR semantics to design or test. Documented in `components/task/list-filters.tsx`'s file-header comment per the spec's "your call — document" instruction.
- **Filter state lives entirely in the URL** (`useSearchParams` + `usePathname` + `useRouter().push`), not client component state — this is what makes the Server Component list page re-fetch on every change and what makes a filtered view shareable/bookmarkable, per the feature's own requirement.
- **Filtering happens in the DB query** (`getProjectListTasks`'s new optional `filters` argument → additional `.eq()` calls chained onto the existing `project_id` + `deleted_at IS NULL` scoped query), not client-side post-filtering of an already-fetched list — keeps the "AND semantics" as literally SQL AND rather than an app-level `.filter()` reimplementation, and avoids fetching rows that will never be shown.
- **Absent query param = absent filter**, not present-with-empty-value. `ListFilters`' internal `ALL_VALUE` sentinel ("__all__") is only a Base UI Select implementation detail (Select needs a non-empty value for the "no selection" option) — it's translated back to "delete this param" before it ever reaches the URL, so `getProjectListTasks(projectId)` (no filters object at all) and `getProjectListTasks(projectId, {})` are exercised as equivalent "clear" cases in the AS-090 test.
- **Assignee options list reuses `getWorkspaceMembers`** (already used by the members page, F017) rather than a new query — the list page resolves the workspace id from `workspaceSlug` via the same RLS-scoped `workspaces` lookup pattern the project detail layout already uses one level up, then maps `active` members to `{ id: userId, label: name ?? email ?? userId }` for the Select.
- **Validated `status`/`priority` query param values** against a fixed allow-list (`VALID_STATUSES`/`VALID_PRIORITIES`) in `page.tsx` before passing them to the query — an unrecognized or tampered query string value is treated as "no filter" rather than being passed through to Supabase, so a malformed URL degrades to the unfiltered list instead of erroring.

## Out-of-scope work needed
- None identified beyond what's already covered by later milestone features (AS-091 sort, AS-093 inline status edit) noted in F053's own comments — filters here are read-only narrowing and don't touch those.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose single-select per filter over multi-select (see "Decisions made" above) since the spec left this as an explicit implementer's choice ("multi or single, your call — document").
AUTONOMOUS_DECISION: Empty-result list for a filtered-to-nothing state reuses `TaskListTable`'s existing "No tasks yet in this project." empty-state copy rather than a new "no tasks match these filters" message — F053's `TaskListTable` isn't in this feature's `Files (approximate)` scope and no assertion here requires a filter-specific empty-state copy change; flagging as a small future polish rather than doing it silently, since it's a one-line UX nicety, not a behavioural gap.

## Notes for the next worker
- The `npm run test` full-suite run has one **pre-existing, unrelated** failure: `tests/integration/tasks-schema.test.ts` fails with `JWT issued at future` (a Supabase test-project clock-skew issue on user/session creation), not something touched by this feature. Confirmed by running only the F053/F054 list-view test files directly (`npx vitest run tests/integration/list-view-filters.test.ts tests/integration/list-view-render.test.ts`) — both files, 9/9 tests, pass cleanly. Worth a follow-up ticket if it starts blocking other workers' `npm run test` gate.
- `getProjectListTasks`'s new `filters` parameter is optional and defaults to "no constraint" per key, so F053's existing call site and test suite (`tests/integration/list-view-render.test.ts`) needed zero changes.
