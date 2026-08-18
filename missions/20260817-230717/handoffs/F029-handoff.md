# Handoff: F029 — archive project action

## Status
COMPLETE

## Assertions covered
AS-030: PASS — `archiveProject` (lib/actions/projects.ts) sets `deleted_at = now()` when called by an active owner or admin; verified in tests/integration/archive-project.test.ts ("AS-030: a workspace owner can archive a project" and "AS-030: a workspace admin can archive a project").
AS-031: PASS — `getWorkspaceProjects` (lib/queries/projects.ts, pre-existing from F027) already filters `deleted_at IS NULL`; verified with a query of the same shape in "AS-031: an archived project is excluded from the default project list query".
AS-032: PASS — archiving only sets `deleted_at`; a direct by-id lookup (no `deleted_at` filter) still returns the full row with `name`/`description` intact. Verified in "AS-032: an archived project's row remains fully readable by direct-by-id query, with its data intact". No project detail page exists yet to attach a "navigate directly" UI to (that's F030/F031's scope) — see Out-of-scope below.
AS-033: PASS — `archiveProject` calls `requireWorkspaceAdmin` (not `requireActiveMembership`); a plain member's call is rejected server-side with a generic error and no `deleted_at` change. Verified in "AS-033 (failure case): a plain member cannot archive a project — rejected server-side even when called directly". The Archive button is also not rendered client-side for non-admin/owner callers (app/(workspace)/w/[workspaceSlug]/projects/page.tsx's `canArchive` gate).

## Files changed
lib/actions/projects.ts
lib/validation/projects.ts
components/archive-project-dialog.tsx
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
tests/integration/archive-project.test.ts
missions/20260817-230717/handoffs/F029-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/integration/archive-project.test.ts` (0) — 7/7 passed standalone
`npm test` (0) — full suite (26 files / 141 tests) passed
`npm run build` (0)

## Decisions made
- Reused `requireWorkspaceAdmin` from `lib/auth/require-membership.ts` exactly as instructed (established in F015/F019/F020) rather than writing a new role check — it already implements "active membership restricted to owner/admin roles," which is precisely AS-030/AS-033's bar.
- Followed `deleteWorkspace`'s soft-delete shape in lib/actions/workspaces.ts: fetch-then-guard (`existing.deleted_at` already set → generic "already archived" error) then a scoped `UPDATE ... WHERE deleted_at IS NULL` so a race between two archive calls can't double-fire side effects, plus a best-effort non-fatal `revalidatePath`.
- Did not touch `lib/queries/projects.ts` — F027's `getWorkspaceProjects` already filters `deleted_at IS NULL`, so AS-031 was already satisfied by existing code; only added a test proving it against the real database with a freshly archived row rather than assuming it holds.
- AS-032 is proven at the data layer only (direct-by-id Supabase query returns the intact row post-archive), not via a new UI page. The feature spec explicitly scopes full "navigate directly" UI to F030/F031 since no project detail route exists yet; building one here would be scope creep beyond this feature's "Files (approximate): lib/actions/projects.ts" and its four assigned assertions.
- Added a `canArchive` role lookup directly in the Server Component (app/.../projects/page.tsx) rather than a new shared helper, mirroring how EditProjectDialog/NewProjectDialog are already conditionally composed inline in that same file — kept the UI gate as close as possible to the one page it affects.
- `ArchiveProjectDialog` uses a confirm dialog (not a bare button) before calling the action, matching this codebase's existing Dialog-based confirmation pattern (EditProjectDialog) rather than an inline `<AlertDialog>` primitive, since no `alert-dialog` UI primitive exists in `components/ui/` yet.

## Out-of-scope work needed
- F030/F031 (project detail page): once a `/w/[workspaceSlug]/projects/[projectId]` route exists, it should route an archived project's direct-by-id fetch to a normal render (not a 404), and probably show an "Archived" banner with an Unarchive action. This handoff only proves the underlying data guarantee (AS-032); it deliberately does not add UI navigation to a page that doesn't exist yet.
- No "unarchive" / restore action exists yet — not requested by AS-030–AS-033, but likely wanted alongside the eventual detail page. Flagging so it isn't assumed to be covered.
- Project archiving does not cascade to a `tasks` table (mirrors the same known-incomplete-cascade note left in `deleteWorkspace` for F021/F029 concerning `workspaces`) — moot today since `tasks` doesn't exist until M4, but worth re-checking once F033+ lands that any future project-archive cascade decision is made deliberately, not by omission.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a modal confirm dialog (mirroring EditProjectDialog's Dialog usage) over a bare unconfirmed button for the Archive action, since archiving changes list visibility and the spec's own AS-032 language ("tasks remain intact") implies this is a meaningful state change worth confirming, and no `alert-dialog` primitive exists in this repo to reach for instead.
AUTONOMOUS_DECISION: Placed the `canArchive` role check as a fresh inline `workspace_members` lookup in the page component rather than exporting a new "get caller role" query helper, since this is the only call site today and adding a shared helper for one caller would be premature abstraction ahead of an actual second use.

## Notes for the next worker
- `requireWorkspaceAdmin` returns `{ ok: true, role }` for both `"owner"` and `"admin"` — do not add a stricter owner-only check here; AS-030 explicitly says "admin or owner," unlike AS-020's workspace-delete which really is owner-only (`requireWorkspaceOwner`). Don't copy-paste the wrong helper between these two files.
- The `archiveProject` fetch-then-update pattern (select current row, guard on already-`deleted_at`, then update `WHERE deleted_at IS NULL`) is the established idiom in this repo for idempotent soft-deletes — reuse it verbatim for any future soft-delete action (e.g. task delete in M4) rather than a bare unconditional `UPDATE`.
- Ran the new test file both standalone and as part of the full `npm test` run — it passed both times. One earlier run that included this file alongside two other integration files in the same `vitest run <files...>` invocation hit a transient `"JWT issued at future"` error from Supabase Auth's `auth.admin.createUser` (clock-skew related, not code-related); re-running showed it was not reproducible and the full suite run afterward passed cleanly. Worth knowing this exists as infra flakiness in this environment, not a regression from this change.
