// Data-fetching for the project Board view (F042: AS-067, AS-068).
//
// Uses the normal RLS-respecting client — `tasks_select_active_members`
// (supabase/migrations/20260818013805_rls_tasks.sql) already scopes rows to
// tasks in projects owned by workspaces the caller is an active member of,
// so this query is workspace-scoped for free by construction (a caller can
// only ever reach this page for a project in a workspace they belong to,
// via the project detail layout's guard). An explicit `deleted_at is null`
// filter is still applied here per tech-decisions.md's soft-delete
// convention ("all SELECTs used by the app ... filter deleted_at IS
// NULL"), even though RLS already enforces it.
//
// `.eq("project_id", projectId)` additionally scopes to exactly the
// requested project (AS-068's "scoped to the current project"), never
// leaking a task from a different project in the same (or another)
// workspace.
//
// Ordered by `position` ascending within the result set — the board page
// then buckets rows by status client-side (Server Component, not a client
// component) to build each of the 4 fixed columns, so within any one
// column the rows arrive already in position order.

import { createClient } from "@/lib/supabase/server";
import type { TaskCardTask } from "@/components/task/task-card";
// F154 (AS-272, AS-273): completion percentage combines checklist and
// child-task counts. F279 (AS-156) moved the actual counting server-side
// into the `get_project_board_tasks` RPC (lateral joins, one round trip)
// instead of assembling `countSubtaskProgress`/`countChecklistProgress`
// results here in TypeScript — this file no longer needs those two
// counters directly, only `computeTaskCompletion`, which still combines
// the RPC's already-counted totals into the same done/total/percent
// shape as before.
import { computeTaskCompletion } from "@/lib/tasks/completion";
import { getTaskLoggedMinutes } from "@/lib/queries/time-entries";
import type { RecurrenceRule } from "@/lib/recurrence/next-date";
import { isOverdue } from "@/lib/tasks/is-overdue";
import { isDoneStatus } from "@/lib/tasks/status-category";
import { todayInTimeZone } from "@/lib/time/user-timezone";

// F146 (AS-258): every embedded `projects` relation below can come back
// from PostgREST as either a single object or a one-element array
// depending on the generated relationship cardinality — this codebase's
// existing convention (lib/actions/tasks.ts's assignTask/editTask/etc.,
// all pre-dating this feature) normalizes it inline with this same
// `Array.isArray` check at every call site rather than trusting a single
// shape, so this helper just centralizes that one-line pattern for the
// three query functions in this file.
function firstRelated<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

