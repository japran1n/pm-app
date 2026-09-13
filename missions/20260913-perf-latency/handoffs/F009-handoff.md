# Handoff: F009 — Calendar status options constrained by project

## Status
COMPLETE

## Assertions covered
AS-008: PASS — `getWorkspaceStatusOptions` (`lib/queries/calendar.ts`) now first resolves the workspace's visible project ids (`projects` filtered by `workspace_id` + `deleted_at is null`) and then queries `project_statuses` with `.in("project_id", ids)`, instead of joining/filtering `project_statuses` against `projects` across the whole table. Verified by reading the diff and by the new unit test `AS-008: scopes the project_statuses query with an explicit project id list` in `tests/unit/f009-workspace-status-options-project-scan.test.ts`, which asserts the mocked `project_statuses` query receives the exact resolved id list via `.in()`.
AS-011: PASS — the returned set and order are unchanged: same columns (`name`, `color`, `category`), same `.order("position", { ascending: true })`, same name-based dedup logic below the query, same empty-workspace short-circuit (now explicit — returns `[]` before ever querying `project_statuses` when there are no visible projects, equivalent to the old join returning zero rows). Verified by the new unit tests `AS-011: returns the same set and order as before narrowing` and `AS-011: returns an empty list when the workspace has no visible projects, without querying project_statuses`.

## Files changed
lib/queries/calendar.ts
tests/unit/f009-workspace-status-options-project-scan.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/f009-workspace-status-options-project-scan.test.ts` (0, 3/3 passed)
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")

## Decisions made
- Resolved visible project ids via a plain `projects` query (`workspace_id` eq + `deleted_at is null`) using the RLS-scoped session client (`createClient()`), same client already in use in this function — RLS on `projects` enforces the same visibility the old `projects!inner(...)` embed depended on, so no behavior changes for private/restricted projects.
- Followed `my-tasks/page.tsx`'s exact two-step pattern (resolve project ids first, then `.in("project_id", ids)` on `project_statuses`) as instructed by the spec, rather than inventing a new join-avoidance strategy.
- Added an explicit `if (projectIds.length === 0) return []` short-circuit — this also skips the second query entirely for workspaces with no visible projects, which is strictly cheaper than the old join and produces the identical empty result.
- Did not touch the `byName` dedup or the returned shape (`CalendarStatusOption[]`) at all, per the "no behavior change" constraint (AS-025 in this mission).

## Out-of-scope work needed
None identified beyond this function's file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — the spec's "Notes for the worker" and the `my-tasks/page.tsx` reference pattern fully determined the implementation; no ambiguity required a default.)

## Notes for the next worker
- `getWorkspaceStatusOptions(workspaceId: string): Promise<CalendarStatusOption[]>` shape and behavior are unchanged: still name-deduplicated `{ name, color, category }` options ordered by `position` ascending, still resolves per-workspace.
- No MCP tools were used — pure application-code change to one function in one file, verified by reading the existing index name (`project_statuses_project_id_position_idx`, cited in the spec) rather than re-querying schema via MCP, since no schema change was made.
- Did not start a dev server, per the spec's instruction that port 3000 belongs to the user.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
