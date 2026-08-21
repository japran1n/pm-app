# Handoff: F126 — expand the workspace role set

## Status
COMPLETE

## Assertions covered
AS-215: PASS — `tests/integration/workspace-role-expansion.test.ts` re-confirms all four original roles (owner, admin, member, viewer) still insert cleanly under the widened CHECK constraint (no regression), confirms the new `guest` value is now accepted, and confirms a still-invalid value (`superadmin`) is still rejected.
AS-238: PASS — same file: `inviteMember` accepts an explicit `role` ("admin"/"member"/"viewer"), the invited row is created with that role, an omitted role still defaults to "member" (backward compatible), and a full invite→accept round trip proves the granted role survives `activateInvitedMemberships` unchanged.

## Files changed
supabase/migrations/20260821184932_workspace_members_role_expansion.sql
lib/supabase/database.types.ts
lib/validation/workspaces.ts
lib/actions/workspaces.ts
tests/integration/workspace-role-expansion.test.ts

## Commands run
`supabase migration new workspace_members_role_expansion` (0)
`supabase db push --yes` (0) — applied migration to the linked project (`qcipqonnqajmazdbysow`)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow` (0) — regenerated `lib/supabase/database.types.ts`
`npx tsc --noEmit` (0)
`npx eslint .` (0, one pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/integration/workspace-role-expansion.test.ts tests/integration/invite-member.test.ts tests/integration/invite-accept-on-signin.test.ts tests/integration/revoke-invite.test.ts tests/integration/change-member-role.test.ts` (0) — 36/36 passed
`npx vitest run tests/integration/remove-member.test.ts` (0) — 10/10 passed (sole-owner guard, AS-018, unaffected)
`npm run test` (1) — full suite: 799 passed, 20 failed, 66 skipped. All 20 failures are `Error: Request rate limit reached` from Supabase Auth signup during test-user seeding, spread across ~17 unrelated files (F054, F055, F108, F109, F124/F275 overdue, F150–F158 checklist/dependency/subtask, F276 profiles, F292/F293 extension, etc.) — none touch workspace roles or invites. Re-ran the full suite a second time; the same rate-limit errors recur (same root cause, not migration-induced). Every test targeting roles, invites, or the sole-owner guard passes in isolation and stays green across both full-suite runs when it does execute.

## Decisions made
- Widened `workspace_members.role`'s CHECK constraint to `owner, admin, member, viewer, guest` in one step, not just adding `guest` to an existing 4-value set: the live constraint (from `20260817222532_create_workspaces.sql`) only ever allowed `owner, admin, member` — `viewer` (named in AS-215 and in this feature's own Draft scope) had never actually been added to the database. Confirmed via `grep` across every migration and by inspecting the constraint's history; no other migration introduces `viewer`. Widening to all five in this migration keeps AS-215 (which already names `viewer`) and the Draft scope's literal "owner/admin/member/viewer/guest" text both satisfied in one additive step.
- No separate `invited_role` column was added, despite the feature's Draft scope text suggesting one. The existing `role` column is already written at invite-creation time and is never touched by the accept path (`lib/actions/invites.ts` `activateInvitedMemberships` only updates `user_id`/`status`) — so `role` already *is* the "role granted on acceptance." Adding a second `invited_role` column would create two sources of truth for the same fact that would need to be kept in sync for no behavioural gain. This follows the clarification's own ambiguity-resolution rule ("the simpler option that adds no new dependency and no second source of truth," recorded per the F126 clarification's stated open question about `guest`/scope, applied here to the `invited_role` question by the same rule). `inviteMember` now takes an optional third `role` argument (default `"member"`) instead of hardcoding `role: "member"` on insert.
- `inviteMemberSchema`'s new `role` field is restricted to `"admin" | "member" | "viewer"` — deliberately excludes `"owner"` (an invite can never hand out ownership; ownership is established only via `create_workspace_with_owner`, F095/AS-006) and deliberately excludes `"guest"` for now (F126's own scope note says guest's actual scoping/enforcement lands in F134; this feature only widens the *database* domain, not the invite/UI surface for granting guest specifically).
- Touched `lib/validation/workspaces.ts` and `lib/actions/workspaces.ts` rather than the spec's approximate `lib/validation/invites.ts` / `lib/actions/invites.ts` — those files don't contain the invite-creation logic in this codebase; `lib/actions/invites.ts` only holds the *accept* path (`activateInvitedMemberships`), and `inviteMember` (the actual invite-creation Server Action) lives in `lib/actions/workspaces.ts` with its schema in `lib/validation/workspaces.ts`. Confirmed by `grep` before editing.
- `remove_workspace_member` (the sole-owner guard, `20260817234900_remove_member_atomic_owner_guard.sql`) needed no code change: it counts rows where `role = 'owner'` and locks/deletes by exact role-string equality, not by enumerating or hardcoding the full allowed role set anywhere. Widening the CHECK constraint does not change what `role = 'owner'` matches, so the guard's existing atomicity and count logic are correct unmodified. Verified with `tests/integration/remove-member.test.ts` (10/10 passing, unchanged file).
- Regenerating `database.types.ts` also picked up an unrelated, pre-existing drift (`is_project_visible_to_row` RPC existed in the live schema but was missing from the previously-committed types file, apparently from a prior feature's migration). Included this correction since regenerating types is explicitly this feature's Touches — the alternative (hand-editing only the role-related diff) would leave the types file still out of sync with the live schema.

## Out-of-scope work needed
- No UI role picker was added to `components/invite-member-form.tsx` — it still only submits an email and relies on `inviteMember`'s new default. Adding a role `<select>` to the invite form is real, additional UI/UX scope (not listed in this feature's Touches) and should be its own feature, likely paired with F129 (role-management UI update) or F128 (viewer-role-enforcement), which are already planned.
- `changeMemberRoleSchema`/`changeMemberRole` (existing role-*change*, not invite, action) still restricts `newRole` to `"member" | "admin"` only — it does not yet accept `"viewer"` or `"guest"`. Widening that is explicitly out of this feature's Draft scope (F128/F129 own the viewer-role enforcement and role-management UI); left untouched.
- `guest` role enforcement/scoping (what a guest can actually see/do) is explicitly F134's scope per the spec's own note; nothing beyond making `guest` a legal `role` value was implemented here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Combined `viewer` (never actually enforced in the DB despite being named in AS-215) into the same widening migration as `guest`, rather than treating `viewer`'s absence as a separate blocker, because both are additive, both are already implied by this feature's own Draft scope text, and splitting them into two migrations/features would add process overhead with no safety benefit — the constraint change is a single, reviewable, additive statement either way.
AUTONOMOUS_DECISION: Restricted invite-role choices to `admin | member | viewer` (no `owner`, no `guest`) per the reasoning in Decisions Made above, rather than exposing the full role set through the invite path.

## Notes for the next worker
- Live constraint name after this migration: `workspace_members_role_check` on `public.workspace_members`, values `owner, admin, member, viewer, guest`.
- MCP: the Supabase MCP server was `Pending approval` at run time (confirmed via `claude mcp list`), consistent with `connections/mcp-registry.md`'s note that the CLI (`supabase db push`) is the primary path. Used the CLI successfully for both the migration push and `supabase gen types typescript`; no MCP tool calls were made or needed.
- If a future worker sees `npm run test` fail with `Request rate limit reached` from Supabase Auth across many unrelated test files, that is Supabase's signup rate limit on the shared test project, not a real regression — verify by re-running the specific failing file(s) in isolation a few minutes later, or run fewer integration files at once.
