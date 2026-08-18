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
    .select("id, title, status, priority, assignee_id, due_date, position")
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
  }));
}