export async function getProjectBoardTasks(
  projectId: string,
): Promise<TaskCardTask[]> {
  const supabase = await createClient();

  // F279 (AS-156): F150/F154/F157 originally each added their own
  // whole-project round trip here (child/subtask rows, checklist rows,
  // open-blocker rows) on top of the main task select — four separate
  // network round trips to a remote Supabase project, which is what
  // pushed AS-156's p95 measurement over the 500ms budget (measured
  // p95=520.6ms before this change). All four are now folded into one
  // Postgres RPC, `get_project_board_tasks`
  // (supabase/migrations/20260819110000_rpc_project_board_tasks.sql),
  // which computes the same subtask/checklist/blocker counts via lateral
  // joins server-side and returns one row per task — a single round
  // trip. The RPC is `security invoker` (not definer), so
  // `tasks_select_active_members`/`checklist_items`/`task_dependencies`
  // RLS applies exactly as it would for the four separate SELECTs it
  // replaces; nothing here bypasses RLS. This function's own return
  // shape (`TaskCardTask[]`) is unchanged, so callers are unaffected.
  const { data, error } = await supabase.rpc("get_project_board_tasks", {
    p_project_id: projectId,
  });

  if (error) {
    throw error;
  }

  type BoardTaskRow = {
    id: string;
    title: string;
    status: string;
    priority: string | null;
    assignee_id: string | null;
    due_date: string | null;
    position: number;
    updated_at: string;
    number: number;
    project_key: string | null;
    subtask_count: number;
    checklist_total: number;
    checklist_done: number;
    child_total: number;
    child_done: number;
    open_blocker_count: number;
    // F167 follow-up: added to the RPC's return in
    // 20260822040000_rpc_project_board_tasks_estimate_minutes.sql.
    estimate_minutes: number | null;
    // F161 follow-through (AS-287, AS-288): every current assignee for
    // this task, oldest-first — added to the RPC's return in
    // 20260822070000_rpc_project_board_tasks_assignee_ids.sql. Always an
    // array (possibly empty), never null — see that migration's own
    // comment for the coalesce.
    assignee_ids: string[];
    // F179 follow-up: added to the RPC's return in
    // 20260822170000_rpc_project_board_tasks_recurrence.sql.
    recurrence: RecurrenceRule | null;
    // F222 (AS-410): this task's own board column category, added to the
    // RPC's return in
    // 20260824060000_status_category_semantics.sql — feeds TaskCard's
    // `statusCategory` so the board's overdue badge is category-aware,
    // same as the RPC's own child_done/open_blocker_count fixes in that
    // migration.
    status_category: string | null;
    // F224 (AS-418, AS-423): every tag on this task, added to the RPC's
    // return in 20260825020000_rpc_project_board_tasks_tags.sql. Always
    // an array (possibly empty), never null -- same "coalesce at the SQL
    // boundary" convention as `assignee_ids` above -- feeds the board's
    // client-side "group by tag" swimlanes (lib/board/grouping.ts).
    tags: string[];
    // F090 item 2: the board's own client-visibility/awaiting-client
    // indicators, added to the RPC's return in
    // 20261028010000_f090_board_client_visibility.sql -- same
    // "not null default false" columns the List view/My Tasks already
    // select directly off `tasks` (see this file's
    // `getProjectListTasks`/`getMyTasks` below).
    client_visible: boolean;
    pending_client_approval: boolean;
  };

  return ((data ?? []) as BoardTaskRow[]).map((task) => {
    // F154 (AS-272, AS-273): checklist and child-task counts for THIS
    // task, straight off the RPC row (already aggregated server-side —
    // no per-card query, no client-side grouping), fed through the same
    // pure `computeTaskCompletion` helper as before.
    const completion = computeTaskCompletion({
      checklistTotal: task.checklist_total,
      checklistDone: task.checklist_done,
      childTotal: task.child_total,
      childDone: task.child_done,
    });

    return {
      id: task.id,
      title: task.title,
      status: task.status as TaskCardTask["status"],
      // F222 (AS-410): straight off the RPC row — see this function's
      // BoardTaskRow type above.
      statusCategory: task.status_category,
      priority: task.priority as TaskCardTask["priority"],
      assigneeId: task.assignee_id,
      dueDate: task.due_date,
      position: task.position,
      updatedAt: task.updated_at,
      // F146 (AS-258): selected via the RPC's own project join — see
      // supabase/migrations/20260819110000_rpc_project_board_tasks.sql.
      number: task.number,
      projectKey: task.project_key ?? undefined,
      // F150 (AS-275): undefined (not 0) when this task has no children,
      // matching TaskCardTask.subtaskCount's own "undefined/0 both hide
      // the indicator" contract.
      subtaskCount: task.subtask_count || undefined,
      // F157 (AS-283): undefined (not 0) when this task has no open
      // blocker, matching TaskCardTask.openBlockerCount's own
      // "undefined/0 both hide the indicator" contract — same convention
      // as `subtaskCount` immediately above.
      openBlockerCount: task.open_blocker_count || undefined,
      // F154 (AS-272, AS-273): combines the checklist and child-task
      // counts above through the shared pure `computeTaskCompletion` —
      // returns `null` when there is nothing to measure (AS-273), never a
      // misleading 0%.
      completion,
      // F167 follow-up (AS-300..AS-302): straight off the RPC row — no
      // `|| undefined` coercion here, since TaskCardTask.estimateMinutes
      // already treats null/undefined/non-positive identically via
      // getEstimateProgress's own gate (unlike subtaskCount/
      // openBlockerCount above, where 0 vs undefined both mean "hide the
      // indicator" and the RPC always returns 0 rather than null for
      // those two).
      estimateMinutes: task.estimate_minutes,
      // F161 follow-through (AS-287, AS-288): straight off the RPC row —
      // feeds TaskCard's UserAvatarGroup. See TaskCardTask.assigneeIds'
      // doc comment for the "always an array" contract.
      assigneeIds: task.assignee_ids ?? [],
      // F179 follow-up (AS-317): straight off the RPC row — no coercion
      // needed, TaskCardTask.recurrence already treats null/undefined
      // identically (no indicator rendered), same convention as
      // estimateMinutes above.
      recurrence: task.recurrence,
      // F224 (AS-418, AS-423): straight off the RPC row -- see this
      // function's BoardTaskRow type above.
      tags: task.tags ?? [],
      // F090 item 2: straight off the RPC row -- see this function's
      // BoardTaskRow type above. TaskCard already renders both
      // indicators when set (built for the List view/My Tasks in F083);
      // the board was simply never passing them through.
      clientVisible: task.client_visible ?? false,
      pendingClientApproval: task.pending_client_approval ?? false,
    };
  });
}

