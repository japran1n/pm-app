import { logger } from "@/lib/observability/logger";

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
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  NotificationKind,
  PortalNotificationKind,
} from "@/lib/notifications/fanout";

export type CreateNotificationParams = {
  userId: string;
  workspaceId: string;
  // F084: widened to also accept the three portal-originated kinds
  // (lib/notifications/fanout.ts's PortalNotificationKind) -- this is the
  // one place both `NotificationKind` (F207 fan-out) and
  // `PortalNotificationKind` (F084 portal events) callers share, so it is
  // the natural point to accept either rather than each having its own
  // near-duplicate RPC-calling helper.
  kind: NotificationKind | PortalNotificationKind;
  // F13 (docs/advanced-chat-plan.md, chat @-mentions): every pre-existing
  // fan-out call site always has a task, so this stayed required until
  // now. A chat mention has no task at all -- the RPC's own `p_task_id`
  // argument already defaults to null (supabase/migrations/
  // 20260823020000_create_notifications.sql's create_notification, and
  // the `notifications.task_id` column is nullable) -- so this is widened
  // to optional rather than requiring a schema change, per that
  // feature's spec step 2 ("proveriti da li prihvata null").
  taskId?: string;
  commentId?: string;
  // F13: chat-specific routing data (channelId/messageId) for a mention
  // that has no task_id/comment_id to key off of -- comment_id can't be
  // reused for this (notifications.comment_id has an FK to `comments`,
  // not `messages`, so passing a message id there would violate that
  // constraint). Stored in the RPC's existing `p_payload` jsonb column
  // instead -- no new migration needed, matching the plan's "or a new
  // migration" fallback being unnecessary here.
  payload?: Record<string, unknown>;
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
      ...(params.taskId ? { p_task_id: params.taskId } : {}),
      ...(params.commentId ? { p_comment_id: params.commentId } : {}),
      ...(params.payload ? { p_payload: params.payload as Json } : {}),
    });

    if (error) {
      logger.error(`${context}: create_notification RPC failed (non-fatal)`, {
          kind: params.kind,
          userId: params.userId,
          taskId: params.taskId,
          error,
        });
      return { ok: false };
    }

    return { ok: true };
  } catch (thrown) {
    logger.error(`${context}: create_notification RPC threw (non-fatal)`, {
        kind: params.kind,
        userId: params.userId,
        taskId: params.taskId,
        error: thrown,
      });
    return { ok: false };
  }
}
