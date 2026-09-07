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
import { formatTaskKey } from "@/lib/tasks/task-key";

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
  // `tasks` has no `key` column -- a task's displayed "KEY-NUMBER"
  // identifier (e.g. "PM-142") is derived at read time via formatTaskKey
  // from the owning project's `key` plus this task's own `number`
  // (lib/tasks/task-key.ts, same convention every other surface that
  // displays a task identity already follows -- see that file's own
  // header comment for why this is the ONLY place that should assemble
  // that string). Explicit `task_id` FK hint on the embed disambiguates
  // from `personal_todos.project_id -> projects -> ...` style ambiguity
  // PostgREST otherwise has to guess at (the "tasks_1" auto-alias seen in
  // the bug report is exactly that guess landing on the wrong shape).
  tasks: { number: number | null; title: string | null; projects: { key: string | null } | null } | null;
  projects: { name: string | null } | null;
};

export async function getPersonalTodos(
  workspaceId: string,
): Promise<PersonalTodo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("personal_todos")
    .select(
      "id, title, is_done, position, task_id, project_id, tasks!personal_todos_task_id_fkey(number, title, projects(key)), projects!personal_todos_project_id_fkey(name)",
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
    taskKey: formatTaskKey(row.tasks?.projects?.key ?? null, row.tasks?.number ?? null),
    taskTitle: row.tasks?.title ?? null,
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
  }));
}
