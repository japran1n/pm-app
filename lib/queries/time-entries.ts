import { createClient } from "@/lib/supabase/server";

export type ActiveTimer = {
  id: string;
  taskId: string;
  startedAt: string;
  task: {
    id: string;
    title: string;
    projectId: string;
  };
};

// getActiveTimer (F111, AS-168): returns the caller's own running timer, if
// any, joined with basic task info. The UI calls this on mount so the
// timer's running state survives a page reload or a new browser tab — the
// source of truth is the `active_timers` row in Postgres, never client-side
// memory. Uses the request-scoped (RLS-respecting) client: a signed-out
// caller simply gets `null` back rather than a privileged lookup, and the
// active_timers_select_active_members policy
// (supabase/migrations/20260818151845_create_active_timers.sql) is what
// actually enforces that a caller only ever sees their own row here (the
// UNIQUE constraint on user_id means there is at most one anyway).
export async function getActiveTimer(): Promise<ActiveTimer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("active_timers")
    .select("id, task_id, started_at, tasks(id, title, project_id)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const task = data.tasks as
    | { id: string; title: string; project_id: string }
    | { id: string; title: string; project_id: string }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;

  if (!taskRow) {
    return null;
  }

  return {
    id: data.id,
    taskId: data.task_id,
    startedAt: data.started_at,
    task: {
      id: taskRow.id,
      title: taskRow.title,
      projectId: taskRow.project_id,
    },
  };
}
