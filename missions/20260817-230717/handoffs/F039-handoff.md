# Handoff: F039 — task detail sheet

## Status
COMPLETE

## Assertions covered
(none — foundation/skeleton feature, no assertion IDs assigned per plan.md)

## Files changed
components/task/task-detail-sheet.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)
`npm test` (0) — 35 test files, 190 tests passed (pre-existing suite; no new tests added, see Decisions)

## Decisions made
- Built as a pure Client Component that receives `task` and `members` as props rather than a Server Component wrapper that fetches its own data, per the orchestrator's explicit task instructions: "just build the reusable Sheet component itself, exported cleanly, ready to be opened by future features (F042's board, F053's list)." There is no board/list page rendering real task cards yet (F042+), so there is no route to attach a Server Component data-fetch to today; a future feature wires this up.
- Assignee list is passed in via a `members: TaskDetailSheetMember[]` prop rather than fetched inside this component. `lib/queries/members.ts`'s `getWorkspaceMembers` (F017) is the reusable query for this — it already resolves workspace members with email/name via the Auth Admin client — but it's `async` and server-only (uses `createAdminClient`), so it can't be called from this Client Component. The intended integration is: a future Server Component page calls `getWorkspaceMembers(workspaceId)`, maps the `active` array to `{ userId, email, name }`, and passes it as `members`.
- Status field is rendered as a disabled `Select` with an explanatory code comment, not silently wired to a no-op or a nonexistent action. Checked `lib/actions/tasks.ts`: `editTask`'s `EditTaskUpdates` (from `lib/validation/tasks.ts`) covers `title`, `description`, `priority`, `dueDate` only — there is no Server Action that can persist a status change yet. Faking persistence (updating local state only) would have been misleading; disabling with a labeled tooltip/aria-label is the honest choice until a `changeTaskStatus`-equivalent action exists.
- Title/description/due date save on blur (calling `editTask`); priority and assignee save immediately on selection (`editTask`/`assignTask` respectively) — matches the existing inline-edit convention in `components/edit-project-dialog.tsx` and `components/member-role-select.tsx` (smallest-possible-client-boundary, `useTransition` + `sonner` toast per action).
- Local edit state (`title`/`description`/`dueDate`) is re-synced from `task` props during render (an `if` check comparing `task.id` to a `syncedTaskId` state value, resetting on close) rather than in a `useEffect`, because `eslint` (via `eslint-plugin-react-hooks`'s `react-hooks/set-state-in-effect` rule, already enabled in this repo's flat config) rejected the more obvious `useEffect(() => { setTitle(...) }, [open, task])` pattern as a cascading-render anti-pattern. This is the React-docs-recommended "adjusting state when a prop changes" pattern.
- Implemented all four states named in the clarified spec (loading/populated/empty/error) as explicit render branches. `loading` and `error` are optional props (default `false`/`null`) since this component doesn't fetch its own data yet — a future data-fetching caller drives them. `task === null` while `open` is `true` is the empty state.
- No temporary demo/trigger page was added. The spec explicitly frames this feature as "just build the reusable Sheet component itself" with a demo trigger only "if useful for manual testing" — given `tsc`/`eslint`/`build` all pass and there's no route to mount a demo in yet without inventing fake task data outside this feature's file scope (`components/task/task-detail-sheet.tsx` only, per the spec's Files section), a demo page was judged unnecessary scope creep rather than a required deliverable.

## Out-of-scope work needed
- A Server Action to persist task `status` changes (e.g. `changeTaskStatus(taskId, status)` mirroring `assignTask`'s pattern) is needed before the status Select in this component can be enabled. Until then it's rendered disabled.
- A future feature (F042 board or F053 list, or a small connective feature) needs to: (1) fetch a task's full detail server-side, (2) call `getWorkspaceMembers` for the `members` prop, (3) manage `open`/`onOpenChange` state from a clicked task card, and (4) mount `<TaskDetailSheet />`. This wiring was intentionally left out per this feature's scope (no real task cards exist yet).
- `lib/queries/members.ts`'s own documented known limitation (N Auth Admin API calls per member-list render) applies transitively once a page fetches `members` for this component — not something to fix here, just worth the next integrator's awareness.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose props-driven data (task/members passed in) over an internal fetch, and chose to disable rather than fake the status field, both per reasoning in "Decisions made" above — no spec ambiguity required a stop, these were reasoned defaults consistent with tech-decisions.md's Server Component/thin Client Component convention and the "never mislead the user about what was saved" spirit of this codebase's error-handling conventions (AS-146/AS-148 area, even though this feature has no assigned assertions).

## Notes for the next worker
- `components/ui/sheet.tsx`, `select.tsx`, `textarea.tsx`, `label.tsx`, `skeleton.tsx` were all already generated by shadcn (F002) and used as-is; no new shadcn components were added.
- No shadcn date-picker component was installed (checked `components/ui/` — none present); used a plain `<Input type="date">`, matching the existing convention in `components/edit-project-dialog.tsx`'s start/end date fields.
- `SelectTrigger`/`SelectItem` etc. come from `@base-ui/react`'s Select primitive wrapper (this repo's shadcn config), not Radix — `value`/`onValueChange` signatures match what's used in `components/member-role-select.tsx`.
- Component exports: `TaskDetailSheet`, plus types `TaskDetailSheetTask` and `TaskDetailSheetMember` for the next integrator to import.
