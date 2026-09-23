# Handoff: F002 — getProjectTeamPreview batched query

## Status
COMPLETE

## Assertions covered
PL-011: PASS — one task_assignees query + one resolvePeople batch; max 4 distinct, total distinct
PL-012: PASS — query throws on error; page .catch logs and yields empty Map
PL-013: PASS — filters tasks.deleted_at null and status != done; projects with none absent from map
(PL-002..PL-006 milestone gate: not evaluated here, no rendering yet)

## Files changed
lib/queries/projects.ts
lib/queries/projects-team-preview.test.ts
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
tests/unit/projects-page-health-resilience.test.tsx
tests/unit/f012-archived-projects-filter.test.tsx

## Commands run
`npx vitest run lib/queries/projects-team-preview.test.ts` (0)
`npx tsc --noEmit` (0)
`npx eslint` on touched files (0)
`npx vitest run` (1, 304 failed files vs baseline 298; the 2 mock-related new failures fixed; 4 others are from an uncommitted pre-existing edit to tests/unit/format-duration.test.ts, not mine)

## Decisions made
- Absent-from-map means empty team (no entry for projects with no assignees).
- Existing page tests mocked the projects module; added getProjectTeamPreview stub.
- Left tests/unit/format-duration.test.ts (not mine, uncommitted) untouched.

## Out-of-scope work needed
Render the team preview (later feature). The 4 failures (task-detail-sheet-time-total, f118-task-type-time-card, my-task-row-parity, time-tracking-estimate-render) trace to the uncommitted format-duration.test.ts change in the worktree.

## Blockers

## Autonomous decisions

## Notes for the next worker
teamPreviewByProject is computed in page.tsx but unused (void).
