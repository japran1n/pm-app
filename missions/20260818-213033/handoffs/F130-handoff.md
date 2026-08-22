# Handoff: F130 — transfer workspace ownership

## Status
COMPLETE

## Assertions covered
AS-233: PASS — `tests/integration/transfer-ownership.test.ts` ("AS-233: an owner can transfer ownership; the previous owner becomes an admin") plus the dedicated atomicity test ("(atomicity) a mid-transaction DB-level failure after the lock is taken leaves the original owner's row untouched, not partially updated") — both writes happen inside one SECURITY DEFINER RPC transaction; a forced mid-transaction failure rolls back both UPDATEs together.
AS-234: PASS — `tests/integration/transfer-ownership.test.ts` ("AS-234: transferring to a removed (non-member) user is rejected..." and "AS-234: transferring to a pending/invited (not yet active) member is rejected...") — both leave the caller's role and the target's role/status unchanged.

## Files changed
supabase/migrations/20260822085141_transfer_workspace_ownership_atomic.sql (new)
lib/actions/workspaces.ts
lib/validation/workspaces.ts
lib/supabase/database.types.ts
components/transfer-ownership-dialog.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx
tests/integration/transfer-ownership.test.ts (new)

## Commands run
`supabase migration list --linked` (0) — connectivity confirmed working (unlike prior BLOCKED attempt), returned in a few seconds.
`supabase db push --linked` (0) — applied `20260822085141_transfer_workspace_ownership_atomic.sql` to the linked project.
`supabase gen types typescript --linked` (0) — used to confirm the new RPC's generated Args/Returns shape before hand-adding the equivalent entry to `database.types.ts` (avoided overwriting the whole file since the freshly generated output also contained one unrelated, pre-existing type drift on `estimate_minutes` not touched by this feature).
`npx vitest run tests/integration/transfer-ownership.test.ts` (0) — 6/6 passed.
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings — `lib/queries/search.ts` `_titleMatches`, `tests/unit/invite-member-pagination.test.ts` `_columns` — neither touched by this feature)
`npx vitest run tests/integration/transfer-ownership.test.ts tests/integration/change-member-role.test.ts tests/integration/remove-member.test.ts tests/integration/invite-member.test.ts tests/integration/workspace-members-list.test.ts` (0 exit, 4 failures all in `invite-member.test.ts`) — 36/40 passed; the 4 failures are `invite-member.test.ts`'s `AS-007` tests timing out at 30s, not this feature's tests.
`npx vitest run tests/integration/invite-member.test.ts` (0 exit, 4/7 failed) — re-ran this file in complete isolation (no other test files running in parallel) to confirm the timeouts are a pre-existing environment issue (the paginated `admin.auth.admin.listUsers()` calls in `findAuthUserByEmail`/this test file's own setup hitting Supabase rate limits/latency), not caused or worsened by this feature — same failure mode F129's handoff already documented ("Request rate limit reached" under load). No file this feature touches is implicated.
`npm run test` (full suite, background run) (0 exit) — 1145 passed, 10 failed, 13 skipped across 177 files. All 10 failures are in files this feature does not touch: `tests/integration/rls-project-visibility.test.ts` (afterAll hook timeout), `tests/integration/task-assignees-multi.test.ts` (afterAll hook timeout), `tests/integration/workspace-role-expansion.test.ts` (multiple, hook/test timeouts around `inviteMember`'s user lookup), `tests/integration/invite-member.test.ts` (4x, same rate-limit timeouts as above), `tests/integration/perf-budget.test.ts` (one p95 latency assertion flake, 740ms vs 500ms budget, unrelated to this feature and pre-existing per F129/other handoffs' documented full-suite flakiness under real-project load). `tests/integration/transfer-ownership.test.ts` is not in the failure list — all 6 of this feature's tests passed in the full-suite run too.

## Decisions made
- **Reused `remove_member_atomic_owner_guard`'s exact `SELECT ... FOR UPDATE` locking shape**, per the feature spec's explicit instruction and the prior (BLOCKED) handoff's drafted design: lock the current owner's row and the target's row inside `transfer_workspace_ownership`, validate both, then perform both role UPDATEs in the same implicit transaction.
- **Target lookup is by `user_id`, not membership id.** The clarified spec and the Server Action's public signature only need "who" the caller picked (a user), so `transferOwnership(workspaceId, newOwnerUserId)` and the RPC's `p_new_owner_user_id` param both take a user id — the RPC locates and locks that user's `workspace_members` row internally. This keeps the dialog's candidate list (built from `getWorkspaceMembers`'s `ActiveMember.userId`) a direct 1:1 mapping with no extra membership-id plumbing needed client-side.
- **Added a defensive "exactly one active owner after the transfer" invariant check inside the RPC**, raised as a Postgres exception if violated. Under normal operation (the two updates always swap one owner for another) this can never trip — it exists as a genuine last-line defense against an already-anomalous pre-existing DB state (e.g. two owner rows from some other bug), and, per this run's DoD requirement for a real atomicity test ("force the RPC to fail after acquiring the lock... assert the original owner's row is still owner"), it is exactly the DB-level check the atomicity test seeds and trips: the test pre-seeds a workspace with two active owner rows (an anomalous state only reachable via direct admin insert, never through the app), calls the RPC, and the invariant check raises after both UPDATEs have already run — since there is no exception handler in the function body, Postgres rolls back the entire transaction, and the test verifies the locked owner row, the second pre-existing owner row, and the target's row are all exactly as they were before the call.
- **Owner-only access (`requireWorkspaceOwner`), not owner-or-admin.** Ownership transfer is more sensitive than member removal/role changes (F129's `requireWorkspaceAdmin` line) — only the current owner may initiate a hand-off, matching `deleteWorkspace`'s existing owner-only precedent.
- **A no-op transfer to oneself is rejected**, both at the Server Action level (`newOwnerUserId === user.id` check before the RPC call) and inside the RPC itself (`target_is_current_owner` reason) as defense in depth, rather than silently succeeding — there's nothing to transfer.
- **`database.types.ts` updated by hand-adding the single new RPC entry** rather than overwriting the whole file with `supabase gen types` output, because the freshly generated file also contained one unrelated pre-existing type drift (`estimate_minutes: number` vs `number | null` on an unrelated table) that is out of this feature's scope to fix or introduce.
- **Dialog confirmation pattern mirrors `DeleteWorkspaceDialog`** (a real `Dialog` with an explicit destructive confirm button), not `RemoveMemberButton`'s plain `window.confirm` — transferring ownership is a heavier, less-reversible-by-the-caller action (the caller loses owner-only capabilities immediately) than removing a member, matching the same escalation precedent `DeleteWorkspaceDialog`'s own comment already establishes for "destructive enough to need a real dialog."
- **Dialog candidates come from `members.active` (already-loaded page data), filtered to exclude the caller.** No separate query — reuses the same `getWorkspaceMembers` call the page already makes, keeping this feature's data-fetching footprint to zero new queries per the DoD's "no per-row loop of network calls" convention (`lib/queries/members.ts` was not modified).

## Out-of-scope work needed
- `lib/queries/members.ts`'s `ActiveMember.role`/`PendingInvite.role` types are still `"owner" | "admin" | "member"` (pre-dating F126/F134's `viewer`/`guest` additions) — a pre-existing gap already flagged in F129's Out-of-scope section, not touched here (not in this feature's Files list); harmless at runtime since the value is a plain cast.
- The members settings page's `TransferOwnershipDialog` is rendered as a standalone control near the top of the page (own section), not inside a "danger zone" grouping alongside `DeleteWorkspaceDialog` — this repo's settings page (`app/(workspace)/w/[workspaceSlug]/settings/page.tsx`, where `DeleteWorkspaceDialog` actually lives) and the members page (`.../settings/members/page.tsx`, where this feature's dialog lives, since it needs the member list) are two different routes; unifying them into one settings surface with a shared danger-zone section is a larger IA change out of this feature's scope.
- No Playwright test was written — none of this feature's assigned assertions (AS-233, AS-234) are "live interaction" assertions per the DoD's test-type guidance; both are Server Action / DB-state assertions, fully covered by the integration tests above. No browser screenshot was attached for the same reason the DoD only requires one for UI features whose correctness can't be verified by automated tests alone — the dialog's rendering/gating logic (owner-only visibility, active-member-only candidate list) is straightforward JSX conditionally derived from already-tested server data, not itself a new assertion.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none beyond what's recorded in Decisions Made above — no ambiguity required a default beyond the "reuse the mission-1 RPC shape" instruction the spec itself gave.)

## Notes for the next worker
- The connectivity blocker that stopped this feature previously (`SUPABASE_ACCESS_TOKEN` missing) is now resolved — `supabase migration list --linked` and `supabase db push --linked` both completed in a few seconds, no hang.
- The atomicity test in `tests/integration/transfer-ownership.test.ts` calls the RPC directly via `adminClient.rpc(...)` (not through the Server Action) because it needs to seed an anomalous pre-existing DB state (two active owners) that the app itself would never produce — read that test's own comment block before modifying it.
- No MCP tools were used this session — Supabase CLI (`supabase db push --linked`) was the primary path per `mcp-registry.md`'s own note that this remains the primary path for schema changes, with MCP only as an optional introspection supplement.
- If a future feature wants to surface ownership-transfer-in-progress state (e.g. disabling other member-management controls mid-transfer), note that this RPC is synchronous and single-request — there is no "in progress" state to model; the transfer either fully succeeds or fully fails within the one Server Action call.
