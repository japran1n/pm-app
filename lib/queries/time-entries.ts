import { createClient } from "@/lib/supabase/server";

export type ProjectTimeTotals = {
  billableMinutes: number;
  nonBillableMinutes: number;
};

// getProjectTimeTotals (F114, AS-172, AS-174): thin wrapper around the
// `get_project_time_totals` RPC (supabase/migrations/20260818160000_rpc_project_time_totals.sql),
// following the same thin-wrapper convention as `getActiveTimer` below and
// the F073 dashboard wrappers around `get_priority_counts`/`get_status_counts`
// (lib/queries/dashboard.ts). Uses the request-scoped (RLS-respecting)
// client — the RPC itself is `security invoker`, so a caller who isn't an
// active member of the project's workspace gets zero totals back, not an
// error and not another workspace's data. The RPC's own `t.deleted_at is
// null` filter excludes a soft-deleted task's logged time (AS-174).
export async function getProjectTimeTotals(
  projectId: string,
): Promise<ProjectTimeTotals> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_project_time_totals", {
    p_project_id: projectId,
  });

  const row = data?.[0];
  if (error || !row) {
    return { billableMinutes: 0, nonBillableMinutes: 0 };
  }

  return {
    billableMinutes: Number(row.billable_minutes ?? 0),
    nonBillableMinutes: Number(row.non_billable_minutes ?? 0),
  };
}

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
