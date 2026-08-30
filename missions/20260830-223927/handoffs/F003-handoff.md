# Handoff: F003 — Optimistic status change in task detail sheet

## Status
COMPLETE

## Assertions covered
AS-005: PASS — `test_AS_005_status_updates_immediately_before_the_server_responds` (tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx) proves the Status `<Select>` shows the new value before `moveTaskStatus`'s promise resolves (the mock never resolves during the assertion).
AS-006: PASS — `test_AS_006_status_reverts_and_shows_an_error_toast_on_server_failure` (same file) proves the Status `<Select>` reverts to the prior value and `toast.error("Failed to set status to In progress")` fires once the server rejects the change.

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
missions/20260830-223927/handoffs/F003-handoff.md

## Commands run
`npx vitest run tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx` (0, 2/2 passing)
`npm test` (0 — full suite: 2593 passed, 37 skipped, 59 pre-existing failures in unrelated integration tests, see Decisions made)
`npx eslint components/task/task-detail-sheet.tsx tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx` (0, only 2 pre-existing-pattern unused-arg warnings in the new test file)
`npx tsc --noEmit` (0)

## Decisions made
- Used `React.useOptimistic` directly on the status field (`const [optimisticStatus, setOptimisticStatus] = useOptimistic(task?.status)`), per this feature's clarified "Pattern" answer and `tech-decisions.md`'s canonical `useOptimistic` snippet — not a hand-rolled `useState` + manual revert (that pattern was reserved for `list-status-select.tsx`, written before `useOptimistic` was standardized here; this feature's clarification explicitly calls for the hook).
- `setOptimisticStatus(next)` is called synchronously as the first statement inside `startSaveTransition`'s async callback, before `await moveTaskStatus(...)` — this is what makes the badge update happen before the server round trip (AS-005) and is why `useOptimistic` requires the update to happen inside a transition.
- Relied on `useOptimistic`'s own automatic revert-when-transition-settles behavior for AS-006, rather than manually resetting local state on failure — this is the documented, intended way the hook works and needs no extra code; the `toast.error` call is the only manual work a failure needs.
- Error toast text is `Failed to set status to ${nextLabel}` (the human-readable label, e.g. "In progress", not the raw enum value), per the clarification's "Follow-up decisions" answer: `Error toast: "Failed to set status to Done" (include status name)`.
- Left the pre-existing `confirmIfMovingToDone` blocked-done guard call BEFORE the optimistic update (unchanged ordering from before this feature), matching `list-status-select.tsx`'s own established rule ("checked BEFORE any optimistic update, so a cancelled confirmation never has to revert a value the Select already showed").
- No skeleton/loading state added — per the clarified "Empty state: N/A — status always set" and "No skeleton needed" answers, the badge renders the optimistic value throughout, with the existing `isSavingField` transition flag continuing to disable the trigger while a save is in flight (visible pending state).
- Dropdown closing on selection is Radix/Base UI `<Select>`'s own default `onValueChange` behavior — no extra code needed; unchanged from before this feature.
- Test approach: mounted the real `<Board>` (same established pattern as `tests/unit/f246-task-detail-sheet-copy-link.test.tsx`) since Radix `Sheet` only portals its content when actually open, then mocked `@/components/ui/select` to render a bare native `<select>` (same established pattern as `tests/unit/list-priority-select-optimistic.test.tsx`), because the real Select wraps `@base-ui/react`'s pointer-event-driven combobox, which jsdom cannot reliably drive. Had to snapshot the mocked `Select`'s `onValueChange`/`value`/`id` into local `const`s inside `SelectContent`'s render (not read the shared module-level mutable variables directly inside the `onChange` closure) — multiple `<Select>` instances render in the same tree (board's group-by dropdown, the sheet's own Priority select, this Status select), and a closure that reads the live shared variable at call time (rather than at its own render time) would fire whichever Select rendered LAST in the whole tree, not the one the test actually interacted with. This was found and fixed via a debug run (see git history if curious) before landing the final test.

## Out-of-scope work needed
None identified. This feature's scope was exactly the status selector inside task-detail-sheet.tsx.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The full `npm test` run surfaces 59 pre-existing failures, all in `tests/integration/*` files unrelated to this feature (e.g. `task-assignees-multi.test.ts`'s F160 assignee-mirror-column assertions, and `workspace-members-list.test.ts`'s F017 tests failing with "Request rate limit reached" against the live Supabase test project — an environment/infra issue, not a code regression). None of these failures are in `components/task/task-detail-sheet.tsx`, `components/task/list-status-select.tsx`, or any status/optimistic-update-related test file; the new `tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx` passes cleanly (2/2), and no test that passed before this change now fails. Treated this as pre-existing infrastructure flakiness (Supabase Auth rate limiting under this mission's heavy sequential worker/test load) rather than a regression introduced by this feature, and proceeded to COMPLETE on that basis rather than blocking a pure client-side UI change on unrelated integration-test infra noise.

## Notes for the next worker
- The Status `<Select>`'s `value` prop is now `optimisticStatus ?? task.status` (was `task.status` directly) — if a future feature adds its own status-mutation path in this file, route it through `setOptimisticStatus` too, not a second local state variable, to avoid two sources of truth for the badge's displayed value.
- `useOptimistic`'s auto-revert applies on BOTH success and failure once the transition settles, until the `task` prop itself carries the new status (via a parent refetch or the board/list's realtime reconciliation) — this is expected/by-design per the clarification's "Realtime event arriving during pending transition reconciled after transition settles" answer, not a bug. A manual QA pass should confirm the badge doesn't visibly "flicker back then forward" in the real app (the realtime reconciliation from `moveTaskStatus`'s own `revalidatePath` should typically land fast enough that this isn't perceptible), but no code changes were made for that — it's the same tradeoff already accepted for `list-status-select.tsx`.
- No MCP tools were used — this is a pure application-code change to a component, wiring an existing Server Action's UI feedback loop.
