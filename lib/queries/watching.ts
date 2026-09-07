// Feature request "Watching feed": data-fetching for
// app/(workspace)/w/[workspaceSlug]/watching/page.tsx — every task the
// signed-in caller is currently watching (F163/F164's `task_watchers`,
// `is_watching: true` only), sorted by that task's own most-recent
// activity (F194's `task_activity`, falling back to the task's own
// `updated_at` for a task with no activity rows yet), newest first.
//
// Read access relies entirely on RLS, same convention
// lib/queries/task-activity.ts's own header comment documents: a
// `task_watchers` row is only visible to its own user (own-row RLS) and a
// `tasks`/`task_activity` row is only visible per `is_task_visible_to` —
// this function's own `.eq("user_id", ...)` filter is redundant with RLS
// but kept explicit anyway (same "belt and suspenders" convention this
// codebase already applies elsewhere, e.g. getWorkspaceProjects's explicit
// `deleted_at is null` filter on top of RLS).
//
// Performance: batched, never per-task N+1 — one query for the watcher
// rows, one for the tasks themselves, one for their projects' names, and
// one for the latest activity row per watched task (fetched via an `in
// (...)` + `order by created_at desc` and reduced to "first row per task"
// in JS, same technique getArchivedWorkspaceProjects/getProjectHealthInputs
// already use for their own "one batched select, group in JS" needs).

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";
import { formatTaskActivityEntry } from "@/lib/activity/format-task-activity-entry";
import type { TaskActivityKind } from "@/lib/activity/task-activity-feed";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { logger } from "@/lib/observability/logger";

export type WatchedTaskListItem = {
  taskId: string;
  taskTitle: string;
  taskKey: string | null;
  projectId: string;
  projectName: string;
  status: string;
  dueDate: string | null;
  /** ISO timestamp this list is sorted by — the watched task's latest
   * `task_activity.created_at`, or its own `updated_at` if it has no
   * activity rows yet. */
  lastActivityAt: string;
  /** A short, human-readable "what changed" line for the most recent
   * activity entry (F196's own sentence vocabulary,
   * lib/activity/format-task-activity-entry.ts), or `null` for a watched
   * task with no activity history at all yet. */
  lastActivitySummary: string | null;
};

/** Fetches every task the given user is currently watching
 * (`task_watchers.is_watching = true`), sorted by most recent activity.
 * Returns an empty array (never throws) on any read failure — same
 * fail-open-to-empty convention `getFavoriteProjectIds` already uses for
 * this sidebar/dashboard-adjacent class of read. */
