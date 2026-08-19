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
// child-task counts. The counting logic itself is NOT reimplemented
// here — `countSubtaskProgress`/`countChecklistProgress` are the same
// pre-existing pure functions F150/F153 already use for the Subtasks
// section's "3 of 5 done" count and the Checklist section's own progress
// bar, so the "done" convention (a child task's status equals the fixed
// string "done") lives in exactly one place. See that function's doc
// comment for the F222 sweep note.
import { countSubtaskProgress } from "@/lib/tasks/subtask-progress";
import { countChecklistProgress } from "@/lib/tasks/checklist-progress";
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

  // F150 (AS-275): NO filter on `parent_task_id` is applied anywhere in
  // this query — a child task (subtask) is a completely ordinary row in
  // `tasks` with the same `project_id`/`deleted_at`/`position` shape as
  // any top-level task, so it is selected, mapped, and returned here
  // exactly like every other task in the project. This is what makes
  // AS-275 ("child tasks still appear as ordinary board cards, not
  // hidden inside their parent") hold: this feature's own subtask UI
  // (the parent's Subtasks section in TaskDetailSheet) is additive — it
  // shows a child task a SECOND time, summarized, inside its parent's
  // detail view — it does not remove or replace the child's own
  // independent row here. See
  // tests/integration/board-tasks-include-subtasks.test.ts for the
  // regression test that actually seeds a parent+child pair and asserts
  // both come back from this exact function.
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, priority, assignee_id, due_date, position, updated_at, number, projects(key)",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  // F150 (AS-264/AS-275's board-card indicator): one extra query for the
  // WHOLE project, grouped client-side into a parentId -> count map —
  // never a per-card/per-row query. Only rows that actually have a live
  // parent are selected (`parent_task_id` not null), so an ordinary
  // top-level task with no subtasks costs nothing extra to compute (it
  // simply has no entry in the resulting map, and the board card's own
  // `!!task.subtaskCount` check hides the indicator for it).
  //
  // F154 (AS-272): `status` is now selected alongside `parent_task_id` too
  // (still the SAME one query, still whole-project, still no per-card
  // round trip) so each parent's children can be run through
  // `countSubtaskProgress` below to get a done/total pair, not just a
  // total.
  const { data: childRows, error: childError } = await supabase
    .from("tasks")
    .select("parent_task_id, status")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .not("parent_task_id", "is", null);

  if (childError) {
    throw childError;
  }

  const subtaskCounts = new Map<string, number>();
  const childrenByParent = new Map<string, { status: string }[]>();
  for (const row of childRows ?? []) {
    if (!row.parent_task_id) continue;
    subtaskCounts.set(
      row.parent_task_id,
      (subtaskCounts.get(row.parent_task_id) ?? 0) + 1,
    );
    const siblings = childrenByParent.get(row.parent_task_id) ?? [];
    siblings.push({ status: row.status });
    childrenByParent.set(row.parent_task_id, siblings);
  }

  // F154 (AS-272): checklist counts for every task in the project, in one
  // more whole-project query (never per-card) — `checklist_items` has no
  // `project_id` column of its own, so this joins through `task_id ->
  // tasks.project_id` (mirroring the RLS policy's own join shape,
  // supabase/migrations/20260819075456_create_checklist_items.sql) rather
  // than fetching every task's items separately.
  const { data: checklistRows, error: checklistError } = await supabase
    .from("checklist_items")
    .select("task_id, is_checked, tasks!inner(project_id, deleted_at)")
    .eq("tasks.project_id", projectId)
    .is("tasks.deleted_at", null);

  if (checklistError) {
    throw checklistError;
  }

  const checklistByTask = new Map<string, { isChecked: boolean }[]>();
  for (const row of checklistRows ?? []) {
    const items = checklistByTask.get(row.task_id) ?? [];
    items.push({ isChecked: row.is_checked });
    checklistByTask.set(row.task_id, items);
  }

  return (data ?? []).map((task) => {
    // F154 (AS-272, AS-273): checklist and child-task counts for THIS
    // task, read out of the two whole-project maps built above (no
    // per-card query) via the same pure counters F153/F150 already use.
    const checklistProgress = countChecklistProgress(
      checklistByTask.get(task.id) ?? [],
    );
    const childProgress = countSubtaskProgress(
      childrenByParent.get(task.id) ?? [],
    );

    return {
      id: task.id,
      title: task.title,
      status: task.status as TaskCardTask["status"],
      priority: task.priority as TaskCardTask["priority"],
      assigneeId: task.assignee_id,
      dueDate: task.due_date,
      position: task.position,
      updatedAt: task.updated_at,
      // F146 (AS-258): selected via this query's existing project join
      // (`projects(key)` above), never a per-row fetch — see
      // lib/tasks/task-key.ts for how these combine into "KEY-NUMBER".
      number: task.number,
      projectKey: firstRelated(task.projects)?.key,
      // F150 (AS-275): undefined (not 0) when this task has no children,
      // matching TaskCardTask.subtaskCount's own "undefined/0 both hide
      // the indicator" contract.
      subtaskCount: subtaskCounts.get(task.id) || undefined,
      // F154 (AS-272, AS-273): combines the checklist and child-task
      // counts above through the shared pure `computeTaskCompletion` —
      // returns `null` when there is nothing to measure (AS-273), never a
      // misleading 0%.
      completion: computeTaskCompletion({
        checklistTotal: checklistProgress.total,
        checklistDone: checklistProgress.checked,
        childTotal: childProgress.total,
        childDone: childProgress.done,
      }),
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
      "id, title, status, priority, assignee_id, due_date, position, updated_at, created_at, number, projects(key)",
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
      "id, title, status, priority, assignee_id, due_date, position, updated_at, created_at, number, projects!inner(key, workspace_id, deleted_at)",
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
  }));
}
