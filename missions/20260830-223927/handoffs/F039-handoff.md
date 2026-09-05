# Handoff: F039 — Fix AS-018: My Tasks hook must filter task events to current user

## Status
COMPLETE

## Assertions covered
AS-018: PASS — verified via `tests/unit/f008-my-tasks-realtime.test.ts` (14/14 passing), including the exact case the scrutiny finding calls out: a `task_assignees` DELETE event for a different `user_id` does NOT trigger `onUnassigned` (test: "does not call onUnassigned when a task_assignees DELETE is for a different user"), and a DELETE for the current user's `user_id` DOES trigger it (test: "AS-017: calls onUnassigned when a task_assignees row is DELETEd for this user"). `tasks` table UPDATE/DELETE events are also verified to only propagate for tracked task ids (tests "AS-018: does NOT call onUpdate/onDelete for a tasks row ... that's RLS-visible but never tracked").

## Files changed
(none — see Decisions made)

## Commands run
`npx vitest run tests/unit/f008-my-tasks-realtime.test.ts` (0) — 14 passed
`npx eslint components/my-tasks/use-my-tasks-realtime.ts tests/unit/f008-my-tasks-realtime.test.ts` (0) — no output, clean
`npx tsc --noEmit` (0) — no output, clean
`git status --short components/my-tasks/use-my-tasks-realtime.ts tests/unit/f008-my-tasks-realtime.test.ts` — empty (no local changes; working tree clean on both files)

## Decisions made
- Read `components/my-tasks/use-my-tasks-realtime.ts` fully (264 lines) before touching anything, per instructions.
- Found that the exact fix described in the scrutiny finding — checking `payload.old.user_id === currentUserId` before invoking any `task_assignees` DELETE callback — is already present in the current codebase at lines 172-178 (`subscribeToMyTasksRealtime`, DELETE case for `task_assignees`): `if (!hasValidTaskAssignee(event.old)) return; const row = event.old as TaskAssigneeRow; if (row.user_id !== userId) return;`. The same guard exists symmetrically on the INSERT case (lines 164-170) for `onAssigned`.
- Traced git history (`git log --oneline -- components/my-tasks/use-my-tasks-realtime.ts`): F008 (37d4173) introduced the original hook; F025 (7310b9a) moved assignment tracking to the `task_assignees` join table; F031 (cd92a07, commit message explicitly lists AS-018) added the `trackedTaskIds` scoping plus the `user_id !== userId` guards on both INSERT and DELETE. F031's handoff and code comments (lines 120-128, 185-189, 229-234 of the current file) show this was a deliberate, documented fix for the exact "replica identity full broadcasts assigned_by/user_id on every un-assignment" concern named in this feature's finding.
- Confirmed `use-my-tasks-realtime.ts` is called from `components/my-tasks/personal-todo-list.tsx` with `userId` sourced from the authenticated session (not searched further since the guard is enforced inside the hook itself, independent of the caller).
- Verified the required test already exists in `tests/unit/f008-my-tasks-realtime.test.ts`: "does not call onUnassigned when a task_assignees DELETE is for a different user" (asserts `onUnassigned` is NOT called for `user_id: "user-2"` when subscribed as `"user-1"`) sits directly alongside "AS-017: calls onUnassigned when a task_assignees row is DELETEd for this user" (asserts it IS called for the matching `user_id`). No new test was needed — the coverage the feature spec asked for was already written as part of F031.
- Ran the full targeted test file, lint, and typecheck to confirm nothing regressed and the fix is genuinely in place today (not just historically) — all clean, so no commit was made since there is nothing to change (git status on the two relevant files is empty).

## Out-of-scope work needed
None identified for this fix. General note (not a new blocker): the wider question of whether other Realtime hooks in the codebase (e.g. board, chat) have equivalent `replica identity full` DELETE-broadcast risks was not investigated here — that would be a separate audit feature (e.g. "audit all postgres_changes DELETE handlers for user_id/scope filtering on payload.old") if the orchestrator wants blanket coverage beyond My Tasks.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Determined via git history and existing test coverage that the fix requested by this feature spec was already implemented and tested by a prior feature (F031, commit cd92a07, which explicitly lists AS-018 in its commit message). Rather than re-implementing or duplicating the guard/test, verified the existing implementation and tests satisfy the assertion exactly as specified (per-user_id check on `task_assignees` DELETE before callback invocation, with both positive and negative test cases), and reported COMPLETE with no file changes rather than introducing redundant code.

## Notes for the next worker
- The guard logic lives in `subscribeToMyTasksRealtime` in `components/my-tasks/use-my-tasks-realtime.ts`, not in the `useMyTasksRealtime` React hook wrapper — the wrapper just supplies `userId` and the `trackedTaskIdsRef`.
- If a future scrutiny pass flags this again, check `git blame`/`git log` on the file first — this exact concern (replica-identity-full broadcasting `user_id` on every row regardless of relevance) has already been fixed twice in this hook's history (once for `tasks.assignee_id` filter limitations in F025, once for the `task_assignees` per-user scoping plus `tasks` UPDATE/DELETE tracked-id scoping in F031). It is possible the scrutiny finding was generated against a stale snapshot of the file predating F031's commit (cd92a07).
- No MCP tools were used — this was a pure code/test verification task with no live schema or external service interaction required.
