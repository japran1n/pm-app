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
