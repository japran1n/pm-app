# Handoff: F055 — list view sort

## Status
COMPLETE

## Assertions covered
AS-091: PASS — `getProjectListTasks(projectId, filters, sort)`'s `due_date_asc`/`due_date_desc` order the result correctly (no-due-date tasks pushed last in both directions), and sort combines correctly with an active filter (filtering applies first, sort orders the remainder). Tests in `tests/integration/list-view-sort.test.ts`.

## Files changed
lib/queries/tasks.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx
components/task/task-list-table.tsx
components/task/due-date-sort-header.tsx
tests/integration/list-view-sort.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/task/list-filters.tsx components/task/due-date-sort-header.tsx components/task/task-list-table.tsx "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx" lib/queries/tasks.ts tests/integration/list-view-sort.test.ts` (0)
`npx vitest run tests/integration/list-view-sort.test.ts tests/integration/list-view-filters.test.ts tests/integration/list-view-render.test.ts` (0 exit overall — 10/13 ran and passed, 3 skipped by env gating; one pre-existing unrelated failure in a different file, see Notes)
`npm run test` (0 — 303/303 unit tests passed)
`npm run build` (0)

## Decisions made
- **`sort` is a third, optional argument on the existing `getProjectListTasks(projectId, filters, sort)`**, applied as the query's final `.order()` in place of the default `created_at ascending` — not a separate query or a client-side re-sort of an already-fetched array. This is what makes "sort applies after filtering" true by construction: the same query builder chain already has every `.eq()` filter attached before `.order()` runs, so there's no way for sort to see rows that filtering excluded.
- **`nullsFirst: false` in both directions.** Tasks with no due date aren't "earliest" or "latest" — they're unset — so they're pushed to the end of the list regardless of ascending/descending, rather than a null sorting to the front in ascending order (Postgres's own default) which would put "no due date" ahead of every real date.
- **URL-param-driven, matching F054's exact pattern**: a `sort` query param (`due_date_asc` / `due_date_desc`, absent = default order) read server-side in `page.tsx`, validated against an allow-list (`VALID_SORTS`, same "tampered/invalid param degrades to default" posture as `VALID_STATUSES`/`VALID_PRIORITIES`), and written by a thin Client Component. No sort state lives outside the URL, so a sorted-and-filtered view is shareable/bookmarkable together, and combines automatically since both are the same query object being built server-side from `searchParams`.
- **New `<DueDateSortHeader>` client component (not folded into `<ListFilters>`)**, rendered inside the "Due date" `<TableHead>` in `<TaskListTable>` (still a Server Component itself) rather than promoting the whole table to a Client Component — keeps the smallest-possible-client-boundary rule from the clarified spec: only the clickable header button needs `useRouter`/`useSearchParams`, the table body stays server-rendered.
- **Three-state click cycle** (no sort → `due_date_asc` → `due_date_desc` → no sort) rather than a two-state asc/desc-only toggle. The spec only asked for "ascending/descending toggle," but a two-state toggle can never express "back to unsorted" once entered, which felt like an unnecessary trap; documented here as the implementer's-call default per the same "your call — document" convention F054 used for single- vs multi-select.

## Out-of-scope work needed
- None identified. AS-093 (inline status edit, a later feature) is untouched by this change — `<TaskListTable>`'s only new prop is the optional `sort` passed through to the header.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the three-state (asc → desc → unsorted) click cycle over a strict two-state asc/desc toggle, since the spec's "ascending/descending toggle" phrasing didn't specify whether returning to the unsorted default should be reachable by clicking — see "Decisions made" above.
AUTONOMOUS_DECISION: `nullsFirst: false` in both sort directions (no-due-date tasks always last) — the spec didn't address null handling explicitly; treated "no due date" as orthogonal to date ordering rather than as an implicit minimum/maximum date.

## Notes for the next worker
- Same pre-existing, unrelated `tests/integration/tasks-schema.test.ts`-style `JWT issued at future` clock-skew failure noted in the F054 handoff also affects `tests/integration/list-view-render.test.ts` when run against the current Supabase test project's clock — confirmed unrelated to this feature by running the sort/filter suites directly (`list-view-sort.test.ts` + `list-view-filters.test.ts`, both fully green) alongside it in the same command.
- `getProjectListTasks`'s new `sort` parameter is optional and appended after the existing `filters` parameter, so every prior call site (board page doesn't use this query; F053/F054's list page call and their test files) needed no changes beyond `page.tsx`'s own new `sort` argument.