export async function getWatchedTasksForUser(
  userId: string,
): Promise<WatchedTaskListItem[]> {
  const supabase = await createClient();

  const { data: watcherRows, error: watcherError } = await supabase
    .from("task_watchers")
    .select("task_id")
    .eq("user_id", userId)
    .eq("is_watching", true);

  if (watcherError) {
    logger.error("getWatchedTasksForUser: watcher query failed", { error: watcherError });
    return [];
  }

  const taskIds = (watcherRows ?? []).map((row) => row.task_id);
  if (taskIds.length === 0) return [];

  // `tasks` has no `key` column -- a task's displayed "KEY-NUMBER"
  // identifier (e.g. "PM-142") is derived at read time via formatTaskKey
  // from the owning project's `key` plus this task's own `number`
  // (lib/tasks/task-key.ts), same fix already applied to getPersonalTodos
  // (see that function's own header comment for why this is the ONLY
  // place that should assemble that string).
  const { data: taskRows, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, number, project_id, status, due_date, updated_at, projects(key)")
    .in("id", taskIds)
    .is("deleted_at", null);

  if (taskError) {
    logger.error("getWatchedTasksForUser: task query failed", { error: taskError });
    return [];
  }

  const tasks = taskRows ?? [];
  if (tasks.length === 0) return [];

  const projectIds = Array.from(new Set(tasks.map((task) => task.project_id)));
  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds);

  if (projectError) {
    logger.error("getWatchedTasksForUser: project query failed", { error: projectError });
  }
  const projectNameById = new Map(
    (projectRows ?? []).map((project) => [project.id, project.name]),
  );

  // Latest activity row per watched task -- one query, newest-first, then
  // "first row per task id wins" in JS (same reduce technique
  // getProjectHealthInputs uses for its own "first active phase per
  // project" grouping just above in this file's sibling module).
  const { data: activityRows, error: activityError } = await supabase
    .from("task_activity")
    .select("task_id, kind, field, old_value, new_value, actor_id, created_at")
    .in("task_id", tasks.map((task) => task.id))
    .order("created_at", { ascending: false });

  if (activityError) {
    logger.error("getWatchedTasksForUser: activity query failed", { error: activityError });
  }

  type ActivityRow = {
    task_id: string;
    kind: string;
    field: string | null;
    old_value: unknown;
    new_value: unknown;
    actor_id: string | null;
    created_at: string;
  };
  const latestActivityByTask = new Map<string, ActivityRow>();
  for (const row of (activityRows ?? []) as ActivityRow[]) {
    if (!latestActivityByTask.has(row.task_id)) {
      latestActivityByTask.set(row.task_id, row);
    }
  }

  const actorIds = Array.from(
    new Set(
      Array.from(latestActivityByTask.values())
        .map((row) => row.actor_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const actorsById = actorIds.length > 0 ? await resolvePeople(actorIds) : new Map();
  const actorLabelById = new Map(
    Array.from(actorsById.entries()).map(([id, person]) => [
      id,
      person?.name ?? person?.email ?? null,
    ]),
  );

  return buildWatchedTaskItems(
    tasks as unknown as WatchingQueryTaskRow[],
    projectNameById,
    latestActivityByTask,
    actorLabelById,
  );
}

export type WatchingQueryTaskRow = {
  id: string;
  title: string;
  number: number | null;
  project_id: string;
  status: string;
  due_date: string | null;
  updated_at: string;
  // `tasks` has no `key` column -- the displayed "KEY-NUMBER" identifier is
  // derived from the owning project's `key` (embedded here) plus `number`
  // via formatTaskKey (lib/tasks/task-key.ts), same convention
  // getPersonalTodos already follows.
  projects: { key: string | null } | null;
};

export type WatchingQueryActivityRow = {
  task_id: string;
  kind: string;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_id: string | null;
  created_at: string;
};

/**
 * Pure assembly step: joins already-fetched tasks/projects/latest-activity
 * data into the sorted `WatchedTaskListItem[]` this feed renders. Split
 * out of `getWatchedTasksForUser` (no Supabase/I/O of its own) so the
 * "what changed" summary + newest-first sort can be unit-tested directly
 * against plain objects, per this codebase's established "pure helper +
 * caller wires up the data" convention (e.g.
 * lib/activity/format-task-activity-entry.ts).
 */
export function buildWatchedTaskItems(
  tasks: WatchingQueryTaskRow[],
  projectNameById: Map<string, string>,
  latestActivityByTask: Map<string, WatchingQueryActivityRow>,
  actorLabelById: Map<string, string | null>,
): WatchedTaskListItem[] {
  const items: WatchedTaskListItem[] = tasks.map((task) => {
    const latestActivity = latestActivityByTask.get(task.id);
    const lastActivityAt = latestActivity?.created_at ?? task.updated_at;

    let lastActivitySummary: string | null = null;
    if (latestActivity) {
      const actorLabel = latestActivity.actor_id
        ? (actorLabelById.get(latestActivity.actor_id) ?? "Someone")
        : null;
      lastActivitySummary = formatTaskActivityEntry({
        kind: latestActivity.kind as TaskActivityKind,
        field: latestActivity.field,
        oldValue: latestActivity.old_value,
        newValue: latestActivity.new_value,
        actorLabel,
      });
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      taskKey: formatTaskKey(task.projects?.key ?? null, task.number ?? null),
      projectId: task.project_id,
      projectName: projectNameById.get(task.project_id) ?? "Unknown project",
      status: task.status,
      dueDate: task.due_date,
      lastActivityAt,
      lastActivitySummary,
    };
  });

  // Sorted by most recent activity, newest first.
  items.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));

  return items;
}
