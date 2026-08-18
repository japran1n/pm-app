# Handoff: F062 — comment soft delete realtime

## Status
COMPLETE

## Assertions covered
AS-101: PASS — `reconcileComment` (lib/tasks/reconcile-realtime-comment.ts) removes a comment from local state the instant its Realtime UPDATE payload carries `deleted_at` set, regardless of which viewer performed the delete. Wired into components/task/comment-list.tsx via the new `useCommentsRealtime` hook, so a comment disappears from every open viewer's task view without a manual refresh. Covered by tests/unit/comment-realtime-subscription.test.ts (`AS_101_removes_comment_whose_update_payload_has_deleted_at_set`, `AS_101_removes_comment_on_hard_delete_event`, `AS_101_leaves_other_viewers_comments_untouched_when_a_different_comment_is_soft_deleted`).
AS-102: PASS — the reducer never reintroduces a row whose `deleted_at` is set, and the underlying "doesn't reappear after reload" guarantee is `comments_select_active_members`'s `deleted_at is null` filter (supabase/migrations/20260818040214_create_comments.sql), already covered by F058/F061's RLS/integration tests (tests/integration/rls-comments.test.ts, tests/integration/delete-comment.test.ts). This feature's wiring-specific slice is covered by `AS_102_does_not_reintroduce_a_soft_deleted_comment_after_a_simulated_reload` (simulates: comment deleted, viewer reloads to a state without the row per RLS, then a stale/replayed Realtime event for the already-deleted row arrives and is a no-op) and `AS_102_repeated_soft_delete_events_for_the_same_comment_stay_idempotent`.

## Files changed
supabase/migrations/20260818050000_realtime_comments_publication.sql
lib/tasks/reconcile-realtime-comment.ts
lib/tasks/subscribe-comments-realtime.ts
components/task/use-comments-realtime.ts
components/task/comment-list.tsx
tests/unit/comment-realtime-subscription.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 61 files, 341 tests passed, including the 8 new tests in tests/unit/comment-realtime-subscription.test.ts
`npm run build` (0)
`npx supabase db push --yes` — attempted to apply the new publication migration to the linked remote project (`qcipqonnqajmazdbysow`); see Notes below — the CLI hung with no output in this sandbox (likely no outbound network egress here), so the migration file exists in `supabase/migrations/` and is ready to apply but was not confirmed applied during this worker run.

## Decisions made
- Enabling Realtime on `comments` is a straight mirror of F049's tasks-publication migration (`supabase/migrations/20260818040000_realtime_tasks_publication.sql`): idempotent `pg_publication_tables` existence check, then `ALTER PUBLICATION supabase_realtime ADD TABLE public.comments`. No new RLS policy needed — Realtime respects the existing `comments_select_active_members` SELECT policy for postgres_changes broadcasts, same rationale as the tasks migration's comment.
- Followed the F049/F103 pattern exactly: a plain, React-free `subscribeToCommentsRealtime` function (unit-testable without a DOM) + a thin `"use client"` hook (`useCommentsRealtime`) that's just useEffect lifecycle glue, + a pure `reconcileComment` reducer mirroring `reconcileTask`'s shape (INSERT append / UPDATE replace-or-remove-if-soft-deleted / DELETE remove).
- Placed the new lib files under `lib/tasks/` (not `lib/board/`) since this is task-scoped, matching the existing `lib/tasks/is-overdue.ts` and the components/task/* pairing, rather than reusing the board-specific directory the spec's template happened to reference.
- The reducer also handles INSERT/plain-UPDATE (not just the soft-delete-removal path), even though F062 is only assigned AS-101/AS-102, because it's the same file F063 (AS-103, "new comments appear live") will extend — this makes F063 land as an additive change (new tests covering the INSERT path in the shared subscription/reconciliation file already used here) rather than needing to rewrite this file's shape. F062's own tests (`comment-realtime-subscription.test.ts`) only assert against its assigned assertions (AS-101/AS-102); the INSERT test present is a smoke test noting the shared-file rationale, not claimed as AS-103 coverage.
- Wired `useCommentsRealtime` directly into `comment-list.tsx` (the only place `TaskComment` local state lives, per F060's doc comment on why comments are a Client Component) rather than a page-level wrapper, since the hook's whole purpose is updating that component's local `localComments` state.

## Out-of-scope work needed
- F063 (AS-103, "new comments appear live for other users without a manual refresh") is a separate assigned feature targeting the same file (`components/task/use-comments-realtime.ts`) — not implemented here beyond what naturally falls out of `reconcileComment` already handling INSERT (see Decisions above). F063's worker should add assertion-specific tests for the append-on-INSERT-for-other-viewers scenario; the subscription/reconciliation plumbing is already in place and should not need reshaping.
- True end-to-end Realtime delivery (two concurrent Supabase Realtime connections, one deletes, the other observes a live removal over the wire) is not covered by this unit suite, same limitation F049's handoff/tests note for tasks — that class of coverage belongs in a Playwright/e2e test with two browser contexts if the mission wants it; not requested by F062's definition of done (which only requires the automated test referencing the assertion IDs).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose `lib/tasks/` over `lib/board/` for the new reconciliation/subscription helper files, since the spec's "Files (approximate)" section only named the hook path (`components/task/use-comments-realtime.ts`) and the codebase's existing directory convention groups task-scoped logic under `lib/tasks/` (e.g. `lib/tasks/is-overdue.ts`), distinct from the board-specific `lib/board/` used by F049's tasks-table equivalent.
AUTONOMOUS_DECISION: `npx supabase db push --yes` hung without output in this sandbox environment (repeated attempts, both with and without `--yes`, and `supabase migration list` also hung) — most likely no outbound network egress to the Supabase project from this worker's sandbox, since prior migrations in this repo's history clearly required real connectivity to have been applied by other workers. The migration file itself (`supabase/migrations/20260818050000_realtime_comments_publication.sql`) is correct, idempotent, and matches the already-applied F049 tasks-publication migration's exact pattern; it needs `supabase db push` run once from an environment with outbound network access to the linked project (`qcipqonnqajmazdbysow`) before AS-101's postgres_changes events will actually fire for `comments` in production/staging. All code and tests pass and do not depend on the migration having been applied yet (the mock-Supabase-client unit tests don't touch the real network).

## Notes for the next worker
- Pattern source: `lib/board/reconcile-realtime-task.ts` (F049/F103) and `components/board/use-board-realtime.ts` (F049) — read those first, this feature is a close structural mirror for the `comments` table instead of `tasks`.
- If `npx supabase db push` also hangs for you in this sandbox, that's a known environment limitation observed during this run, not a code issue — try from the orchestrator's environment (`/mission-connect`'s already-verified `supabase link` should still be valid) or re-run `npx supabase db push --yes` from a network-enabled shell.
- MCP: `mcp__supabase__*` tools were not present as callable tools in this worker's session (per `connections/mcp-registry.md`, Supabase MCP is "Optional" and CLI is the primary path) — proceeded via CLI only, per the registry's guidance not to block on MCP approval.

## Orchestrator note (post-handoff)
The 20260818050000_realtime_comments_publication.sql migration failed to apply from the worker's sandbox (no network egress). Applied by the orchestrator via `supabase db push` at 2026-08-18T06:22Z — confirmed present in `supabase migration list` remote column. No code changes needed; this was purely an apply-step gap, not a logic defect.
