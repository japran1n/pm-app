import { logger } from "@/lib/observability/logger";
import { getRequestClient } from "@/lib/auth/current-user";
import { buildStatusBucketMaps } from "@/lib/portal/status-bucket";
import {
  todayIso,
  type PortalBillingModel,
  type PortalLaunchConfidence,
  type StatusCategory,
  type StatusRowWithBucket,
} from "./shared";

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
  // F006g (missions/20260903-portal, AS-015): the status's own
  // `client_bucket` override (raw, unresolved -- same shape as
  // `project_statuses.client_bucket`), carried alongside `category` so
  // `clientStatusLabel` can resolve this task's group heading through
  // `resolveClientBucket` instead of matching the status's name.
  clientBucket: string | null;
};

export type PortalProject = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  // F003 (missions/20260903-portal, AS-005): the portal topbar's launch
  // chips. `null` on any of these three is a real, common state (a PM
  // hasn't set them yet) -- rendered as "-" by the shell, never a fake
  // date or a default confidence.
  targetLaunchDate: string | null;
  launchConfidence: PortalLaunchConfidence | null;
  launchNote: string | null;
  // Paket B: 'fixed_price' (the DB default) hides Hours in the portal;
  // 'hourly' shows it. Never null -- the column itself is `not null
  // default 'fixed_price'`.
  billingModel: PortalBillingModel;
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
  // The project's board columns (status name + category + client_bucket),
  // independent of which columns currently hold a shared task. Carried
  // down so the client list can resolve the category AND client bucket
  // for a status it receives over Realtime (e.g. a task moved into a Done
  // column that had zero shared tasks at render time) without a second
  // round trip -- `tasks.status`/`status_id` never carry `category` or
  // `client_bucket` themselves; only `project_statuses` does.
  statuses: { id: string; name: string; category: StatusCategory; clientBucket: string | null }[];
};

export async function getPortalProjects(
  workspaceId: string,
): Promise<PortalProject[]> {
  const supabase = await getRequestClient();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select(
      "id, name, description, start_date, end_date, target_launch_date, launch_confidence, launch_note, billing_model",
    )
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    // F001 (missions/20260903-portal, AS-007): a project's portal is off
    // by default. RLS still lets a client read the `projects` row itself
    // (portal_enabled has no bearing on ordinary project visibility), so
    // this filter is the actual gate for the portal's own project list —
    // the same "the database hides rows, this file filters what's left
    // over from a business-logic requirement, not a security boundary"
    // reasoning as `getProjectPhases`'s client_visible task filter below.
    .eq("portal_enabled", true)
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
        .select("id, project_id, name, category, client_bucket")
        .in("project_id", projectIds),
    ]);

  if (tasksError) {
    logger.error("getPortalProjects: failed to load tasks", { error: tasksError });
  }
  if (statusesError) {
    logger.error("getPortalProjects: failed to load statuses", { error: statusesError });
  }

  // F006g (missions/20260903-portal, AS-015): client_bucket carried the
  // same way as category, so `PortalTaskList`'s group headings can resolve
  // a bucket (via `resolveClientBucket`) instead of matching the status's
  // name.
  const {
    categoryByStatusId,
    categoryByProjectAndName,
    clientBucketByStatusId,
    clientBucketByProjectAndName,
  } = buildStatusBucketMaps((statuses ?? []) as StatusRowWithBucket[]);

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
      const clientBucket =
        (task.status_id ? clientBucketByStatusId.get(task.status_id) : undefined) ??
        clientBucketByProjectAndName.get(`${project.id}:${task.status}`) ??
        null;

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
        clientBucket,
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
      targetLaunchDate: project.target_launch_date,
      launchConfidence: project.launch_confidence as PortalLaunchConfidence | null,
      launchNote: project.launch_note,
      billingModel: (project.billing_model as PortalBillingModel | null) ?? "fixed_price",
      tasks: mapped,
      notStarted,
      inProgress,
      done,
      total,
      percentComplete: total === 0 ? null : Math.round((done / total) * 100),
      nextDue,
      overdueCount,
      statuses: ((statuses ?? []) as StatusRowWithBucket[])
        .filter((s) => s.project_id === project.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          clientBucket: s.client_bucket ?? null,
        })),
    };
  });
}

export type PortalProjectOption = { id: string; name: string };

// F006b (missions/20260903-portal, AS-007): the new-request form's own
// project `<select>` — every other project-scoped read in this file that
// touches `projects` directly needs the same explicit `portal_enabled`
// filter `getPortalProjects` documents on its own identical line, because
// RLS never gates an ordinary `projects` SELECT by that column. Without
// it, a client on a portal-enabled AND a portal-disabled project could
// file a NEW request against the disabled one from this exact dropdown —
// this was the write half of the M1 scrutiny report's B1.
export async function getPortalProjectOptions(
  workspaceId: string,
): Promise<PortalProjectOption[]> {
  const supabase = await getRequestClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .eq("portal_enabled", true)
    .order("name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
}
