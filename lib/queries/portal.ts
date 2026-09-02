import { logger } from "@/lib/observability/logger";

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
import { createAdminClient } from "@/lib/supabase/admin";

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
  // The project's board columns (status name + category), independent of
  // which columns currently hold a shared task. Carried down so the client
  // list can resolve the category for a status it receives over Realtime
  // (e.g. a task moved into a Done column that had zero shared tasks at
  // render time) without a second round trip -- `tasks.status`/`status_id`
  // never carry `category` themselves; only `project_statuses` does.
  statuses: { id: string; name: string; category: StatusCategory }[];
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
    logger.error("getPortalProjects: failed to load projects", { error: projectsError });
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
    logger.error("getPortalProjects: failed to load tasks", { error: tasksError });
  }
  if (statusesError) {
    logger.error("getPortalProjects: failed to load statuses", { error: statusesError });
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
      statuses: ((statuses ?? []) as StatusRow[])
        .filter((s) => s.project_id === project.id)
        .map((s) => ({ id: s.id, name: s.name, category: s.category })),
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
    logger.error("getWorkspaceRoleForCurrentUser failed", { error: error });
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
    logger.error("getPortalRequests failed", { error: error });
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
  // F4 (docs/client-dashboard-features-plan.md): drives the
  // Approve/Request changes controls on this page.
  pendingClientApproval: boolean;
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
    .select(
      "id, title, status, status_id, due_date, description, project_id, pending_client_approval",
    )
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
    pendingClientApproval: task.pending_client_approval ?? false,
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
      .select(
        "id, title, status, status_id, due_date, project_id, updated_at, pending_client_approval",
      )
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

    // "Waiting on you" — F1 (docs/client-dashboard-features-plan.md):
    // this used to be inferred from a regex on the status name
    // (`/review/i`), which only worked for a team whose status happened to
    // be named exactly "In Review". `pending_client_approval` is the same
    // signal made explicit: the team sets it, so it survives status
    // renames and covers any status, not just one whose name matches.
    const isAwaitingReview = task.pending_client_approval === true;

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

// --- Activity feed (F2, docs/client-dashboard-features-plan.md) -----------
//
// "What happened since you were last here" for a client who opens the
// portal infrequently. Deliberately NOT built on `audit_log`: that table's
// RLS (20260821211226) is owner/admin read-only by design, on the explicit
// reasoning that it is a sensitive internal history — extending it to the
// client role would be a real widening of a boundary stated elsewhere to
// be load-bearing, for a feature that doesn't need it. Everything this
// feed shows is derivable from `tasks` and `comments`, which are already
// the exact RLS-scoped reads this file's other queries use.

export type PortalActivitySummary = {
  /** Null the first time a client ever opens the portal — the UI shows no
   * "since" framing in that case, only the two lists below. */
  since: string | null;
  completed: PortalOverviewTask[];
  added: PortalOverviewTask[];
  commentCount: number;
};

export async function getPortalActivitySummary(
  workspaceId: string,
  userId: string,
): Promise<PortalActivitySummary> {
  // Bookkeeping only (the "when did this member last look" timestamp),
  // not task/comment data — reading and writing it via the admin client is
  // the deliberate exception to this file's own RLS-only convention (see
  // top-of-file comment), because workspace_members carries no RLS policy
  // for a client to update their own row, and the value written back here
  // is never influenced by anything the caller supplied.
  const admin = createAdminClient();
  const { data: memberRow } = await admin
    .from("workspace_members")
    .select("id, portal_last_seen_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("role", "client")
    .maybeSingle();

  const since = memberRow?.portal_last_seen_at ?? null;

  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const completed: PortalOverviewTask[] = [];
  const added: PortalOverviewTask[] = [];
  let commentCount = 0;

  if (projectIds.length > 0) {
    const sinceFloor = since ?? "1970-01-01T00:00:00.000Z";

    const [{ data: tasks }, { data: statuses }, { data: sharedTasks }] =
      await Promise.all([
        supabase
          .from("tasks")
          .select(
            "id, title, status_id, due_date, project_id, created_at, updated_at",
          )
          .in("project_id", projectIds)
          .is("deleted_at", null)
          .gt("updated_at", sinceFloor),
        supabase
          .from("project_statuses")
          .select("id, project_id, category")
          .in("project_id", projectIds),
        // Comments live under client_visible tasks only — fetch that id
        // set first so the comment count query below doesn't have to
        // reason about visibility itself (RLS already restricts it, this
        // is only for the `internal` filter, same belt-and-suspenders
        // reasoning as elsewhere in this file).
        supabase
          .from("tasks")
          .select("id")
          .in("project_id", projectIds)
          .eq("client_visible", true)
          .is("deleted_at", null),
      ]);

    const sharedTaskIds = (sharedTasks ?? []).map((t) => t.id);

    const { count } = sharedTaskIds.length
      ? await supabase
          .from("comments")
          .select("id", { count: "exact", head: true })
          .in("task_id", sharedTaskIds)
          .eq("internal", false)
          .is("deleted_at", null)
          .gt("created_at", sinceFloor)
      : { count: 0 };

    commentCount = count ?? 0;

    const categoryByStatusId = new Map<string, StatusCategory>();
    for (const status of statuses ?? []) {
      categoryByStatusId.set(status.id, status.category as StatusCategory);
    }

    for (const task of tasks ?? []) {
      const category = task.status_id
        ? categoryByStatusId.get(task.status_id)
        : undefined;
      const mapped: PortalOverviewTask = {
        id: task.id,
        title: task.title,
        projectId: task.project_id,
        projectName: projectNames.get(task.project_id) ?? "",
        dueDate: task.due_date,
        updatedAt: task.updated_at,
      };

      if (category === "done") {
        completed.push(mapped);
      } else if (task.created_at > sinceFloor) {
        added.push(mapped);
      }
    }
  }

  // Written back last, after every read above already ran, so this visit
  // itself is reflected on the client's *next* visit, not this one.
  if (memberRow) {
    await admin
      .from("workspace_members")
      .update({ portal_last_seen_at: new Date().toISOString() })
      .eq("id", memberRow.id);
  }

  return { since, completed, added, commentCount };
}

// --- Files (F3, docs/client-dashboard-features-plan.md) -------------------
//
// One list of every attachment on a task the client can see, instead of
// making them open each task to find one. RLS-scoped exactly like this
// file's other queries: attachments join back to tasks, and a client's own
// SELECT on `tasks` already only returns client_visible rows (20260902010000),
// so filtering here on client_visible again is belt-and-suspenders, not the
// real boundary.

export type PortalFile = {
  id: string;
  fileName: string;
  createdAt: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
};

export async function getPortalFiles(
  workspaceId: string,
): Promise<PortalFile[]> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  if (projectIds.length === 0) return [];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, project_id")
    .in("project_id", projectIds)
    .eq("client_visible", true)
    .is("deleted_at", null);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return [];

  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]));

  const { data: attachments } = await supabase
    .from("attachments")
    .select("id, file_name, created_at, task_id")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  return (attachments ?? []).flatMap((attachment) => {
    const task = taskById.get(attachment.task_id);
    if (!task) return [];
    return [
      {
        id: attachment.id,
        fileName: attachment.file_name,
        createdAt: attachment.created_at,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.project_id,
        projectName: projectNames.get(task.project_id) ?? "",
      },
    ];
  });
}
