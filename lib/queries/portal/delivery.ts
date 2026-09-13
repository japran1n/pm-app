import { logger } from "@/lib/observability/logger";
import { getRequestClient } from "@/lib/auth/current-user";
import { computeWeeklyDeliverySeries, type WeeklyDeliveryWeek } from "@/lib/portal/weekly-delivery";
import type { PortalQueryResult, StatusCategory, StatusRow } from "./shared";

// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// "Weekly delivery rhythm" -- how much client-visible work shipped, week
// by week, across the project's own span. See lib/portal/weekly-delivery.ts's
// own header for the full definition of "shipped in week N" and why
// `task_activity` (not `updated_at`) is the source. This function does
// the two reads that definition needs and hands the plain completion-date
// list to that pure module -- the DB/RLS boundary and the series math stay
// separate, same split as getProjectPhases/computePhaseTimelineLayout.
export async function getPortalWeeklyDelivery(
  projectId: string,
  projectStartDate: string | null,
  todayIso: string,
): Promise<PortalQueryResult<WeeklyDeliveryWeek[]>> {
  const supabase = await getRequestClient();

  // Same `client_visible` scoping every other business-logic read in this
  // file applies explicitly (getProjectPhases's own comment: RLS already
  // hides a non-visible task from a client session, but this figure must
  // stay correct for a team member previewing the client's own numbers
  // too).
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, status_id, status, created_at")
    .eq("project_id", projectId)
    .eq("client_visible", true)
    .is("deleted_at", null);

  if (tasksError) {
    logger.error("getPortalWeeklyDelivery: failed to load tasks", { error: tasksError });
    return { ok: false, error: tasksError.message };
  }

  const fallbackStart = projectStartDate ?? tasks?.[0]?.created_at?.slice(0, 10) ?? todayIso;

  if (!tasks?.length) {
    return { ok: true, data: computeWeeklyDeliverySeries([], fallbackStart, todayIso) };
  }

  const { data: statuses, error: statusesError } = await supabase
    .from("project_statuses")
    .select("id, project_id, name, category")
    .eq("project_id", projectId);

  if (statusesError) {
    logger.error("getPortalWeeklyDelivery: failed to load statuses", { error: statusesError });
    return { ok: false, error: statusesError.message };
  }

  // Same category-resolution convention as getProjectPhases/getPortalOverview
  // above (categoryByStatusId, falling back to a name match) -- never a
  // hardcoded `status === 'done'` string check, so a project that renamed
  // or reordered its default columns still resolves correctly.
  const categoryByStatusId = new Map<string, StatusCategory>();
  const categoryByName = new Map<string, StatusCategory>();
  for (const status of (statuses ?? []) as StatusRow[]) {
    categoryByStatusId.set(status.id, status.category);
    categoryByName.set(status.name, status.category);
  }

  const doneTasks = tasks.filter((task) => {
    const category = task.status_id
      ? categoryByStatusId.get(task.status_id)
      : categoryByName.get(task.status);
    return category === "done";
  });

  if (doneTasks.length === 0) {
    return { ok: true, data: computeWeeklyDeliverySeries([], fallbackStart, todayIso) };
  }

  const doneTaskIds = doneTasks.map((task) => task.id);

  const { data: activity, error: activityError } = await supabase
    .from("task_activity")
    .select("task_id, created_at")
    .in("task_id", doneTaskIds)
    .eq("kind", "field_changed")
    .eq("field", "status")
    .order("created_at", { ascending: false });

  if (activityError) {
    logger.error("getPortalWeeklyDelivery: failed to load task_activity", {
      error: activityError,
    });
    return { ok: false, error: activityError.message };
  }

  // Rows arrive most-recent-first, so the first row seen for a task_id is
  // its LAST status change -- exactly the "last transition, task still
  // done today" reading this feature's definition requires (see
  // lib/portal/weekly-delivery.ts's header for why the last, not the
  // first, transition is used).
  const lastStatusChangeByTask = new Map<string, string>();
  for (const row of activity ?? []) {
    if (!lastStatusChangeByTask.has(row.task_id)) {
      lastStatusChangeByTask.set(row.task_id, row.created_at);
    }
  }

  // Fallback per task (documented in lib/portal/weekly-delivery.ts's
  // header): a done task with no recorded status-change event at all --
  // predates F194/F195, or was seeded/imported already done -- uses its
  // own `created_at`, never `updated_at`.
  const completionDates = doneTasks.map(
    (task) => lastStatusChangeByTask.get(task.id) ?? task.created_at,
  );

  return { ok: true, data: computeWeeklyDeliverySeries(completionDates, fallbackStart, todayIso) };
}
