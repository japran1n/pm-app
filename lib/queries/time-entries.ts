import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logger } from "@/lib/observability/logger";

export type ProjectTimeTotals = {
  billableMinutes: number;
  nonBillableMinutes: number;
  estimateMinutes: number;
};

// getProjectTimeTotals (F114/AS-172/AS-174; extended by F168/AS-303/AS-304
// to add `estimateMinutes`): thin wrapper around the `get_project_time_totals`
// RPC (supabase/migrations/20260818160000_rpc_project_time_totals.sql,
// extended by supabase/migrations/20260822080000_rpc_project_time_totals_estimate.sql),
// following the same thin-wrapper convention as `getActiveTimer` below and
// the F073 dashboard wrappers around `get_priority_counts`/`get_status_counts`
// (lib/queries/dashboard.ts). Uses the request-scoped (RLS-respecting)
// client — the RPC itself is `security invoker`, so a caller who isn't an
// active member of the project's workspace gets zero totals back, not an
// error and not another workspace's data. The RPC's own `t.deleted_at is
// null` filter excludes a soft-deleted task's logged time and estimate
// (AS-174, AS-304).
export async function getProjectTimeTotals(
  projectId: string,
): Promise<ProjectTimeTotals> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_project_time_totals", {
    p_project_id: projectId,
  });

  const row = data?.[0];
  if (error || !row) {
    return { billableMinutes: 0, nonBillableMinutes: 0, estimateMinutes: 0 };
  }

  return {
    billableMinutes: Number(row.billable_minutes ?? 0),
    nonBillableMinutes: Number(row.non_billable_minutes ?? 0),
    estimateMinutes: Number(row.estimate_minutes ?? 0),
  };
}

export type WorkspaceTimeByPerson = {
  userId: string;
  billableMinutes: number;
  nonBillableMinutes: number;
};

// getWorkspaceTimeByPerson (F115, AS-173, AS-174): thin wrapper around the
// `get_workspace_time_by_person` RPC
// (supabase/migrations/20260818170000_rpc_workspace_time_by_person.sql),
// following the same thin-wrapper convention as `getProjectTimeTotals`
// above. Uses the request-scoped (RLS-respecting) client — the RPC itself
// is `security invoker`, so a caller who isn't an active member of
// `workspaceId` gets an empty array back, not an error and not another
// workspace's data (AS-176). The RPC's own `t.deleted_at is null` filter
// excludes a soft-deleted task's logged time (AS-174); `startDate`/`endDate`
// are inclusive on both ends.
export async function getWorkspaceTimeByPerson(
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<WorkspaceTimeByPerson[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_workspace_time_by_person", {
    p_workspace_id: workspaceId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || !data) {
    if (error) {
      logger.error("getWorkspaceTimeByPerson: rpc failed", { error: error });
    }
    return [];
  }

  return data.map(
    (row: { user_id: string; billable_minutes: number; non_billable_minutes: number }) => ({
      userId: row.user_id,
      billableMinutes: Number(row.billable_minutes ?? 0),
      nonBillableMinutes: Number(row.non_billable_minutes ?? 0),
    }),
  );
}

export type PersonTimeByProject = {
  projectId: string;
  projectName: string;
  totalMinutes: number;
  billableMinutes: number;
};

// getPersonTimeByProject: thin wrapper around the `get_person_time_by_project`
// RPC (supabase/migrations/20261109010000_rpc_person_time_reports.sql),
// following the same thin-wrapper convention as `getWorkspaceTimeByPerson`
// above. Uses the request-scoped (RLS-respecting) client — the RPC itself
// is `security invoker`, so RLS on `time_entries`/`tasks`/`projects`
// applies exactly as it would for any direct SELECT. The RPC's own
// `t.deleted_at is null` filter excludes a soft-deleted task's logged
// time; `startDate`/`endDate` are inclusive on both ends.
export async function getPersonTimeByProject(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<PersonTimeByProject[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_person_time_by_project", {
    p_user_id: userId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || !data) {
    if (error) {
      logger.error("getPersonTimeByProject: rpc failed", { error: error });
    }
    return [];
  }

  return data.map(
    (row: {
      project_id: string;
      project_name: string;
      total_minutes: number;
      billable_minutes: number;
    }) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      totalMinutes: Number(row.total_minutes ?? 0),
      billableMinutes: Number(row.billable_minutes ?? 0),
    }),
  );
}

