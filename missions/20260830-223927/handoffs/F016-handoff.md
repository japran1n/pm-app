# Handoff: F016 — Fix title save missing try/catch

## Status
COMPLETE

## Assertions covered
AS-010: PASS — title reverts to previous value and toast.error is shown on both `result.ok === false` (pre-existing path) and on a thrown/rejected `editTask` (new path, this fix). New test `test_AS_010_title_reverts_and_shows_error_toast_when_the_save_throws_instead_of_rejecting` covers the throw case specifically.

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx` (0) — 5/5 passed
`npm test` (0) — 321 passed / 58 failed test files; failures are pre-existing Supabase integration tests hitting "Request rate limit reached" during sign-in (e.g. tests/integration/trash-view.test.ts), unrelated to this change. No failure references task-detail-sheet or F005/F016.
`npm run lint` (0 relevant) — 2 pre-existing errors in components/my-tasks/personal-todo-list.tsx ("Cannot access ref value during render"), a file this feature does not touch (already modified in working tree from a prior worker session). No lint errors in files this feature changed.
`npx tsc --noEmit` (0 relevant) — 1 pre-existing error in tests/unit/probe_tmp/probe.test.tsx, an unrelated stray file not part of this feature's scope. No typecheck errors in files this feature changed.

## Decisions made
- Wrapped only the `await editTask(...)` call in the existing `startTitleSaveTransition` callback with try/catch, matching the spec's exact instruction (add try/catch around the await; on catch call `setTitle(previousTitle)` and `toast.error("Failed to save title")`).
- Used `editTask.mockImplementationOnce(() => Promise.reject(new Error("network")))` in the test rather than `mockRejectedValue` because the shared `editTask` mock in this test file is a custom `vi.fn` that resolves manually via `resolveEditTask`, not a native mock with `.mockRejectedValue` chaining pattern used elsewhere — `mockImplementationOnce` returning a rejected promise is behaviorally identical to `mockRejectedValue` for this one call and is discriminating: reverting the try/catch causes the test to fail with an unhandled rejection / title not reverting.

## Out-of-scope work needed
None identified for this feature. (Pre-existing lint/typecheck issues in personal-todo-list.tsx and tests/unit/probe_tmp/probe.test.tsx are unrelated to F016 and were not introduced by this change.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none)

## Notes for the next worker
- The full `npm test` run takes ~10 minutes and includes live Supabase integration tests that are flaky under rate limiting; when validating this feature, prefer running the scoped file directly: `npx vitest run tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx`.
- No MCP tools were used for this fix — it is a pure client-side try/catch addition with no external service interaction.