// Data-fetching for the project List view (F053: AS-085).
//
// Same RLS-backed, `deleted_at is null`, `project_id`-scoped shape as
// `getProjectBoardTasks` above (see that function's comment for the full
// rationale — the RLS policy `tasks_select_active_members` plus this
// explicit filter is what makes the query workspace- and project-scoped
// by construction). The difference from the board query is ordering: the
// board buckets rows into 4 fixed status columns and needs `position`
// ascending *within* each column, but the list view is one flat table, so
// there's no meaningful use for the board's fractional `position` here.
// Ordered by `created_at` ascending instead (oldest first, a stable and
// predictable default) — AS-091's due-date sort is a client-side/UI
// concern layered on top of this fetch, not this query's job.
//
// F054 (AS-086..090): optional `filters` narrow the result set further.
// Each provided filter is applied as an additional `.eq()` on top of the
// existing `project_id` + `deleted_at IS NULL` scoping, so when more than
// one filter is supplied they combine with SQL's implicit AND semantics
// (AS-089) — there is no OR path here. Omitting a filter key (or passing
// the whole `filters` argument) leaves that column unconstrained, which is
// how "Clear filters" restores the full list (AS-090): the list page just
// calls this with no filters again.
export type ProjectListTaskFilters = {
  // Follow-up (advanced filtering, partial): a single value keeps the
  // existing "eq" semantics; an array matches ANY of the given values
  // (SQL IN), for a saved view's multi-select filter
  // (lib/validation/views.ts's `savedViewFilterSchema` "in" operator).
  status?: TaskCardTask["status"] | TaskCardTask["status"][];
  priority?: NonNullable<TaskCardTask["priority"]> | NonNullable<TaskCardTask["priority"]>[];
  // F162 (AS-291): a single id (the URL-driven `<ListFilters>` shape today)
  // or an array of ids (for callers/tests that need to filter by several
  // assignees at once) — either way this now matches ANY of a task's
  // CURRENT assignees via `task_assignees`, not the deprecated single
  // `tasks.assignee_id` column (F160's mirror rule means `assignee_id` only
  // ever names ONE of several assignees, so filtering on it directly would
  // silently miss tasks where the selected person is a second/third
  // assignee). See `filterTaskIdsByAnyAssignee` below for the dedup
  // strategy that keeps a task with several matching assignees to exactly
  // one row.
  assigneeId?: string | string[];
  // F434-F440: matches tasks whose task_type_id equals this id.
  taskTypeId?: string;
  // Follow-up (manual view membership): an explicit id allow-list, used
  // by list/page.tsx to fetch the tasks manually pinned into a view (via
  // `view_tasks`) so they can be unioned onto the filter-matched set --
  // see lib/views/apply-view.ts's `mergeManualTaskIds`. Combines with
  // AND semantics like every other key here, but the only caller that
  // sets this passes no other filter at the same time.
  taskIds?: string[];
};

