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
  assigneeId?: string;
};

// F055 (AS-091): due-date sort, applied AFTER filtering — same query, just
// a different `.order()` in place of the default `created_at ascending`.
// "asc"/"desc" map directly onto Postgres NULLS behaviour; tasks with no
// due date are pushed to the end regardless of direction (`nullsFirst:
// false`) so an unset due date never outranks a real one in either sort
// order — it's neither "earliest" nor "latest", it's unset.
export type ProjectListTaskSort = "due_date_asc" | "due_date_desc";

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
      "id, title, status, priority, assignee_id, due_date, position, updated_at, created_at, number, estimate_minutes, projects(key)",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
  }
  if (filters?.assigneeId) {
    query = query.eq("assignee_id", filters.assigneeId);
  }

  query =
    sort === "due_date_asc"
      ? query.order("due_date", { ascending: true, nullsFirst: false })
      : sort === "due_date_desc"
        ? query.order("due_date", { ascending: false, nullsFirst: false })
        : query.order("created_at", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status as TaskCardTask["status"],
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
      "id, title, status, priority, assignee_id, due_date, position, updated_at, created_at, number, estimate_minutes, projects!inner(key, workspace_id, deleted_at)",
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
  if (filters?.assigneeId) {
    query = query.eq("assignee_id", filters.assigneeId);
  }

  query = query.order("created_at", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status as TaskCardTask["status"],
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
  }));
}
