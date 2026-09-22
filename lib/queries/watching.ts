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
 *
 * F057 (FU-M4-10, SB-052): returns getWorkspaceClientRequests's own
 * `{ list, error }` shape (lib/queries/client-requests.ts) instead of a
 * bare array — a real read failure on any of the watcher/task/project
 * queries below used to collapse to `[]`, indistinguishable from
 * "watching nothing", and (for the project lookup specifically) could
 * render a row with a blank/"Unknown project" name instead of surfacing
 * the failure. `error` is set for a failure on the watcher query, the
 * task query, OR the project-name query — the last one because a project
 * name is core render data for every row here, not a nullable extra. The
 * activity lookup remains best-effort (a missing "what changed" summary
 * degrades gracefully; see below), matching AS/SB conventions elsewhere
 * that only the row's core identity fields gate the error path. */
export async function getWatchedTasksForUser(
  userId: string,
): Promise<{ list: WatchedTaskListItem[]; error?: string }> {
  const supabase = await createClient();

  const { data: watcherRows, error: watcherError } = await supabase
    .from("task_watchers")
    .select("task_id")
    .eq("user_id", userId)
    .eq("is_watching", true);

  if (watcherError) {
    logger.error("getWatchedTasksForUser: watcher query failed", { error: watcherError });
    return { list: [], error: "Couldn't load watched tasks." };
  }

  const taskIds = (watcherRows ?? []).map((row) => row.task_id);
  if (taskIds.length === 0) return { list: [] };

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
    return { list: [], error: "Couldn't load watched tasks." };
  }

  const tasks = taskRows ?? [];
  if (tasks.length === 0) return { list: [] };

  const projectIds = Array.from(new Set(tasks.map((task) => task.project_id)));
  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds);

  if (projectError) {
    // F057: a project name is core render data for every row here (not a
    // nullable extra) — swallowing this used to let a row fall through to
    // `buildWatchedTaskItems`'s "Unknown project" fallback, which reads
    // identically to a genuinely nameless/deleted project. Surface the
    // failure instead of guessing.
    logger.error("getWatchedTasksForUser: project query failed", { error: projectError });
    return { list: [], error: "Couldn't load watched tasks." };
  }
  const projectNameById = new Map(
    (projectRows ?? []).map((project) => [project.id, project.name]),
  );

  // Latest activity row per watched task — one RPC call using DISTINCT ON
  // (task_id) in Postgres, which is far cheaper than fetching all rows and
  // grouping in JS. The function runs with security invoker so RLS on
  // task_activity still applies.
  const { data: activityRows, error: activityError } = await supabase
    .rpc("get_latest_task_activity", { task_ids: tasks.map((task) => task.id) });

  if (activityError) {
    // F057: previously logged-and-continued, which rendered every row as
    // if it had no activity history (silently wrong "what changed"
    // summaries and sort order) instead of surfacing the failure.
    logger.error("getWatchedTasksForUser: activity query failed", { error: activityError });
    return { list: [], error: "Couldn't load watched tasks." };
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
  // The RPC already returns one row per task_id (DISTINCT ON), so a simple
  // Map build is all that is needed — no JS-side "first row wins" loop.
  const latestActivityByTask = new Map<string, ActivityRow>(
    (activityRows ?? []).map((row: ActivityRow) => [row.task_id, row]),
  );

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

  return {
    list: buildWatchedTaskItems(
      tasks as unknown as WatchingQueryTaskRow[],
      projectNameById,
      latestActivityByTask,
      actorLabelById,
    ),
  };
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