// F055 (AS-091): due-date sort, applied AFTER filtering — same query, just
// a different `.order()` in place of the default `created_at ascending`.
// "asc"/"desc" map directly onto Postgres NULLS behaviour; tasks with no
// due date are pushed to the end regardless of direction (`nullsFirst:
// false`) so an unset due date never outranks a real one in either sort
// order — it's neither "earliest" nor "latest", it's unset.
export type ProjectListTaskSort = "due_date_asc" | "due_date_desc";

// F162 (AS-291): resolves an assignee filter (single id or several) to the
// deduplicated set of task ids that have ANY of those ids as a CURRENT
// assignee, via `task_assignees` (RLS-scoped the same way `tasks` itself
// is — `task_assignees_select_visible`,
// supabase/migrations/20260822020000_task_assignees_table.sql — so this
// never leaks a task id from a workspace/project the caller can't see).
//
// Dedup strategy: a task with N matching assignees comes back as N rows
// from this join-table query (one per matching `user_id`), but feeding
// that straight into a `tasks.id IN (...)` filter is naturally idempotent
// — `IN` doesn't care how many times an id is repeated in the list, and
// the outer `tasks` query still returns exactly one row per task id
// regardless. The `Set` here is just to keep the `.in()` argument itself
// free of literal duplicates (smaller query, not a correctness
// requirement) — the actual "no duplicate task rows" guarantee comes from
// filtering by primary-key membership rather than joining `tasks` directly
// to `task_assignees` (which WOULD fan out one row per matching assignee
// if selected via an embedded/inner join instead of this two-step
// id-list approach). Returns `null` when no `assigneeId` filter was given
// (caller should skip the id-scoping entirely), or an array (possibly
// empty, meaning "no task matches") otherwise.
// F235 (AS-448): exported so getCalendarTasks (lib/queries/calendar.ts)
// can reuse the exact same "which task ids have this assignee" resolution
// -- same RLS-scoped `task_assignees` read, same dedup rule -- instead of
// a second hand-rolled assignee-filter implementation for the calendar's
// own workspace-wide query.
export async function filterTaskIdsByAnyAssignee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assigneeId: string | string[] | undefined,
): Promise<string[] | null> {
  if (!assigneeId) return null;
  const ids = Array.isArray(assigneeId) ? assigneeId : [assigneeId];
  if (ids.length === 0) return null;

  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id")
    .in("user_id", ids);

  if (error) {
    throw error;
  }

  return [...new Set((data ?? []).map((row) => row.task_id))];
}

