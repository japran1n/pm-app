# Handoff: F020 — remove member action

## Status
COMPLETE

## Assertions covered
AS-016: PASS — owner and admin can each remove a regular active member (tests/integration/remove-member.test.ts)
AS-017: PASS — the removed member's row no longer resolves as an active membership, so a subsequent membership lookup denies access
AS-018: PASS — the sole owner cannot be removed (rejected server-side with "cannot remove the sole owner" wording); a workspace with two owners allows removing one of them

## Files changed
lib/actions/workspaces.ts
lib/validation/workspaces.ts
components/remove-member-button.tsx
app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx
tests/integration/remove-member.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/integration/remove-member.test.ts` (0) — 8/8 passed against the real linked Supabase project
`npx vitest run` (0) — 73 passed across 13 files, including the new 8
`npm run build` (0)

## Decisions made
- `removeMember` re-checks the caller via `requireWorkspaceAdmin` (owner OR admin), not `requireWorkspaceOwner` — AS-016 says "a workspace owner can remove a member" but does not restrict removal to owner-only the way AS-014/AS-015/AS-019 restricted role-change to owner-only; F018's existing `revokeInvite` also uses the admin-level check for the analogous invite-management action, so this keeps the two closely-related actions consistent.
- AS-018 sole-owner guard: implemented as a `SELECT COUNT` (`{ count: "exact", head: true }`) of active `role = 'owner'` rows for the workspace, evaluated only when the target row's own role is `"owner"`. If the count is `<= 1`, reject with "You cannot remove the sole owner of a workspace." A workspace with two or more owners permits removing any one of them, tested explicitly (AS-018 test: two owners, remove one, succeeds).
- Hard-deletes the `workspace_members` row (matching `revokeInvite`'s existing DELETE pattern) rather than soft-deleting — per the task instructions, the row is the join/membership record itself, not the user's own data, so no soft-delete/tombstone is needed. Deletion is scoped with `.eq("status", "active")` in the same query as an extra defense-in-depth guard against a race where the row's status changed between the lookup and the delete.
- Checked F019's `changeMemberRole` for the same sole-owner-demote guard the task asked me to retroactively verify: it already blocks changing the target's role away from "owner" unconditionally (`if (targetRow.role === "owner") return { ok: false, ... }`), which is strictly stronger than AS-018 requires (it blocks demoting *any* owner, not just the sole one) but is still correct — a sole owner can never be demoted through that action either. No change made there; confirmed correct rather than duplicated.
- UI: reused the existing `RevokeInviteButton` pattern (`window.confirm` + ghost icon button with `X` icon) for `RemoveMemberButton` rather than introducing a new dialog component, for consistency with F018's established convention in this file set.
- Gated the remove control in the members page with the same `canInvite` boolean (owner or admin) already computed on the page, rather than introducing a new `canRemove` variable, since the two gates are identical (owner-or-admin) for this page's current UI needs.
- Did not hide the remove button for the owner's own row client-side (unlike `MemberRoleSelect`, which F019 explicitly excludes for owner rows). AS-018 only prohibits removing the *sole* owner, and the page has no client-side visibility into whether a given owner is the only one — that count is only known server-side at request time. Attempting to remove any owner is allowed by the UI; `removeMember` itself is the enforcement point and returns a clear error toast when the target turns out to be the sole owner.
- `revalidatePath` wrapped in try/catch mirroring every other action in this file, for consistency and so the test harness (no active Next.js request context) doesn't turn a successful removal into a reported failure.

## Out-of-scope work needed
- None identified. The UI does not distinguish "you are about to remove the sole owner" before the click (no pre-flight owner-count check surfaced to the client) — the confirm dialog and the server error together are sufficient per the discovery Q26 "critical paths only" sign-off criterion, but a nicer UX (disabling/hiding the button when the target is knowably the sole owner) could be a future polish item if the product ever asks for it. Not creating a follow-up feature since this isn't blocking anything and wasn't part of the assigned assertions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `requireWorkspaceAdmin` (owner-or-admin) over `requireWorkspaceOwner` for the caller check, based on AS-016's literal text ("a workspace owner can remove a member") not explicitly excluding admins, the task instructions saying "AS-016 says owner/admin, broader than F019's owner-only", and consistency with `revokeInvite`'s existing admin-level gate for the sibling invite-management action.
AUTONOMOUS_DECISION: Did not add a `canRemove`-specific UI gate distinct from `canInvite`, since both currently resolve to the same owner-or-admin condition on this page; introducing a separate identical variable seemed like needless duplication rather than a real design decision.

## Notes for the next worker
- No MCP tools were used at run time (spec's "MCP at run: none" was accurate) — no schema/RLS changes were required; `workspace_members` DELETE already goes through the admin client, same as `revokeInvite`.
- Integration tests run against the real linked Supabase project per this repo's established pattern (`describe.skipIf(!haveAdminCreds)`); all 8 new tests pass with the `.env` present in this environment.
- The sole-owner guard's owner-count query only runs when the target's own role is `"owner"` — it does not run on every removal, so the common case (removing a plain member/admin) has no extra query overhead.
