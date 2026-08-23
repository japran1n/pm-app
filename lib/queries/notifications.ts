// F208: data-fetching for the notification bell + panel (AS-379, AS-385).
//
// Read path: F206's `notifications` table already scopes SELECT to
// `user_id = auth.uid()` (own inbox only) plus a 30-day retention window
// (RLS, supabase/migrations/20260823020000_create_notifications.sql) — this
// file adds no additional filtering for those two guarantees, it only
// shapes rows for display and resolves the actor/task display fields the
// panel needs (AS-385: "actor, action, and task").
//
// Workspace-scoped (per this feature's bell living in the per-workspace
// sidebar, mirroring every other sidebar-fed query in this codebase, e.g.
// getWorkspaceMembers): a caller who belongs to several workspaces sees
// only the active workspace's notifications here, not a cross-workspace
// merged inbox — there is no cross-workspace inbox UI anywhere else in
// this app to justify building one now (simpler option, no new
// dependency, per the clarified ambiguity-resolution answer).
//
// Performance (this feature's explicit "no N+1 queries per row, no
// per-item network call" budget): one query for the notification rows,
// one batched query for their tasks (+ project key), and one batched
// resolvePeople() call for their actors — never one query per row.
import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { UserAvatarPerson } from "@/components/user-avatar";

export type NotificationKind =
  | "mention"
  | "comment_reply"
  | "task_assigned"
  | "task_due_soon"
  | "watcher_update";

export type NotificationListItem = {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  readAt: string | null;
  actor: UserAvatarPerson | null;
  task: {
    id: string;
    /** "PM-142", or null if the task has no resolvable key (e.g. its
     * project was deleted alongside it — formatTaskKey's own null
     * contract). */
    key: string | null;
    /** Null when the task itself no longer exists (hard-deleted) or was
     * soft-deleted — the panel falls back to "a deleted task" rather than
     * omitting the row (AS-385's simpler-option default: the notification
     * itself is still real history for its owner, so it stays listed). */
    title: string | null;
    /** AS-386 follow-up: the task's project id, so the panel can link
     * straight to `/w/{slug}/projects/{projectId}/board?taskId={id}`
     * (the board page's `useTaskDetailSheet` deep-link) instead of the
     * search page. Null when the task's project itself is gone/
     * unresolvable — the panel falls back to the search link in that
     * case only. */
    projectId: string | null;
  } | null;
  /** F304 (AS-374 follow-up): the comment this notification is about, when
   * one exists (F207's fan-out already stores `comment_id` on the row for
   * `comment_reply`/`mention` kinds via lib/actions/comments.ts's
   * addComment — this query simply wasn't selecting it). Null for kinds
   * that never carry a comment (task_assigned, watcher_update) or when the
   * notification predates F207's comment_id column. The panel uses this to
   * deep-link straight to the comment, not just the task. */
  commentId?: string | null;
};

const DEFAULT_LIMIT = 20;

/**
 * The current user's notifications for `workspaceId`, newest first
 * (AS-385), with actor + task display fields resolved. `unreadCount` is a
 * separate query (not `list.length`) so the bell's badge (AS-379) stays
 * correct even when `list` is capped by `limit` — e.g. 25 unread
 * notifications with `limit: 20` still shows "25", not "20".
 *
 * F210 (AS-390): a notification whose task was deleted, or whose task's
 * project the caller can no longer see (made private after the
 * notification fired — both cases "treat both the same way" per this
 * feature's clarified Notes), degrades to a non-clickable row instead of
 * a broken link. The `tasks` SELECT below runs on the caller's own
 * session (not the admin client), so `public.is_task_visible_to()` /
 * `is_project_visible_to()` (supabase/migrations/20260821140526_project_
 * visibility_rls_sweep.sql) already filters out rows for a
 * no-longer-visible project at the RLS layer — the query never needs to
 * re-implement that visibility rule itself; a task id that doesn't come
 * back from this query (because RLS excluded it, or because it's been
 * hard-deleted) is treated identically to a soft-deleted task: `title:
 * null`, which the panel already renders as "a deleted task" and a
 * non-clickable row (see notification-panel.tsx's taskLabel/taskHref).
 * The same accessibility check also removes such rows from `unreadCount`
 * (spec: "excluded from the unread count").
 */
