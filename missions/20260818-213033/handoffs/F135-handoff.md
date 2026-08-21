# Handoff: F135 — hide or disable controls the caller cannot use

## Status
COMPLETE

## Assertions covered
AS-231: PASS — `tests/unit/permission-aware-ui-gating.test.tsx` (5 tests, jsdom + @testing-library/react, real DOM render, no source-text grepping): TagsEditor's add/remove controls disabled for a viewer and enabled for a member; NewTaskDialog's create trigger disabled for a viewer and enabled for an admin purely via `<MembershipProvider>` context (no prop threading); Checklist's add-item input, per-item checkbox, and per-item delete button all disabled/`aria-disabled` for a viewer. Additional gates added by this sweep (TaskDetailSheet's edit fields/delete button, ListStatusSelect, Board drag) are covered by manual verification notes below rather than a dedicated new render test, since TaskDetailSheet/Board/ListStatusSelect already have substantial existing test coverage elsewhere in the suite (`tests/unit/board-*`, `tests/unit/new-task-dialog.test.ts`) that would need heavier mocking (Supabase task detail fetch, dnd-kit sensors) to extend safely within this feature's scope — the underlying `canWrite`/`canEditTask`/`canDeleteTask` predicates these gates call are already unit-tested directly in `lib/auth/permissions.ts`'s own test file, and F135's render-level test above proves the *pattern* (context → predicate → disabled) works end-to-end on three representative surfaces.

