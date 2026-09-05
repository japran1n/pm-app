# Handoff: F019 — Fix My Tasks render-phase optimistic reset

## Status
COMPLETE

## Assertions covered
AS-012: PASS — checking a task marks it complete immediately and the optimistic state survives a `router.refresh()` that delivers stale pre-toggle data while the toggle is still in-flight (verified by 3 tests, including a regression test that fails on the pre-fix code).
AS-014: PASS — same for the uncheck direction (verified by 2 tests).

## Files changed
components/my-tasks/personal-todo-list.tsx
tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0, 8/8 passed)
`npx vitest run tests/unit` (0, 186 files / 1418 tests passed)
`npm run lint` (0, 0 errors — pre-existing unrelated `no-unused-vars` warnings only)
`npx tsc --noEmit` (0)
`npm test` (0, ran in background; the RLS/dependency/comment-realtime integration test failures observed require a live Supabase test database that isn't reachable in this sandbox — pre-existing, unrelated to this feature; confirmed the unit suite alone is 100% green)

## Decisions made
- Root cause: `personal-todo-list.tsx:26-31` (pre-fix) unconditionally called `setTodos(initialTodos)` whenever the `initialTodos` prop identity changed (e.g. from `router.refresh()`), discarding any in-flight optimistic mutation's base state with no protection.
- Fix: added `pendingToggleIds` (React state, a `Set<string>` of todo ids with an active toggle) alongside the existing `syncedInitial` derived-state pattern. In the render-phase sync block, rows whose id is in `pendingToggleIds` are preserved from the current `todos` state instead of being replaced by the server's payload; other rows still sync normally. `handleToggle` adds the id to the set right before dispatching the transition and removes it in every settle path (success, `{ ok: false }`, and thrown rejection).
- Only call `setTodos` when the merged array actually differs (by per-index reference) from the current one, to avoid an unnecessary extra state update while a toggle is pending.
- **Ref vs state:** initially implemented `pendingToggleIds`/`syncedInitial` as `useRef`, mutated directly during render (a common "cache" trick). This was rejected by this project's ESLint config (`react-hooks/refs` from the React Compiler plugin — "Cannot access ref value during render" / "Passing a ref to a function may read its value during render"), which is a hard error in `npm run lint`. Rewrote both to plain `useState`, matching the pre-existing `syncedInitial` pattern already in the file. `handleToggle` now calls `setPendingToggleIds` (functional updates) instead of mutating a ref.
- Verified the fix and the new regression test both ways: the new `test_AS_012_AS_014_in_flight_row_is_not_clobbered_by_a_stale_sync_mid_toggle` test fails against the unmodified (pre-fix) component (`git stash` the component file only, rerun the test file: 1 failed / 7 passed) and passes with the fix applied (8/8 passed). The other two new tests (`test_AS_012_optimistic_check_survives_...` / `test_AS_014_optimistic_uncheck_survives_...`) assert the literal assertion text (checkbox state + strikethrough class survive the refresh) but do NOT by themselves distinguish old vs new code, because `useOptimistic`'s boolean-flip reducer masks a same-value base reset while an action is still pending (a self-healing property of the hook, discovered during investigation) — kept them anyway since they directly test the assertion wording, but the title-preservation test is the one that actually proves the mechanism and would catch a regression.

## Out-of-scope work needed
- Not part of this feature, but discovered during investigation: `personal-todo-list.tsx`'s `pendingToggleIds` protection only covers the window while a toggle is in-flight. A stale `router.refresh()` payload that arrives AFTER a toggle has already resolved and committed is not (and per the spec's literal wording, is not required to be) protected — this is normal eventual-consistency behavior for optimistic UI and not a bug, but worth noting if a future worker investigates a similar report.
- Also discovered (unrelated to F019, pre-existing, not fixed): `npm test`'s integration suite (`tests/integration/*`) has multiple failing/skipped tests (RLS policies, dependency UI actions, comment realtime) that require a live Supabase test database and appear to fail/skip in this sandbox regardless of any code change here. Flagging for whoever owns test-infra/CI setup — this is not something F019 touches or introduces.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `useState`-based `Set<string>` for pending-toggle tracking over the spec's suggested "Set ref" wording, because a literal ref-based implementation is disallowed by this repo's ESLint config (React Compiler `react-hooks/refs` rule treats any ref read during render as a hard error). The state-based approach satisfies the same requirement (track in-flight ids, skip resetting those rows in the sync effect) while staying lint-clean; behavior verified identical via the regression test.
AUTONOMOUS_DECISION: Added a third test (`test_AS_012_AS_014_in_flight_row_is_not_clobbered_by_a_stale_sync_mid_toggle`) beyond the two literally following the assertion IDs, because the two assertion-literal tests do not, by themselves, distinguish pre-fix from post-fix behavior (useOptimistic's own boolean-flip masking self-heals a same-value base reset while pending). The third test uses a concurrently-changed `title` field as an observable proxy for "was this in-flight row's whole object replaced by the stale sync," which is unaffected by that masking and reliably fails on the reverted component.

## Notes for the next worker
- No MCP usage — this is a pure client-component/UI fix with no external service interaction.
- If you touch `personal-todo-list.tsx` again: do not reintroduce `useRef` reads during render — this repo's `npm run lint` enforces React Compiler rules (`react-hooks/refs`) as hard errors, not warnings.
- `npm test`'s full run (including integration tests) takes several minutes and needs a live Supabase test DB; for fast iteration on unit-only changes, use `npx vitest run tests/unit`.
