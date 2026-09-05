# Handoff: F118 — Surface task types in the UI

## Status
COMPLETE

## Assertions covered
AS-064: PASS — `test_AS_064_a_task_created_through_the_new_task_dialog_carries_the_picked_task_type` / `test_AS_064_leaving_the_picker_untouched_never_forces_a_type_override` (tests/unit/f118-new-task-dialog-type-picker.test.tsx), plus `test_AS_064_createTask_persists_the_caller_supplied_task_type` / `test_AS_064_omitting_the_type_falls_back_to_the_workspace_delivery_default` against the real linked Supabase project (tests/integration/f118-task-type-picker-ui.test.ts).
AS-065: PASS (negative/vacuous case, per the assertion's own "when the entry point exposes a picker" wording) — `test_AS_065_quick_add_exposes_no_type_picker_and_creates_a_task_with_no_type_override` (tests/unit/f118-quick-add-no-type-picker.test.tsx). Quick-add's layout (a single collapsed-to-one-input control at the foot of each board column) has no room for a second field without a redesign this feature's own spec explicitly forbids — left untouched, still creates `delivery`-typed tasks via the DB default (F116), which is a safe, unchanged behaviour.
AS-066: PASS — `test_AS_066_an_existing_tasks_type_can_be_changed_and_is_visible_immediately_without_reload` / `test_AS_066_type_change_reverts_and_shows_an_error_toast_on_server_failure` (tests/unit/f118-task-detail-sheet-type-editor.test.tsx), plus `test_AS_066_setTaskType_changes_an_existing_tasks_type_without_touching_client_visible` against the real DB (tests/integration/f118-task-type-picker-ui.test.ts).
AS-067: PASS — `test_AS_067_changing_a_tasks_type_never_touches_client_visible` (tests/unit/f118-task-detail-sheet-type-editor.test.tsx) asserts the exact payload shape `setTaskType` is ever called with (`{ taskId, taskTypeId }` only); the real-DB integration test above additionally asserts `client_visible` is bit-for-bit unchanged after a real type swap between two types with different `default_client_visible` values.
AS-068: PASS — `test_AS_068_displays_tracked_and_estimated_hours_grouped_by_task_type` / `test_AS_068_renders_nothing_for_a_project_with_no_time_totals_yet` (tests/unit/f118-task-type-time-card.test.tsx). AS-062 (F116) already integration-tests `rpc_project_time_totals` itself against the real DB; this feature only adds the UI surface for it.

## Files changed
components/task/new-task-dialog.tsx
components/task/task-detail-sheet.tsx
components/task/task-type-time-card.tsx (new)
lib/actions/task-types.ts
lib/actions/tasks.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/hours/page.tsx
tests/unit/f118-new-task-dialog-type-picker.test.tsx (new)
tests/unit/f118-task-detail-sheet-type-editor.test.tsx (new)
tests/unit/f118-quick-add-no-type-picker.test.tsx (new)
tests/unit/f118-task-type-time-card.test.tsx (new)
tests/integration/f118-task-type-picker-ui.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/task/new-task-dialog.tsx components/task/task-detail-sheet.tsx components/task/task-type-time-card.tsx lib/actions/task-types.ts lib/actions/tasks.ts "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/hours/page.tsx" tests/unit/f118-*.test.tsx tests/integration/f118-task-type-picker-ui.test.ts` (0)
`npx vitest run tests/unit/f118-new-task-dialog-type-picker.test.tsx tests/unit/f118-task-detail-sheet-type-editor.test.tsx tests/unit/f118-quick-add-no-type-picker.test.tsx tests/unit/f118-task-type-time-card.test.tsx --no-file-parallelism` (0) — 8/8 PASS
`npx vitest run tests/integration/f118-task-type-picker-ui.test.ts --no-file-parallelism` (0) — 3/3 PASS, against the real linked Supabase project
`npx vitest run tests/unit/new-task-dialog.test.ts tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx tests/unit/f005-task-detail-sheet-page-fields.test.tsx tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx tests/unit/f246-task-detail-sheet-copy-link.test.tsx tests/unit/board-task-detail-sheet-wiring.test.ts tests/unit/task-detail-sheet-undo.test.ts tests/unit/set-task-type-cross-workspace-guard.test.ts tests/unit/f005b-task-type-manager-system-key-badge.test.tsx --no-file-parallelism` (0) — 56/56 PASS (5 unhandled-rejection warnings from `page-links-editor.tsx`'s `cookies()`-outside-request-scope pre-existing quirk, confirmed via `git stash` to be present identically on the unmodified baseline — not caused by this feature)
`npx vitest run tests/integration/template-actions.test.ts tests/integration/recurrence-scheduled-generation.test.ts tests/integration/create-task.test.ts tests/integration/extension-create-task.test.ts --no-file-parallelism` (0) — 30/30 PASS, confirming this feature's `createTask`/`lib/tasks/create.ts` signature change (added a trailing optional `taskTypeId` parameter) didn't regress any pre-existing caller (templates, recurrence, the extension route, the base create-task path)

## Decisions made

- **`quick-add.tsx` was left untouched, no picker added.** Its entire surface is a single collapsed-to-one-input control rendered at the foot of each board column (see that file's own doc comment on its layout constraints); adding a second interactive field there is a layout redesign, which this feature's own spec explicitly forbids ("If it does not fit without a layout change, leave it... Do not redesign quick-add.tsx to force a fit"). AS-065's own wording ("when the entry point exposes a picker") exists for exactly this case — its test documents the negative/vacuous outcome rather than skipping the assertion.
- **Added a `getProjectTaskTypeOptions(projectId)` Server Action to `lib/actions/task-types.ts`** — a thin, read-only wrapper (via `withAuthz`, `requireVisibility: true`, no `requireWrite`) around F116's own already-tested `getTaskTypes(workspaceId)` query, scoped to a project so two Client Components (`NewTaskDialog`, `TaskDetailSheet`) that only know a `projectId` don't need their many Server Component callers individually threaded with a new `taskTypes` prop. Exact same shape as the pre-existing `getProjectPhaseOptions` (lib/actions/phases.ts) this feature's own spec pointed to as the model. This is a **read wrapper**, not new business logic/validation/RPC — it does not violate the "no new validation, no schema change, no new RPC" scope boundary.
- **`createTask` (lib/actions/tasks.ts) gained one new trailing optional parameter, `taskTypeId`**, threaded straight through to `createTaskForUser` (lib/tasks/create.ts), which already accepted and validated it end-to-end per F116's own handoff ("`createTaskSchema.taskTypeId` is wired end-to-end and ready... nothing currently supplies it"). This is wiring, not new validation — every check (cross-workspace ownership, `default_client_visible` seeding) already existed and is exercised by the new integration test. Every existing caller of `createTask` (quick-add, the board empty state, tests) is unaffected since the new parameter is optional and trailing.
- **`getTaskDetail` (lib/actions/tasks.ts) now also selects and returns `task_type_id` as `taskTypeId`** on `TaskDetailSheetTask` — previously only the joined `task_types(name, system_key)` display fields were returned, with no raw id for a write path to target. Added as one more column on the existing select (no second round trip), same as every other field on this task already works.
- **The type editor in `task-detail-sheet.tsx` follows the exact optimistic + confirmed-mirror pattern the Phase Select (F002) and Priority Select (F004) already established** — same `useOptimistic`/`useState` undefined-baseline shape, same `startSaveTransition`, same toast conventions — rather than inventing a new interaction pattern for this one field.
- **The type editor never renders a "no type" option** and `handleTaskTypeChange` early-returns on a falsy value — a task always has a type (F116/AS-058), so unlike Priority/Phase there is no legitimate "clear" case to model.
- **The time-by-type card (`components/task/task-type-time-card.tsx`) is a plain Server Component**, not a Client Component — it renders once per page load from data already fetched server-side (`getProjectTaskTypeTimeTotals`, F116's existing RPC wrapper), with zero interactivity, matching the spec's explicit "no chart, no trend line, no filtering UI" instruction literally.
- **Placed the time-by-type card on `hours/page.tsx`** (the project's team-only "Hours" surface, gated identically: a client-role caller gets `notFound()`), not `settings/page.tsx` — this project has no single dedicated "overview" route; `hours/page.tsx` is the closest existing surface already about a project's time, and the spec allows either "overview or settings." Rendered unconditionally on that page (not date-window-scoped like the rest of that page's team-hours breakdown), since `rpc_project_time_totals` itself reports a project's whole-lifetime totals with no period parameter — per F116's own doc comment on that RPC ("one row of numbers, no charts, no trends").

## Out-of-scope work needed

1. **`is_billable` still has no admin write path in the UI** (workspace-created custom types can't set it either) — pre-existing gap noted in F116's own handoff, unchanged by this feature; out of scope per this feature's spec.
2. **The command palette's task-creation action, the onboarding tour, the browser extension route, and template/recurrence creation paths still create untyped-by-user (delivery-default) tasks** — explicitly out of scope for this feature (see spec's "Out of scope — do not touch"); a follow-up could extend the picker to the command palette specifically once the concurrent chat/command-palette session's own work has landed and this repo's `components/command/*` is safe to touch again.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Chose `hours/page.tsx` over `settings/page.tsx` for the time-by-type card's placement, since this codebase has no single project "overview" route and the spec explicitly allows either surface — `hours/page.tsx` is the more topically relevant of the two (it's already entirely about a project's time).

AUTONOMOUS_DECISION: Added a new `getProjectTaskTypeOptions` Server Action (a read-only wrapper, not new business logic) rather than reusing `getTaskTypes` directly from the two Client Components — Server Actions can be called directly from Client Components in this codebase's established convention (see `getProjectPhaseOptions`'s own doc comment), but a raw `lib/queries/*` function (which calls `createClient()` from `next/headers` cookies) cannot be imported into a Client Component bundle at all.

## Notes for the next worker

- No MCP tools were used — this feature touches no live external service configuration; the mcp-registry.md's Supabase entry didn't need consulting since no schema/RPC/policy changed (per this feature's own explicit "no new schema, no new RPC, no new validation" scope).
- Did not touch `components/command/*`, `app-sidebar.tsx`, or `components/chat/*`, and did not run a dev server on port 3000, per the concurrent chat/command-palette session's own constraints.
- `list-task-type-select.tsx` (F116's own inline editor for the project List view row) already existed and needed no changes — it's a separate, already-complete surface from the three this feature adds (New Task dialog, task detail sheet, project hours page).
