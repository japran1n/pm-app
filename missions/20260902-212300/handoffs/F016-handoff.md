# Handoff: F016 — fix-up: portal task list realtime category defect (AS-021)

## Status
COMPLETE

## Assertions covered
AS-021: PASS — new discriminating test `test_AS_021_status_change_to_done_moves_row_and_updates_heading_live` sends a status/status_id change into a Done column and asserts the row moves out of the stale heading into the correct one; confirmed FAIL against the pre-fix `category: existing?.category ?? "not_started"` behaviour (mutation-verified below), PASS against the fix.

## Files changed
components/portal/task-list.tsx
components/portal/task-list.test.tsx
lib/queries/portal.ts

## Commands run
`npx vitest run components/portal/task-list.test.tsx` (0) — 7/7 pass on the fix
`npx tsc --noEmit` (1, pre-existing unrelated failure — see Notes)
`npm run lint` (0) — 0 errors, 17 pre-existing warnings, none in touched files
`npx vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**" --exclude "missions/**"` (0) — 206 files / 1590 tests pass

## Decisions made
- Root cause (per scrutiny-1.md AS-021 finding): `category` lives on `project_statuses`, not on the `tasks` row, so the realtime handler in `task-list.tsx` had no way to resolve it and pinned the reconciled row to `existing?.category ?? "not_started"` forever.
- Chose the "resolve locally" branch explicitly offered by the fix-up spec over a targeted refetch. `getPortalProjects` in `lib/queries/portal.ts` already fetches all of a workspace's `project_statuses` rows (name + category) to compute each task's category server-side; it just never surfaced that list to the client. I added a `statuses: { id, name, category }[]` field to `PortalProject`, populated per-project from the same query that already runs, and threaded it down as a prop. No new query, no new round trip.
- In `task-list.tsx`, built a `CategoryLookup` (status_id -> category, status name -> category) once from `project.statuses` via `buildCategoryLookup`, and `resolveCategory` looks up the *incoming* task's `status_id`/`status` against it before falling back to `existing?.category ?? "not_started"`. Lookup by id first (stable across a column rename), by name second, matching the pattern `getPortalProjects` already uses server-side (`categoryByStatusId` then `categoryByProjectAndName`).
- Extended `RawTaskRow` with an optional `status_id` field so the realtime payload (which does carry `status_id` on the `tasks` table) can be used for the id-based lookup; `mergeIncomingTask`'s existing `statusId: existing?.statusId ?? null` behaviour (which never updated statusId on a status change — a separate latent gap) is fixed as a side effect: `statusId` is now recomputed from the incoming payload whenever `raw.status` is present.
- Left the fallback `"not_started"` only for a task never seen before this session AND whose incoming status matches nothing in the project's status list (e.g. a status added to the project after this page's `project.statuses` prop was rendered) — the safest default per the original code's own reasoning, now only reached in that narrower, genuinely-unresolvable case rather than on every status change.
- `useEffect`'s dependency array picked up `project.statuses` alongside `project.id` since `buildCategoryLookup(project.statuses)` is called inside it; this matches the existing "fresh server prop wins" re-seeding already done at the top of `PortalTaskList` (`project !== seededProject`).

## Out-of-scope work needed
- None identified beyond what scrutiny-1.md already lists in FU-A through FU-H for other assertions/files (portal-overview-live.tsx debug log, board.tsx guard tests, request-list.tsx, use-portal-overview-realtime.ts, my-tasks realtime hook) — all explicitly off-limits to this feature and apparently already being worked by other concurrent workers per `git status` showing those files as dirty outside my changes.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to add `statuses` to `PortalProject` (derived from data `getPortalProjects` already fetches) rather than a client-side refetch, per the fix-up spec's explicit preference for local resolution when derivable. This only touches `lib/queries/portal.ts` and `components/portal/task-list.tsx`/its test, which are within this feature's scope; `getPortalProjects`'s only other call site (`app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx`) needed no change since it just forwards the whole `project` object.

## Notes for the next worker
- `npx tsc --noEmit` reports one pre-existing, unrelated error: `tests/unit/check-migration-drift.test.ts(159,21): error TS2339: Property 'SUPABASE_ACCESS_TOKEN' does not exist on type 'object'.` Confirmed via `git stash` that this error exists identically before any of my changes — it belongs to another worker's in-flight edit to `scripts/check-migration-drift.mjs`/its test (both shown as modified-but-uncommitted in `git status` before I started, untouched by me). Not caused by, or fixed by, this feature.
- Mutation verification for the new AS-021 test: reverted `category: resolveCategory(...)` back to the original `category: existing?.category ?? "not_started"` and reran `npx vitest run components/portal/task-list.test.tsx` — result: 1 failed / 6 passed, with the new test failing at `expect(screen.getByText(/Delivered/i)).toBeInTheDocument()` (element not found, row still rendered under "Waiting on your review"). Restored the fix and reran — 7/7 pass. This confirms the test is discriminating against the real defect, not just against refactored code shape.
- Other files shown as modified in `git status` at start of this session (`board.tsx`, `lib/actions/portal-approval.ts`, `scripts/check-*.mjs`, various test files) were NOT touched by me — they were already dirty before I began, presumably other workers' concurrent in-flight work on other fix-up features from the same scrutiny report. I did not stage or commit them.
