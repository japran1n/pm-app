# Handoff: F015 — invite member action

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `tests/integration/invite-member.test.ts` "AS-007: an owner can invite a user by email, creating an invited workspace_members row" and the parallel admin-role test both ran against the real linked Supabase project and assert the resulting `workspace_members` row has `status: "invited"`, `invited_email` set, and `user_id: null`.

## Files changed
lib/actions/workspaces.ts
lib/validation/workspaces.ts
lib/auth/require-membership.ts
tests/integration/invite-member.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 8 files / 45 tests passed, including 7 new AS-007 integration tests run against the real Supabase project (not skipped — `.env` has admin creds)
`npm run build` (0)

## Decisions made
- **New shared helper `lib/auth/require-membership.ts`** (`requireActiveMembership`, `requireWorkspaceAdmin`) rather than inlining the role check in `inviteMember` — tech-decisions.md's Clarified implementation names this exact file/shape ("membership re-verified server-side via a shared `lib/auth/require-membership.ts` helper"), and it did not exist yet (F013 didn't need a role check, only membership creation). Takes the admin client so the check can't be silently defeated by an incomplete RLS policy on `workspace_members` — it independently re-derives owner/admin status from the database rather than trusting a client-passed role.
- **Both the caller's own membership check and the invite insert use the admin client**, matching F013's precedent: `workspace_members` has no client-facing INSERT policy at all (F012 deliberately left it fully closed pending an invite/accept feature), so the RLS-respecting cookie client cannot perform this insert regardless; the admin client is the only path, and it's the same client the server-side re-check uses so there's no risk of the check and the write disagreeing about what's true.
- **Duplicate-detection strategy:** two lookups before insert — (1) any existing row in the workspace with this `invited_email` (covers a still-pending invite and, per F011's schema note, an already-accepted invite whose `invited_email` column is left in place after backfill), and (2) if the email belongs to an existing auth user, that user's own `workspace_members` row by `user_id` (covers an active member whose row was seeded directly with a `user_id` and no `invited_email`, e.g. F013's owner-creation flow, which never sets `invited_email`). Both a partial-index race (`workspace_members_workspace_invited_email_unique`) and the pre-check's Postgres error code `23505` are handled as a fallback for the pre-check-then-insert race window.
- **`revalidatePath` wrapped in try/catch, non-fatal.** `revalidatePath` throws "static generation store missing" when called outside an active Next.js request/render context; the integration tests invoke `inviteMember` directly (same pattern as F013's tests), so this would otherwise fail an already-successful invite in tests. The invite's database write is the source of truth; a failed cache revalidation is logged and does not change the returned result.
- **Error messages distinguish "already invited" vs "already a member"** rather than one generic "duplicate" message, since the DoD's failure test explicitly calls out both cases as distinct scenarios to assert against.
- **`inviteMemberSchema` lowercases/trims the email** (`z.string().trim().toLowerCase().email()`) so invite-email matching and lookup against auth user emails (which Supabase stores case-normalized) can't diverge on casing.

## Out-of-scope work needed
- No UI form for inviting members exists yet (`app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx` per tech-decisions.md's file layout is not yet built). This feature is the Server Action only, per its spec's file scope (`lib/actions/workspaces.ts`).
- AS-008/AS-009 (invited email auto-activates on magic-link sign-in; invited-but-not-signed-in doesn't show as active) are separate assertions for a later feature — `inviteMember` only creates the `invited` row; nothing here backfills `user_id`/flips `status` on accept.
- `admin.auth.admin.listUsers()` is called without pagination for the by-user-id duplicate check; at v1 scale (discovery's stated scope) this is fine, but if the user base grows large this lookup should be replaced with a more targeted query (e.g. a Postgres function joining `auth.users` by email) rather than listing all users.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: role for a new invite row is fixed at `'member'` — the spec/assertion only says "invite a user by email," with no mention of choosing the invitee's role at invite time, and no other assertion in this milestone's range (AS-005..012) mentions role selection during invite. `'member'` is the table's own `default 'member'`, so this also matches the schema's own baseline.

## Notes for the next worker
- Follows F013's `createWorkspace` pattern closely: discriminated-union result, admin client for the actual writes, `console.error` on unexpected failures forwarded to Sentry via the SDK's automatic instrumentation, generic safe messages for unexpected errors but specific ones for the two duplicate cases (not a raw DB error).
- The integration test (`tests/integration/invite-member.test.ts`) mocks `@/lib/supabase/server`'s `createClient()` the same way F013's test does, and seeds owner/admin/member throwaway users + workspaces directly via the admin client, cleaning up in `afterAll`.
- MCP used: none (no Supabase MCP tool access was available in this worker's session; verification was done by running the real integration tests against the linked project via `.env` credentials instead, matching F013's note on the same point).
