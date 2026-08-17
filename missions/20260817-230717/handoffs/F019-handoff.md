# Handoff: F019 — change member role action

## Status
COMPLETE

## Assertions covered
AS-014: PASS — owner can change a member's role member<->admin (tests/integration/change-member-role.test.ts)
AS-015: PASS — member cannot change roles; rejected server-side even calling the action directly
AS-019: PASS — admin (not just member) is also rejected server-side; only owner may change roles

## Files changed
lib/actions/workspaces.ts
lib/validation/workspaces.ts
lib/auth/require-membership.ts
components/member-role-select.tsx
app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx
tests/integration/change-member-role.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm test` (0) — 65 passed across 12 files, including the new 8
`npx vitest run tests/integration/change-member-role.test.ts` (0) — 8/8 passed against the real linked Supabase project
`npm run build` (0)

## Decisions made
- Added a new `requireWorkspaceOwner` helper alongside the existing `requireWorkspaceAdmin` in `lib/auth/require-membership.ts` rather than parameterizing the existing one, to keep each check's intent explicit at the call site (AS-014/AS-015/AS-019 draw the line at owner-only, stricter than the owner/admin line used by invite/revoke).
- `changeMemberRoleSchema.newRole` is a Zod enum of exactly `["member", "admin"]` — "owner" is never an accepted value through this action. Documented inline why: this action changes an existing member's role, not the workspace's ownership; granting ownership would need to coordinate with AS-018's sole-owner guard, which is out of this feature's scope.
- The action also rejects attempts to change the *target's* role away from "owner" (a defensive guard beyond what the assertions strictly require, since the UI never renders the control for an owner row) — belt-and-suspenders against a bypassed UI trying to demote the owner via this action instead of AS-018's dedicated path.
- If `newRole` already equals the target's current role, the action short-circuits to `{ ok: true }` without an UPDATE — avoids an unnecessary write and matches the idempotent-request pattern implied by the discriminated-union contract.
- UI: reused the existing shadcn `Select` component (already installed, used elsewhere) rather than DropdownMenu — a two-option role picker maps more naturally to Select's semantics.
- `revalidatePath` wrapped in try/catch mirroring `inviteMember`/`revokeInvite`'s existing non-fatal-outside-request-context handling, for consistency and so the test harness (no active Next.js request context) doesn't turn a successful role change into a reported failure.

## Out-of-scope work needed
- None identified beyond what's already tracked (F020 "remove member" was referenced as future work in F018's handoff; role-change here does not overlap it).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to also block changing the *target* row when its current role is "owner" (returns `{ ok: false, error: "The workspace owner's role cannot be changed here." }`), even though the assigned assertions only require rejecting non-owner *callers*. Rationale: the UI never exposes a control for the owner row (`page.tsx` renders `MemberRoleSelect` only when `member.role !== "owner"`), so this is defense-in-depth against a bypassed UI passing the owner's own membership id, consistent with the file's existing "never trust the client, re-check server-side" convention (AS-143).

## Notes for the next worker
- `MemberRoleSelect` is rendered in the Active members table only when `canChangeRoles` (caller's own role is exactly "owner") is true and the row's role isn't "owner" — otherwise the existing read-only `Badge` is shown, matching F017/F018's established pattern for owner/admin-gated controls.
- No MCP tools were used at run time (spec's "MCP at run: none" was accurate) — the Supabase MCP was not needed since no schema/RLS changes were required; `workspace_members.role` and its update path already existed from earlier features.
- Integration tests run against the real linked Supabase project per this repo's established pattern (`describe.skipIf(!haveAdminCreds)`); they pass with the `.env` present in this environment.