export type PersonTimeDaily = {
  entryDate: string;
  totalMinutes: number;
  billableMinutes: number;
};

// getPersonTimeDaily: thin wrapper around the `get_person_time_daily` RPC
// (supabase/migrations/20261109010000_rpc_person_time_reports.sql).
// Grouped only by entry_date (no project dimension) for bar
// chart/calendar-grid displays of a single person's logged time.
export async function getPersonTimeDaily(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<PersonTimeDaily[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_person_time_daily", {
    p_user_id: userId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || !data) {
    if (error) {
      logger.error("getPersonTimeDaily: rpc failed", { error: error });
    }
    return [];
  }

  return data.map(
    (row: { entry_date: string; total_minutes: number; billable_minutes: number }) => ({
      entryDate: row.entry_date,
      totalMinutes: Number(row.total_minutes ?? 0),
      billableMinutes: Number(row.billable_minutes ?? 0),
    }),
  );
}

export type WorkspaceTimeByPersonAndProject = {
  userId: string;
  projectId: string;
  projectName: string;
  billableMinutes: number;
  nonBillableMinutes: number;
};

// getWorkspaceTimeByPersonAndProject: thin wrapper around the
// `get_workspace_time_by_person_and_project` RPC
// (supabase/migrations/20261109010000_rpc_person_time_reports.sql), an
// extension of `getWorkspaceTimeByPerson` above that adds a project
// dimension for heatmap/drill-down views on the workspace time report
// page.
export async function getWorkspaceTimeByPersonAndProject(
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<WorkspaceTimeByPersonAndProject[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_workspace_time_by_person_and_project",
    {
      p_workspace_id: workspaceId,
      p_start_date: startDate,
      p_end_date: endDate,
    },
  );

  if (error || !data) {
    if (error) {
      logger.error("getWorkspaceTimeByPersonAndProject: rpc failed", { error: error });
    }
    return [];
  }

  return data.map(
    (row: {
      user_id: string;
      project_id: string;
      project_name: string;
      billable_minutes: number;
      non_billable_minutes: number;
    }) => ({
      userId: row.user_id,
      projectId: row.project_id,
      projectName: row.project_name,
      billableMinutes: Number(row.billable_minutes ?? 0),
      nonBillableMinutes: Number(row.non_billable_minutes ?? 0),
    }),
  );
}

export type PersonTimeEntry = {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  minutes: number;
  billable: boolean;
  entryDate: string;
  note: string | null;
};

// getPersonTimeEntriesInRange: individual time-entry rows (including
// notes) for ONE person within an explicit date range — powers the
// per-person drill-down page's entry list
// (app/(workspace)/w/[workspaceSlug]/time/[userId]/page.tsx). Unlike
// `getMyRecentTimeEntries` (a fixed lookback window, capped days, built
// for the caller's own global "Track Time" widget), this takes an
// explicit `userId` and `startDate`/`endDate` so it can show any workspace
// member's entries for the SAME range the page's aggregates use. Uses the
// request-scoped (RLS-respecting) client — `time_entries_select_active_
// members` (supabase/migrations/20260902020000_client_role_read_scope_
// hardening.sql) scopes visibility by TASK visibility, not by
// "row.user_id === caller", so this naturally returns another member's
// entries for tasks the caller can see, and nothing for tasks it can't
// (e.g. a client-hidden task). The caller (the page) is responsible for
// deciding whether to render the `note` field at all for a non-self
// target — see `canViewIndividualTimeEntryNotes`
// (lib/auth/permissions.ts) — this query does not itself redact notes,
// since RLS already governs row-level access and note-level redaction is
// a UI/business-rule concern, not a data-access one.
export async function getPersonTimeEntriesInRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<PersonTimeEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_entries")
    .select("id, task_id, minutes, billable, entry_date, note, tasks(id, title, project_id)")
    .eq("user_id", userId)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getPersonTimeEntriesInRange: query failed", { error: error });
    return [];
  }

  return (data ?? []).map((row) => {
    const task = row.tasks as
      | { id: string; title: string; project_id: string }
      | { id: string; title: string; project_id: string }[]
      | null;
    const taskRow = Array.isArray(task) ? task[0] : task;
    return {
      id: row.id,
      taskId: row.task_id,
      taskTitle: taskRow?.title ?? "Untitled task",
      projectId: taskRow?.project_id ?? null,
      minutes: row.minutes,
      billable: row.billable,
      entryDate: row.entry_date,
      note: row.note,
    };
  });
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
  const { supabase, user } = await getCurrentUser();

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