export async function getProjectListTasks(
  projectId: string,
  filters?: ProjectListTaskFilters,
  sort?: ProjectListTaskSort,
): Promise<TaskCardTask[]> {
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select(
      // F167 follow-up: `estimate_minutes` added so the list view's
      // `TaskCard`s also receive a real estimate, same as the board view.
      // F161 follow-through (AS-287, AS-288): `task_assignees(user_id)`
      // added so the list view's `TaskCard`s also receive the full
      // assignee set, same as the board view's RPC — one embedded join,
      // no per-row fetch.
      // F179 follow-up (AS-317): `recurrence` added so the list view's
      // `TaskCard`s also receive real recurrence data, same as the board
      // view.
      // F222 (AS-410): `status_id, project_statuses(category)` added so
      // this list view's TaskCard/isOverdue calls get category-aware
      // "done" behaviour (lib/tasks/status-category.ts) instead of
      // falling back to the literal `status === "done"` comparison for
      // every row — same rationale as `estimate_minutes`/`recurrence`
      // above.
      // F6 (docs, "subtask view kao na ClickUp"): `parent_task_id` added
      // so the list view can nest a child directly under its parent row
      // client-side — see TaskCardTask.parentTaskId's own comment for why
      // this is presentation-only and does not remove anything from this
      // already-flat query (AS-275).
      // F083: `client_visible, pending_client_approval` added so the list
      // view's TaskCards can render the client-visibility/awaiting-client
      // indicators, same as the detail sheet's own toggles read/write —
      // see TaskCardTask.clientVisible/pendingClientApproval's own
      // comments.
      "id, title, status, status_id, priority, assignee_id, due_date, position, updated_at, created_at, number, estimate_minutes, recurrence, parent_task_id, task_type_id, client_visible, pending_client_approval, blocked_reason, projects(key), task_assignees(user_id), project_statuses(category), task_types(id, name, color)",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (filters?.status) {
    query = Array.isArray(filters.status)
      ? query.in("status", filters.status)
      : query.eq("status", filters.status);
  }

  if (filters?.taskTypeId) {
    query = query.eq("task_type_id", filters.taskTypeId);
  }
  if (filters?.priority) {
    query = Array.isArray(filters.priority)
      ? query.in("priority", filters.priority)
      : query.eq("priority", filters.priority);
  }
  if (filters?.taskIds) {
    query = query.in("id", filters.taskIds.length > 0 ? filters.taskIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  // F162 (AS-291): matches ANY of a task's current assignees via
  // `task_assignees`, not the deprecated single `assignee_id` column — see
  // `filterTaskIdsByAnyAssignee`'s comment above for the dedup rationale.
  const assigneeTaskIds = await filterTaskIdsByAnyAssignee(
    supabase,
    filters?.assigneeId,
  );
  if (assigneeTaskIds !== null) {
    query = query.in("id", assigneeTaskIds);
  }

  query =
    sort === "due_date_asc"
      ? query.order("due_date", { ascending: true, nullsFirst: false })
      : sort === "due_date_desc"
        ? query.order("due_date", { ascending: false, nullsFirst: false })
        : query.order("created_at", { ascending: true });

  // F161 follow-through (AS-287, AS-288): orders the embedded
  // `task_assignees` rows oldest-first — PostgREST embeds are otherwise
  // unordered — matching the board RPC's own `assignee_ids` tie-break
  // (supabase/migrations/20260822070000_rpc_project_board_tasks_assignee_ids.sql)
  // so a task's assignee list renders in the same order everywhere.
  query = query.order("created_at", {
    ascending: true,
    referencedTable: "task_assignees",
  });

  // W10 (pagination hardening): this query previously had no upper bound
  // at all — a project with thousands of tasks meant fetching the entire
  // table in one round trip. `TaskCardTask[]` flows from here through the
  // List view page (Server Component), the dashboard's workspace-wide
  // table (getWorkspaceListTasks below reuses this same shape), and
  // several client components downstream, so wiring a real cursor/"Load
  // more" UI end-to-end is out of scope for this pass (see W10 handoff's
  // "Out-of-scope work needed") — this `.limit()` is a safety cap only,
  // matching this feature's documented fallback.
  query = query.limit(1000);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = data ?? [];

  // F412: one batched sum of logged time for the whole visible page,
  // rather than a per-row fetch — see getTaskLoggedMinutes's own doc
  // comment for why this can't be an N+1.
  const loggedMinutesByTask = await getTaskLoggedMinutes(
    rows.map((task) => task.id),
  );

  return rows.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status as TaskCardTask["status"],
    // F222 (AS-410): see this function's select above.
    statusCategory: firstRelated(task.project_statuses)?.category ?? null,
    priority: task.priority as TaskCardTask["priority"],
    assigneeId: task.assignee_id,
    dueDate: task.due_date,
    position: task.position,
    updatedAt: task.updated_at,
    // F146 (AS-258): see getProjectBoardTasks above for the rationale —
    // same existing-query-extension approach, same helper.
    number: task.number,
    projectKey: firstRelated(task.projects)?.key,
    // F167 follow-up: see this function's select above.
    estimateMinutes: task.estimate_minutes,
    // F412: previously always undefined on this path — see
    // getTaskLoggedMinutes's doc comment.
    totalMinutes: loggedMinutesByTask.get(task.id) ?? 0,
    // F161 follow-through (AS-287, AS-288): see this function's select
    // above — `task_assignees` always comes back as an array for a
    // one-to-many embed (unlike the single-relation `projects` above,
    // never object-or-array), so no `firstRelated`-style normalization is
    // needed here.
    assigneeIds: (task.task_assignees ?? []).map((row) => row.user_id),
    // F179 follow-up (AS-317): see this function's select above.
    recurrence: task.recurrence as RecurrenceRule | null,
    // F6: see this function's select above and TaskCardTask.parentTaskId's
    // own comment.
    parentTaskId: task.parent_task_id,
    // F434-F440: see this function's select above.
    taskType: firstRelated(task.task_types) ?? null,
    // F083: see this function's select above.
    clientVisible: task.client_visible ?? false,
    pendingClientApproval: task.pending_client_approval ?? false,
    // Free-text "why is this blocked" reason — see this function's select
    // above and TaskCardTask.blockedReason's own comment.
    blockedReason: task.blocked_reason ?? null,
  }));
}

