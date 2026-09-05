# Handoff: F022 — Fix todo guard leak + AS-013 discriminating revert test

## Status
COMPLETE

## Assertions covered
AS-013: PASS — mutant (committing failed state without reverting inside the failure branch) kills `test_AS_013_checkbox_reverts_and_shows_an_error_toast_when_the_toggle_fails` (verified manually by injecting the mutant and re-running).

## Files changed
components/my-tasks/personal-todo-list.tsx
tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0, 8/8 pass)
`npm run lint` (0, 13 pre-existing warnings unrelated to this feature, 0 errors)
`npx tsc --noEmit` (0)
`npx vitest run` (0 — full suite; 95 of 379 files fail, all due to pre-existing live-Supabase integration tests hitting "Request rate limit reached" during sign-in, unrelated to this feature; no failures in personal-todo-list or f006 test files)

## Decisions made
- Replaced the F020 pending-toggle map (`Map<id, confirmedIsDone>`, released on server-value equality) with a commit-ordered map (`Map<id, { isDone, committed }>`). A row stays guarded (server sync ignored) while `committed === false`. On local commit (`setTodos` in the toggle success path) the entry is flipped to `committed: true` via a new `markCommitted()` helper. The sync effect then accepts the VERY NEXT server payload unconditionally for committed rows and deletes the guard entry — instead of requiring that payload's value to match the confirmed value first.
- This is a deliberate design tradeoff specified by the feature spec: it trades the previous guarantee (guard persists until a matching value arrives, tested in F020's tests) for eliminating a permanent-freeze bug (row stuck forever if the write never persisted server-side, or if another actor toggled the row back to a value that coincidentally equals a stale read before the real confirming sync arrives). Per the spec's explicit instructions this is intentional, not a regression.
- Updated the two pre-existing F020 sync-guard tests (`test_AS_012_optimistic_check_survives_a_server_data_refresh...` and `test_AS_014_optimistic_uncheck_survives_a_server_data_refresh...`) whose assertions directly encoded the OLD equality-based release semantics (asserting a stale post-commit sync is ignored until a matching value arrives). Updated them to assert the new commit-ordered semantics: the first post-commit server sync is accepted unconditionally, even if it's stale, and future syncs then apply normally. This was necessary for the guard-release design change to be correctly implemented and testable — leaving the old assertions in place would have made the two designs mutually exclusive and one intentionally correct behavior would fail its own regression test.
- `handleDelete` now removes the todo's guard entry via `setPendingToggles` immediately on optimistic delete, since a deleted row can never receive a meaningful future server sync.
- AS-013 test fix: added a `flushPendingTransitions()` helper (`act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })`) called after the toggle promise rejects/resolves-with-`ok:false`, before asserting revert state — this pushes the assertion past the optimistic pending-flip render and into the settled/reverted state. Also reordered assertions to check the toast call first (via `waitFor`) then the checkbox/text state, and asserted BOTH the checkbox state (`aria-checked="false"`) AND `not.toHaveClass("line-through")` AND the toast, matching the "assert original state AND toast" requirement in scope.
- Verified the mutation-test requirement manually: temporarily added `setTodos(...)` inside the `if (!result.ok)` failure branch of `handleToggle` (permanently committing the failed toggle state) and re-ran the f006 test file — `test_AS_013_checkbox_reverts_and_shows_an_error_toast_when_the_toggle_fails` failed as required (checkbox stuck at `aria-checked="true"`). Reverted the mutant afterward; original file restored and re-verified green (8/8).

## Out-of-scope work needed
None identified within this feature's scope. The pre-existing integration test failures observed in the full `npx vitest run` (trash-view.test.ts, workspace-members-list.test.ts, and others under `tests/integration/`) are due to a live Supabase auth rate limit being hit during the run, not related to this feature or its files — no action taken on them per "do not modify files outside scope."

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Updated the two existing F020 regression tests in the same test file whose hard-coded expectations directly contradicted the new commit-ordered guard-release semantics mandated by this feature's clarified spec. This was necessary to make the spec's FU-N fix both correct and testable; leaving them unmodified would have permanently red-lit the suite for a behavior change the spec explicitly requires. Chose to preserve full test coverage of the "stale/in-flight sync must not clobber row" property (still tested) while updating only the specific "post-commit stale sync ignored until value matches" expectation, which no longer holds by design.

## Notes for the next worker
- The commit-ordered guard trades a small residual race window (the first post-commit server sync could theoretically be stale and briefly re-flip the UI to a wrong value) for eliminating the permanent-freeze failure mode. If a future feature wants to eliminate that residual window too, it would need a request/commit sequence number embedded in server payloads (not available today) rather than a boolean flag — flagged here for awareness, not filed as a follow-up since no assertion currently requires it.
- No MCP tools were used for this feature; it is a pure client-side React state fix with no live external service interaction.