// F412: per-task logged-time sums, for the list view's "Logged" column and
// TaskCard's `totalMinutes` (a field that has existed on TaskCardTask since
// F113 but was never actually populated by any query — the board and list
// queries only ever set it to `undefined`, so the "time logged" indicator
// TaskCard already renders has been silently dead until now).
//
// One batched query for the whole visible set rather than a per-row RPC —
// the list/board already fetch N tasks in one round trip, and this should
// not turn into N+1. Uses the request-scoped client, so RLS
// (`time_entries_select_active_members`) is what actually restricts the
// sum: a caller only ever sees minutes logged on tasks visible to them,
// which for a client account with `client_visible=false` on a task means
// this returns nothing for it (matching 20260902020000's hardening — a
// client must not learn logged time even in aggregate).
export async function getTaskLoggedMinutes(
  taskIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (taskIds.length === 0) return totals;

  const supabase = await createClient();
  // P2-15: use server-side aggregation RPC to avoid Supabase's 1000-row silent
  // cap on .in() filters; the RPC is security invoker so RLS still applies.
  const { data, error } = await supabase.rpc("get_task_logged_minutes", {
    p_task_ids: taskIds,
  });

  if (error) {
    logger.error("getTaskLoggedMinutes: query failed", { error: error });
    return totals;
  }

  for (const row of (data ?? []) as Array<{ task_id: string; logged_minutes: number }>) {
    totals.set(row.task_id, Number(row.logged_minutes));
  }

  return totals;
}

export type MyRecentTimeEntry = {
  id: string;
  taskId: string;
  taskTitle: string;
  minutes: number;
  billable: boolean;
  entryDate: string;
  note: string | null;
};

// getMyRecentTimeEntries: powers the global "Track Time" header widget's
// entry list (grouped by day client-side) — the caller's own time entries
// across the whole workspace, most recent first, capped to a short lookback
// window (`days`) so the popover never has to render a caller's entire
// history. Uses the request-scoped (RLS-respecting) client, same convention
// as getTaskLoggedMinutes/getActiveTimer above: a signed-out caller gets an
// empty array, and `time_entries_select_active_members` RLS is what
// actually restricts this to entries the caller may see (a client account
// with client_visible=false on a task never surfaces it here either, same
// hardening as getTaskLoggedMinutes documents).
export async function getMyRecentTimeEntries(
  userId: string,
  days = 14,
): Promise<MyRecentTimeEntry[]> {
  const supabase = await createClient();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("time_entries")
    .select("id, task_id, minutes, billable, entry_date, note, tasks(id, title)")
    .eq("user_id", userId)
    .gte("entry_date", sinceDate)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getMyRecentTimeEntries: query failed", { error: error });
    return [];
  }

  return (data ?? []).map((row) => {
    const task = row.tasks as
      | { id: string; title: string }
      | { id: string; title: string }[]
      | null;
    const taskRow = Array.isArray(task) ? task[0] : task;
    return {
      id: row.id,
      taskId: row.task_id,
      taskTitle: taskRow?.title ?? "Untitled task",
      minutes: row.minutes,
      billable: row.billable,
      entryDate: row.entry_date,
      note: row.note,
    };
  });
}

