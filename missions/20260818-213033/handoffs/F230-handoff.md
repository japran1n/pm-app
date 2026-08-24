# Handoff: F230 — My Tasks page

## Status
COMPLETE

## Assertions covered
AS-435: PASS — `getMyTasks` real query path, proven by `tests/integration/f230-my-tasks-query.test.ts` (`test_AS_435_lists_a_task_assigned_to_the_caller_in_a_project_they_can_see`, `test_AS_435_negative_excludes_a_task_assigned_to_the_caller_in_a_private_project_they_cannot_see`, `test_AS_435_a_multi_assignee_task_appears_exactly_once`, `test_AS_435_a_task_in_a_custom_renamed_done_category_column_is_marked_done_via_category_not_literal_text`, `test_AS_435_negative_excludes_tasks_in_archived_projects`, `test_AS_435_negative_excludes_trashed_tasks`) — all against a real signed-in session against the live Supabase project, driving `getMyTasks` (the exact function `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx` calls), never a raw admin-client query.
AS-436: PASS — bucketing logic unit-tested in `tests/unit/my-tasks-bucket.test.ts` (7 tests, incl. timezone-crossing case), plus `test_AS_436_a_task_far_in_the_past_is_bucketed_as_overdue` in the integration suite proving the real query's `row.bucket` field.
AS-439: PASS — `test_AS_439_each_returned_task_shows_its_project_name` (integration) asserts `row.projectName`/`row.projectId` on the real query result; the page's `MyTaskRowItem` renders `row.projectName` as a Badge on every row.

