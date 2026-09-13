"use server";
import { logger } from "@/lib/observability/logger";


// F208: mark-read / mark-all-read Server Actions (AS-386, AS-387).
//
// No new RPC needed — per this feature's own briefing, F206's
// `notifications_update_own` RLS policy already allows a signed-in user
// to UPDATE `read_at` on their own rows (`user_id = auth.uid()`, `with
// check` mirrors `using`, so a caller can't reassign a row to someone
// else either). A plain client-session UPDATE is therefore the real
// enforcement boundary here, same "self-serve via the caller's own
// session" convention lib/actions/watchers.ts / comment-reactions.ts use
// for other self-scoped rows — no admin-client bypass required.
//
// Validation: Zod at the action boundary (markNotificationReadSchema /
// markAllNotificationsReadSchema), re-validated server-side per the
// clarified "client-side for immediate feedback, re-validated by the
// action's Zod schema server-side" answer — the panel's own optimistic
// update is never trusted alone.
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  markNotificationReadSchema,
  markAllNotificationsReadSchema,
} from "@/lib/validation/notifications";
import {
  getNotificationsForWorkspace,
  type NotificationListItem,
} from "@/lib/queries/notifications";
import type { ActionOutcome } from "@/lib/actions/authz";

export type MarkNotificationReadResult = ActionOutcome;

// AS-386: marks a single notification read. Idempotent — marking an
// already-read notification read again is a harmless no-op (the UPDATE
// still matches the row, `read_at` is just re-set to a fresh timestamp).
export async function markNotificationRead(
  notificationId: string,
): Promise<MarkNotificationReadResult> {
  const parsed = markNotificationReadSchema.safeParse({ notificationId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid notification.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  // RLS scopes this UPDATE to the caller's own notification row
  // (`user_id = auth.uid()`); a notificationId belonging to someone else,
  // or that doesn't exist, or that's outside the 30-day retention window
  // (F206's SELECT-time retention filter — UPDATE's own `using` clause
  // has no separate retention check, but a caller can't target a row it
  // can't first look up via the panel that only ever lists rows still
  // inside the window) simply matches zero rows: no error, no leak of
  // whether the id exists at all.
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId)
    .select("id");

  if (error) {
    logger.error("markNotificationRead: update failed", { error: error });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!data || data.length === 0) {
    return { ok: false, error: "Notification not found." };
  }

  return { ok: true };
}

// AS-387: marks every unread notification in `workspaceId` read for the
// caller, clearing the bell's unread count. Scoped to a single workspace
// (matching the panel's own per-workspace read query, see
// lib/queries/notifications.ts) — not every notification the caller has
// across every workspace they belong to, since the panel itself never
// shows a cross-workspace merged inbox either (see that file's doc
// comment).
export async function markAllNotificationsRead(
  workspaceId: string,
): Promise<MarkNotificationReadResult> {
  const parsed = markAllNotificationsReadSchema.safeParse({ workspaceId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid workspace.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  // RLS (`notifications_update_own`) still scopes this to the caller's
  // own rows regardless of `workspace_id` — the explicit filter here is
  // just to avoid touching the caller's notifications in OTHER
  // workspaces, matching the panel's own per-workspace scope, not a
  // security boundary on its own.
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", parsed.data.workspaceId)
    .is("read_at", null);

  if (error) {
    logger.error("markAllNotificationsRead: update failed", { error: error });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true };
}

export type NotificationSnapshotResult = ActionOutcome<{ list: NotificationListItem[]; unreadCount: number }>;

// F209 (AS-388): a fresh, server-authoritative snapshot of the caller's
// notification inbox for `workspaceId` — the single source of truth this
// feature's realtime hook and tab-focus reconciliation both call through,
// rather than each maintaining its own incremented/decremented copy of
// the unread count. This is the exact same query
// components/notifications/notification-bell.tsx's initial server-side
// render already uses (lib/queries/notifications.ts's
// getNotificationsForWorkspace) — no second read path, no second source
// of truth, per the clarified "simpler option" ambiguity answer:
//
// - Realtime INSERT event arrives (subscription-level user_id scoping,
//   see subscribe-notifications-realtime.ts) -> re-fetch this snapshot
//   -> badge + panel list both update from real server state, not from a
//   client-side `+1` that could drift.
// - Tab regains focus/visibility -> re-fetch this snapshot -> self-heals
//   a badge that a missed Realtime event (e.g. a dropped WebSocket while
//   the tab was backgrounded) could otherwise have left permanently
//   wrong.
export async function getNotificationSnapshot(
  workspaceId: string,
): Promise<NotificationSnapshotResult> {
  const parsed = markAllNotificationsReadSchema.safeParse({ workspaceId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid workspace.",
    };
  }

  const { list, unreadCount, error } = await getNotificationsForWorkspace(
    parsed.data.workspaceId,
  );

  // F308 (FU-12 item 6): a real query failure inside
  // getNotificationsForWorkspace propagates as this action's own `ok:
  // false` (see NotificationBell's reconcile — it now distinguishes this
  // from "genuinely zero notifications" instead of both collapsing into
  // the same silent no-op).
  if (error) {
    return { ok: false, error };
  }

  return { ok: true, list, unreadCount };
}
