// F304 (D2/FU-4 scrutiny fix): the ONE place that actually calls the
// `create_notification` RPC (F206's SECURITY DEFINER function).
//
// Before this fix, every fan-out call site (lib/actions/tasks.ts's
// setTaskAssigneesCore and moveTaskStatus, lib/actions/comments.ts's
// addComment) called `await supabase.rpc("create_notification", {...})`
// WITHOUT destructuring the returned `error` — supabase-js *resolves*
// (never throws) on an RPC error, so those call sites' surrounding
// try/catch never fired and a rejected RPC (a membership check failure, a
// `kind` CHECK violation, a unique-index conflict) meant the notification
// was silently never sent, with zero observability. Only
// lib/notifications/mentions.ts's notifyNewlyMentionedUsers correctly
// checked `error` before this fix.
//
// This helper is the single place every fan-out call site now goes
// through instead of each reimplementing the same `supabase.rpc(...)`
// call inconsistently. It stays non-fatal by design — a notification
// failure must never fail the surrounding assignment/status-change/
// comment write, the same "non-fatal side effect" convention already
// established by every other post-write side effect in this codebase
// (see e.g. lib/actions/tasks.ts's writeTaskFieldChanges try/catch) — but
// the failure is now OBSERVED (logged with the recipient/kind/task
// context) rather than silently dropped.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { NotificationKind } from "@/lib/notifications/fanout";

export type CreateNotificationParams = {
  userId: string;
  workspaceId: string;
  kind: NotificationKind;
  taskId: string;
  commentId?: string;
};

/**
 * Calls `create_notification` and returns whether it succeeded. Never
 * throws — callers can `await` this without their own try/catch purely
 * for RPC-failure purposes (a caller may still want its own try/catch
 * around unrelated code in the same loop iteration, e.g. the
 * watcher-promotion upsert in notifyNewlyMentionedUsers).
 *
 * `context` is an optional short label (the caller's own function name,
 * e.g. "setTaskAssigneesCore") included in the log line so a failure can
 * be traced back to which fan-out path produced it, matching every other
 * `console.error` call site in this codebase's "<functionName>: <what
 * failed>" convention.
 */
export async function createNotification(
  supabase: SupabaseClient<Database>,
  params: CreateNotificationParams,
  context: string,
): Promise<{ ok: boolean }> {
  try {
    const { error } = await supabase.rpc("create_notification", {
      p_user_id: params.userId,
      p_workspace_id: params.workspaceId,
      p_kind: params.kind,
      p_task_id: params.taskId,
      ...(params.commentId ? { p_comment_id: params.commentId } : {}),
    });

    if (error) {
      console.error(
        `${context}: create_notification RPC failed (non-fatal):`,
        {
          kind: params.kind,
          userId: params.userId,
          taskId: params.taskId,
          error,
        },
      );
      return { ok: false };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(
      `${context}: create_notification RPC threw (non-fatal):`,
      {
        kind: params.kind,
        userId: params.userId,
        taskId: params.taskId,
        error: thrown,
      },
    );
    return { ok: false };
  }
}
