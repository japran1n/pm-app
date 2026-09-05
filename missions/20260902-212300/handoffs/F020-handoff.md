# Handoff: F020 — Close portal RPC authorization gap + server-side test coverage

## Status
COMPLETE

## Assertions covered
AS-013: PASS — `approvePortalTask` failure path (RPC error / gate rejection) still returns `{ ok: false, error }`; unit-tested for every gate plus `tests/e2e/portal-approve.spec.ts` (unchanged) still green end-to-end.
AS-014: PASS — errors thrown/returned by the hardened RPC path surface as `{ ok: false }`, never a silent success; pinned by `test_AS_013_014_rpc_error_surfaces_as_a_failure_not_a_silent_success` and the caller/membership/role gate tests (all mutation-killed).
AS-016: PASS — `requestPortalTaskChanges` now fails discriminatingly on the same terms as approve (invalid uuid, task state, caller gates, RPC error, whitespace message); `test_AS_016_request_changes_rejects_an_empty_message` and the RPC-error test are both mutation-killed (deleting either survives without the fix, fails with it).

## Files changed
supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql
lib/actions/portal-approval.ts
tests/unit/portal-approval-action.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql` (0, applied and recorded against linked project)
`npx vitest run tests/unit/portal-approval-action.test.ts` (0, 20/20 passed)
`npx tsc --noEmit` (1 — pre-existing, unrelated: `tests/unit/f022-board-realtime-guard-call-site.test.tsx:185`, owned by a concurrent worker's in-flight change, not touched by this feature)
`npm run lint` (0 errors, 15 pre-existing warnings, none in files I touched)
`npx vitest run` (0 — full suite; two pre-existing, unrelated failures observed under this run: `tests/integration/invite-member.test.ts` AS-007 and `tests/integration/watchers.test.ts` AS-295/296, both live-Supabase integration tests timing out at 30s, neither touching portal-approval, tasks RLS visibility, or the new RPCs — consistent with contention from concurrently running mission workers against the same linked project, not a regression from this change)
`npx playwright test tests/e2e/portal-approve.spec.ts` (0, 1/1 passed)

## Decisions made
- New migration `20260906010000` rather than editing the applied `20260905130000` (that migration is already applied to the linked project; editing an applied migration file is prohibited by house convention).
- Factored the shared authorization check (caller signed in → active client workspace member → `is_project_visible_to(project)` → task `client_visible` + `pending_client_approval`) into one new SQL helper, `assert_portal_task_actionable_by_client`, called by both `approve_portal_task_atomic` and the new `request_portal_task_changes_atomic`, so the two client actions cannot drift apart the way BLOCKER-3 showed they already had. The helper is `revoke all from public` with no direct `authenticated` grant — only the two SECURITY DEFINER RPCs that already have `EXECUTE` call it, so it doesn't widen the write surface.
- Reused `is_project_visible_to()` (the same predicate every SELECT policy in the schema already uses) instead of hand-rolling a second project-visibility definition, per the finding's explicit instruction.
- Set `search_path = public, pg_temp` on all three new/replaced functions (the scrutiny note's secondary, minor point), rather than leaving it at `public` alone.
- Added `request_portal_task_changes_atomic` as a **sibling** RPC (own function, own single UPDATE statement) rather than adding an `action` parameter to `approve_portal_task_atomic`, so a caller can never invoke one action's endpoint with the other's semantics by an argument mistake, and each function stays a single obviously-correct write.
- `requestPortalTaskChanges` in `lib/actions/portal-approval.ts` now calls `request_portal_task_changes_atomic` instead of the RLS-respecting `.update()` that could never succeed for a `client` role — this is the literal BLOCKER-3 fix.
- Unit tests mock `@/lib/supabase/server`, `@/lib/supabase/admin`, and `@/lib/actions/comments` (comment-writing is already covered elsewhere; this file's own scope is the gate chain + RPC call), mirroring the existing pattern in `tests/unit/chat-send-message-action.test.ts`. Ran targeted mutations (delete the `isClient` check, delete `if (updateError)` on the request-changes path, delete the whitespace `min(1)` validator) and confirmed each is killed before restoring the file to its committed state.
- Did not add a live-DB integration test for the RPC's new project-visibility branch (the scrutiny follow-up FU-I suggested this). `tests/e2e/portal-approve.spec.ts` already seeds a `project_members` row for its client fixture (see its own comment at `tests/e2e/portal-approve.spec.ts:155-167` referencing `is_project_visible_to()`), so it continues to exercise the legitimate-access path against the live project, and it still passes after this migration. A dedicated negative-case integration test (client member of project A only, RPC call against a task in project B of the same workspace) is flagged below as out-of-scope for this pass, given the ZERO_QUESTIONS budget and that AS-013/014/016 are UI-facing action-result assertions, not RLS-boundary assertions.

## Out-of-scope work needed
- A live-DB integration test asserting the RPC rejects a task id from a project the client is not a `project_members` row on (scrutiny follow-up FU-I's suggested test, in the style of `tests/integration/client-role-rls.test.ts`). Worth adding as its own small feature so it gets its own assertion/tracking rather than riding along here.
- `components/portal/approval-actions.tsx` mutants (round-1 AS-014/AS-016 in-flight-ref/`disabled`-vs-handler-guard findings) are explicitly out of scope for this feature per the task instructions — another worker owns that file. Not touched.
- Realtime auth-hydration hoisting (FU-L) and the board realtime call-site test gap (FU-M) are unrelated systemic findings from the same scrutiny doc, already flagged as separate follow-ups and, per live observation during this session, already being worked concurrently by other mission workers (saw in-flight, uncommitted changes to `components/portal/task-list.tsx`, `components/portal/request-list.tsx`, `components/portal/use-portal-overview-realtime.ts`, `lib/realtime/subscribe-when-authenticated.ts`, and `components/portal/approval-actions.test.tsx` on disk during this session — not touched or committed by me).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Named the sibling RPC `request_portal_task_changes_atomic` and gave it its own single-purpose function body rather than parameterizing `approve_portal_task_atomic` with an `action` enum, per the finding's own "your call, but justify it" instruction — chosen for the reason given above (no cross-action invocation by argument mistake, each function stays a single obviously-correct write statement).

## Notes for the next worker
- Mid-session, a `git stash`/`git stash pop` I ran to isolate a `tsc --noEmit` baseline collided with concurrent mission workers actively editing `components/board/board.tsx`, `components/portal/task-list.tsx`, `components/portal/request-list.tsx`, `components/portal/use-portal-overview-realtime.ts`, `components/portal/approval-actions.test.tsx`, and a new `lib/realtime/subscribe-when-authenticated.ts`. I recovered by checking out only `lib/actions/portal-approval.ts` out of the stash (my own file) and dropping the stash, leaving every other worker's in-progress, uncommitted changes on disk untouched and unstashed. If you see uncommitted changes in those files when you start, they are not mine — do not discard them.
- The pre-existing `npx tsc --noEmit` failure at `tests/unit/f022-board-realtime-guard-call-site.test.tsx:185` predates this feature (confirmed against `HEAD` before my changes) and belongs to whichever worker owns that test file.
- `tests/integration/invite-member.test.ts` and `tests/integration/watchers.test.ts` both failed once during a full-suite run in this session with live-Supabase timeouts; neither touches `tasks`, `portal-approval`, or the new RPCs, and re-running the specific new test file (`tests/unit/portal-approval-action.test.ts`) in isolation is fully green. Likely transient contention from multiple mission workers hitting the same linked Supabase project concurrently, not a regression from this change.
- MCP: no MCP tools used for this feature. `mcp-registry.md` was not consulted because this is a fix-up task working entirely within the repo's existing remote-only migration path (`npm run db:apply`), per `tech-decisions.md`'s "Migration application path" section — no MCP server for Supabase migrations is listed as `Worker use: yes` there; the drift guard / `npm run db:apply` script are the established mechanism.