// F078 (AS-134): the dashboard's task table — same filter shape as the
// project List view (`ProjectListTaskFilters`/`getProjectListTasks`
// above), but scoped to an entire workspace instead of a single project,
// since the dashboard shows tasks across ALL of the workspace's projects.
//
// Reuses `ProjectListTaskFilters`'s status/priority/assigneeId shape
// as-is (aliased as `WorkspaceListTaskFilters` for call-site clarity, but
// structurally identical) so `<ListFilters>` (F054, components/task/
// list-filters.tsx) — which only ever writes `status`/`priority`/
// `assigneeId` into the URL and knows nothing about project vs. workspace
// scope — is reusable here completely unmodified, exactly as this
// feature's spec calls for ("reuses the same status/priority filter
// components as the list view").
//
// The project scope in `getProjectListTasks` comes from
// `.eq("project_id", projectId)`; there is no single-column equivalent
// for "workspace", so this instead inner-joins to `projects` and filters
// on `projects.workspace_id` — `tasks -> projects -> workspace_id`, per
// the feature's own instruction. RLS (`tasks_select_active_members`,
// same policy `getProjectBoardTasks`/`getProjectListTasks` rely on) still
// independently scopes every row to projects in workspaces the caller is
// an active member of; the explicit `.eq("projects.workspace_id", ...)`
// on top of that narrows the *already-permitted* rows down to this one
// workspace specifically, mirroring the `project_id` narrowing the
// project-scoped query does on top of the same RLS policy.
// UX-20: the dashboard's four KPI tiles (Overdue / Due soon / Blocked /
// Completed) each need to link somewhere real, not just show a number —
// `flag` is that link's target, layered on top of the existing status/
// priority/assignee filters exactly the way they already compose (AND,
// same as the rest of this type). "Due soon"/"Overdue"/"Completed" are
// evaluated with the SAME `lib/time/user-timezone.ts` helpers the RPCs
// backing the tiles' own counts use (F124's "never disagree" rule), so a
// tile's number and the list it opens can't drift from each other around
// a timezone boundary the way two independently-computed date checks
// could.
export type WorkspaceListTaskFilters = ProjectListTaskFilters & {
  flag?: "overdue" | "due_soon" | "blocked" | "completed";
};

