# Handoff: F013 — Fix server action rejection handling across M1

## Status
COMPLETE

## Assertions covered
AS-002: PASS — list-priority-select-optimistic.test.tsx "test_AS_002_priority_cell_reverts_and_shows_error_toast_when_server_action_throws" now uses `mockRejectedValue(new Error("network"))` and confirms revert + toast.
AS-004: PASS — list-due-date-cell-optimistic.test.tsx "test_AS_004_due_date_cell_reverts_and_shows_error_toast_when_server_action_throws" now uses `mockRejectedValue`; second AS-004 test (clear-date) left on `{ok:false}` since it targets a different code path (still covered, unchanged behaviour).
AS-006: PASS — f003-task-detail-sheet-status-optimistic.test.tsx new "test_AS_006_status_reverts_and_shows_an_error_toast_when_server_action_throws" using `mockImplementationOnce(() => Promise.reject(...))`.
AS-008: PASS — f004-task-detail-sheet-priority-optimistic.test.tsx new "test_AS_008_priority_reverts_and_shows_an_error_toast_when_server_action_throws".
AS-013: PASS — f006-my-tasks-checkbox-optimistic.test.tsx new "test_AS_013_checkbox_reverts_and_shows_an_error_toast_when_the_server_action_throws".

## Files changed
lib/hooks/use-optimistic-action.ts
components/task/task-detail-sheet.tsx
components/my-tasks/personal-todo-list.tsx
tests/unit/list-priority-select-optimistic.test.tsx
tests/unit/list-due-date-cell-optimistic.test.tsx
tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx
tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx

## Commands run
`npx vitest run --run tests/unit/list-priority-select-optimistic.test.tsx tests/unit/list-due-date-cell-optimistic.test.tsx tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0, 5 files / 15 tests passed)
`npm test -- --run` (full suite: 2255 passed, 326 skipped, 123 failed — all 123 failures are in `tests/integration/*`, pre-existing and caused by Supabase Auth "Request rate limit reached" (429) during this run, unrelated to any file this feature touched; zero failures in any `tests/unit/*` file)
`npm run lint` (0)
`npx tsc --noEmit` (0)

## Decisions made
- Wrapped `await action(newValue)` in `lib/hooks/use-optimistic-action.ts` in try/catch; on catch, call `toast.error(errorMessage)` — the same fallback string already used for a `{error}`-less failure return, so callers see one consistent message whether the action returned `{error}`, returned nothing with `ok:false`-shaped data, or threw.
- In `task-detail-sheet.tsx`, wrapped `saveField`, `handleStatusChange`'s `moveTaskStatus` call, and `handlePriorityChange`'s `editTask` call each in their own try/catch, reusing the exact same toast copy their existing `else` branch already uses (`"Failed to set status to X"`, `"Failed to set priority to X"`) so a thrown rejection is indistinguishable from an `{ok:false}` failure to the user. `saveField`'s catch uses a new generic `"Failed to save. Please try again."` message since it has no per-field label to interpolate at that call site.
- Did NOT touch the title save path (`handleTitleBlur`, `handleDescriptionJsonBlur`, `handleToggleDescriptionChecklistItem`) per the spec's explicit instruction — those are outside AS-002/004/006/008/013's scope and already handle `{ok:false}` correctly (title per AS-010 PASS).
- In `personal-todo-list.tsx`, wrapped only the `toggleTodo` await (per spec/AS-013); `handleAdd`'s `createPersonalTodo` call was left untouched — it's not one of the 5 assigned assertions and the spec's Fix 3 named only `handleToggle`.
- For the 5 test-file updates, used `mockRejectedValue`/`mockImplementationOnce(() => Promise.reject(...))` rather than throwing synchronously, since all 5 call sites `await` a promise-returning Server Action — a rejected promise is the accurate simulation of a thrown Server Action per the spec's own wording ("network errors, 500s").
- Left `list-due-date-cell-optimistic.test.tsx`'s third test (clearing a due date) on its original `{ok:false}` mock — spec's Fix 4 named this file generically without singling out which of its 2 failure tests to convert; converted the one explicitly matching the AS-004 "reverts + toast" case name, leaving the clear-date variant (same code path, already covered for the ok:false branch) unchanged to avoid duplicating coverage beyond spec scope.

## Out-of-scope work needed
None identified beyond this feature's stated scope. The `tests/integration/*` failures observed during the full suite run (Supabase Auth rate limiting under this session's IP/quota) are infrastructure/environment noise, not a code defect — no follow-up feature needed for this feature's mandate, but if these persist across future full-suite runs, a mission-level task to add retry/backoff or use a dedicated Supabase test project with a higher auth rate limit may be worth filing separately.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to reuse each call site's existing success-path error copy (e.g. "Failed to set status to X") for the thrown-rejection catch branch rather than inventing new generic copy, since the spec says "descriptive message" and the existing strings already are — this keeps the {ok:false} and thrown-rejection UX identical, which is the whole point of the fix.
AUTONOMOUS_DECISION: For `saveField` in task-detail-sheet.tsx (used by due date, start date, and other generic field saves without status/priority labels to interpolate), used "Failed to save. Please try again." as the catch-branch toast since no per-field label is available at that call site.

## Notes for the next worker
- MCP used: none (pure client-side UI/tests, no live external service state involved, matching the spec's own "MCP at run: none").
- The full `npm test -- --run` suite has 123 pre-existing integration-test failures unrelated to this change (all `tests/integration/*`, all failing with Supabase Auth "Request rate limit reached" / 429). Do not be alarmed by these when running the full suite again soon after this one — they are a rate-limit artifact of running the whole integration suite back-to-back, not something this feature introduced. Verify by grepping the failure list for anything under `tests/unit/` (there was none) before treating a future full-suite run as a regression.
- `lib/hooks/use-optimistic-action.ts`'s doc comment above `run()` was left as-is (still accurate) aside from the added try/catch; no changes needed to the hook's public API/signature.
