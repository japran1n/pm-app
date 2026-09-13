"use server";
import { logger } from "@/lib/observability/logger";


// F211 (AS-391, AS-396): read/write the signed-in user's notification
// preferences. Pattern mirrors lib/actions/profile.ts's updateProfile:
// Zod-validated input, the caller's own session client (RLS is
// self-scoped here — no admin client or SECURITY DEFINER RPC is needed
// for a user writing their own row, per this feature's migration's
// header comment), discriminated-union return, generic user-facing
// errors with details only logged server-side.

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { updateNotificationPreferencesSchema } from "@/lib/validation/notification-preferences";
import type { ActionResult } from "@/lib/actions/authz";

export type NotificationPreferences = {
  mentionInApp: boolean;
  mentionEmail: boolean;
  taskAssignedInApp: boolean;
  taskAssignedEmail: boolean;
  commentReplyInApp: boolean;
  commentReplyEmail: boolean;
  watcherUpdateInApp: boolean;
  watcherUpdateEmail: boolean;
  taskDueSoonInApp: boolean;
  taskDueSoonEmail: boolean;
  emailEnabled: boolean;
  // Faza D (docs/chat-slack-parity-plan.md)
  chatDmInApp: boolean;
  chatThreadReplyInApp: boolean;
  soundEnabled: boolean;
  /** 0-100, applied as the notification sound's playback volume. */
  soundVolume: number;
  soundOnlyWhenUnfocused: boolean;
};

function rowToPreferences(row: {
  mention_in_app: boolean;
  mention_email: boolean;
  task_assigned_in_app: boolean;
  task_assigned_email: boolean;
  comment_reply_in_app: boolean;
  comment_reply_email: boolean;
  watcher_update_in_app: boolean;
  watcher_update_email: boolean;
  task_due_soon_in_app: boolean;
  task_due_soon_email: boolean;
  email_enabled: boolean;
  chat_dm_in_app: boolean;
  chat_thread_reply_in_app: boolean;
  sound_enabled: boolean;
  sound_volume: number;
  sound_only_when_unfocused: boolean;
}): NotificationPreferences {
  return {
    mentionInApp: row.mention_in_app,
    mentionEmail: row.mention_email,
    taskAssignedInApp: row.task_assigned_in_app,
    taskAssignedEmail: row.task_assigned_email,
    commentReplyInApp: row.comment_reply_in_app,
    commentReplyEmail: row.comment_reply_email,
    watcherUpdateInApp: row.watcher_update_in_app,
    watcherUpdateEmail: row.watcher_update_email,
    taskDueSoonInApp: row.task_due_soon_in_app,
    taskDueSoonEmail: row.task_due_soon_email,
    emailEnabled: row.email_enabled,
    chatDmInApp: row.chat_dm_in_app,
    chatThreadReplyInApp: row.chat_thread_reply_in_app,
    soundEnabled: row.sound_enabled,
    soundVolume: row.sound_volume,
    soundOnlyWhenUnfocused: row.sound_only_when_unfocused,
  };
}

// camelCase form field -> actual notification_preferences column name,
// used only to build the partial update payload below.
const COLUMN_BY_FIELD = {
  mentionInApp: "mention_in_app",
  mentionEmail: "mention_email",
  taskAssignedInApp: "task_assigned_in_app",
  taskAssignedEmail: "task_assigned_email",
  commentReplyInApp: "comment_reply_in_app",
  commentReplyEmail: "comment_reply_email",
  watcherUpdateInApp: "watcher_update_in_app",
  watcherUpdateEmail: "watcher_update_email",
  taskDueSoonInApp: "task_due_soon_in_app",
  taskDueSoonEmail: "task_due_soon_email",
  emailEnabled: "email_enabled",
  chatDmInApp: "chat_dm_in_app",
  chatThreadReplyInApp: "chat_thread_reply_in_app",
  soundEnabled: "sound_enabled",
  soundVolume: "sound_volume",
  soundOnlyWhenUnfocused: "sound_only_when_unfocused",
} as const;

const SELECT_COLUMNS =
  "mention_in_app, mention_email, task_assigned_in_app, task_assigned_email, comment_reply_in_app, comment_reply_email, watcher_update_in_app, watcher_update_email, task_due_soon_in_app, task_due_soon_email, email_enabled, chat_dm_in_app, chat_thread_reply_in_app, sound_enabled, sound_volume, sound_only_when_unfocused";

export type GetNotificationPreferencesResult = ActionResult<NotificationPreferences>;

// Server Component data-loading helper (the clarified spec's "server-fetched
// in the page, passed down as typed props" pattern) — the settings page
// calls this, not the client form.
export async function getNotificationPreferences(): Promise<GetNotificationPreferencesResult> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("notification_preferences")
    .select(SELECT_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    logger.error("getNotificationPreferences: read failed", { error: error });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F211's migration backfills every existing user and a trigger creates
  // a row for every new signup, so a missing row should not normally
  // happen — but the table's own column defaults (this feature's
  // documented "sensible defaults") are returned as a defensive fallback
  // rather than surfacing an error to a user whose row genuinely doesn't
  // exist yet for some reason.
  if (!data) {
    return {
      ok: true,
      data: {
        mentionInApp: true,
        mentionEmail: true,
        taskAssignedInApp: true,
        taskAssignedEmail: true,
        commentReplyInApp: true,
        commentReplyEmail: false,
        watcherUpdateInApp: true,
        watcherUpdateEmail: false,
        taskDueSoonInApp: true,
        taskDueSoonEmail: false,
        emailEnabled: true,
        chatDmInApp: true,
        chatThreadReplyInApp: true,
        soundEnabled: true,
        soundVolume: 60,
        soundOnlyWhenUnfocused: true,
      },
    };
  }

  return { ok: true, data: rowToPreferences(data) };
}

export type UpdateNotificationPreferencesResult = ActionResult<NotificationPreferences>;

// AS-391/AS-396: persists a partial patch of the caller's own preferences.
// RLS (notification_preferences_update_own) already rejects any attempt
// to touch a different user's row; `.eq("user_id", user.id)` is a
// defence-in-depth match, not the only guard, per tech-decisions.md's "DB
// is the last line, not the only line" convention.
export async function updateNotificationPreferences(
  input: unknown,
): Promise<UpdateNotificationPreferencesResult> {
  const parsed = updateNotificationPreferencesSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid preferences.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // Faza D: soundVolume is a 0-100 number, every other field is boolean --
  // widened from `Record<string, boolean>` to admit it without a second,
  // parallel patch object.
  const patch: Record<string, boolean | number> = {};
  for (const [field, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    const column = COLUMN_BY_FIELD[field as keyof typeof COLUMN_BY_FIELD];
    patch[column] = value;
  }

  // Upsert (not a plain update): guarantees this call succeeds even if,
  // for whatever reason, the backfill/trigger-created row doesn't exist
  // yet for this user — mirroring this file's fail-safe read fallback
  // above instead of surfacing a confusing "row not found" error for a
  // row the user has every right to create for themselves (RLS's
  // notification_preferences_insert_own policy already allows it).
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" })
    .select(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    logger.error("updateNotificationPreferences: write failed", { error: error });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  revalidatePath("/w/[workspaceSlug]/settings/profile", "page");

  return { ok: true, data: rowToPreferences(data) };
}
