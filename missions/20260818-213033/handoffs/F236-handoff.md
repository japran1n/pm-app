# Handoff: F236 — db-task-start-date

## Status
COMPLETE

## Assertions covered
AS-453: PASS — a task can have a start date, which must not be after its due date. Covered by: DB CHECK `tasks_start_date_not_after_due_date` (raw admin insert/update, bypassing Zod) in `tests/integration/tasks-start-date.test.ts` (11/11 passing); Zod cross-field refine in `tests/unit/edit-task-start-date-validation.test.ts` (8/8 passing); `editTask` real set/clear in the same integration file.

## Files changed
supabase/migrations/20260828010000_tasks_start_date.sql (new)
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript --linked`; content ended up byte-identical to what was already committed, so `git status` shows no diff for this file — verified `start_date` is present in the generated types)
lib/validation/tasks.ts (startDate field on `editableFields`, cross-field `superRefine` on the partial-updates schema)
lib/actions/tasks.ts (`editTask`: select/update/diff/return `start_date`/`startDate`; `getTaskDetail`: select + map `start_date` -> `startDate`; DB CHECK violation mapped to a field-level error message)
lib/activity/task-activity.ts (`TaskActivityField`/`TaskFieldSnapshot`/`FIELD_KEY_MAP` extended with `start_date`, additive, no DB CHECK on `p_field` so this is safe)
lib/activity/format-task-activity-entry.ts (new `"start_date"` case in the field-changed sentence switch, mirroring `"due_date"` minus its recurrence special-case)
components/task/task-detail-sheet.tsx (`TaskDetailSheetTask.startDate`, local state, re-sync, `handleStartDateChange`, a Start date `<Input type="date">` immediately above the existing Due date input)
tests/integration/tasks-start-date.test.ts (new)
tests/unit/edit-task-start-date-validation.test.ts (new)

## Commands run
`npx supabase db push` (0) — applied `20260828010000_tasks_start_date.sql` against the linked project
`npx supabase gen types typescript --linked` (0) — regenerated database.types.ts
`npx tsc --noEmit` (0) — clean, zero errors
`npx eslint .` (0) — zero errors, 2 pre-existing unrelated warnings (`lib/queries/search.ts` unused `_titleMatches`, `tests/unit/invite-member-pagination.test.ts` unused `_columns`), both present before this feature's changes
`npx vitest run tests/unit/edit-task-start-date-validation.test.ts` (0) — 8/8 passed
`npx vitest run tests/integration/tasks-start-date.test.ts` (0) — 11/11 passed
`npx vitest run tests/integration/edit-task.test.ts tests/unit/task-activity-diff.test.ts tests/unit/format-task-activity-entry.test.ts tests/integration/f322-single-task-project-visibility.test.ts` (0) — regression slice, 76/76 passed
`npm run test` (1 — see Notes below; failures are pre-existing infra, not this feature)

## Decisions made
- Ordering rule (Draft scope's open question): a `start_date` must not be AFTER `due_date`. Both null is fine, either one null with the other set is fine ("single-day bar" case named in the Draft scope, feeds F237's timeline). Enforced by CHECK `start_date is null or due_date is null or start_date <= due_date`, mirrored by a Zod `superRefine` on `editTaskSchema`'s `updates` object that only fires when BOTH `startDate` and `dueDate` are present in the SAME `editTask` call (a call touching only one field has no client-side visibility into the row's existing other value — the DB CHECK is the real last line of defense for that case, verified by its own test).
- Verified MCP-eligible service (Supabase, `Worker use: yes` per `mcp-registry.md`) touches: used `npx supabase db push` / `supabase gen types typescript --linked` (the CLI path this repo's other migrations consistently use) rather than the Supabase MCP tools directly, matching every recent sibling migration's own Commands-run convention (`project_statuses`, `saved_views`) — no MCP schema-introspection call was needed since the migration applied cleanly on the first `db push` and `gen types` confirms the live schema directly.
- `TaskActivityField`/`TaskFieldSnapshot` (lib/activity/task-activity.ts) extended with `start_date`, and a matching sentence case added to `format-task-activity-entry.ts`, even though the feature spec's Files list didn't name these two files. Justification: F236's own instruction says "A column nobody can set is exactly the built-but-not-wired failure ... do not ship one" — `editTask` already calls `diffTaskFields`/`writeTaskFieldChanges` for every editable field (title/priority/due_date/estimate_minutes), and `TaskFieldSnapshot` is a CLOSED type; adding `start_date` to `editTask`'s diff call without extending this type would not compile, and omitting it from the diff call entirely would silently drop start-date changes from the task's own activity feed — the exact wired-vs-not gap the spec explicitly warns against. Kept minimal: no new migration (the RPC's `p_field` column has no CHECK), reused the existing sentence-switch shape.
- Recorded in the migration's own inline doc comment (and fixed after a first test run caught it): `tasks.project_id` has **no** `ON DELETE CASCADE` (only `project_statuses.project_id` does) — the real project-delete flow, and every existing integration test's own teardown, deletes a project's tasks first, then the project. My "cascade-path safety" test was updated to match that real flow rather than assuming a cascade that doesn't exist on `tasks`.

## Out-of-scope work needed
- F237 (timeline itself): needs a range query across `[start_date, due_date]` — `tasks_start_date_idx` (btree on `start_date` alone) is added here per the performance-budget answer, but F237 should check whether a combined `(start_date, due_date)` index or a GiST range index is warranted once its actual query shape is known; not added here since this feature's scope is the column + edit path only.
- `createTask`/`createTaskSchema` was deliberately NOT given a `startDate` field — the feature spec's Files list names only `lib/validation/tasks.ts` (used for `editTaskSchema`) and `components/task/task-detail-sheet.tsx`; the create-task dialog (`components/task/new-task-dialog.tsx`) was out of scope. A task's start date can currently only be set after creation, via the detail sheet's edit path. If F237's timeline needs "set a start date at creation time," that's a new, explicitly-scoped follow-up.
- `bulkUpdateTasks` (lib/actions/tasks.ts, F186) was not extended with a `startDate` bulk-edit field — its own doc comment says its writable field set is deliberately narrower than `editTaskSchema`'s (bulk-safe fields only), and the F236 spec's Files list doesn't name it. If bulk start-date editing is wanted, that's a new feature.
- `createTask`/`duplicateTask`/`create_project_from_template`/the recurrence generator do not set `start_date` at all — every new/duplicated/templated/recurring task starts with `start_date = null`, which is correct per "no backfill guessing," but is worth flagging: a recurring task's generated occurrence never inherits a start-date offset from its source (only `due_date` is recurrence-aware). If recurring tasks should carry a start-date offset once the timeline exists, that's F237/F238+ scope, not this feature's.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: extended `lib/activity/task-activity.ts` and `lib/activity/format-task-activity-entry.ts` (not named in the feature's Files list) to keep `start_date` changes wired into the existing per-field activity feed, per the ambiguity-resolution default (simplest option, no new dependency/second source of truth) and the spec's own explicit warning against shipping an unwired column. See Decisions made above for the full justification.
AUTONOMOUS_DECISION: chose "both null is valid, either-one-null-with-the-other-set is valid, only start > due (when both present) is rejected" as the ordering rule, per the Draft scope's own wording ("null or `<= due_date`") and its explicit "including a null due date with a set start date" test note.

## Notes for the next worker
- `npm run test` (full suite) has 22 failed test files / 33 failed tests, but NONE reference `start_date`, `editTaskSchema`, `task-detail-sheet.tsx`, `task-activity.ts`, or the new migration. Every failure I inspected is one of the two documented pre-existing infra conditions: (1) Supabase Auth "Request rate limit reached" cascading through nearly every auth-heavy integration test (`rls-*`, `invite-member`, `workspace-role-expansion`, `checklist-actions`, `notification-*`, `recurrence-scheduled-generation*`, etc.) once enough throwaway users were created across the run, and (2) `tests/unit/trash-list.test.tsx`'s pre-existing "invariant expected app router to be mounted" Next.js router-mount error, unrelated to this feature. I re-ran the narrower regression slice (`edit-task.test.ts`, `task-activity-diff.test.ts`, `format-task-activity-entry.test.ts`, `f322-single-task-project-visibility.test.ts`) plus my own two new test files in isolation and all 76+8+11 = 95 passed cleanly — the rate-limit cascade only appears once the full suite runs hundreds of `auth.admin.createUser`/`signInWithPassword` calls back to back.
- Did not run Playwright — per this feature's own instructions, every authenticated Playwright spec currently fails in the shared login helper (pre-existing, not this feature's to fix), and this feature has no new UI surface that isn't already covered by the task-detail-sheet's existing due-date Playwright coverage pattern (there wasn't one to begin with — dueDate itself has no dedicated e2e spec either, confirmed by `grep -rl dueDate e2e/` returning nothing beyond the one shared login helper file all specs already fail in).
- MCP: no live Supabase MCP tool calls were needed for this feature — schema introspection/verification was done via `supabase db push` + `supabase gen types typescript --linked` against the linked project directly (same convention every recent sibling schema migration in this milestone used), which is an equally direct verification of the live schema.
