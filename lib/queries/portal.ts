// Data-fetching for the client portal (C3/C4, docs/client-portal-plan.md).
//
// Every query here uses the ordinary RLS-respecting server client, never
// the admin client. That is deliberate and load-bearing: the whole point of
// migrations 20260902010000/20260902020000 is that a client session already
// sees exactly — and only — their projects and the tasks marked
// `client_visible`. Re-implementing that filter in TypeScript here would
// create a second copy of the visibility rule that could drift from the
// policies, which is the failure this feature already hit once (see the
// duplicated `is_project_visible_to_row` predicate). So these queries are
// written as if nothing were hidden, and the database does the hiding.
//
// The one consequence worth stating: if a policy were ever dropped, this
// code would happily render internal data. That is the correct trade — a
// missing policy is a bug that must be loud, not one quietly compensated
// for in a query builder.

import { createClient } from "@/lib/supabase/server";

export type StatusCategory = "not_started" | "in_progress" | "done";

export type PortalTask = {
  id: string;
  title: string;
  status: string;
  statusId: string | null;
  dueDate: string | null;
  // The category of the board column this task sits in. Carried on the task
  // itself (not just aggregated into the counts below) because the UI needs
  // it per row: a finished task with a past due date is not late, and
  // rendering it in the overdue style would tell the client something false
  // about work that was actually delivered.
  category: StatusCategory;
};

export type PortalProject = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  tasks: PortalTask[];
  // Counts by the *category* of the task's board column, not by the column
  // name: a team can rename or add columns freely (F218 project_statuses),
  // and the portal must keep reporting sensible progress when they do.
  notStarted: number;
  inProgress: number;
  done: number;
  total: number;
  // Percentage complete, rounded. `null` when there is nothing shared yet —
  // rendering "0%" for a project with no shared tasks would read as "no
  // work has been done", which is a different and wrong claim.
  percentComplete: number | null;
  nextDue: PortalTask | null;
  overdueCount: number;
};

type StatusRow = {
  id: string;
  project_id: string;
  name: string;
  category: StatusCategory;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getPortalProjects(
  workspaceId: string,
): Promise<PortalProject[]> {
  const supabase = await createClient();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name, description, start_date, end_date")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("name");

  if (projectsError) {
    console.error("getPortalProjects: failed to load projects:", projectsError);
    return [];
  }
  if (!projects?.length) return [];

  const projectIds = projects.map((p) => p.id);

  const [{ data: tasks, error: tasksError }, { data: statuses, error: statusesError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, status_id, due_date, project_id")
        .in("project_id", projectIds)
        .is("deleted_at", null)
        .order("position"),
      supabase
        .from("project_statuses")
        .select("id, project_id, name, category")
        .in("project_id", projectIds),
    ]);

  if (tasksError) {
    console.error("getPortalProjects: failed to load tasks:", tasksError);
  }
  if (statusesError) {
    console.error("getPortalProjects: failed to load statuses:", statusesError);
  }

  const categoryByStatusId = new Map<string, StatusCategory>();
  const categoryByProjectAndName = new Map<string, StatusCategory>();
  for (const status of (statuses ?? []) as StatusRow[]) {
    categoryByStatusId.set(status.id, status.category);
    categoryByProjectAndName.set(`${status.project_id}:${status.name}`, status.category);
  }

  const today = todayIso();

  return projects.map((project) => {
    const projectTasks = (tasks ?? []).filter((t) => t.project_id === project.id);

    let notStarted = 0;
    let inProgress = 0;
    let done = 0;
    let overdueCount = 0;
    let nextDue: PortalTask | null = null;

    const mapped: PortalTask[] = projectTasks.map((task) => {
      // `status_id` is kept in sync with `status` by a DB trigger, but fall
      // back to matching on the column name so a row written before that
      // trigger existed still lands in the right bucket rather than
      // silently counting as "not started".
      const category =
        (task.status_id ? categoryByStatusId.get(task.status_id) : undefined) ??
        categoryByProjectAndName.get(`${project.id}:${task.status}`) ??
        "not_started";

      if (category === "done") done += 1;
      else if (category === "in_progress") inProgress += 1;
      else notStarted += 1;

      const mappedTask: PortalTask = {
        id: task.id,
        title: task.title,
        status: task.status,
        statusId: task.status_id,
        dueDate: task.due_date,
        category,
      };

      if (category !== "done" && task.due_date) {
        if (task.due_date < today) overdueCount += 1;
        if (!nextDue || (nextDue.dueDate ?? "") > task.due_date) {
          nextDue = mappedTask;
        }
      }

      return mappedTask;
    });

    const total = mapped.length;

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      startDate: project.start_date,
      endDate: project.end_date,
      tasks: mapped,
      notStarted,
      inProgress,
      done,
      total,
      percentComplete: total === 0 ? null : Math.round((done / total) * 100),
      nextDue,
      overdueCount,
    };
  });
}

