# Handoff: F013 — Repair the M1 channel-split regression and stop vitest collecting old Playwright evidence

## Status
COMPLETE

## Assertions covered
AS-007: PASS — verified via full `npx vitest run` (205 files / 1572 tests passed, 0 failed), which includes `tests/unit/personal-todo-list-realtime-wiring.test.tsx` now asserting the F003 two-channel My Tasks topology.
AS-033: PASS — `npx vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**"` no longer collects `missions/**/milestones/*-evidence*/*.spec.ts` Playwright files; full run is green.

## Files changed
tests/unit/personal-todo-list-realtime-wiring.test.tsx
vitest.config.ts

## Commands run
`npx vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**"` (0) — Test Files 205 passed (205), Tests 1572 passed (1572)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 15 pre-existing warnings unrelated to this change)

## Decisions made
- Confirmed the real channel-topic strings from `components/my-tasks/use-my-tasks-realtime.ts` (`tasks:my-tasks:${userId}:assignees` and `tasks:my-tasks:${userId}:tasks`, lines 137-138/145/191) rather than guessing, so the test asserts the actual F003 topology.
- Reworked the test's fake Supabase `.channel()` mock so each channel *name* gets its own object (previously all `.channel(name)` calls returned one shared object), and tagged each captured `.on()` registration with the channel name it was made on (`channelName` field on `OnCall`). This was necessary because the old single-object mock made it impossible to prove which channel a given table's binding was registered against — without this change the test could pass even if both bindings collapsed back onto one channel, defeating the point of the regression test per the feature spec's explicit warning.
- Updated the assertion to check `channelCalls` for exactly the two expected topic names AND that `task_assignees`'s binding is on the `:assignees` channel while `tasks`'s binding is on the `:tasks` channel (plus `onCalls.length === 2` so no extra/missing bindings sneak through).
- Fixed `vitest.config.ts`'s `test.exclude` by adding `"missions/**"` — scoped to the whole missions tree (orchestrator/evidence bookkeeping) rather than a narrower pattern, since new milestone-evidence directories get created per mission run and a narrower glob would need updating every time. Verified this does not affect collection of `tests/**` or `components/**` (full suite still shows the same 205 files / 1572 tests, matching the pre-existing suite size minus the two Playwright files that no longer error).

## Out-of-scope work needed
None identified — `tests/e2e/portal-approve.spec.ts` and its helpers (`lib/actions/portal-approval.ts`, `next-env.d.ts` showing as modified in git status) are pre-existing uncommitted changes from another worker's in-progress feature; not touched by this feature and left exactly as found.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to give the test mock per-channel-name objects (rather than e.g. asserting only channel names and separately asserting the set of tables, which was the original loosening risk called out in the spec) so that the "each topic carries the right table" guarantee is structurally enforced by the test itself, not just by convention.

## Notes for the next worker
- The wiring test's fake Supabase client lives entirely in `tests/unit/personal-todo-list-realtime-wiring.test.tsx`; if a future feature adds a third per-table channel to `useMyTasksRealtime`, extend both the `makeFakeSupabase()` channel-object map (already generic per name) and the topology assertion in the "mounts the real hook..." test.
- No MCP tools were needed for this feature (pure test/config fix, no live external service state touched).
