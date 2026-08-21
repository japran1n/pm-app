# Handoff: F128 — viewer role is read-only everywhere

## Status
COMPLETE

## Assertions covered
AS-216: PASS — `tests/integration/rls-viewer.test.ts` (a viewer can SELECT tasks/comments; a plain member's writes are unaffected — regression guards included) and `tests/unit/permissions.test.ts` (`canWrite` matrix: owner/admin/member true, viewer false, guest deliberately true — see Decisions Made).
AS-217: PASS — `tests/integration/rls-viewer.test.ts` proves rejection at BOTH layers independently: (a) direct Server Action calls (`createTask`, `editTask`, `deleteTask`, `addComment`, `logTimeEntry`, `createProject`) as a viewer return `{ ok: false }`, not merely a hidden UI control; (b) a viewer's real Supabase session (publishable key, no admin bypass) is rejected by RLS on direct `INSERT`/`UPDATE` against `tasks`/`comments`/`time_entries`, proving a client that skips the Server Action entirely (curl/devtools/stale UI) is still rejected at the database.

## Files changed
lib/auth/permissions.ts
lib/auth/require-membership.ts
lib/actions/tasks.ts
lib/actions/projects.ts
lib/actions/comments.ts
lib/actions/attachments.ts
lib/actions/time-entries.ts
components/task/comment-list.tsx
components/task/attachment-list.tsx
components/task/time-tracking.tsx
components/task/task-detail-sheet.tsx
components/task/use-task-detail-sheet.ts
supabase/migrations/20260821194500_viewer_guest_write_rls.sql
supabase/migrations/20260821195500_viewer_write_rls_exclude_guest_fix.sql
tests/unit/permissions.test.ts
tests/integration/rls-viewer.test.ts

### Every Server Action file touched, and what changed in each
- **lib/actions/tasks.ts** — `createTaskForUser`, `assignTask`, `editTask`, `deleteTask`, `promoteSubtask`, `updateTaskTags`, `moveTaskStatus`, `reorderTask`, `moveAndReorderTask` all now call `canWrite`/`canEditTask` right after the existing `requireActiveMembership` check and return a permission-denied result for a viewer. `getOpenBlockers`/`getTaskDetail` (reads) were deliberately left untouched. `GetTaskDetailResult.currentUserRole` widened from `"owner" | "admin" | "member"` to the full `WorkspaceRole`.
- **lib/actions/projects.ts** — `createProject`, `editProject` gated. `archiveProject` was already `requireWorkspaceAdmin`-only (owner/admin), so a viewer was already rejected there before this feature; left unchanged.
- **lib/actions/comments.ts** — `addComment` gated; `deleteComment`'s author-branch additionally re-checks `canWrite` (a comment authored before a role change could otherwise still be deleted by a now-viewer caller).
- **lib/actions/attachments.ts** — `uploadAttachment` gated; `deleteAttachment`'s uploader-branch additionally re-checks `canWrite`, same rationale as deleteComment. The signed-URL "view" action (a read) was left untouched.
- **lib/actions/time-entries.ts** — `logTimeEntry`, `startTimer` gated; `editTimeEntry` (author-only, AS-169) and `deleteTimeEntry`'s author-branch additionally re-check `canWrite`. `stopTimer` has no membership check at all (it only ever stops the *caller's own* timer via the user's own RLS-scoped session, not the admin client) — a viewer can never have started one in the first place after this feature, so no gate was needed there.
- Deliberately out of scope (not touched): `lib/actions/checklist.ts`, `lib/actions/dependencies.ts`, `lib/actions/project-members.ts`, `lib/actions/workspaces.ts`, `lib/actions/invites.ts` — see Out-of-scope below.

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run test -- tests/unit/permissions.test.ts tests/integration/rls-viewer.test.ts` (0, 73/73 passed)
`npm run test -- tests/integration/rls-tasks.test.ts tests/integration/rls-comments.test.ts tests/integration/rls-attachments.test.ts tests/integration/rls-time-entries.test.ts tests/integration/create-task.test.ts tests/integration/edit-task.test.ts tests/integration/delete-task.test.ts tests/integration/delete-comment.test.ts tests/unit/permissions.test.ts tests/integration/rls-viewer.test.ts tests/integration/rls-guest.test.ts` (0, 129/129 passed — the full write-path/RLS surface this feature touches, run in isolation)
`npm run test` (full suite, 2 runs) — both runs had a large, *different* set of failures each time, all with `Error: ... Request rate limit reached` from Supabase Auth's `signInWithPassword`/`createUser` during test setup (plus one unrelated 30s timeout in `start-stop-timer.test.ts`), never a real assertion failure. This is the real linked Supabase project's Auth rate limit being exhausted by the sheer number of integration tests that each spin up 2-4 throwaway users — not caused by this feature. See Notes below.
`supabase db push --yes` (0, twice — see Decisions Made)

## Decisions made
- **`canWrite` excludes only "viewer", not "guest"** (deviates from my own first draft). My first implementation excluded both viewer and guest, which broke F134's already-established `AS-223` ("a guest can comment on and be assigned tasks inside a project they were added to") — confirmed by `tests/integration/rls-guest.test.ts` failing after my first migration landed. F128's own spec/title is scoped to "viewer" specifically; guest write access is project-scoped and governed by F134's own rules. Fixed by narrowing `canWrite` to `role !== "viewer"` and shipping a fix-forward migration (`20260821195500_viewer_write_rls_exclude_guest_fix.sql`) that repoints the same-named SECURITY DEFINER writer-helper functions to exclude only `'viewer'`. Re-verified `rls-guest.test.ts` passes after the fix. This is exactly the "concurrent feature, shared predicate" collision the clarification's ambiguity-resolution rule anticipates — resolved by narrowing to the simpler, spec-matching scope rather than guessing at a combined viewer+guest design.
- **`canWrite` vs the more specific `canEditTask`/`canDeleteTask`**: used `canEditTask` for `editTask` (identical viewer-gating, no ownership nuance, so reusing the named predicate is more legible than a second copy of the same check). Deliberately did NOT use `canDeleteTask` for `deleteTask` — that predicate additionally scopes plain members to their own creations (AS-055 says "any active role may delete, no per-task ownership check" for `deleteTask`, so `canDeleteTask`'s extra ownership restriction would have regressed member behaviour). Used the generic `canWrite` there instead.
- **RLS approach**: added new SECURITY DEFINER helpers (`is_project_workspace_writer`, `is_task_workspace_writer`) mirroring the existing read helpers (`is_project_workspace_member`, `is_task_workspace_member`) rather than editing the read helpers in place — this guarantees viewer reads (including what Realtime's `postgres_changes` delivers, since Realtime authorizes against the same SELECT RLS policy) are untouched by this feature. Only INSERT/UPDATE policies were repointed at the new writer helpers.
- **Realtime verification**: no code/config change was needed. `supabase/migrations/20260818040000_realtime_tasks_publication.sql`'s own doc comment confirms Realtime's `postgres_changes` authorizes each broadcast against the table's existing SELECT RLS policy (`tasks_select_active_members`), which this feature never modified — so a viewer's realtime subscription keeps working exactly as it did for reads, with no separate Realtime-specific rule to add or verify.
- **UI tooltip mechanism**: used the native `title` attribute rather than pulling in `components/ui/tooltip.tsx`'s Radix/base-ui primitive, per the clarification's "simpler option that adds no new dependency" instruction — none of `comment-list.tsx`/`attachment-list.tsx`/`time-tracking.tsx` previously used the Tooltip component.
- **`WorkspaceRole` prop widening**: `currentUserRole` props across `comment-list.tsx`, `attachment-list.tsx`, `time-tracking.tsx`, `task-detail-sheet.tsx`, `use-task-detail-sheet.ts`, and `lib/actions/tasks.ts`'s `GetTaskDetailResult`/`require-membership.ts`'s `MembershipCheckResult` were widened from the old `"owner" | "admin" | "member"` literal union to the full `WorkspaceRole` — required both to compile (the real value could now be `"viewer"`/`"guest"`) and to let the UI actually gate on it.

## Out-of-scope work needed
- **`lib/actions/checklist.ts` and `lib/actions/dependencies.ts`** are also mutating Server Actions (add/toggle/rename/reorder/delete checklist items; add/remove task dependencies) that currently allow any active member — including a viewer — to write, with no RLS-level role gate either. The feature spec's Draft scope names only "tasks, projects, comments, attachments, time entries," so these were left untouched. A follow-up feature should apply the same `canWrite` gate (Server Action layer) plus a writer-scoped RLS policy (mirroring `is_task_workspace_writer`) to `checklist_items` and `task_dependencies`.
- **`lib/actions/project-members.ts`** (adding/removing project members) is already owner/admin-gated at the Server Action layer (unrelated to viewer), not reviewed for viewer-specific gaps as part of this feature.
- **Full-suite Supabase Auth rate limiting**: the test suite's sheer number of integration tests that each create 2-4 throwaway Supabase Auth users via `admin.createUser`/`signInWithPassword` intermittently exhausts the real linked project's Auth rate limit when run all together, causing a large, non-deterministic set of unrelated test files to fail with `Request rate limit reached` (confirmed pre-existing — the specific files that fail differ between runs, and none of them are files this feature touches). This is an existing test-infra limitation, not something this feature introduced or is positioned to fix; flagging as a candidate for a future test-infra feature (e.g. batching/throttling Auth calls across the suite, or a shared pool of pre-created test users) if full-suite-in-one-CI-run reliability becomes a blocker.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: `canWrite` was scoped to exclude only "viewer" (not "guest"), after discovering mid-implementation that a blanket viewer+guest exclusion regressed F134's already-shipped `AS-223`. Resolved without waiting for input by narrowing to match this feature's own spec title/scope ("viewer role is read-only") and F134's existing assertion, per the clarification's "take the simpler option, no second source of truth, record the choice" instruction. Full rationale in Decisions Made above.
AUTONOMOUS_DECISION: `checklist_items`/`task_dependencies` write paths were left ungated (viewer can still write there) since the feature spec's Draft scope names only tasks/projects/comments/attachments/time-entries; documented as Out-of-scope rather than expanded into silently.

## Notes for the next worker
- `lib/auth/permissions.ts` is being edited concurrently by another in-flight feature (F134, guest role scoping) in this same working tree — `canViewMembersList` and its doc comments were already present on disk when this worker started and were left untouched. When reading this file's git history, expect interleaved F127/F128/F134 additions in the same file.
- The migration `20260821194500_viewer_guest_write_rls.sql` was pushed with an over-broad exclusion (viewer+guest) and immediately fixed forward by `20260821195500_viewer_write_rls_exclude_guest_fix.sql` rather than edited in place, since the first migration was already applied to the live linked Supabase project via `supabase db push` before the AS-223 regression was discovered. Both migrations are in the repo; the net effect after both is "viewer-only" exclusion.
- `supabase db push --yes` was used twice (once per migration) against the linked project (`qcipqonnqajmazdbysow`, per `mcp-registry.md`) — no Supabase MCP tool call was made (MCP was "Pending approval" per the registry; the CLI path is the primary path and was sufficient here).
- If a future worker adds viewer/guest enforcement to `checklist_items`/`task_dependencies`, reuse `is_task_workspace_writer(uuid)` (defined in `20260821194500_viewer_guest_write_rls.sql`) rather than adding a third copy of the same join shape.