// The caller's role in this workspace, used by the portal layout to decide
// whether this person belongs here at all. Reads through RLS: after
// 20260902020000 a client can see only their own `workspace_members` row,
// which is precisely the row this needs.
export async function getWorkspaceRoleForCurrentUser(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("getWorkspaceRoleForCurrentUser failed:", error);
    return null;
  }
  return data?.role ?? null;
}

// --- Client requests (C5) ---------------------------------------------------

export type PortalRequest = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  body: string | null;
  desiredBy: string | null;
  status: "submitted" | "in_review" | "accepted" | "declined";
  declineReason: string | null;
  convertedTaskId: string | null;
  convertedTaskTitle: string | null;
  convertedTaskStatus: string | null;
  createdAt: string;
};

// The signed-in client's own requests. RLS's
// `client_requests_select_author_or_team` already scopes this to rows the
// caller authored, so no `created_by` filter is repeated here — same
// reasoning as the rest of this file.
export async function getPortalRequests(
  workspaceId: string,
): Promise<PortalRequest[]> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectNames = new Map(
    (projects ?? []).map((p) => [p.id as string, p.name as string]),
  );

  if (projectNames.size === 0) return [];

  const { data, error } = await supabase
    .from("client_requests")
    .select(
      "id, project_id, title, body, desired_by, status, decline_reason, converted_task_id, created_at, tasks(title, status)",
    )
    .in("project_id", [...projectNames.keys()])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getPortalRequests failed:", error);
    return [];
  }

  return (data ?? []).map((row) => {
    // The embedded task is only readable when it is shared with the client
    // — which `acceptClientRequest` guarantees for anything it converts.
    // A null here therefore means "accepted, then later un-shared by the
    // team", which the UI renders as accepted without a link rather than
    // pretending the task does not exist.
    const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;

    return {
      id: row.id,
      projectId: row.project_id,
      projectName: projectNames.get(row.project_id) ?? "",
      title: row.title,
      body: row.body,
      desiredBy: row.desired_by,
      status: row.status as PortalRequest["status"],
      declineReason: row.decline_reason,
      convertedTaskId: row.converted_task_id,
      convertedTaskTitle: task?.title ?? null,
      convertedTaskStatus: task?.status ?? null,
      createdAt: row.created_at,
    };
  });
}

export type PortalProjectOption = { id: string; name: string };

export async function getPortalProjectOptions(
  workspaceId: string,
): Promise<PortalProjectOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
}

// --- Task detail + conversation (C7) ---------------------------------------

export type PortalComment = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  authorName: string | null;
  isMine: boolean;
};

export type PortalTaskDetail = PortalTask & {
  projectId: string;
  projectName: string;
  description: string | null;
  comments: PortalComment[];
};

