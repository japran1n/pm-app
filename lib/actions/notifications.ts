"use server";

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
import { createClient } from "@/lib/supabase/server";
import {
  markNotificationReadSchema,
  markAllNotificationsReadSchema,
} from "@/lib/validation/notifications";

export type MarkNotificationReadResult =
  | { ok: true }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    console.error("markNotificationRead: update failed:", error);
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    console.error("markAllNotificationsRead: update failed:", error);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true };
}
