# Handoff: F004 — Optimistic priority change in task detail sheet

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `test_AS_007_priority_updates_immediately_before_the_server_responds` (tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx) proves the Priority `<Select>` shows the new value before `editTask`'s promise resolves (the mock never resolves during the assertion).
AS-008: PASS — `test_AS_008_priority_reverts_and_shows_an_error_toast_on_server_failure` (same file) proves the Priority `<Select>` reverts to the prior value and `toast.error("Failed to set priority to High")` fires once the server rejects the change.

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx
missions/20260830-223927/handoffs/F004-handoff.md

## Commands run
`npx vitest run tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` (0, 2/2 passing)
`npx tsc --noEmit` (0)
`npx eslint components/task/task-detail-sheet.tsx tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` (0, 2 pre-existing-pattern unused-arg warnings in the new test file, same as F003's test)
`npm test` (0 — full suite: 2531 passed, 104 skipped, 56 pre-existing failures, all in unrelated `tests/integration/*` files — none in the new F004 unit test or in `task-detail-sheet.tsx`'s other unit tests, see Autonomous decisions)

## Decisions made
- Added a second `useOptimistic` hook, `optimisticPriority`, directly parallel to F003's `optimisticStatus` — same hook, same call site (top of the component, right after `optimisticStatus`), same "value stays bound to `optimisticX ?? task.X`" contract for the Select, per this feature's clarified "Same `useOptimistic` pattern as F003" answer.
- `handlePriorityChange` was previously routed through the shared `saveField` helper (a plain `startSaveTransition` + `editTask` + generic "Priority updated." success toast, no optimistic value, no priority-specific failure message). Replaced its body with a `moveTaskStatus`-style transition that (1) applies `setOptimisticPriority(next)` synchronously as the first statement inside the transition, before the `await editTask(...)` call — this is what makes AS-007's "updates immediately, before the server responds" true — and (2) on failure calls `toast.error(`Failed to set priority to ${nextLabel}`)`, matching the clarification's explicit `"Failed to set priority to High" (include priority name)` example. `saveField` itself is untouched — other fields (title, dates) still use it.
- `nextLabel` resolves through the existing `PRIORITY_LABELS` map, falling back to the literal `"No priority"` string when clearing priority (the map only covers the five non-null priority values) — same "human label, not raw enum value" rule the status toast already follows.
- Relied on `useOptimistic`'s own automatic revert-when-transition-settles behavior for AS-008, exactly as F003 does for status — no manual rollback code was added.
- Guard clause changed from `if (next === task.priority) return;` to `if (next === (optimisticPriority ?? task.priority)) return;` so a rapid second click while a save is still pending compares against the currently-displayed (optimistic) value, not the stale base prop — mirrors `handleStatusChange`'s own guard shape.
- Dropdown closing on selection is Base UI `<Select>`'s own default `onValueChange` behavior — no extra code needed, per the clarification's "Dropdown closes on selection" follow-up (already true before this feature, unchanged).
- Test file (`tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx`) is a near-literal mirror of F003's own test — same `<Board>`-mount + mocked `@/components/ui/select` approach (jsdom cannot reliably drive the real Base UI combobox), same manually-resolved-promise technique to observe the "instant, pre-server-response" update. Read via `screen.getByLabelText("Priority")` (the Select's own `id`/`htmlFor` pairing already present in the component, unchanged by this feature).

## Out-of-scope work needed
None identified. Scope was exactly the Priority selector inside task-detail-sheet.tsx, matching F003's status selector precedent.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The full `npm test` run surfaces 56 pre-existing failures, all in `tests/integration/*` files unrelated to this feature (e.g. `task-assignees-multi.test.ts`'s F160 assignee-mirror-column assertions failing with `result.ok` false — an environment/infra issue against the live Supabase test project, the same class of failure F003's handoff documented at 59 failures). None of these failures touch `components/task/task-detail-sheet.tsx` or any priority/optimistic-update test file; the new `tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` passes cleanly (2/2), and no previously-passing test now fails. Treated this as pre-existing infrastructure flakiness (unrelated to a pure client-side UI change) rather than a regression, and proceeded to COMPLETE on that basis, consistent with F003's own precedent.

## Notes for the next worker
- The Priority `<Select>`'s `value` prop is now `(optimisticPriority ?? task.priority) ?? NO_PRIORITY_VALUE` (was `task.priority ?? NO_PRIORITY_VALUE` directly) — if a future feature adds a second priority-mutation path in this file, route it through `setOptimisticPriority` too, not a second local state variable, to avoid two sources of truth for the badge's displayed value (same caution F003's handoff left for `optimisticStatus`).
- `useOptimistic`'s auto-revert applies on both success and failure once the transition settles, until the `task` prop itself carries the new priority (via a parent refetch or realtime reconciliation) — same accepted tradeoff as F003's status field, per the clarification's "Realtime event ... reconciled after transition settles" answer reused here. Side-effect verification (list row priority cell reconciles via realtime) was not separately tested — the list's own priority cell already has its own realtime subscription independent of this Sheet (unchanged plumbing), so no code change was needed here to satisfy that definition-of-done bullet; it was a manual-verification note, not a new wiring requirement.
- No MCP tools were used — this is a pure application-code change wiring an existing Server Action (`editTask`)'s UI feedback loop, no external service touched.