## Files changed
app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx (new)
lib/queries/my-tasks.ts (new)
lib/my-tasks/bucket.ts (new)
components/nav/app-sidebar.tsx (added "My Tasks" nav item above "Projects")
tests/unit/my-tasks-bucket.test.ts (new)
tests/integration/f230-my-tasks-query.test.ts (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 2 pre-existing warnings unrelated to this feature — `lib/queries/search.ts:280` and `tests/unit/invite-member-pagination.test.ts:186`, both `no-unused-vars` warnings that predate this feature)
`npx vitest run tests/unit/my-tasks-bucket.test.ts` (0 — 7/7 passed)
`npx vitest run tests/integration/f230-my-tasks-query.test.ts` (0 — 8/8 passed, real Supabase project)
`npx vitest run tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/app-sidebar-settings-nav.test.tsx` (0 — 7/7 passed; sidebar nav regression slice, unaffected by the new "My Tasks" entry)
`npx vitest run tests/unit/status-category.test.ts tests/unit/user-timezone.test.ts tests/unit/is-overdue.test.ts tests/unit/task-list-table.test.tsx` (0 — 27/27 passed; regression slice for the shared status-category/timezone/overdue helpers this feature reuses)
`npx vitest run` (full suite): 245/280 files passed, 1831/1985 tests passed, 34 failed, 120 skipped. All 34 failures are pre-existing integration-test failures unrelated to this feature (e.g. `tests/integration/workspace-role-expansion.test.ts` failing with "Something went wrong. Please try again in a moment." — Supabase Auth rate limiting, one of this mission's documented known infra conditions) plus one unrelated `cookies() outside request scope` warning from `getMentionCandidates` surfacing during `tests/unit/user-avatar.test.tsx`'s render (pre-existing, not touched by this feature). None of the 34 failing files import or exercise any file this feature touched.

## Decisions made
- Reused the RLS-scoped session client (`createClient()`), not `createAdminClient()`, for `getMyTasks` — `tasks_select_active_members`'s existing `public.is_project_visible_to(project_id)` RLS predicate (F132, `20260821140526_project_visibility_rls_sweep.sql`) already enforces private-project visibility for every row this cross-project query could return, so no second application-level visibility check (`isProjectVisibleToCaller`, which is documented as an admin-client-only helper) was needed or added — verified this holds via the integration test's private-project negative case.
- Assignment filtering uses `task_assignees!inner(user_id)` + `.eq("task_assignees.user_id", userId)` on the `tasks` query (mirroring `getWorkspaceListTasks`'s existing `projects!inner(...)` dotted-embed-filter pattern in the same file), rather than querying `task_assignees` as the base table — since the embed is used only to filter (not to select every assignee row), a multi-assignee task naturally returns exactly one row, with no dedup step needed.
- "Done"-ness and status display go through `project_statuses.category` (`isDoneStatus`, `lib/tasks/status-category.ts`) exactly like the board/list views, never a literal `status === "done"` string comparison.
- Archived-project/trashed-task exclusion mirrors `getWorkspaceListTasks`'s existing two-predicate approach (`projects!inner(..., deleted_at)` + `.is("projects.deleted_at", null)` + `.is("deleted_at", null)` on `tasks`) rather than selecting from the `active_project_tasks` view, because that view doesn't expose the `projects`/`project_statuses` embeds this query needs and duplicating its predicate inline matches the existing sibling function's own approach in the same file (not a new pattern).
- Did not touch `active_project_tasks` or any of its four dependent RPCs — no schema/view change was needed for this feature.

## Autonomous decisions
AUTONOMOUS_DECISION: "This week" is defined as a Monday-start ISO week (date-fns `endOfWeek(..., { weekStartsOn: 1 })`), computed from "today" in the caller's own timezone through that week's Sunday inclusive — the simplest option using only the date-fns primitives already in this codebase (tech-decisions.md: "date-fns — all calendar, timeline, recurrence, and timezone maths. No new date library"), no new dependency, no second week-math implementation.

AUTONOMOUS_DECISION: Bucketing is done purely by raw `due_date` vs. "today" comparison, independent of whether the task is marked done — unlike `isOverdueInTimeZone` (which deliberately excludes done tasks from the *overdue badge*). AS-435's wording ("lists tasks assigned to the caller") has no done-exclusion clause, so a completed task with a past due date is still listed (grouped by its actual due date), avoiding a second "is this task actually late" definition living alongside `isOverdueInTimeZone`'s own. A task with no due date at all falls into "later" (none of AS-436's four named buckets is a "no date" bucket, and "later" is the closest semantic fit).

## Out-of-scope work needed
- AS-437 (exclude archived projects and trash — already correctly enforced by this feature's query and integration-tested here, but the assertion itself is assigned to F231 per this feature's spec seam note) — F231 should add its own UX-level regression test rather than re-deriving the query logic.
- AS-438 (status change directly from My Tasks) — needs a client-side status-change control per row; this page currently only displays `row.status`/`row.statusCategory` read-only. F231 should add a small Client Component wrapper (reusing `ListStatusSelect`'s pattern, but per-row status options must come from THAT row's own project's `project_statuses`, not a single shared list, since projects can have different columns — `getProjectColumns` per distinct `projectId` present in the result, or a single query joining `project_statuses` per project, whichever keeps this within the performance budget).
- AS-440 (purposeful empty state with a permission-gated primary action) — this feature's empty state is a plain "No tasks are assigned to you yet." message (functionally correct, not a placeholder — it is reached via the real `getMyTasks` zero-row path) but has no primary action; F231 should add one (e.g. a link to Projects, or a "browse your projects" CTA) per the shared EmptyState convention.
- AS-441 (optionally include watched tasks) — not implemented; F231 should add a toggle (URL search param, per this codebase's "state in URL params for anything shareable" convention) that additionally queries `task_watchers` for the caller and merges those tasks into the same bucketed result, being careful to still dedupe a task that is both assigned AND watched (appears once).
- No `assigneeIds`/avatar display was added to `MyTaskRow` (kept the row shape minimal, matching only the three assigned assertions) — a future worker adding avatars should follow `TaskCardTask.assigneeIds`'s existing "always an array" convention rather than inventing a new shape.

## Blockers
(none — Status is COMPLETE)

## Notes for the next worker
- `getMyTasks` (lib/queries/my-tasks.ts) returns `MyTasksBuckets` (`{ overdue, today, thisWeek, later }`, each `MyTaskRow[]`) — F231 can import this type and the same function directly rather than re-querying.
- The page currently links each row to `/w/{workspaceSlug}/projects/{projectId}/board?taskId={id}` (opens the task's own project board) — there is no cross-project task detail route yet; if F231 (or a later Z. Task deep links feature, AS-473-478) adds one, this link target should be revisited.
- No MCP tools were needed for this feature — it only reads through existing RLS-backed tables/views (`tasks`, `task_assignees`, `projects`, `project_statuses`), all already introspected by prior features (F218-F223, F322/F323); confirmed via reading the relevant migration files directly (`20260821140526_project_visibility_rls_sweep.sql`, `20260824010000_project_statuses.sql`, `20260822010000_active_project_tasks_view_and_time_report_fix.sql`, `20260822020000_task_assignees_table.sql`) rather than a live schema MCP call, since no new table/policy was introduced.
