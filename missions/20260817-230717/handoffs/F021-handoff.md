# Handoff: F021 — delete workspace action

## Status
COMPLETE

## Assertions covered
AS-020: PASS — only the active owner can call `deleteWorkspace` successfully; admin and plain-member callers are rejected server-side with "Only the workspace owner can delete a workspace." (tests/integration/delete-workspace.test.ts)
AS-021: PASS — deletion sets `deleted_at = now()` on the workspaces row (soft delete, row is not removed); a soft-deleted workspace no longer appears in a membership-scoped switcher-style query under F012's existing RLS policy

## Files changed
lib/actions/workspaces.ts
lib/validation/workspaces.ts
tests/integration/delete-workspace.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/integration/delete-workspace.test.ts` (0) — 7/7 passed against the real linked Supabase project
`npx vitest run` (0) — 80 passed across 14 files, including the new 7
`npm run build` (0)

## Decisions made
- `deleteWorkspace` re-checks the caller via `requireWorkspaceOwner` (owner only), matching AS-020's literal text ("Only the owner can delete a workspace") — deliberately stricter than F020's `removeMember`, which uses the broader `requireWorkspaceAdmin`.
- Soft-delete via `UPDATE workspaces SET deleted_at = now() WHERE id = ... AND deleted_at IS NULL`, matching tech-decisions.md's never-hard-delete convention. The `deleted_at IS NULL` guard makes the update a no-op (rather than clobbering an existing timestamp) if the row was already soft-deleted by a concurrent request; both are treated as the not-found case via the lookup that precedes it.
- **F012's RLS SELECT policy already filters `deleted_at IS NULL`** (`workspaces_select_active_members` in `supabase/migrations/20260817222822_rls_workspaces.sql`, added at F012 time in anticipation of this feature: "Also respects soft-delete convention (deleted_at IS NULL) per tech-decisions.md."). Checked this explicitly per the task instructions — **no migration was needed**; a soft-deleted workspace already stops appearing in any query that goes through the regular (non-admin) Supabase client, including the switcher. Verified this directly with a real signed-in user in the last test case (AS-021 RLS/switcher test), not just asserted from reading the policy file.
- **Cascade to projects/tasks is deliberately NOT implemented** — those tables don't exist yet (M3/M4, later milestones). Per the task instructions, this is a known-incomplete cascade, not silently missing: a `// TODO(F029/F038 or later): cascade soft-delete to projects/tasks once those tables exist` comment marks the exact spot in `deleteWorkspace` (immediately before the `UPDATE workspaces` call) where that cascade logic belongs once those tables land. AS-021's contract text says "and all its projects and tasks" — this feature satisfies the part of it that can be satisfied today (the workspace row itself) and explicitly does not claim the cascade is done.
- Redirect logic: after a successful soft-delete, looks up the caller's next remaining active workspace membership (excluding the just-deleted workspace) and redirects to `/w/<that-workspace-slug>` if one exists; otherwise redirects to `/onboarding`, matching every other "no workspace" redirect already in this app (`app/(auth)/auth/callback/route.ts`, the `[workspaceSlug]` layout/page guards). The lookup filters `deleted_at IS NULL` on the candidate next workspace too, so it can never redirect into another already-soft-deleted workspace.
- `deleteWorkspace`'s return type (`DeleteWorkspaceResult`) only has an `{ ok: false, error }` shape, no `{ ok: true }` variant — every success path ends in `redirect()`, which throws and never returns to the caller, matching `createWorkspace`'s existing precedent in this same file.
- `revalidatePath` call uses the `"layout"` type argument (two-argument form) since F021 spec's Clarified implementation calls for "targeted revalidatePath/revalidateTag (two-argument form, Next.js 16)"; scoped to the `/w/[workspaceSlug]` layout segment so the switcher and any nested workspace pages pick up the change.

## Out-of-scope work needed
- Cascading soft-delete to `projects` and `tasks` once those tables exist (F029/F038 or later, per the TODO comment left in `lib/actions/workspaces.ts` immediately above the `UPDATE workspaces` call in `deleteWorkspace`). Whoever builds those tables should extend `deleteWorkspace` at that exact spot to soft-delete all rows in `projects`/`tasks` scoped to `workspace_id`, inside the same request as the workspace soft-delete.
- No UI (delete-workspace button/confirm dialog) was added — the assigned task scope was limited to `lib/actions/workspaces.ts` and did not ask for a settings-page control the way F020's task explicitly did for remove-member. A future feature can wire a button into the workspace settings page calling this action, following the `RemoveMemberButton`/`RevokeInviteButton` pattern already established in this codebase.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to look up and redirect to "the caller's next remaining workspace" by an unordered `.limit(1)` active-membership query (no explicit ordering, e.g. by `created_at`) since the task said "e.g. to their next remaining workspace" without specifying an ordering, and no existing convention in this codebase orders workspace switcher lists by any particular field yet.
AUTONOMOUS_DECISION: Did not add a `{ ok: true }` result variant to `DeleteWorkspaceResult` since every success path redirects and therefore never returns — kept consistent with `createWorkspace`'s existing `Promise<CreateWorkspaceResult>` signature/precedent in this same file, which likewise never actually returns `{ ok: true }` on its success path.

## Notes for the next worker
- No MCP tools were used at run time (spec's "MCP at run: none" was accurate) — F012's existing RLS policy already covered the soft-delete filtering needed, so no schema/RLS change was required for this feature.
- Integration tests run against the real linked Supabase project per this repo's established pattern (`describe.skipIf(!haveAdminCreds)`); all 7 new tests pass with the `.env` present in this environment. One test (`AS-021 RLS/switcher`) explicitly signs in as a real throwaway user (via `adminClient.auth.admin.updateUserById` to set a known password, then `signInWithPassword`) and queries `workspaces` through the regular publishable-key client to prove the soft-deleted row is filtered by RLS, not just asserted from reading the migration file.
- `deleteWorkspace(workspaceId)` takes a plain `workspaceId` argument (not a `FormData`-based Server Action signature like `createWorkspace`), matching the signature style of `removeMember`/`changeMemberRole`/`revokeInvite` in this same file — all four are called from client components via direct invocation, not `<form action={...}>`.
