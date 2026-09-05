# Handoff: F019 — Fix-up: cover tracked-task-id Set identity at useMyTasksRealtime's call site (AS-011)

## Status
COMPLETE

## Assertions covered
AS-011: PASS — new hook-level test `tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx` mounts the real `useMyTasksRealtime` hook, drives a `task_assignees` INSERT then a `tasks` UPDATE for the same id through mocked channels, and asserts `onUpdate` fires. A second test forces a resubscribe (userId change) and proves an id learned live via `onAssigned` survives being read back out of `trackedTaskIdsRef.current` at the call site — this is the test that actually kills the `new Set(trackedTaskIdsRef.current)` mutant at `use-my-tasks-realtime.ts:283`. Mutation-verified (see Commands run).

## Files changed
tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx (new)

No production code changes. Mutation testing confirmed the existing implementation at `components/my-tasks/use-my-tasks-realtime.ts:283` (passing `trackedTaskIdsRef.current`, the live reference) is already correct — the gap was purely missing test coverage at the hook's call-site boundary, as identified by the scrutiny finding.

## Commands run
`npx vitest run tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx` (0) — 2/2 passed
`npx vitest run tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx tests/unit/f008-my-tasks-realtime.test.ts tests/unit/f004-my-tasks-realtime-topology.test.ts tests/unit/f034-fix-realtime-bugs.test.ts tests/unit/personal-todo-list-realtime-wiring.test.tsx` (0) — 5 files / 36 tests passed (full My Tasks realtime test set)
Mutation verification: edited `components/my-tasks/use-my-tasks-realtime.ts:283` from `trackedTaskIdsRef.current` to `new Set(trackedTaskIdsRef.current)`, re-ran the new test file → `test_AS_011_id_learned_live_survives_a_resubscribe_after_userId_change` FAILED (`onUpdate` never called), the first test still passed. Reverted the file to its original content (`cp` from a pre-edit backup) and re-ran → both tests PASSED.
`npx eslint tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx` (0) — 0 errors, 0 warnings (removed an unused `createElement` import flagged initially)
`npx tsc --noEmit` — pre-existing unrelated error in `components/board/board.tsx:291` (a concurrent worker's in-progress change to `board.tsx`, outside this feature's scope; `git status` shows it as already modified before this feature started). No new type errors introduced by my change.
`git commit` (0)

## Decisions made
- Chose to mount the hook via `renderHook` from `@testing-library/react` (already used elsewhere in the repo, e.g. `tests/unit/f251-inline-edit-permissions-realtime.test.tsx`) rather than a wrapper component, per the spec's instruction to exercise the hook, not just `subscribeToMyTasksRealtime` directly, since the mutant lives at the hook's call site.
- The naive "assign then update in the same subscription" test alone does NOT discriminate the mutant, because both channel closures still share the same one-off copy for the lifetime of a single subscribe call. To actually kill the mutant I forced a resubscribe (changed `userId`, which is the subscription effect's only dependency) between learning the id live and delivering the `tasks` UPDATE — this is the boundary where a copy (seeded fresh from a ref that never learned the live id) diverges from the live reference (which the id was written back into). Documented this reasoning in the test file's comments so a future reader understands why the first test alone is insufficient.
- Did not touch production code — mutation testing showed the current implementation is correct, only the test coverage was missing.

## Out-of-scope work needed
None beyond what scrutiny-1.md's FU-H already described (fully addressed here). The scrutiny doc also mentions a related smell — the seeding effect re-adds `initialTaskIds` on every render when the caller passes an inline array — but that is explicitly a separate concern not part of this AS-011 fix-up's scope and was left untouched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a `userId` change to force the subscription effect to re-run (rather than an `initialTaskIds` re-seed) as the discriminating trigger, since `initialTaskIds` re-seeding alone does not cause `subscribeToMyTasksRealtime` to be re-invoked (its effect's dependency array is `[userId]` only) and so would not actually re-read `trackedTaskIdsRef.current` at the mutated call site.

## Notes for the next worker
The repo currently has several other workers' in-flight changes (e.g. `components/board/board.tsx`, `components/portal/task-list.tsx`) that are unrelated to this feature and pre-existed before I started (confirmed via `git status` at the start of this session). The `npx tsc --noEmit` error in `board.tsx:291` is one of those and is not introduced by this feature.
