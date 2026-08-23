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
  } | null;
};

const DEFAULT_LIMIT = 20;

/**
 * The current user's notifications for `workspaceId`, newest first
 * (AS-385), with actor + task display fields resolved. `unreadCount` is a
 * separate, cheap count query (not `list.length`) so the bell's badge
 * (AS-379) stays correct even when `list` is capped by `limit` — e.g. 25
 * unread notifications with `limit: 20` still shows "25", not "20".
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
    .select("id, kind, actor_id, task_id, read_at, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getNotificationsForWorkspace: fetch failed:", error);
    return { list: [], unreadCount: 0 };
  }

  const { count: unreadCount, error: unreadError } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("read_at", null);

  if (unreadError) {
    console.error(
      "getNotificationsForWorkspace: unread count failed:",
      unreadError,
    );
  }

  const taskIds = Array.from(
    new Set((rows ?? []).map((row) => row.task_id).filter((id): id is string => !!id)),
  );
  const actorIds = Array.from(
    new Set((rows ?? []).map((row) => row.actor_id).filter((id): id is string => !!id)),
  );

  const [taskRows, actorSummaries] = await Promise.all([
    taskIds.length
      ? supabase
          .from("tasks")
          .select("id, title, number, deleted_at, projects(key)")
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
        },
      ];
    }),
  );

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
      task: row.task_id ? taskById.get(row.task_id) ?? null : null,
    };
  });

  return { list, unreadCount: unreadCount ?? 0 };
}
