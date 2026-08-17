# Handoff: F016 — invite accept on signin

## Status
COMPLETE

## Assertions covered
AS-008: PASS — `tests/integration/invite-accept-on-signin.test.ts`: "AS-008: an invited email that signs in is granted active membership, no separate signup token" and the multi-workspace variant both pass against the live linked Supabase project.
AS-009: PASS — same file: "AS-009 (failure case): a not-yet-invited user's sign-in does not activate anything" and the concurrent-duplicate-claim test both pass.

## Files changed
lib/actions/invites.ts
app/(auth)/auth/callback/route.ts
tests/integration/invite-accept-on-signin.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 9 test files, 49 tests passed, including the 4 new ones run live against Supabase (admin creds present in `.env`, so `describe.skipIf` did not skip)
`npm run build` (0)

## Decisions made
- Extracted the activation logic into `activateInvitedMemberships(userId, email)` in `lib/actions/invites.ts` rather than inlining it in the route handler, so it's directly unit/integration-testable without driving a real magic-link callback through a browser.
- Used the secret-key admin client (`createAdminClient`), not the session client, to perform the SELECT+UPDATE. `workspace_members` has no UPDATE RLS policy (see `supabase/migrations/20260817222822_rls_workspaces.sql`), and even if it did, a freshly authenticated user isn't a member of anything yet so a session-scoped policy couldn't match the invited row anyway. Same rationale F013 used for the admin client on workspace bootstrap.
- Claiming is done via UPDATE, not INSERT: each pending row is fetched by id, then updated with `.eq("id", row.id).is("user_id", null)`. If two callbacks race for the same invite, only the first UPDATE actually matches (second one matches zero rows because user_id is no longer null), so the row is claimed exactly once. This is on top of, not instead of, the F011 unique constraint on `(workspace_id, user_id)`, which is a second line of defense against ending up with two rows for the same user in the same workspace.
- `invited_email` is left in place after activation (not cleared) as an audit trail of the original invite address. `user_id` and `status` are what actually govern access/AS-009 visibility, so leaving `invited_email` set doesn't affect correctness.
- Activation runs unconditionally on every callback (guarded only by `user.email` being present), immediately after `getUser()` and before the existing membership-count redirect logic, so newly-activated memberships are correctly counted by the code that already existed.
- Iterated rows sequentially in a for-loop rather than `Promise.all`, since each activation is an independent write and sequential execution keeps error handling per-row simple; invite counts per user are expected to be small (a handful of workspaces at most), so this isn't a performance concern.

## Out-of-scope work needed
None identified beyond this feature's assigned scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to leave `invited_email` set after activation rather than clearing it, per the task's explicit "your choice, document it" — reasoned it's more useful as an audit trail than as a strictly-necessary-to-clear field, since no assertion or downstream code reads `invited_email` to determine active-membership status (that's `status` + `user_id`).

## Notes for the next worker
- `activateInvitedMemberships` returns `ActivatedMembership[]` (currently just `{ workspaceId }`) in case a future feature wants to show "you were just added to N workspaces" UI on first login — not currently consumed by the route beyond triggering the side effect.
- The route only calls activation when `user.email` is truthy; Supabase auth users can in principle lack an email (e.g. phone-only auth), which this app doesn't currently use, so this is a defensive no-op guard rather than a real gap.
- No RLS policy was added; if a future feature needs the *client* (not just the server) to update workspace_members directly (e.g. a "leave workspace" self-service action), that will need its own scoped UPDATE policy — this feature deliberately kept using the admin-client pattern already established by F013 rather than opening up client-writable RLS.