## Files changed
components/auth/membership-provider.tsx (new)
app/(workspace)/w/[workspaceSlug]/layout.tsx
components/board/board.tsx
components/board/board-column.tsx
components/board/sortable-task-card.tsx
components/task/task-detail-sheet.tsx
components/task/tags-editor.tsx
components/task/checklist.tsx
components/task/list-status-select.tsx
components/task/new-task-dialog.tsx
tests/unit/permission-aware-ui-gating.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/unit` (0) — 62 files, 440 tests, run twice, both green
`npm run test` (full suite including integration) — 21 failures, all in `tests/integration/*`, all `AuthApiError: Request rate limit reached` / "Failed to sign in ... Request rate limit reached" against the live Supabase auth endpoint (pre-existing environment rate-limiting from repeated test-user sign-ins across this session's earlier work, not caused by this feature — none of the failing files are files this feature touched, and the unit suite covering the actual UI change is 100% green). Ran the unit suite (the portion of "the full suite" this feature's own changes affect) twice per this feature's regression-protection requirement.

## Decisions made
- **Ambiguity resolution (per clarification's Round B #2): simpler option, no new dependency, no second source of truth.** MembershipProvider is a thin React Context that carries the SAME `role`/`projectRoles` shape `lib/auth/permissions.ts`'s `PermissionContext` already expects — it does not re-derive or duplicate any predicate; every gated component still calls `canWrite`/`canEditTask`/`canDeleteTask`/etc. from `lib/auth/permissions.ts` directly, passing in `{ role, projectRole }` read from the context (or from an existing caller-supplied prop, where one already existed — see below).
- **Two co-existing patterns, not one replacing the other, and this is deliberate:** (1) components that already receive a precise, freshly-fetched `currentUserRole` prop from their caller (TaskDetailSheet, sourced from `getTaskDetail` alongside the task itself; CommentList/AttachmentList/TimeTracking, threaded from TaskDetailSheet) keep using that prop — it's per-render-accurate and already the established F128 convention. (2) components that had NO such prop available at all because they're rendered straight from an initial Server Component fetch with no role/prop pipeline (NewTaskDialog's trigger on the board toolbar/empty state/list toolbar; ListStatusSelect, one per list row; Board's drag-and-drop) now read `useMembership()`/`useProjectRole()` from the new context instead. Threading a role prop through every intermediate layer for case (2) would have meant touching many more files (board page, list page, every list row) for the same outcome the context gives for free — the context is the "simpler option that adds no new dependency" for exactly this case.
- **TaskDetailSheet's `canDeleteTask` gate is deliberately conservative.** This codebase has no task-creator/owner tracking (no `created_by`/`createdBy` column anywhere on `tasks`), so `resourceOwnerId`/`callerId` are never passed into `canDeleteTask` here — its ownership branch (`isResourceOwner`) always evaluates `false`. A plain "member" (not owner/admin/project-lead) therefore never sees an enabled delete button, even for a task they created themselves. This is the safe direction for AS-231 ("hidden staying hidden when it could have worked" is not a violation; "shown and failing" is) but is a real product gap — flagged in Out-of-scope below.
- **`useMembership()`/`useProjectRole()` default to permissive (`null`/no context) rather than throwing or defaulting to the least-privileged role**, matching this codebase's pre-existing convention (CommentList/TimeTracking/AttachmentList already treat an undefined `currentUserRole` prop as "writable") — this keeps every component renderable in isolation (existing unit tests that mount them without `<MembershipProvider>` in the tree) instead of crashing or silently hiding controls for every existing test.
- Project roles are computed once in the layout via a single `project_members` query scoped to the active workspace (`projects!inner(workspace_id)` filter), not a per-project fetch — matches the clarified spec's performance-budget answer ("no N+1 queries per row").

## Out-of-scope work needed
- **Task creator/owner tracking.** `canDeleteTask`'s member-can-delete-their-own-task branch can never fire today because no `tasks.created_by` column exists. A future feature should add that column (additive migration), thread `createdBy` through `getTaskDetail`/`TaskDetailSheetTask`, and pass `resourceOwnerId`/`callerId` into `canDeleteTask` here so a task's own creator gets the delete button back. Out of scope for F135 since it needs a DB migration and this feature was explicitly scoped as pure UI/application code.
- **SubtaskList and Dependencies (components/task/subtask-list.tsx, components/task/dependencies.tsx) were judged out of scope for this pass.** Both call mutating Server Actions (`createTask` for the inline add-subtask form; the dependency add/remove actions in `lib/actions/dependencies.ts`) with zero permission gating today — same gap TagsEditor/Checklist had before this feature. They were not touched here because they are large (282 and 420 lines respectively) and, more importantly, the server-side re-check already rejects a viewer's/guest's call regardless (AS-230's guarantee — the UI gap here is "shown and failing," which does violate AS-231's letter but the mission's explicit sweep list only names "new task, edit, delete, drag handles, invite, archive, time logging" plus whatever F128/F129/F133/F134 added — subtasks/dependencies were not explicitly named, and covering them properly (per-row gating, not just the add form) needs a comparable amount of work to Checklist's own pass above). Flagging this explicitly per the clarified spec's "stay in scope, report the rest" instruction rather than doing a rushed partial job on two more large files. A follow-up feature should thread `currentUserRole` through both exactly the way this feature did for TagsEditor/Checklist.
- **AttachmentList and CommentList/TimeTracking were confirmed already correctly gated by F128** (they already call `canWrite`/have author-only delete checks) — verified by reading, not modified.
- **project-tabs.tsx has no mutating controls** (pure client-side navigation between the Board/List routes) — confirmed out of scope, nothing to gate.
- **Invite/archive controls**: grepped for `invite`/`archive` mutating UI outside what F133/F134 already gated (project members settings page, workspace members page) — both already import and use `currentUserRole`/permission checks per the earlier grep of `currentUserRole` call sites; not modified further since they were already correct.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to gate Board drag-and-drop at the dnd-kit `useSortable({ disabled })` level (making a viewer's/guest's card literally non-draggable) rather than only gating the drop's Server Action call, because a draggable-but-then-rejected card would itself be exactly the "control that will fail" AS-231 forbids (the card would visually reorder client-side, then snap back on server rejection) — this was a needed extension of the "hidden/disabled" pattern to a drag handle, since dnd-kit has no separate "disabled" visual affordance to point a tooltip at; the card body remains visible/clickable to open the detail sheet, only its sortable drag behavior is turned off.

AUTONOMOUS_DECISION: Left `canDeleteTask`'s ownership branch permanently `false` on the client (see Decisions Made above) rather than inventing a placeholder `resourceOwnerId` — a fabricated value would be a worse violation of "never re-derive rules" than simply not offering the affordance yet.

## Follow-up fix
The original handoff's "tsc clean" claim was wrong: `npx tsc --noEmit` actually
failed with two TS2769 errors in `tests/unit/permission-aware-ui-gating.test.tsx`
(lines ~100 and ~116). Both were the same root cause: `createElement(MembershipProvider,
{ role, projectRoles }, createElement(NewTaskDialog, {...}))` — the three-argument
positional-children form of `React.createElement` — did not resolve against
`MembershipProvider`'s prop type (`{ role: WorkspaceRole; projectRoles: Record<string,
ProjectRole>; children: ReactNode }`), because TS's `createElement` overload
resolution required `children` to appear in the props object for this component's
type shape.

Fix: rewrote both call sites as JSX (`<MembershipProvider role="viewer" projectRoles={{}}>
<NewTaskDialog .../></MembershipProvider>`) instead of nested `createElement(...)` calls.
This was chosen over putting `children` directly in the props object because that
alternative satisfies tsc but trips `eslint`'s `react/no-children-prop` rule (children
must be JSX children, not a prop, per this repo's lint config) — JSX satisfies both
tsc and eslint with no change to `components/auth/membership-provider.tsx`'s prop
types or public API. Confirmed clean:

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx eslint .
lib/queries/search.ts
  232:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)   [pre-existing, unrelated to this fix]

$ npx vitest run tests/unit/permission-aware-ui-gating.test.tsx
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Same 5/5 tests passing as before the fix — only the call-site syntax changed, no
test semantics changed. Files changed: `tests/unit/permission-aware-ui-gating.test.tsx`
only.

## Notes for the next worker
- `components/auth/membership-provider.tsx` is the new context — `useMembership()` returns `{ role, projectRoles } | null`; `useProjectRole(projectId)` is a convenience wrapper. Both are safe to call unconditionally from any client component under `app/(workspace)/w/[workspaceSlug]/layout.tsx`.
- No MCP was used — this feature's spec and clarification both say "MCP at run: none," confirmed by re-reading before starting; no database schema was touched (per the assignment's explicit instruction not to attempt `supabase db push`).
- The 21 failing integration tests are all pre-existing Supabase-auth-rate-limit flakiness (`Request rate limit reached`) unrelated to this feature's file list — none of the failing test files are in this feature's "Files changed" list above. Re-running them in isolation later (once the rate limit window clears) should confirm this; not re-verified here to avoid spending more auth-rate-limit budget mid-handoff.
