# Handoff: F021 — Propagate discriminating test shape to remaining vacuous tests (FU-K)

## Status
COMPLETE

## Assertions covered
AS-004: PASS — verified discriminating: temporarily swapped `useOptimistic` → `useState` in `lib/hooks/use-optimistic-action.ts`, ran the scoped test files, all 6 tests (both files) failed as expected; restored the real hook (`git diff` on the hook file is empty), re-ran, all 6 pass.

## Files changed
tests/unit/list-due-date-cell-optimistic.test.tsx
tests/unit/use-optimistic-action.test.tsx

## Commands run
`npx vitest run tests/unit/use-optimistic-action.test.tsx tests/unit/list-due-date-cell-optimistic.test.tsx` (0) — scoped run, 6/6 pass with real hook
`npm test` (0) — full suite: 296 files / 2281 tests passed, 83 files / 109 tests failed — all failures are pre-existing `tests/integration/*` Supabase auth tests failing with `AuthApiError: Request rate limit reached` (429 from live Supabase auth, an environment/rate-limit issue), not related to this feature's test-only changes. Neither of the two files this feature touches appears among the failures.
`npm run lint` (0) — 0 errors, 13 pre-existing warnings unrelated to this change
`npx tsc --noEmit` (0)
`git commit` (0)

## Decisions made
- Diagnosed the actual vacuousness mechanism before rewriting: the failing tests used already-rejected/already-resolved mocks (`mockRejectedValue`, `async () => ({...})`), so the rejection settles on the same microtask as the optimistic `setOptimisticValue` call. Under React's batching inside `startTransition`, this collapses both state transitions into a single commit and the intermediate "new" value is never independently observed — which, empirically (verified by manually swapping `useOptimistic` → `useState` and running the original tests), let the useState regression through the due-date AS-004 tests and the two failure-path hook tests without failing, even though the assertions superficially "checked the revert."
- Fix: switched all three revert-path tests (both AS-004 due-date-cell tests and both failure-path hook tests) to deferred promises (`new Promise((resolve/reject) => {...})` with the resolver/rejecter captured and called explicitly), mirroring the pattern the file's own AS-003/success test already used. This lets each test assert phase 1 (displayed/optimistic value is the new value while the action is pending) and then, after manually resolving/rejecting, assert phase 2 (value has reverted to original). Confirmed by re-running the useState-swapped hook: all 6 tests in both files now fail; with the real hook restored, all 6 pass.
- Did not touch `lib/hooks/use-optimistic-action.ts` or `components/task/list-due-date-cell.tsx` — scope is test-only per the spec's "Files" list.

## Out-of-scope work needed
- The `tests/integration/workspace-time-by-person.test.ts` and `tests/integration/workspace-members-list.test.ts` (and ~81 other integration test files) are failing on `npm test` with `AuthApiError: Request rate limit reached` from Supabase Auth. This is a pre-existing environment/rate-limit issue unrelated to F021 — the integration suite is presumably hitting Supabase's sign-in rate limit when run back-to-back across hundreds of test files. Not something this feature should fix; flagging for whoever owns test-infra/CI configuration (e.g. throttling sign-ins, using a test-only auth bypass, or increasing the project's rate limit).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied the same deferred-promise discriminating pattern to the third hook test (`test_AS_failure_hook_shows_actions_own_error_message_when_provided`, the `{ error }`-return path) even though the spec only explicitly called out the "reverts and calls toast on rejection" test — the same batching/vacuousness mechanism affected it identically, and the spec's stated goal ("the hook test: assert optimistic value is temporarily the new value ... AND reverts ... — both phases need checking") applies equally to this sibling test.

## Notes for the next worker
- The root cause of the vacuousness was not "missing assertions" (the revert assertions were already present) but the *timing* of when they were checked relative to React's transition batching. If you're adding more `useOptimisticAction` consumers/tests in future features, prefer the deferred-promise pattern (capture `resolve`/`reject` and call them explicitly after asserting the pending/optimistic state) over `mockRejectedValue`/`mockResolvedValue` for any test that needs to distinguish "reverted correctly" from "never actually applied to begin with."
- No MCP tools used — this is a pure test-file change with no external service interaction.
