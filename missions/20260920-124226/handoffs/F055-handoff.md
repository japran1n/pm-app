# Handoff: F055 — Fix AS-030 switcher test to use real schema

## Status
COMPLETE

## Assertions covered
AS-030: PASS — `getWorkspaceMembers` correctly excludes deactivated/removed/pending members from `result.active`; verified with 7 tests covering absent-row removal, invited-with-backfilled-user_id leak vector, workspace_id filter, id-field presence, and error propagation. Confirmed mutation-kill: reverting the filter to `r.status !== "removed"` fails the new "backfilled invited row" test.

## Files changed
tests/unit/switcher-member-source.test.ts

## Commands run
`npx vitest run tests/unit/switcher-member-source.test.ts` (0, 7/7 passed)
`npx tsc --noEmit` (0)
`npx eslint tests/unit/switcher-member-source.test.ts --max-warnings=0` (0)
`sed -i '' 's/r.status === "active"/r.status !== "removed"/' lib/queries/members.ts && npx vitest run ...` — manual mutation-bar check: 1 test failed as required, then reverted with `git checkout -- lib/queries/members.ts`

## Decisions made
- Replaced the unfalsifiable `status: "removed"` fixture with two schema-producible exclusion cases per spec: (1) an absent member row (removal is a DELETE against `workspace_members_status_check`, which only allows `'invited'`/`'active'`), and (2) an `invited` row with a backfilled `user_id` — the real production leak vector for an invited user who accepted but whose row status hasn't flipped to `active`.
- Added a differing-`workspace_id` fixture row to exercise the `.eq("workspace_id", …)` filter, an assertion that `id` is present on returned active members (not just `userId`/`name`/`avatarUrl`), and an error-path test that sets `membersError` and asserts `getWorkspaceMembers` rejects.
- Verified the mutation bar by hand: changing `lib/queries/members.ts`'s filter from `r.status === "active"` to `r.status !== "removed"` fails the new "backfilled invited row" test (1 failure, others pass), then reverted the source file — no production code changes were kept.

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — followed spec directly)

## Notes for the next worker
IMPORTANT: at commit time, `git status` showed several files already modified/staged in the working tree that were not touched by this feature (`components/calendar/week-agenda.tsx`, `components/calendar/week-time-grid.tsx`, `components/calendar/week-view.tsx`, three `tests/unit/calendar-week-*.test.tsx` files, and a new `tests/unit/f015-remove-task-strips.test.tsx`) — these appear to belong to a concurrently-run feature (F015, "remove task strips", per the AS-033 comment visible in the diff). I ran `git add tests/unit/switcher-member-source.test.ts` (only my file) but the resulting commit `e2e355ea` ended up including those other files too (8 files changed total), which means they were already present in the git index before my `git add`/`git commit` ran, likely from a concurrent/interleaved worker process sharing this working tree. I did not author, review, or intend to include those changes. The orchestrator should verify commit `e2e355ea` against F015's own scope/handoff to confirm those files' contents are correct and were not lost or corrupted by this interleaving — if F015 already has its own commit, `e2e355ea` may be a harmless duplicate; if not, the orchestrator should confirm F015's work is still intact in the repo (it is, since the diff shows the F015 changes present in HEAD).
