# Handoff: F136 — workspace settings page

## Status
COMPLETE

## Assertions covered
AS-239: PASS — sidebar renders a "Settings" nav item to `/w/[slug]/settings` only when `canManageWorkspace` (owner/admin, via `canManageProject`) is true; verified by `tests/unit/app-sidebar-settings-nav.test.tsx` (3 tests) and `tests/unit/workspace-settings-permissions.test.ts`'s `canManageProject` role matrix.
AS-240: PASS — `renameWorkspace` persists the new name and `revalidatePath`s the workspace layout so the switcher/page titles refresh without a manual reload (client also calls `router.refresh()`); verified by `tests/integration/rename-workspace.test.ts` (owner/admin succeed, member/guest/unauthenticated/invalid-input rejected, cross-workspace isolation).
AS-244: PASS — `canDeleteWorkspace` returns true only for role "owner"; the settings page only mounts `<DeleteWorkspaceDialog>` when `canDelete` is true, so an admin's render tree never includes the control at all (not merely disabled). Verified by `tests/unit/workspace-settings-permissions.test.ts`'s `canDeleteWorkspace` matrix, plus the pre-existing `tests/integration/delete-workspace.test.ts` for the underlying `deleteWorkspace` action's server-side owner-only enforcement (untouched by this feature — F136 only adds a UI entry point to it).

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
app/(workspace)/w/[workspaceSlug]/settings/page.tsx (new)
components/nav/app-sidebar.tsx
components/workspace/workspace-general-form.tsx (new)
components/workspace/delete-workspace-dialog.tsx (new)
lib/actions/workspaces.ts (renameWorkspace action — already present from prior session, verified/kept as-is)
lib/auth/permissions.ts (canDeleteWorkspace — already present from prior session, verified/kept as-is)
lib/validation/workspaces.ts (renameWorkspaceSchema — already present from prior session, verified/kept as-is)
tests/integration/rename-workspace.test.ts (new)
tests/unit/workspace-settings-permissions.test.ts (new)
tests/unit/app-sidebar-settings-nav.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, one pre-existing unrelated warning in lib/queries/search.ts)
`npm run test -- tests/integration/rename-workspace.test.ts tests/unit/workspace-settings-permissions.test.ts tests/unit/app-sidebar-settings-nav.test.tsx` (0, 25/25 passed)
`npm run test` (full suite: 26 files / 28 tests failed, all with `Error: ... Request rate limit reached` from Supabase auth sign-in in integration tests I did not touch — checklist-actions, dependency-ui-actions, open-blockers, workspace-members-list, etc. None of the failing test names reference F136/rename/settings/delete-workspace. Re-running the three F136-scoped files in isolation above passed cleanly, confirming this is Supabase auth rate-limiting from the volume of integration tests in this suite (likely compounded by a concurrent worker also hitting the same project), not a regression introduced by this feature.)

## Decisions made
- Picked up mid-interruption: `renameWorkspace` (lib/actions/workspaces.ts), `canDeleteWorkspace` (lib/auth/permissions.ts), and `renameWorkspaceSchema` (lib/validation/workspaces.ts) were already fully implemented and well-commented from the prior session — read and verified them against the spec rather than rewriting; they matched the clarified spec exactly (owner-or-admin rename via `canManageProject`/`requireWorkspaceAdmin`, owner-only delete via existing `deleteWorkspace`/`requireWorkspaceOwner`).
- Built the settings page itself (didn't exist as a file), `WorkspaceGeneralForm`, `DeleteWorkspaceDialog`, and wired the sidebar's already-imported-but-unused `Settings` icon into an actual gated nav item.
- Threaded a new `canManageWorkspace` boolean prop from the workspace layout (`canManageProject({ role: activeWorkspaceRole })`, using the role the layout already computes for `MembershipProvider`) down through `AppSidebar` → `SidebarContent`, rather than re-deriving role client-side.
- Members page becomes a tab link under `/settings` (per clarified spec) rather than a new top-level nav item — the settings page's own nav row links to `/settings/members`; the sidebar's existing "Members" link is left as-is (F134's existing behaviour, out of scope to remove per "don't touch code outside Touches" — see Out-of-scope below).
- Logo: F138 (workspace logo upload) has not landed in this tree (no `logo_url` column, no upload action found) — rendered a static disabled placeholder ("No logo") per the clarified spec's explicit allowance for a stub.
- Slug is rendered read-only (not editable) — `renameWorkspace` only ever writes `name`; changing the slug would break every existing `/w/{slug}/...` bookmark, which is out of this feature's scope and not required by any assigned assertion.
- Audit log link: the spec's draft scope mentions "links to ... audit" but F139 (the `audit_log` table/UI) has not landed yet in this tree (only its migration file was present, untracked, from a concurrent worker) — omitted the audit link entirely rather than linking to a page that doesn't exist yet; tracked below.
- Delete-workspace dialog uses a real `<Dialog>` (mirroring `ArchiveProjectDialog`, F029) rather than `window.confirm` (mirroring `RemoveMemberButton`) — workspace deletion is a heavier, workspace-wide action than removing one member, warranting the fuller confirm surface with the workspace name and consequence text spelled out.

## Out-of-scope work needed
- An "Audit" tab/link on the settings page, once F139 (audit_log table) and its own UI feature land — F136's spec mentions it but the underlying page doesn't exist yet in this tree.
- The sidebar still shows a standalone "Members" link (`/settings/members`) alongside the new "Settings" link, rather than folding Members fully under Settings navigation-wise. The clarified spec's instruction ("the existing members page becomes a tab under settings rather than a separate top-level nav item") is satisfied on the settings page itself (which links to Members as a tab), but removing/changing the sidebar's pre-existing standalone Members link is a change to F134's already-shipped behaviour, outside F136's "Touches" list — flagging rather than silently changing shared nav behaviour.
- F138 (workspace logo upload) itself — the settings page only has a static placeholder for it, as instructed by the clarified spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Omitted an audit-log link entirely (rather than linking to a not-yet-existing page or building a stub audit page) since F139 hadn't landed a queryable audit page at implementation time in this tree, and building one would be out of F136's scope.
AUTONOMOUS_DECISION: Left the sidebar's existing standalone "Members" nav link untouched rather than removing it in favor of routing solely through the new Settings tab nav, since removing it would change F134's already-shipped, differently-scoped behavior beyond what AS-239/240/244 require.

## Notes for the next worker
- `lib/activity/`, `supabase/migrations/20260821211226_create_audit_log.sql`, and `tests/integration/rls-audit-log.test.ts` were present as untracked files in the working tree from a concurrent F139 worker — left entirely untouched and not staged/committed by this feature's commit.
- The full test suite has pre-existing intermittent `Request rate limit reached` failures from Supabase auth sign-in calls across many integration test files (unrelated to this feature) — this appears to be a Supabase project-level auth rate limit being hit by the sheer volume/concurrency of integration tests (compounded by another worker running concurrently against the same project). Worth flagging to the orchestrator if it recurs across features: either space out worker runs against Supabase auth, or the project's auth rate limit may need to be raised.
- MCP usage: none — `mcp-registry.md` lists no MCP for this feature (matches the feature spec's "MCP at run: none"); all work is pure Next.js/Supabase-SDK application code plus tests.
