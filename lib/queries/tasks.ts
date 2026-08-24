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
import type { RecurrenceRule } from "@/lib/recurrence/next-date";

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
  status?: TaskCardTask["status"];
  priority?: NonNullable<TaskCardTask["priority"]>;
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
      "id, title, status, status_id, priority, assignee_id, due_date, position, updated_at, created_at, number, estimate_minutes, recurrence, projects(key), task_assignees(user_id), project_statuses(category)",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
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

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((task) => ({
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
    // F161 follow-through (AS-287, AS-288): see this function's select
    // above — `task_assignees` always comes back as an array for a
    // one-to-many embed (unlike the single-relation `projects` above,
    // never object-or-array), so no `firstRelated`-style normalization is
    // needed here.
    assigneeIds: (task.task_assignees ?? []).map((row) => row.user_id),
    // F179 follow-up (AS-317): see this function's select above.
    recurrence: task.recurrence as RecurrenceRule | null,
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
export type WorkspaceListTaskFilters = ProjectListTaskFilters;

export async function getWorkspaceListTasks(
  workspaceId: string,
  filters?: WorkspaceListTaskFilters,
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
      "id, title, status, status_id, priority, assignee_id, due_date, position, updated_at, created_at, number, estimate_minutes, recurrence, projects!inner(key, workspace_id, deleted_at), task_assignees(user_id), project_statuses(category)",
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

  query = query.order("created_at", { ascending: true });

  // F161 follow-through (AS-287, AS-288): see getProjectListTasks above
  // for why this explicit embedded-table ordering is needed.
  query = query.order("created_at", {
    ascending: true,
    referencedTable: "task_assignees",
  });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((task) => ({
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
  }));
}
