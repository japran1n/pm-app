import { logger } from "@/lib/observability/logger";

// Quick notes: read-side for a caller's own quick notes. RLS
// (quick_notes_owner_only) already restricts every row to
// `user_id = auth.uid()` — no admin client, no extra filter needed here,
// same "RLS is the real boundary" convention as personal_todos.

import { createClient } from "@/lib/supabase/server";

export type QuickNote = {
  id: string;
  text: string;
  isDone: boolean;
  createdAt: string;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
};

type QuickNoteRow = {
  id: string;
  text: string;
  is_done: boolean;
  created_at: string;
  task_id: string | null;
  project_id: string | null;
  tasks: { key: string | null; title: string | null } | null;
  projects: { name: string | null } | null;
};

export async function getMyQuickNotes(
  workspaceId: string,
): Promise<QuickNote[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quick_notes")
    .select(
      "id, text, is_done, created_at, task_id, project_id, tasks(key, title), projects(name)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getMyQuickNotes failed", { error: error });
    return [];
  }

  return ((data ?? []) as unknown as QuickNoteRow[]).map((row) => ({
    id: row.id,
    text: row.text,
    isDone: row.is_done,
    createdAt: row.created_at,
    taskId: row.task_id,
    taskKey: row.tasks?.key ?? null,
    taskTitle: row.tasks?.title ?? null,
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
  }));
}
