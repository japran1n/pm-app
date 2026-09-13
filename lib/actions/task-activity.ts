"use server";

// F196: Server Action wrapper around lib/queries/task-activity.ts's
// getTaskActivityPage, so the Activity tab (a Client Component, per this
// codebase's established "smallest possible client boundary" convention —
// see components/task/comment-list.tsx's own doc comment for why
// task-detail-sheet.tsx's whole subtree is already client-side) can fetch
// its initial window and each "load more" page without a page reload,
// exactly like every other on-demand action this Sheet already calls
// (addComment, deleteComment, etc.).
//
// Not folded into getTaskDetail (lib/actions/tasks.ts) — that action
// already bundles nine parallel queries into one Sheet-open round trip,
// and this feature's Files scope does not list lib/actions/tasks.ts.
// Fetching activity as its own lazy, on-demand call (only made once the
// viewer opens the Activity tab) also means a viewer who only reads
// comments never pays for an activity query at all, matching the
// clarified performance budget without touching the existing, much
// larger action.
//
// Auth: mirrors getTaskDetail's own "must be signed in" check. Beyond
// that, no additional visibility check is performed here — the query
// itself relies entirely on F194's `task_activity_select_visible` RLS
// policy (AS-359), same "the DB is the enforcement point, this action
// only decides what error copy to show" split every other read action in
// this codebase uses.

import { deleteTaskSchema } from "@/lib/validation/tasks";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getTaskActivityPage,
  type TaskActivityPage,
} from "@/lib/queries/task-activity";

export type GetTaskActivityFeedResult =
  | { ok: true; data: TaskActivityPage }
  | { ok: false; error: string };

export async function getTaskActivityFeed(
  taskId: string,
  limit?: number,
): Promise<GetTaskActivityFeedResult> {
  const parsed = deleteTaskSchema.safeParse({ taskId });
  if (!parsed.success) {
    return { ok: false, error: "Invalid task." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to view this task." };
  }

  const page = await getTaskActivityPage(parsed.data.taskId, limit);
  // F308 (FU-12 item 6): a real query failure inside getTaskActivityPage
  // sets `page.error` (distinct from a genuine "zero rows" empty page,
  // which never sets it) — propagate that as this action's own `ok:
  // false` so ActivityFeed's existing error-vs-empty branching (it
  // already renders a distinct "Retry" state for `ok: false`) covers this
  // case too, instead of a transient DB failure rendering as "No activity
  // yet."
  if (page.error) {
    return { ok: false, error: page.error };
  }
  return { ok: true, data: page };
}