export async function getNotificationsForWorkspace(
  workspaceId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<{ list: NotificationListItem[]; unreadCount: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { list: [], unreadCount: 0 };
  }

  const { data: rows, error } = await supabase
    .from("notifications")
    .select("id, kind, actor_id, task_id, comment_id, read_at, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getNotificationsForWorkspace: fetch failed:", error);
    return { list: [], unreadCount: 0 };
  }

  // F210: fetched separately from `rows` (no `limit`) because unreadCount
  // must reflect every unread row, not just the page the panel renders —
  // e.g. 25 unread with `limit: 20` still needs to know the accessibility
  // of all 25, not just the first 20.
  const { data: unreadRows, error: unreadError } = await supabase
    .from("notifications")
    .select("id, task_id")
    .eq("workspace_id", workspaceId)
    .is("read_at", null);

  if (unreadError) {
    console.error(
      "getNotificationsForWorkspace: unread lookup failed:",
      unreadError,
    );
  }

  const taskIds = Array.from(
    new Set(
      [...(rows ?? []), ...(unreadRows ?? [])]
        .map((row) => row.task_id)
        .filter((id): id is string => !!id),
    ),
  );
  const actorIds = Array.from(
    new Set((rows ?? []).map((row) => row.actor_id).filter((id): id is string => !!id)),
  );

  const [taskRows, actorSummaries] = await Promise.all([
    taskIds.length
      ? supabase
          .from("tasks")
          .select("id, title, number, project_id, deleted_at, projects(key)")
          .in("id", taskIds)
      : Promise.resolve({ data: [], error: null }),
    resolvePeople(actorIds),
  ]);

  if (taskRows.error) {
    console.error(
      "getNotificationsForWorkspace: task lookup failed:",
      taskRows.error,
    );
  }

  const taskById = new Map(
    (taskRows.data ?? []).map((task) => {
      const project = task.projects as { key: string } | { key: string }[] | null;
      const projectKey = Array.isArray(project) ? project[0]?.key : project?.key;
      return [
        task.id,
        {
          id: task.id,
          key: formatTaskKey(projectKey ?? null, task.number),
          // Soft-deleted tasks still resolve here (no deleted_at filter
          // on the query above) but are shown as "deleted task" per this
          // feature's simpler-option fallback, not silently dropped.
          title: task.deleted_at ? null : task.title,
          // AS-386 follow-up: null out the project id for a soft-deleted
          // task too, same as `title` above, so the panel's taskHref
          // helper falls back to the search link rather than linking to
          // a board deep-link for a task that no longer really exists.
          projectId: task.deleted_at ? null : task.project_id,
        },
      ];
    }),
  );

  // F210 (AS-390): true only for a task id that came back from the query
  // above AND isn't soft-deleted. A task id that isn't in `taskById` at
  // all was either hard-deleted or filtered out by RLS because its
  // project is no longer visible to this recipient — both degrade the
  // same way.
  function isAccessible(taskId: string): boolean {
    return taskById.get(taskId)?.title !== undefined && taskById.get(taskId)?.title !== null;
  }

  function resolveTask(taskId: string | null): NotificationListItem["task"] {
    if (!taskId) return null;
    const found = taskById.get(taskId);
    if (found) return found;
    // Hard-deleted or no-longer-visible — degrade like a soft-deleted
    // task rather than surfacing a broken link.
    return { id: taskId, key: null, title: null, projectId: null };
  }

  const list: NotificationListItem[] = (rows ?? []).map((row) => {
    const actor = row.actor_id ? actorSummaries.get(row.actor_id) ?? null : null;
    return {
      id: row.id,
      kind: row.kind as NotificationKind,
      createdAt: row.created_at,
      readAt: row.read_at,
      actor: actor
        ? { id: row.actor_id as string, name: actor.name, email: actor.email, avatarUrl: actor.avatarUrl }
        : null,
      task: resolveTask(row.task_id),
      commentId: row.comment_id,
    };
  });

  const unreadCount = (unreadRows ?? []).filter(
    (row) => !row.task_id || isAccessible(row.task_id),
  ).length;

  return { list, unreadCount };
}