export async function getWorkspaceListTasks(
  workspaceId: string,
  filters?: WorkspaceListTaskFilters,
  timezone: string = "UTC",
): Promise<TaskCardTask[]> {
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select(
      // F167 follow-up: `estimate_minutes` added so the dashboard's
      // `TaskCard`s also receive a real estimate, same as the board/list
      // views.
      // F161 follow-through (AS-287, AS-288): `task_assignees(user_id)`
      // added so the dashboard's `TaskCard`s also receive the full
      // assignee set, same as the board/list views.
      // F179 follow-up (AS-317): `recurrence` added so the dashboard's
      // `TaskCard`s also receive real recurrence data, same as the
      // board/list views.
      // F222 (AS-410): see getProjectListTasks above for the rationale.
      // F083: see getProjectListTasks above for the rationale.
      // Portal-parity fix: `task_type_id`/`task_types(...)` and
      // `parent_task_id` added so the workspace-wide dashboard table gets
      // the same Type column data and subtask nesting the per-project List
      // view (getProjectListTasks) already has — see this feature's
      // handoff for why the dashboard table silently rendered an empty
      // Type column before this.
      "id, title, status, status_id, priority, assignee_id, due_date, position, updated_at, created_at, number, estimate_minutes, recurrence, parent_task_id, task_type_id, client_visible, pending_client_approval, blocked_reason, projects!inner(key, workspace_id, deleted_at), task_assignees(user_id), project_statuses(category), task_types(id, name, color)",
    )
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null)
    .is("deleted_at", null);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
  }
  // F162 (AS-291): see getProjectListTasks above — same
  // `filterTaskIdsByAnyAssignee` helper, same dedup rationale, just
  // workspace- instead of project-scoped via the surrounding query's own
  // `projects.workspace_id` filter.
  const assigneeTaskIds = await filterTaskIdsByAnyAssignee(
    supabase,
    filters?.assigneeId,
  );
  if (assigneeTaskIds !== null) {
    query = query.in("id", assigneeTaskIds);
  }

  // UX-20: "blocked" is the one flag that can't be decided from a column
  // already on `tasks` — it means "has an open (not-done) blocker in
  // task_dependencies", the same predicate 20260824060000's
  // get_project_board_tasks RPC uses for a single project's
  // open_blocker_count, resolved here to an id list the same way
  // filterTaskIdsByAnyAssignee resolves assignee ids, since RLS on
  // task_dependencies/tasks already scopes this to rows the caller can
  // see. "overdue"/"due_soon"/"completed" are decided AFTER the fetch
  // below instead (they need each task's resolved status category, which
  // isn't a filterable column either, but is cheap to compute in JS with
  // the same helper isOverdue()/getWorkspaceListTasks's own map() already
  // uses per row).
  if (filters?.flag === "blocked") {
    const { data: dependencyRows } = await supabase
      .from("task_dependencies")
      .select(
        "blocked_task_id, tasks!task_dependencies_blocking_task_id_fkey(status, deleted_at, project_statuses(category))",
      )
      .not("blocking_task_id", "is", null);

    const blockedIds = new Set<string>();
    for (const row of dependencyRows ?? []) {
      const blocking = firstRelated(row.tasks);
      if (!blocking || blocking.deleted_at) continue;
      const category = firstRelated(blocking.project_statuses)?.category ?? null;
      if (!isDoneStatus(blocking.status, category)) {
        blockedIds.add(row.blocked_task_id);
      }
    }
    query = query.in("id", [...blockedIds]);
  }

  query = query.order("created_at", { ascending: true });

  // F161 follow-through (AS-287, AS-288): see getProjectListTasks above
  // for why this explicit embedded-table ordering is needed.
  query = query.order("created_at", {
    ascending: true,
    referencedTable: "task_assignees",
  });

  // W10 (pagination hardening): same unbounded-fetch safety cap as
  // getProjectListTasks above — workspace-wide, so this is the query most
  // likely to hit a very large row count. Note the "overdue"/"due_soon"/
  // "completed" flags are still applied AFTER this fetch (see this
  // function's own comment above), so on a workspace with >1000
  // non-deleted tasks the KPI counts computed from `flag`-filtered results
  // could undercount past this cap — an accepted tradeoff for this pass;
  // see W10 handoff.
  query = query.limit(1000);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const mapped = (data ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status as TaskCardTask["status"],
    // F222 (AS-410): see getProjectListTasks above.
    statusCategory: firstRelated(task.project_statuses)?.category ?? null,
    priority: task.priority as TaskCardTask["priority"],
    assigneeId: task.assignee_id,
    dueDate: task.due_date,
    position: task.position,
    updatedAt: task.updated_at,
    // F146 (AS-258): unlike the two project-scoped queries above, every
    // row here can belong to a DIFFERENT project (this is the
    // workspace-wide dashboard query), so `projectKey` genuinely varies
    // per row rather than being constant across the result set — still
    // selected via this query's existing `projects!inner(...)` join, no
    // per-row fetch.
    number: task.number,
    projectKey: firstRelated(task.projects)?.key,
    // F167 follow-up: see this function's select above.
    estimateMinutes: task.estimate_minutes,
    // F161 follow-through (AS-287, AS-288): see getProjectListTasks above
    // for why no `firstRelated` normalization is needed here.
    assigneeIds: (task.task_assignees ?? []).map((row) => row.user_id),
    // F179 follow-up (AS-317): see this function's select above.
    recurrence: task.recurrence as RecurrenceRule | null,
    // F083: see this function's select above.
    clientVisible: task.client_visible ?? false,
    pendingClientApproval: task.pending_client_approval ?? false,
    // Portal-parity fix: see this function's select above.
    parentTaskId: task.parent_task_id,
    taskType: firstRelated(task.task_types) ?? null,
    // Free-text "why is this blocked" reason — see this function's select
    // above and TaskCardTask.blockedReason's own comment.
    blockedReason: task.blocked_reason ?? null,
  }));

  // UX-20: "overdue"/"due_soon"/"completed" aren't filterable columns —
  // they're derived from (dueDate, status/statusCategory) exactly the way
  // TaskCard already decides whether to render its own overdue styling,
  // so this reuses that same lib/tasks/is-overdue.ts helper instead of a
  // second, potentially-drifting date comparison.
  if (filters?.flag === "overdue") {
    return mapped.filter((task) =>
      isOverdue(task.dueDate, task.status, timezone, task.statusCategory),
    );
  }
  if (filters?.flag === "due_soon") {
    const today = todayInTimeZone(timezone) ?? new Date().toISOString().slice(0, 10);
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 7);
    const horizonIso = horizon.toISOString().slice(0, 10);
    return mapped.filter(
      (task) =>
        task.dueDate !== null &&
        task.dueDate >= today &&
        task.dueDate < horizonIso &&
        !isDoneStatus(task.status, task.statusCategory),
    );
  }
  if (filters?.flag === "completed") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return mapped.filter(
      (task) =>
        isDoneStatus(task.status, task.statusCategory) &&
        task.updatedAt !== undefined &&
        new Date(task.updatedAt) >= cutoff,
    );
  }

  return mapped;
}

