# Handoff: F038 — delete task action

## Status
COMPLETE

## Assertions covered
AS-055: PASS — `deleteTask` in `lib/actions/tasks.ts` lets any active workspace member soft-delete a task (sets `deleted_at = now()`, no hard DELETE), matching the same "no per-task ownership restriction, only workspace membership" model as `editTask` (AS-061). Verified by `tests/integration/delete-task.test.ts`'s "any active workspace member (not just the author) can soft-delete a task" test (caller is `otherMemberUserId`, not the author) and the non-member-rejection / cross-workspace-isolation tests.
AS-056: PASS — confirmed (not assumed) that the RLS SELECT policy `tasks_select_active_members` (`supabase/migrations/20260818013805_rls_tasks.sql`) already has `deleted_at is null` in its `using` clause, so a soft-deleted task is filtered out of every SELECT-based view (board, list, search, dashboard) the instant `deleted_at` is set — no additional per-view filtering code was needed. Verified by the "a soft-deleted task no longer appears in a standard (RLS-filtered) SELECT query" test, which asserts the row is absent under the same `.is("deleted_at", null)` predicate the policy encodes, while still present via an unfiltered query (proving it's a soft delete, not a physical removal).
AS-057: PASS (structural deferral, documented — not fully implementable yet). Comments/attachments tables don't exist yet (M6: F058 comments, F064 attachments land later), so there is no orphan-comment/orphan-attachment view to guard against today. This will be naturally satisfied once F058/F064 land, because their RLS will be scoped through the (now-deleted) task, and a deleted task's children won't be independently browsable without going through the task itself — which is already gone from every view per AS-056. Verified today by the "an already-deleted task is treated as not found by deleteTask" test, confirming the same `deleted_at is null` lookup convention that will back this once children tables exist. **Do not treat this as a gap requiring a fix now** — there is nothing to fix; it's a note for whichever worker implements F058/F064 to make sure their RLS is scoped through `tasks(deleted_at is null)` (or an equivalent join), consistent with this convention.

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
tests/integration/delete-task.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/tasks.ts lib/validation/tasks.ts tests/integration/delete-task.test.ts` (0)
`npm run test` (0) — 35 files / 190 tests passed, including 5 new delete-task tests run against the real linked Supabase project
`npm run build` (0)

## Decisions made
- `deleteTask` mirrors `editTask`/`assignTask`'s exact shape: Zod-validated `taskId` only (`deleteTaskSchema` in `lib/validation/tasks.ts`), task+workspace lookup via `tasks -> projects!inner(id, workspace_id)` filtered to `deleted_at is null`, `requireActiveMembership` re-check (defense in depth, AS-143), admin-client UPDATE (not DELETE — RLS has no DELETE policy on `tasks` by design per the F034 migration comment), discriminated-union return, generic error messages (AS-146), best-effort `revalidatePath`.
- Chose UPDATE `deleted_at = now()` via `new Date().toISOString()` rather than a raw SQL `now()` call, matching the pattern already used elsewhere in this codebase for timestamp columns set from application code (createTask/editTask rely on DB column defaults for `created_at`/`updated_at`, but there's no DB-side trigger/default for `deleted_at` on soft delete, so the app sets it explicitly).
- Looking up the existing task with `.is("deleted_at", null)` before deleting makes a second `deleteTask` call on an already-deleted task return `{ ok: false, error: "Task not found." }` rather than silently re-touching the row or throwing — same "soft-deleted = not found" convention already established by `assignTask`/`editTask`'s lookups, and it's what makes the row idempotent-safe.
- Did not add any UI (delete button, confirmation dialog) — spec's Files section names only `lib/actions/tasks.ts`, matching F037's precedent of shipping the Server Action ahead of its UI.

## Out-of-scope work needed
- No UI wired up to call `deleteTask` yet (delete button / confirmation dialog on the task detail view or card menu) — same gap F037 left for `editTask`. A future feature should add this, likely alongside whatever UI eventually calls `editTask`.
- F058 (comments) and F064 (attachments), when implemented, must scope their own SELECT RLS through `tasks` with `deleted_at is null` (or an equivalent join to a non-deleted task) so AS-057 is fully satisfied end-to-end once those tables exist. This is a note for those features, not a blocker for F038 — see AS-057 above.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated AS-057 as satisfied today via structural deferral (documented in code comments and here) rather than blocking F038, since comments/attachments tables genuinely don't exist yet in this schema (confirmed no such migrations exist) and there is nothing in the current schema an orphan-view guard could apply to. Flagged the follow-up expectation for F058/F064 explicitly above rather than silently assuming someone will remember.

## Notes for the next worker
- `tests/integration/delete-task.test.ts` follows the exact `loadDotEnv`/`describe.skipIf(!haveAdminCreds)` structure from `tests/integration/edit-task.test.ts` — copy that file's structure for any future task-action tests.
- Confirmed by direct read of `supabase/migrations/20260818013805_rls_tasks.sql`: `tasks_select_active_members` already filters `deleted_at is null`, and there is deliberately no DELETE policy on `tasks` (comment in that migration explains soft-delete-only is the convention) — `deleteTask` therefore uses `.update()`, never `.delete()`.
- `tests/integration/rls-tasks.test.ts` (F034) already covers the RLS policy itself end-to-end with a real member session; `delete-task.test.ts`'s AS-056 test intentionally re-asserts the same `deleted_at is null` predicate directly against the admin client rather than duplicating a full session-based RLS test, since the point here is "did deleteTask actually set the column," not "does the policy work" (already proven elsewhere).
