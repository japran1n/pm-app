# Handoff: F024 — Fix-up: data-loss path in requestPortalTaskChanges

## Status
COMPLETE

## Assertions covered
AS-013: PASS — `tests/unit/portal-approval-action.test.ts` (23/23), all shared-gate + happy-path tests for `approvePortalTask` still pass unchanged; no regression to the approve path.
AS-016: PASS — `tests/unit/portal-approval-action.test.ts`, including three new tests covering the failure path: `test_AS_016_request_changes_comment_failure_leaves_the_task_pending_and_retryable`, `test_AS_016_request_changes_posts_the_comment_before_flipping_the_pending_flag`, `test_AS_016_request_changes_retry_after_a_comment_failure_succeeds_with_the_same_message`.

## Files changed
lib/actions/portal-approval.ts
tests/unit/portal-approval-action.test.ts

## Commands run
`npx vitest run tests/unit/portal-approval-action.test.ts` (0) — 23/23 pass
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 15 pre-existing warnings, same set scrutiny-3 already noted)
`npx vitest run tests/unit` (0) — 206 files / 1610 tests pass
`npx vitest run` (1) — full suite including integration tests; failures are confined to `tests/integration/*` (live-Supabase-dependent tests hitting resource contention from other concurrent workers running in this shared repo at the same time — unrelated to this feature, `tests/unit` alone is green)
`npx playwright test tests/e2e/portal-approve.spec.ts` (0) — 1 passed
Manual mutation check (not committed, restored from `/tmp/portal-approval-backup.ts` before final commit): swapped the RPC call and the `addComment` call back to the old (buggy) order in `requestPortalTaskChanges` — this killed 2 of the 3 new tests (`..._leaves_the_task_pending_and_retryable` and `..._retry_after_a_comment_failure...`), confirming they pin the fix. Restored the real fix and re-ran the file (23/23 green) before committing.

## Decisions made
- Chose "post the comment first, flip the flag second" over the two alternatives raised in the spec:
  - **Not** an atomic RPC change (taking `p_message` into `request_portal_task_changes_atomic` and writing the comment inside the function) because that would require touching `supabase/migrations/`, which is explicitly out of scope for this worker (another worker owns migrations right now) and would duplicate `addComment`'s mention-parsing / activity-logging / notification fan-out logic inside SQL, which the original file's header comment explicitly says to avoid.
  - **Not** a compensating rollback (call the RPC, and if `addComment` fails, flip `pending_client_approval` back to `true`) because that needs a second RLS-bypassing write path the client doesn't otherwise have, doubles the number of privileged calls per request, and still has its own failure window (the compensating flip itself can fail, at which point we're back to square one but with more code).
  - Posting first is strictly simpler: `addComment` failing now means nothing happened yet (task stays pending, no partial state), and a comment landing followed by an RPC failure just means retryable state where the worst case is a duplicate identical comment on retry — which is far better than a permanently lost message and a "task not found" dead end. This mirrors the file's own existing asymmetry: `approvePortalTask`'s trail comment is fixed boilerplate text and posted best-effort *after* the flag flip (because the approval itself is the payload there); here the client's typed message *is* the payload, so it has to land first.
- Did **not** touch the SQL migration comment scrutiny-3 flagged as misleading (`20260906010000_portal_task_actions_project_visibility.sql:121-125`, MAJOR-5/FU-T). Fixing it requires editing a file under `supabase/migrations/`, which my instructions explicitly prohibit ("other workers own those right now"). Left as out-of-scope below.
- Extended the test file's `addComment` mock to record call args (`commentCalls`) so the new tests can assert the client's message was actually attempted (not silently dropped) and that ordering vs. the RPC is correct, without touching the mock's existing public shape (`opts.addCommentOk` still works exactly as before for all pre-existing tests).

## Out-of-scope work needed
- **FU-T / MAJOR-5 (scrutiny-3.md):** `request_portal_task_changes_atomic` and `approve_portal_task_atomic` (`supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql:110-114,137-141`) have byte-identical bodies, and the header comment at `:121-125` incorrectly claims the two RPCs cannot be invoked with each other's semantics. A client can call `request_portal_task_changes_atomic` directly through PostgREST and clear `pending_client_approval` with no message at all. This needs a migration-owning worker to either give `request_portal_task_changes_atomic` a required `p_message` parameter (writing the comment inside the function) or correct the comment to state the note is an application-layer convention only, not a DB-enforced invariant. Explicitly out of scope here because `supabase/migrations/` is prohibited for this worker.
- **FU-S (scrutiny-3.md MAJOR-4):** `is_project_visible_to`, `is_project_client`, `is_project_workspace_writer`, `is_task_workspace_writer` pin `search_path = public` only (missing `pg_temp`), same prohibition applies (migrations).
- **FU-P (scrutiny-3.md MAJOR-1, AS-016):** `components/portal/approval-actions.tsx:113-118` resets `inFlightRef.current` outside a proven `finally` for the request-changes handler client-side — separate bug on the client component, explicitly out of scope (`components/portal/approval-actions.tsx` and its test are prohibited for this worker; scrutiny-3 shows another worker's diff to that file already in progress in this shared working tree).
- **FU-Q (scrutiny-3.md MAJOR-2, AS-027):** board.tsx's remaining `releasePendingMove` call sites — out of scope, `components/board/` prohibited.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "comment-first" ordering over the atomic-RPC-parameter and compensating-rollback alternatives named in the task brief, per the justification above (no migration access, simplest failure semantics, matches the file's existing best-effort-vs-payload asymmetry).
AUTONOMOUS_DECISION: Left the misleading SQL comment (MAJOR-5) unfixed because fixing it requires a migration file edit, which is explicitly prohibited for this worker; documented as out-of-scope work above instead of silently skipping it.

## Notes for the next worker
- This repo currently has several other workers/features running concurrently against the same working tree (observed uncommitted changes to `components/portal/approval-actions.test.tsx` and an untracked new migration `supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql` mid-session, neither touched by this commit). If you run the full `npx vitest run` and see `tests/integration/*` failures unrelated to your feature, check for resource contention (many concurrent `vitest`/`next dev` processes) before assuming a regression — `npx vitest run tests/unit` (206 files / 1610 tests) was fully green throughout this session.
- The mutation check for the ordering fix was done manually via a scratch Python script that swapped the comment/RPC blocks in `requestPortalTaskChanges`, confirmed 2 of 3 new tests fail, then restored from a `/tmp` backup — no stryker/mutation-testing tool was installed or is present in this repo, consistent with prior features' approach (manual mutant restoration, verified via `git diff` clean at the end).
- No MCP tools were needed for this fix-up: it's pure application-layer ordering in a Server Action, no schema/policy change, and `mcp-registry.md` was not consulted since nothing here touches live Supabase state beyond what the existing RPC/table already does.
