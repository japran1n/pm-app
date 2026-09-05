# Handoff: F015 — Fix My Tasks toggle concurrency bug

## Status
COMPLETE

## Assertions covered
AS-012: PASS — checking a task still marks it visually complete immediately (test_AS_012_checking_a_task_marks_it_visually_complete_before_the_server_confirms), and now also verified safe under rapid out-of-order toggles (test_AS_012_AS_014_rapid_toggle_commits_last_user_intent_when_responses_resolve_out_of_order).
AS-014: PASS — unchecking a task still marks it incomplete immediately (test_AS_014_unchecking_a_completed_task_marks_it_incomplete_immediately), and now also verified safe under rapid out-of-order toggles (same rapid-toggle test as above).

## Files changed
components/my-tasks/personal-todo-list.tsx
tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0) — 5/5 passed
`npm test` (0) — full suite; integration tests that hit a live Supabase instance have pre-existing failures unrelated to this change (see Out-of-scope work needed)
`npx vitest run tests/unit` (0) — 186 files / 1413 tests passed
`npm run lint` (0) — 0 errors, 13 pre-existing warnings unrelated to this change
`npx tsc --noEmit` (0)

## Decisions made
- Followed the exact fix directive from the spec: captured `intendedIsDone = !todo.isDone` as a local const at the top of `handleToggle`, before the `await`, and passed it to the `setTodos` success commit instead of recomputing `!todo.isDone` against a possibly-stale closure.
- Went beyond the literal instruction to also satisfy the stated invariant ("final state matches last user action regardless of resolution order"): a simple click-time capture alone is not sufficient when two *different* clicks (e.g. check then uncheck) resolve out of order — the earlier click's captured intent can still land after the later click's commit and silently overwrite it. Added a `useRef<Map<string, number>>` (`latestToggleRef`) that stamps each `handleToggle` call for a given todo id with an incrementing request id; a response is only committed via `setTodos` if it's still the latest request issued for that todo. Stale responses (including thrown/rejected ones) are skipped entirely — `useOptimistic` then reverts to whatever the last successful commit set, which is the last user action.
- This mechanism is per-todo-id (keyed by `todo.id`), so toggling two different rows concurrently is unaffected — sequencing is only enforced within repeated toggles of the same row, matching the bug report's scope.
- No MCP usage needed — this is pure client-side component logic with no live external service state to inspect (mcp-registry.md / feature spec both say "MCP at run: none").

## Out-of-scope work needed
- The full `npm test` run surfaced pre-existing integration test failures unrelated to F015: `tests/integration/f229-saved-views-ui.test.ts`, `tests/integration/bulk-restore-tasks.test.ts`, `tests/integration/f222-status-category-semantics.test.ts`, `tests/integration/f326-rls-hardening.test.ts`, `tests/integration/f228-saved-view-actions.test.ts` all fail against the live Supabase schema (e.g. `PGRST202: Could not find the function public.bulk_delete_tasks_atomic`), and `tests/integration/rls-active-timers.test.ts` / `tests/integration/client-requests-rls.test.ts` report all-skipped. These are environment/schema-drift issues (missing/renamed Postgres functions, RLS policy state) independent of the personal-todo-list toggle fix and existed before this change. Worth a follow-up feature to reconcile the deployed Supabase schema/RPCs with what these integration tests expect, or to gate them behind an env check if the DB isn't reachable in this sandbox.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Added request-sequencing (via `latestToggleRef`) beyond the literal "capture intent as a local const" instruction, because a spec-compliant test of true rapid toggling (two different intents resolving out of order) proved that intent-capture alone does not satisfy the stated invariant "final state matches last user action regardless of resolution order." Chose the minimal, localized fix (a ref-based per-todo request counter) rather than changing the server action contract or introducing a queuing library, consistent with tech-decisions.md's preference for `useOptimistic` + Server Actions with no new dependencies.

## Notes for the next worker
- The added test `test_AS_012_AS_014_rapid_toggle_commits_last_user_intent_when_responses_resolve_out_of_order` in `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` refactors the mock `toggleTodo` to push each pending resolver onto a `pendingResolvers` array (instead of only tracking the single latest `resolveToggle`), so the test can resolve the two in-flight promises in a chosen (reversed) order. Existing tests still use the single `resolveToggle` variable and are unaffected.
- If a future change reintroduces a bug in this area, first check whether `latestToggleRef` in `components/my-tasks/personal-todo-list.tsx` is still being consulted before each `setTodos` commit inside `handleToggle`.
