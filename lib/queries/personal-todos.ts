import { logger } from "@/lib/observability/logger";

// F416-F418: read-side for a caller's own personal to-dos. RLS
// (personal_todos_owner_only) already restricts every row to
// `user_id = auth.uid()` — no admin client, no extra filter needed here,
// same "RLS is the real boundary" convention as the rest of this schema.
//
// Consolidation (20261116010000): personal_todos absorbed quick_notes'
// only extra capability — an optional link to a task or project, rendered
// as an "on task: ..."/"on project: ..." chip — rather than keeping two
// parallel personal-reminder tables.

import { createClient } from "@/lib/supabase/server";

export type PersonalTodo = {
  id: string;
  title: string;
  isDone: boolean;
  position: number;
  // Optional: absent in older call sites/tests that don't care about the
  // task/project link chip -- component treats a missing value the same as
  // an explicit null (no chip rendered).
  taskId?: string | null;
  taskKey?: string | null;
  taskTitle?: string | null;
  projectId?: string | null;
  projectName?: string | null;
};

type PersonalTodoRow = {
  id: string;
  title: string;
  is_done: boolean;
  position: number;
  task_id: string | null;
  project_id: string | null;
  tasks: { key: string | null; title: string | null } | null;
  projects: { name: string | null } | null;
};

export async function getPersonalTodos(
  workspaceId: string,
): Promise<PersonalTodo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("personal_todos")
    .select(
      "id, title, is_done, position, task_id, project_id, tasks(key, title), projects(name)",
    )
    .eq("workspace_id", workspaceId)
    .order("position");

  if (error) {
    logger.error("getPersonalTodos failed", { error: error });
    return [];
  }

  return ((data ?? []) as unknown as PersonalTodoRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    isDone: row.is_done,
    position: row.position,
    taskId: row.task_id,
    taskKey: row.tasks?.key ?? null,
    taskTitle: row.tasks?.title ?? null,
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
  }));
}
