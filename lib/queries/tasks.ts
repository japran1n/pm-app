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

export async function getProjectBoardTasks(
  projectId: string,
): Promise<TaskCardTask[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, priority, assignee_id, due_date, position, updated_at",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

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
  }));
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
      "id, title, status, priority, assignee_id, due_date, position, updated_at, created_at",
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
      "id, title, status, priority, assignee_id, due_date, position, updated_at, created_at, projects!inner(workspace_id)",
    )
    .eq("projects.workspace_id", workspaceId)
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
  }));
}
