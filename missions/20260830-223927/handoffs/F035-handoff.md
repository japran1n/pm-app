# Handoff: F035 — Fix AS-016: F032 passed PersonalTodo ids instead of Task ids

## Status
COMPLETE

## Assertions covered
AS-016: PASS — verified with `tests/unit/personal-todo-list-realtime-wiring.test.tsx`'s "AS-016" test, which now seeds `initialTaskIds={["task-1"]}` (a real task id, distinct from the personal-todo's `"todo-1"`) and drives a real `tasks` UPDATE `postgres_changes` payload for `id: "task-1"` through the mocked channel, asserting `router.refresh()` fires. Before the fix this test used `"todo-1"` for both, which masked the bug (the tracked-id set happened to contain the same string used in the payload even though it came from the wrong table).

## Files changed
components/my-tasks/personal-todo-list.tsx
app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx
tests/unit/personal-todo-list-realtime-wiring.test.tsx

## Commands run
`npx vitest run tests/unit/personal-todo-list-realtime-wiring.test.tsx tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` (0, 15 passed)
`npm run lint` (0, 0 errors / pre-existing warnings only, none new)
`npx tsc --noEmit` (0)
`npm test` (0 — process exit code; 2506 passed / 82 failed across 55 files, see Notes — none of the 82 failures touch the files this feature changed)

## Decisions made
- Added a new optional `initialTaskIds?: string[]` prop to `<PersonalTodoList>` rather than reaching into `getMyTasks`'s buckets inside the component, since the component has no server access and the buckets are already fetched by the page. This matches the existing "resolve once, thread down" convention used elsewhere on `my-tasks/page.tsx` (e.g. `timezone`).
- Computed `allTaskIds` once in `MyTasksPage` (flatMap over `BUCKET_ORDER` against `realBuckets`) and passed it to both `<PersonalTodoList>` render sites (the zero-task empty-state branch and the normal branch) — the empty-state branch naturally yields an empty array, which is the hook's documented safe default.
- Did not touch `use-my-tasks-realtime.ts` itself — its `initialTaskIds` contract (F008/F025/AS-018) was already correct; the bug was purely in what the caller passed.
- Fixed the test fixture to use distinct ids (`todo-1` for the personal-todo row, `task-1` for the seeded/real task id in the AS-016 and AS-018 "already visible" tests) so the test would have caught the original bug (payload id must match a seeded `initialTaskIds` entry, not merely reuse the todo's own id).

## Out-of-scope work needed
None identified for this fix. The rest of the realtime wiring (AS-015, AS-017, AS-018 assignment/unassignment/delete via `task_assignees`) was unaffected by this bug and is unchanged.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new prop `initialTaskIds` (matching the underlying hook's own prop name) rather than something more todo-list-specific, since it's a direct pass-through to `useMyTasksRealtime`'s existing `initialTaskIds` option — keeping the names aligned avoids an extra indirection for future readers tracing the prop through the component.

## Notes for the next worker
- The full `npm test` run (2506 passed / 82 failed / 194 skipped across 386 files) has pre-existing, unrelated failures on this working tree — none in files this feature touched. Spot-checked two: (1) `tests/integration/task-assignees-multi.test.ts` fails on a `tasks.assignee_id` mirror-column assertion unrelated to My Tasks/personal todos; (2) `tests/integration/workspace-members-list.test.ts` fails with "Request rate limit reached" signing in a test user against the live Supabase auth service — an environmental/rate-limit issue, not a code regression. The working tree also has unstaged changes to `components/command/command-palette.tsx`, `lib/hooks/use-palette-search-realtime.ts`, and `tests/unit/f034-fix-realtime-bugs.test.ts` from a different in-flight feature (F034) that this handoff does not touch or claim.
- No MCP tools were needed for this fix — it's pure client-component prop wiring; no schema/live-state introspection was required.
