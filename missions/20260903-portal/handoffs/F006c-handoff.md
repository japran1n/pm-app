# Handoff: F006c — Make the phase actually persist, and finish the page-type seam

## Status
COMPLETE

## Assertions covered
AS-009: PASS — `create_project_from_template` now accepts `p_phases` and seeds `project_phases` inside the same transaction as the project/tasks. Verified via `npx tsc --noEmit`, `npm run db:apply`, and `tests/integration/project-from-template.test.ts` (3 new tests: phases seeded in order with correct `client_description`/`state` defaults, a template with no `phases` key still succeeds with zero phases created, and a direct-RPC atomicity test proves a malformed phase rolls back the whole call including its tasks).
AS-013: PASS — `getTaskDetail` now selects and returns `phase_id`/`phaseId`; `editTask` can also write it (cross-project validated). Verified via `tests/integration/f002-phase-management.test.ts`'s new `test_AS_013_getTaskDetail_returns_the_phase_a_reload_would_show` (calls the real `getTaskDetail`, not a mock) plus two more new integration tests for `editTask`'s phase write and its cross-project rejection. The previously-flagged unit test (`tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx`) is now typed against the real `GetTaskDetailResult` export and its doc comment makes clear it only proves UI reflection, not persistence.
AS-014: PASS — the task detail sheet's page-fields gate now checks `task.taskTypeSystemKey === "page"` instead of the type's name; `getTaskDetail` selects `task_types(name, system_key)`. `system_key` now has a real write path (`updateTaskType({ systemKey })`) in the task-types settings screen, with a friendly uniqueness message instead of a raw constraint error. The backfill is widened. Verified via `tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx` (new: "Sida" + `system_key='page'` shows the fields; "Page" name with no key hides them), the existing `tests/unit/f005-task-detail-sheet-page-fields.test.tsx` (updated to set `taskTypeSystemKey: "page"` alongside `taskTypeName`, since the gate moved), and `tests/integration/f006c-task-type-system-key-write-path.test.ts` (new: admin can set/clear the tag, a second tag attempt gets the friendly "already tagged" message not a raw `23505`, a plain member is rejected).

## Files changed
lib/actions/tasks.ts
lib/actions/task-types.ts
lib/actions/templates.ts
lib/validation/tasks.ts
lib/validation/task-types.ts
lib/validation/templates.ts
components/task/task-detail-sheet.tsx
components/workspace/task-type-manager.tsx
lib/supabase/database.types.ts (regenerated)
supabase/migrations/20260915010000_create_project_from_template_phases.sql (new)
supabase/migrations/20260915020000_task_type_system_key_backfill_widen.sql (new)
tests/integration/f002-phase-management.test.ts
tests/integration/project-from-template.test.ts
tests/integration/f006c-task-type-system-key-write-path.test.ts (new)
tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx
tests/unit/f005-task-detail-sheet-page-fields.test.tsx
tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx (new)

