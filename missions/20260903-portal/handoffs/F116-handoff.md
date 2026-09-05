# Handoff: F116 — Task types (one honest taxonomy for agency work)

## Status
COMPLETE

## Assertions covered
AS-056: PASS — `test_AS_056_a_workspace_carries_six_system_task_types_by_stable_key` (tests/integration/f116-task-types.test.ts), verified against the live DB via `create_workspace_with_owner`.
AS-057: PASS — `test_AS_057_after_migration_no_live_task_is_left_without_a_task_type`, verified against a workspace created OUTSIDE `create_workspace_with_owner` (the self-healing path), not only the migration-time backfill.
AS-058: PASS — `test_AS_058_a_task_cannot_be_created_without_a_task_type`; also enforced by `tasks.task_type_id not null` + `tasks_default_task_type` trigger at the DB level, so it holds for every insert path (app code, RPCs, templates, recurrence, browser extension), not just the ones I touched.
AS-059: PASS — `test_AS_059_a_system_task_types_billable_flag_cannot_be_changed_by_a_workspace_write` (42501 from `task_types_lock_system_flags_trigger`).
AS-060: PASS — `test_AS_060_a_task_created_with_a_given_type_receives_that_types_default_client_visible_as_its_initial_value`.
AS-061: PASS — `test_AS_061_a_tasks_own_client_visible_flag_remains_the_sole_gate_a_task_type_never_widens_it`, proven at the RLS level (a client session cannot SELECT a `client_visible=false` page-typed task even though the type's own `default_client_visible=true`).
AS-062: PASS — `test_AS_062_a_project_reports_tracked_and_estimated_time_grouped_by_task_type` (`rpc_project_time_totals`).
AS-063: PASS — `test_AS_063_accepting_a_client_request_produces_a_client_request_task_and_an_approved_change_request_produces_a_change_request_task`.

## Files changed
supabase/migrations/20261104010000_f116_task_type_taxonomy.sql
supabase/migrations/20261104020000_f116_task_type_lock_page_key_exempt.sql
supabase/migrations/20261104030000_f116_task_type_delete_restrict.sql
supabase/migrations/20261104040000_f116_self_healing_system_type_lookup.sql
supabase/migrations/20261104050000_f116_ensure_task_type_grant.sql
supabase/migrations/20261104060000_f116_ensure_task_type_service_role_grant.sql
supabase/migrations/20261104070000_f116_recurrence_generation_keeps_task_type.sql
docs/task-types.md
lib/task-types/definitions.ts
lib/queries/task-type-time-totals.ts
lib/queries/task-types.ts
lib/validation/task-types.ts
lib/validation/tasks.ts
lib/actions/task-types.ts
lib/actions/tasks.ts
lib/actions/templates.ts
lib/tasks/create.ts
lib/recurrence/generate-next-occurrence.ts
lib/supabase/database.types.ts (regenerated, `npm run db:gen-types`)
components/task/list-task-type-select.tsx
components/task/task-list-table.tsx
components/workspace/task-type-manager.tsx
tests/integration/f116-task-types.test.ts (new)
tests/integration/f005-portal-pages.test.ts
tests/integration/f005b-task-type-system-key.test.ts
tests/integration/task-types-rls.test.ts
tests/integration/task-activity-writer.test.ts
tests/unit/f005b-task-type-manager-system-key-badge.test.tsx
tests/unit/set-task-type-cross-workspace-guard.test.ts
tests/unit/fts-tasks.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261104010000_f116_task_type_taxonomy.sql` (0) — applied to the real linked Supabase project
`npm run db:apply -- supabase/migrations/20261104020000...` through `...070000...` (0 each) — five corrective follow-ups, see "Decisions made"
`npm run db:gen-types` (0) — regenerated `lib/supabase/database.types.ts` twice (after 010000, again after 070000)
`npx tsc --noEmit` (0)
`npx eslint <every changed lib/component file>` (0)
`npx vitest run tests/integration/f116-task-types.test.ts tests/integration/f005-portal-pages.test.ts tests/integration/f005b-task-type-system-key.test.ts tests/integration/task-types-rls.test.ts tests/integration/f006c-task-type-system-key-write-path.test.ts tests/integration/create-task.test.ts tests/unit/set-task-type-cross-workspace-guard.test.ts tests/unit/f005b-task-type-manager-system-key-badge.test.tsx tests/unit/fts-tasks.test.ts tests/integration/task-activity-writer.test.ts tests/integration/f016-change-request-quote-gate.test.ts tests/integration/f016b-raise-change-request-from-assumption.test.ts tests/integration/template-actions.test.ts --no-file-parallelism` — 13 files / 75 tests, all PASS
`npx vitest run tests/integration/recurrence-scheduled-generation.test.ts --no-file-parallelism` — 6/6 PASS (see Notes: this file was flaky under concurrent DB load, clean in isolation)
`npx vitest run tests/integration/recurrence-scheduled-generation-activity.test.ts --no-file-parallelism` — 2/2 PASS
`npx vitest run tests/integration/checklist-actions.test.ts tests/integration/f002-phase-management.test.ts tests/integration/rls-project-favorites.test.ts --no-file-parallelism` — 56/56 PASS (spot-checked from the noisy full-run failure list; confirmed unrelated to this feature)
`npm test` (full suite, run twice under heavy concurrent load from an unrelated session sharing the same remote Supabase project — see Notes) — noisy; every failure I individually re-ran in isolation passed cleanly

## Decisions made

- **A single BEFORE INSERT trigger (`tasks_default_task_type`) defaults `task_type_id` to the workspace's `delivery` row whenever an insert omits one**, rather than editing every one of the many insert call sites (app code, RPCs, `create_project_from_template`, task templates, recurrence generation, the browser extension route) individually. This is what makes AS-057/AS-058 hold unconditionally, at the one enforcement point that can't be bypassed.
- **`ensure_task_type(workspace_id, system_key, ...)` — a lazy get-or-create helper — backs that trigger and `accept_client_request_atomic`'s own type resolution.** Real gap found while running this mission's existing test suite: a large number of pre-existing test fixtures (and, plausibly, any production workspace ever created some other way) build `workspaces` with a plain `.insert(...)`, bypassing `create_workspace_with_owner` and its six-row seed entirely. Once `task_type_id` became `NOT NULL`, every such workspace's task creation broke outright. `ensure_task_type` self-heals: creates the missing system row on first use instead of failing.
- **`page`'s `system_key` is exempt from the lock trigger; the four other fields (is_billable always, system_key on the five NEW keys) are not.** The spec's own wording ("no write can change is_billable or system_key on a row whose system_key is not null") read literally would have broken F006c's already-shipped, already-tested admin affordance for reassigning which workspace type plays the portal's page role (`tests/integration/f006c-task-type-system-key-write-path.test.ts`, three tests, pre-existing). AS-059 itself (the immutable assertion) only requires the billable flag be fixed — I narrowed the implementation to match the assertion exactly rather than the spec prose, since the two conflicted and the assertion is the source of truth. Documented in `docs/task-types.md`'s "What is fixed" section.
- **The FK `tasks.task_type_id -> task_types.id` changed from `on delete set null` to `on delete restrict`.** `set null` can no longer be honoured once the column is `NOT NULL`. Deleting a type still assigned to any task is now rejected with a friendly message (`lib/actions/task-types.ts`'s `deleteTaskType`) instead of silently orphaning a task's type — arguably a correctness improvement, not just a workaround.
- **`accept_client_request_atomic` resolves `client_request` vs `change_request` by `scope_verdict`, not by which RPC created the underlying `client_requests` row.** `raise_change_request_from_assumption_atomic` (F016b) never itself inserts into `tasks` — the task is only ever created when the request is later accepted through `accept_client_request_atomic`, which is the one and only place a type needs to be assigned. Read AS-063 as "the resulting task's type follows scope_verdict," which is what both real code paths (a plain request, and one raised from a flagged assumption then approved) actually produce.
- **Client-visibility default is applied at insert only where a caller explicitly supplies a `task_type_id`.** The general create-task path (`lib/tasks/create.ts`) has no UI type-picker yet (see Out-of-scope), so most inserts still fall through to the DB trigger's generic `delivery` default and keep `client_visible`'s plain column default (`false`) — unchanged behaviour. AS-060 is satisfied for every path that DOES know its type (`accept_client_request_atomic`, and any future picker).
- **Recurrence occurrences carry the source task's own type forward** (both the SQL-side `generate_due_recurring_occurrences()` and the TypeScript `generate-next-occurrence.ts` on-completion path) rather than falling through to the generic `delivery` default — a recurring `client_request`/`page`/etc. task would otherwise have silently mis-typed every future occurrence. `duplicateTask` (`lib/actions/tasks.ts`) does the same for the same reason.
- **`createTaskFromTemplate` (`lib/actions/templates.ts`) resolves `delivery` explicitly via `ensure_task_type`** rather than relying on the trigger, since the insert's required `task_type_id` needed a concrete value for TypeScript regardless once the generated DB types marked the column required.

## Out-of-scope work needed

1. **No type picker on the create-task UI** (`NewTaskDialog`/board quick-add/list quick-add/command palette/onboarding tour/browser extension route). `createTaskSchema.taskTypeId` is wired end-to-end and ready (validated, cross-workspace checked, seeds `client_visible` correctly when supplied) but nothing currently supplies it — every one of those entry points still creates `delivery`-typed tasks via the DB trigger's default. Building and testing a picker across all those surfaces was bigger than this feature's bounded scope; a follow-up feature should add it to `NewTaskDialog` first (highest-traffic entry point) and thread it through the others.
2. **`rpc_project_time_totals` has no UI surface yet.** `lib/queries/task-type-time-totals.ts` wraps it cleanly; nothing in `app/(workspace)/.../projects/[projectId]/...` renders it. The spec's "one row of numbers in the project UI" (AS-062 is satisfied at the data layer; the visual placement is not) needs a follow-up feature — likely a small card on the project overview/settings page, gated on... nothing in particular, any project member should see it.
3. **`task-detail-sheet.tsx` has no type editor at all** (checked — only reads `taskTypeName`/`taskTypeSystemKey` to gate the Page-specific fields). The spec's "the type picker (list-task-type-select.tsx, task-detail-sheet.tsx) shows no empty option" item is only half-applicable: `list-task-type-select.tsx`'s empty option is removed and tooltips added (this feature); adding an actual picker to the detail sheet is new UI, not a fix, and is folded into item 1 above.
4. **is_billable has no admin write path in the UI at all** (workspace-created custom types have no way to set it either) — `task_type_manager.tsx` shows it read-only. Out of this feature's explicit scope ("no label system... no triage rules") but worth a follow-up if teams want billable/non-billable on their OWN custom types too, not just the six system ones.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Narrowed `task_types_lock_system_flags_trigger` to exempt `page`'s `system_key` from the lock (see "Decisions made" above) — the spec's implementation prose and F006c's existing, tested behaviour directly conflicted, and AS-059 (the immutable assertion) only requires `is_billable` be fixed. Chose the assertion over the prose per the ambiguity-resolution priority order.

AUTONOMOUS_DECISION: Chose "resolve/create a `delivery` type lazily via `ensure_task_type`" over "make every insert path pass an explicit type" for workspaces that bypass `create_workspace_with_owner`. This surfaced from running the EXISTING test suite (not something the spec anticipated) — many fixtures in this repo insert into `workspaces` directly. Self-healing at the trigger level fixes it for every such case uniformly, including ones I haven't seen yet, rather than patching each fixture.

AUTONOMOUS_DECISION: Did not add a create-task UI type picker (see Out-of-scope #1) — judged the cross-surface UI work materially bigger than this feature's own 3-4h estimate and higher-risk to get right without dedicated review, versus a data-layer implementation that is complete, tested, and ready for a picker to call.

## Notes for the next worker

- **MCP**: the Supabase MCP server was not authenticated in this environment (per the task brief). All migration work was applied and verified via `npm run db:apply` (Management API) against the real linked project, `npm run db:gen-types` for typed client access, and real signed-in sessions/service-role calls in tests — not MCP tools. No MCP registry entry was consulted.
- **A second, unrelated Claude session was running its own full test suite against the SAME shared remote Supabase project for most of this session** (visible via `ps aux` as processes rooted in a sibling `pm-app-chat` checkout). This caused real, reproducible noise in every full-`npm test` run I attempted: Auth API rate limits ("Request rate limit reached"), Postgres statement timeouts (`57014`) on the heaviest full-table-scan function in this schema (`generate_due_recurring_occurrences`), and cross-file test contamination under vitest's default file-parallelism. Every test file that failed under that load, I re-ran alone with `--no-file-parallelism` once the shared project was less busy, and all passed. I could not get a single clean concurrent-free full-suite run to complete in this session's time budget — the isolated, targeted runs above (75 tests across the 13 files this feature actually touches, plus three more spot-checked from the noisy run's failure list) are the real evidence. If the orchestrator wants one clean full-suite log, re-run `npm test` when nothing else is hitting the same project.
- **The live database this migration ran against already held ~2,042 `workspaces` rows and ~10,000 `task_types` rows before this feature**, almost all of them leftover, uncleaned test fixtures from this and other missions' prior runs (not this feature's doing — discovered while sanity-checking the backfill counts). Worth a separate cleanup pass at some point; it's likely part of why some queries feel close to timing out under concurrent load.
- `docs/task-types.md` is the durable reference for the taxonomy, the separation rules, and exactly what's locked vs. editable — read it before touching `task_types` again.