// One shared task, with the part of its conversation the client is allowed
// to see. RLS decides both halves: a task that is not shared returns no
// row, and an internal comment returns no row — so `null` here means
// "nothing to show", never "hidden but present".
export async function getPortalTaskDetail(
  workspaceId: string,
  taskId: string,
  currentUserId: string,
): Promise<PortalTaskDetail | null> {
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, title, status, status_id, due_date, description, project_id")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !task) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, workspace_id")
    .eq("id", task.project_id)
    .maybeSingle();

  // Guards against a task id from another workspace being rendered inside
  // this workspace's portal chrome.
  if (!project || project.workspace_id !== workspaceId) return null;

  const { data: statuses } = await supabase
    .from("project_statuses")
    .select("id, name, category")
    .eq("project_id", task.project_id);

  const category =
    (statuses ?? []).find((s) => s.id === task.status_id)?.category ??
    (statuses ?? []).find((s) => s.name === task.status)?.category ??
    "not_started";

  const { data: comments } = await supabase
    .from("comments")
    .select("id, text, created_at, user_id")
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at");

  const authorIds = [...new Set((comments ?? []).map((c) => c.user_id))];
  const names = new Map<string, string | null>();

  if (authorIds.length > 0) {
    // A client cannot read the team's profiles (20260902020000), so this
    // returns their own name and nothing else. Rather than render blanks,
    // the UI falls back to the workspace name for anyone it cannot
    // resolve — from the client's side "someone at the agency said this"
    // is the honest and sufficient attribution.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", authorIds);
    for (const profile of profiles ?? []) {
      names.set(profile.id, profile.display_name);
    }
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusId: task.status_id,
    dueDate: task.due_date,
    category: category as StatusCategory,
    projectId: project.id,
    projectName: project.name,
    description: task.description,
    comments: (comments ?? []).map((comment) => ({
      id: comment.id,
      text: comment.text,
      createdAt: comment.created_at,
      authorId: comment.user_id,
      authorName: names.get(comment.user_id) ?? null,
      isMine: comment.user_id === currentUserId,
    })),
  };
}

// UX-22: the portal landing page used to be only "here is a progress bar
// per project" — it never answered the two questions a client actually
// opens the portal for: "is anything waiting on me?" and "what shipped
// recently?". This reuses the same RLS-scoped tasks/statuses read
// getPortalProjects already does (so a client still only ever sees rows
// their `client_visible` grant already allows) and derives two small
// lists from it instead of adding a second, parallel query path.
export type PortalOverviewTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  dueDate: string | null;
  updatedAt: string;
};

export type PortalOverview = {
  waitingOnYou: PortalOverviewTask[];
  deliveredThisWeek: PortalOverviewTask[];
};

export async function getPortalOverview(
  workspaceId: string,
): Promise<PortalOverview> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (!projects?.length) {
    return { waitingOnYou: [], deliveredThisWeek: [] };
  }

  const projectIds = projects.map((p) => p.id);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  const [{ data: tasks }, { data: statuses }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, status_id, due_date, project_id, updated_at")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
    supabase
      .from("project_statuses")
      .select("id, project_id, name, category")
      .in("project_id", projectIds),
  ]);

  const categoryByStatusId = new Map<string, StatusCategory>();
  for (const status of (statuses ?? []) as StatusRow[]) {
    categoryByStatusId.set(status.id, status.category);
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const waitingOnYou: PortalOverviewTask[] = [];
  const deliveredThisWeek: PortalOverviewTask[] = [];

  for (const task of tasks ?? []) {
    const category = task.status_id
      ? categoryByStatusId.get(task.status_id)
      : undefined;

    // "Waiting on you" — the status name itself carries the "needs a
    // client response" signal (e.g. "In Review"); category alone can't
    // distinguish that from ordinary in-progress work.
    const isAwaitingReview = /review/i.test(task.status);

    const mapped: PortalOverviewTask = {
      id: task.id,
      title: task.title,
      projectId: task.project_id,
      projectName: projectNames.get(task.project_id) ?? "",
      dueDate: task.due_date,
      updatedAt: task.updated_at,
    };

    if (isAwaitingReview && category !== "done") {
      waitingOnYou.push(mapped);
    } else if (category === "done" && new Date(task.updated_at) >= sevenDaysAgo) {
      deliveredThisWeek.push(mapped);
    }
  }

  return { waitingOnYou, deliveredThisWeek };
}
