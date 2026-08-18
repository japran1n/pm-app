# Handoff: F105 — dashboard table archived project exclusion

## Status
COMPLETE

## Assertions covered
AS-129: PASS — `getWorkspaceListTasks` now filters `projects.deleted_at is null` via the existing `projects!inner` embed, matching the RPCs; proven by `tests/integration/dashboard-task-table-filters.test.ts`'s new archived-project test (Task E excluded, Tasks A/B/C present).
AS-134: PASS — dedicated parameter-tampering test added (`tests/integration/dashboard-list-tasks-rls-cross-workspace.test.ts`), a member of workspace A calling `getWorkspaceListTasks(workspaceBId)` directly gets `[]`, not workspace B's seeded (non-empty) real data — mirrors F077's dedicated RPC tampering test.

## Files changed
lib/queries/tasks.ts
tests/integration/dashboard-task-table-filters.test.ts
tests/integration/dashboard-list-tasks-rls-cross-workspace.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run` (1 failed suite: tests/integration/archive-project.test.ts, all 7 tests skipped internally then a beforeAll failure "JWT issued at future" — a system-clock/JWT-issuance-timing environment problem unrelated to this change and pre-existing; 403 passed, 7 skipped elsewhere)
`npx vitest run tests/integration/dashboard-task-table-filters.test.ts tests/integration/dashboard-list-tasks-rls-cross-workspace.test.ts` (0, 9/9 passed)
`npm run build` (0)

## Decisions made
- Added `deleted_at` to the existing `projects!inner(workspace_id)` embed (now `projects!inner(workspace_id, deleted_at)`) and a new `.is("projects.deleted_at", null)` clause, rather than switching to a separate join/RPC — smallest change that mirrors the RPCs' `p.deleted_at is null` filter exactly, per the spec's explicit fix instruction.
- Extended the existing `dashboard-task-table-filters.test.ts` beforeAll with a third in-workspace project that is immediately soft-deleted (archived) plus one task in it ("Task E"), rather than a new file, since the archived-project exclusion test needed the same multi-project/multi-workspace fixture already built there (parity with existing filter tests, minimal duplication).
- Put the parameter-tampering test in its own new file (`dashboard-list-tasks-rls-cross-workspace.test.ts`) rather than appending to `dashboard-task-table-filters.test.ts`, mirroring how F077's tampering test (`dashboard-rls-cross-workspace.test.ts`) is a separate dedicated file from the RPC filter tests — keeps the adversarial-test intent isolated and discoverable, per the spec's explicit instruction to mirror F077's dedicated test.
- Seeded workspace B with three non-trivial tasks (varying status/priority) in the tampering test, same pattern as F077, so a `[]` result is proof of the boundary holding rather than an artifact of an empty workspace B.

## Out-of-scope work needed
- Finding 2 (M7-scrutiny.md) — `task-list-table.tsx`/`list-status-select.tsx` render status/priority with no color, breaking AS-135 consistency with the dashboard charts. Tracked separately as a follow-up feature (list-view-status-priority-colors); not touched here, out of this feature's file scope (`lib/queries/tasks.ts`, tests only).
- Finding 3 (M7-scrutiny.md) — AS-136 has no performance budget defined yet (F089 is in M8) and plan.md lacks a "Deferred re-verification" note for it. Not code, not in this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — the spec's fix and test instructions were unambiguous and followed directly)

## Notes for the next worker
- The one failing test suite in the full `npx vitest run` (`tests/integration/archive-project.test.ts`, "JWT issued at future") is a local-clock/Supabase-JWT-timing issue, reproducible before this change too (unrelated file, untouched by this feature) — not a regression from F105. Worth flagging to the orchestrator if it recurs across workers, but no action taken here.
- `getWorkspaceListTasks`'s TypeScript return mapping (`TaskCardTask`) does not need any change — `projects` is only used for filtering via the embed, never read back out of `data`, so adding `deleted_at` to the select list does not affect the returned shape.