export type MyTimeEntryInRange = {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  projectName: string | null;
  minutes: number;
  billable: boolean;
  entryDate: string;
  note: string | null;
};

// getMyTimeEntriesInRange: the caller's own raw time_entries rows within an
// inclusive [startDate, endDate] window, each carrying its task's title and
// owning project's id/name — powers the "My time" personal dashboard
// (/time/me)'s Daily list and Weekly grid cells, which both need real,
// individually addressable entry rows (not a pre-aggregated total) so an
// entry can be grouped by task/day client-side. Deliberately a separate
// function from `getMyRecentTimeEntries` above (which is capped to a
// "days back from now" lookback for the global Track Time widget) — this
// one takes an explicit inclusive date range so it can serve past AND
// future-dated ranges (e.g. a Monthly view navigated forward) without
// reinterpreting `days` as a signed offset. Uses the request-scoped
// (RLS-respecting) client, same convention as every other query in this
// file — `time_entries_select_active_members` RLS is what actually
// restricts this to entries the caller may see.
export async function getMyTimeEntriesInRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<MyTimeEntryInRange[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_entries")
    .select(
      "id, task_id, minutes, billable, entry_date, note, tasks(id, title, project_id, projects(id, name))",
    )
    .eq("user_id", userId)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .order("entry_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("getMyTimeEntriesInRange: query failed", { error: error });
    return [];
  }

  return (data ?? []).map((row) => {
    const task = row.tasks as
      | { id: string; title: string; project_id: string; projects: { id: string; name: string } | { id: string; name: string }[] | null }
      | { id: string; title: string; project_id: string; projects: { id: string; name: string } | { id: string; name: string }[] | null }[]
      | null;
    const taskRow = Array.isArray(task) ? task[0] : task;
    const project = taskRow?.projects
      ? Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects
      : null;
    return {
      id: row.id,
      taskId: row.task_id,
      taskTitle: taskRow?.title ?? "Untitled task",
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      minutes: row.minutes,
      billable: row.billable,
      entryDate: row.entry_date,
      note: row.note,
    };
  });
}

export type PersonEstimateVsLogged = {
  userId: string;
  estimateMinutes: number;
  loggedMinutes: number;
};

// F414: per-person rollup for ONE project — "who is over their estimate on
// this project", the screen a lead opens before a status meeting.
// Workspace-wide time-by-person (getWorkspaceTimeByPerson above) is scoped
// by date range because logged time is a flow; estimate is not — it's a
// property of a task, not of a period — so this is scoped by project
// instead, matching the project header's own estimate/logged bar (F413)
// rather than bolting a mismatched estimate onto a date-range report.
//
// Estimate is attributed to `assignee_id`, the same single legacy field
// the board/list read for the assignee-filter dropdown — a task can have
// several people in `task_assignees`, but only one is the "owner" an
// estimate is naturally attributed to. Splitting an estimate across
// multiple assignees would need a policy this feature's spec doesn't
// define, so this deliberately does not attempt it.
export async function getProjectEstimateAndLoggedByPerson(
  projectId: string,
): Promise<PersonEstimateVsLogged[]> {
  const supabase = await createClient();

  // P2-16: replace two sequential full-scan queries with a single server-side
  // FULL OUTER JOIN aggregation RPC; security invoker so RLS still applies on
  // both tasks and time_entries.
  const { data, error } = await supabase.rpc(
    "get_project_estimate_and_logged_by_person",
    { p_project_id: projectId },
  );

  if (error) {
    logger.error("getProjectEstimateAndLoggedByPerson: rpc failed", { error });
    return [];
  }

  return ((data ?? []) as Array<{
    user_id: string;
    estimated_minutes: number;
    logged_minutes: number;
  }>)
    .map((row) => ({
      userId: row.user_id,
      estimateMinutes: Number(row.estimated_minutes),
      loggedMinutes: Number(row.logged_minutes),
    }))
    .sort((a, b) => b.loggedMinutes - a.loggedMinutes);
}
