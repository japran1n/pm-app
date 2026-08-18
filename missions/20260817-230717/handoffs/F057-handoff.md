# Handoff: F057 — list status inline edit

## Status
COMPLETE

## Assertions covered
AS-093: PASS — new test `tests/integration/list-status-inline-edit.test.ts` (2 tests, both passing) proves changing a task's status via `moveTaskStatus` (the same Server Action the list dropdown calls) persists and is reflected by both `getProjectListTasks` and `getProjectBoardTasks`, plus a negative case (invalid status rejected, row unchanged).

## Files changed
components/task/list-status-select.tsx (new)
components/task/task-list-table.tsx
tests/integration/list-status-inline-edit.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run` (0) — 308/308 tests passed
`npm run build` (0)

## Decisions made
- Reused `moveTaskStatus` (lib/actions/tasks.ts, F045/AS-069) as-is rather than writing a new Server Action — it already updates only `status` (position untouched, matching the spec's "position doesn't need to change here") and already calls `revalidatePath(`/w/${slug}`, "layout")` on success, which covers both the list and board routes since they're nested under that layout segment.
- New Client Component `ListStatusSelect` wraps a shadcn `<Select>` around the status cell only — `TaskListTable` itself stays a Server Component (AS-155), following the same "smallest possible client boundary" pattern as `TagsEditor` (F041) and `DueDateSortHeader` (F055).
- Optimistic local-state update with revert-on-failure + `sonner` error toast, same `useTransition`/`persist` pattern as `TagsEditor.persist`. This satisfies "reflect the new status without a full page reload" via client state; `router.refresh()` was not needed since the row updates from local state immediately and `revalidatePath` keeps subsequent server reads fresh.
- Removed the now-unused `STATUS_LABELS` map from `task-list-table.tsx` (the Select's own `SelectItem` labels replace it) to avoid an unused-variable lint error.
- Test file mocks `@/lib/supabase/server`'s `createClient` to return a real password-signed-in Supabase client (same pattern as `tests/integration/list-view-render.test.ts`), not a bare `auth.getUser()` stub (the pattern `tests/integration/move-task-status.test.ts` uses) — this test also calls `getProjectListTasks`/`getProjectBoardTasks`, which run real `.from(...)` queries against that client, not just `auth.getUser()`.

## Out-of-scope work needed
None noticed beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose client-side optimistic state + `sonner` toast over `router.refresh()` for the "reflect without full reload" requirement, since the spec explicitly said either was acceptable ("your call") and the optimistic pattern was already established by `TagsEditor` in this codebase.

## Notes for the next worker
- Board-view verification: not done via a running browser/UI click-through — verified by code-level proof that `getProjectBoardTasks` and `getProjectListTasks` both read the same `tasks` table with no view-specific write path, and by the new integration test directly asserting `getProjectBoardTasks` returns the updated status after calling `moveTaskStatus`. Since the board page (`app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx`) is a Server Component reading via `getProjectBoardTasks` on every navigation, and `moveTaskStatus`'s `revalidatePath(.../layout)` invalidates that route too, a real navigation to the board after a list-view status edit will show the new column — this was reasoned from the data layer + revalidation path rather than clicked through in a browser.
- The list view (F053–F057) is now fully complete: F053 (render), F054 (filters), F055 (due-date sort), F056 (empty state), F057 (inline status edit) are all implemented and tested. No further list-view work is expected in this milestone.