## Commands run
`npm run db:apply -- supabase/migrations/20260915010000_create_project_from_template_phases.sql` (0)
`npm run db:apply -- supabase/migrations/20260915020000_task_type_system_key_backfill_widen.sql` (0)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint <all files changed/added by this feature>` (0, 4 pre-existing-style warnings on unused `_taskId`/`_updates` mock params, no errors)
`npx vitest run tests/integration/f002-phase-management.test.ts tests/integration/f005b-task-type-system-key.test.ts tests/integration/f006c-task-type-system-key-write-path.test.ts tests/integration/project-from-template.test.ts tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx tests/unit/f005-task-detail-sheet-page-fields.test.tsx tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx tests/unit/f005b-task-type-manager-system-key-badge.test.tsx tests/integration/task-types-rls.test.ts tests/integration/portal-phases-rls.test.ts tests/unit/edit-task-start-date-validation.test.ts tests/integration/edit-task.test.ts` (0 — 99 tests passed)
`npx vitest run tests/integration/f323-sibling-action-project-visibility.test.ts tests/integration/task-detail-comment-read-path.test.ts tests/integration/f233-calendar-task-interactions.test.ts tests/integration/dependency-ui-actions.test.ts tests/integration/task-key-display-queries.test.ts tests/integration/estimate-minutes-query-wiring.test.ts tests/integration/recurrence-query-wiring.test.ts tests/integration/subtask-ui-detail.test.ts tests/integration/assignee-ids-query-wiring.test.ts tests/integration/task-detail-watchers.test.ts` (0 — 89 tests passed; sanity check that widening `getTaskDetail`'s select string didn't regress every other consumer)

Per the mission's instruction, the full `vitest` suite was NOT run — only the tests above (this feature's own + every existing suite that touches `getTaskDetail`, `task_types`, or project templates).

## Decisions made
- **`getTaskDetail` fix is purely additive.** Added `phase_id` and `task_types(name, system_key)` to the existing select and two new fields (`phaseId`, `taskTypeSystemKey`) to the returned `TaskDetailSheetTask` object. `setTaskPhase` (`lib/actions/phases.ts`) already wrote `phase_id` correctly since F002 — this was a read-path-only gap, confirmed by `grep -c "phase_id\|phaseId" lib/actions/tasks.ts` returning 0 before this change.
- **`editTask` also got a `phaseId` field**, per the spec's explicit Scope item 1 ("Thread phase_id through getTaskDetail and editTask"), even though the UI's own write path (`setTaskPhase`) already worked. Since `setTaskPhase`'s own cross-project check (`lib/actions/phases.ts:646-658`, itself citing `removeColumnWithReassignment` in `lib/actions/statuses.ts`) is real security-relevant validation Zod cannot express, `editTask` re-implements the identical check (fetch the phase, compare `project_id`) rather than skipping it — accepting an arbitrary phase id from any project would have been a real regression, not a faithful mirror of "the same validation the other task fields get."
- **The page-fields gate is additive alongside F005b's existing read-only "Portal" badge**, not a replacement — `tests/unit/f005b-task-type-manager-system-key-badge.test.tsx` (F005b, untouched) still asserts `getByText("Portal")`; the new write control renders as a second, separate `<Select>` only when `canManage`, labelled "Portal role" with options "No portal role" / "Portal's page type". Only `page` is exposed as a two-state toggle (not the full 5-value `system_key` enum the DB CHECK allows) because `page` is the only key anything in the app reads today, per `SYSTEM_KEY_EXPLANATIONS`' own pre-existing doc comment in that file.
- **Backfill widening matched exactly: `page`, `pages`, `sida`, `stranica`**, case-insensitive, whitespace-trimmed via `btrim()`. These are the four names M1-scrutiny.md's B4/B5 and this feature's own spec text name explicitly (grep: `missions/20260903-portal/milestones/M1-scrutiny.md:93`, `missions/20260903-portal/features/F006c-*.md:27,32,67`). Did NOT match "Page template" (mentioned only in F005b's spec as an example of a differently-named type, not confirmed by the scrutiny review as an actual page-type synonym) or attempt a broader fuzzy match — a false-positive backfill (tagging an unrelated type as the page type) is worse than a workspace needing one click in the new settings-screen control.
- **Backfill made collision-safe.** `20260912010000`'s own single-pattern backfill reasoned it could match at most one row per workspace because the name-uniqueness index forbids two rows with the same name — that reasoning breaks with four patterns at once (a workspace could have both a "Page" row and a separate "Pages" row). Used `distinct on (workspace_id)` with a priority order (exact "page" first) so this migration can never itself violate `task_types_workspace_id_system_key_idx`.
- **Project-template phases: only `name`/`client_description` are captured**, not `state`/dates — a template snapshots a phase's identity and its client-facing explanation, never an in-flight project's current progress. Freshly-seeded phases always start at the column default (`not_started`), mirroring `seed_default_phases`' own reasoning.
- **`create_project_from_template`'s old 5-arg signature was dropped, not left as a second overload** — Postgres treats a different parameter list as a distinct function under `create or replace`, so `drop function if exists ...(uuid, text, text, uuid, jsonb)` runs first, then the 6-arg version is created. Confirmed via `npm run db:apply` (both migrations applied cleanly) and `npm run db:gen-types` (regenerated types show `p_phases?: Json` on the same RPC entry, no duplicate).
- **Did not add `phase_id` to `diffTaskFields`/task activity logging** in `editTask` — out of scope per the spec's four numbered defects; noted below for a future feature if wanted.

## Out-of-scope work needed
- **Task activity log doesn't record phase changes made via `editTask` or `setTaskPhase`.** `diffTaskFields`/`writeTaskFieldChanges` in `editTask` covers title/priority/due date/start date/estimate only; a phase reassignment produces no activity-log entry today (via either write path). Not required by AS-013's text ("a team member can assign a task to a phase ... and the assignment survives a reload") but worth a small follow-up if activity-log completeness for phases matters.
- **`system_key` UI only exposes the `page` role**, not `qa`/`component`/`content`/`seo` — those four are reserved in the DB CHECK constraint (`20260912010000`) but nothing in the app reads them yet. When a feature wires one of them up, extend `task-type-manager.tsx`'s `<Select>` options and `SYSTEM_KEY_EXPLANATIONS` together, per that file's own doc comment.
- **The empty Pages view's copy still doesn't distinguish "no page type tagged in this workspace" from "no pages have been shared yet."** M1-scrutiny.md's FU-4 suggested this as a "better" alternative to (not a requirement alongside) widening the backfill + adding a write path — this feature did the latter two, which is a real, complete fix (a team can now always self-serve the tag from the settings screen). The empty-state copy split is a UX nicety on top, not implemented here — out of scope per this feature's own numbered defect list, which does not mention `components/portal/pages-table.tsx` or its empty state at all.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No `missions/20260903-portal/clarifications/F006c-*.md` file exists (this mission's M1-remediation features were opened directly by the orchestrator from the scrutiny review, not through the per-feature 20-question clarification phase). Resolved all four defects' open questions directly from the feature spec's own numbered Scope list, M1-scrutiny.md's FU-3/FU-4/FU-12, and grep-verified precedent in the existing codebase (`lib/actions/phases.ts`'s cross-project check, `lib/actions/status-templates.ts`'s admin-gated write pattern already followed by `updateTaskType`), per the `worker-mcp-usage` skill's ambiguity-resolution priority order (clarified spec → tech-decisions → grep-provable precedent → safest default).
AUTONOMOUS_DECISION: Chose to keep `editTask`'s new `phaseId` field's error message pattern ("That phase does not belong to this task's project.") as a literal string match with `setTaskPhase`'s own wording, rather than inventing new copy, since both surface the same underlying rule to the same audience (a team member editing a task).

## Notes for the next worker
- The Supabase MCP was not used (per this feature's own instructions: "The Supabase MCP is not authorised — use the CLI"). Migrations were applied and types regenerated via `npm run db:apply -- <file>` and `npm run db:gen-types`, both against the real linked Supabase project (`.env`'s credentials) — same as every prior worker in this mission.
- `git diff lib/supabase/database.types.ts` after regeneration is exactly one line (`p_phases?: Json` added to the `create_project_from_template` RPC's argument type) — worth spot-checking after any future RPC signature change that this stays a single, clean diff rather than a large unrelated reformat (would indicate the generator picked up unrelated schema drift).
- `tests/integration/f006c-task-type-system-key-write-path.test.ts` deletes all of its shared test workspace's `task_types` rows in `beforeEach` (not just `afterAll`) — needed because several tests in that file `insert` a row tagged `system_key = 'page'` directly via the admin client, and the partial unique index (`task_types_workspace_id_system_key_idx`) would otherwise collide across tests sharing one workspace. If adding more tests to this file, keep that `beforeEach` or give the new test its own workspace.