// F246 (AS-473, AS-474, AS-477): resolves a workspace-scoped task-key URL
// segment (e.g. "PM-142", already parsed into its (projectKey, taskNumber)
// halves by lib/tasks/task-key.ts's parseTaskKeyQuery — the same parser
// F147/F242 use, never a second copy of that regex) down to a single task
// id, for the deep-link route
// app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx.
//
// Deliberately the plain RLS-scoped client, never the admin client: both
// `projects_select_active_members` and `tasks_select_active_members`
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
// already route every SELECT through `is_project_visible_to`, the exact
// same rule F323's `isProjectVisibleToCaller` re-implements for the
// admin-client call sites in lib/actions/*.ts. Since this lookup never
// leaves RLS, a project the caller cannot see (private, not a member) or
// a soft-deleted project/task simply returns no row here — identical
// "no row" shape whether the key never existed at all, so nothing this
// function returns can distinguish "doesn't exist" from "exists but
// hidden." The deep-link page then re-resolves the FULL task detail
// through `getTaskDetail` (lib/actions/tasks.ts), which re-runs the same
// visibility check a second, independent way and returns the identical
// "Task not found." message either way (AS-477) — this function only
// ever hands that page a candidate id to re-verify, never a shortcut
// around it.
export async function resolveTaskIdByKey(
  workspaceId: string,
  projectKey: string,
  taskNumber: number,
): Promise<{ taskId: string; projectId: string } | null> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("key", projectKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    return null;
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("project_id", project.id)
    .eq("number", taskNumber)
    .is("deleted_at", null)
    .maybeSingle();

  if (!task) {
    return null;
  }

  return { taskId: task.id, projectId: project.id };
}
