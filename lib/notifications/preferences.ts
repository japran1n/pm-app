import { logger } from "@/lib/observability/logger";

// F211 (AS-391, AS-396): notification preferences — the read side F207's
// fan-out call sites (lib/actions/tasks.ts, lib/actions/comments.ts,
// lib/notifications/mentions.ts) consult before writing an in-app
// notification row, plus the server-validated write side the settings
// form (components/notifications/preferences-form.tsx) uses.
//
// Deliberately NOT folded into lib/notifications/fanout.ts:
// fanout.ts's own doc comment ("Pure, side-effect-free... no Supabase
// client, no I/O") rules this module out of that file — computing WHO
// qualifies for a notification (fanout.ts) and asking "does this specific
// recipient actually want this kind in-app" (this file, a real DB read)
// are different concerns, matching the same split the fanout doc comment
// already draws between "who gets notified" (fanout.ts) and "the actual
// write" (the calling Server Action).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type {
  FanoutRecipient,
  NotificationKind,
} from "@/lib/notifications/fanout";

// Maps each of F207's closed NotificationKind values to the
// notification_preferences column that gates its in-app delivery. Kept as
// an explicit, exhaustively-typed record (rather than a naive string
// template like `${kind}_in_app`) so a future new NotificationKind that
// forgets to extend this map is a compile error, not a silent
// column-name-that-doesn't-exist bug.
const IN_APP_COLUMN_BY_KIND: Record<
  NotificationKind,
  | "mention_in_app"
  | "task_assigned_in_app"
  | "comment_reply_in_app"
  | "watcher_update_in_app"
  | "task_due_soon_in_app"
> = {
  mention: "mention_in_app",
  task_assigned: "task_assigned_in_app",
  comment_reply: "comment_reply_in_app",
  watcher_update: "watcher_update_in_app",
  // F307 (AS-391 follow-up): same column F212's SQL sweep reads directly
  // (supabase/migrations/20260823050000_overdue_notification_sweep.sql's
  // `np.task_due_soon_in_app = true` predicate) -- kept as the exact same
  // column name intentionally, documented as one shared source of truth
  // read from two call sites (this TS map, and that migration's SQL),
  // not two independently-diverging rules. This function is not
  // currently called on the sweep's path (that sweep is pure SQL/pg_cron
  // and gates in-line, see that migration's header comment for why); this
  // entry exists so a future TypeScript caller of
  // filterRecipientsByInAppPreference is not missing task_due_soon.
  task_due_soon: "task_due_soon_in_app",
};

/**
 * AS-391: filters `recipients` down to only those users who have the
 * in-app channel enabled for their notification's kind. A user with no
 * preferences row at all (should not normally happen — F211's migration
 * backfills every existing user and a trigger creates one for every new
 * signup — but a call site must never crash or silently drop a
 * legitimate recipient just because that invariant somehow didn't hold)
 * is treated as "enabled" for every kind, matching this feature's
 * defaults-on-signup behaviour.
 *
 * `client` must be able to read every candidate recipient's row, not just
 * the caller's own — notification_preferences' RLS is strictly
 * self-scoped (a user can only ever read their own row), so this must be
 * called with the admin/service-role client, exactly like every other
 * "read another user's row for fan-out purposes" query already in these
 * call sites (e.g. the task_watchers reads in tasks.ts/comments.ts).
 *
 * Never throws: a preferences read failure degrades to "notify everyone"
 * (the same fail-open posture as an absent row, above) rather than
 * silently dropping every recipient because of a transient read error —
 * consistent with every other post-write side effect in these call sites
 * being explicitly non-fatal.
 */
export async function filterRecipientsByInAppPreference(
  client: SupabaseClient<Database>,
  recipients: FanoutRecipient[],
): Promise<FanoutRecipient[]> {
  if (recipients.length === 0) return recipients;

  const userIds = Array.from(new Set(recipients.map((r) => r.userId)));

  const { data, error } = await client
    .from("notification_preferences")
    .select(
      "user_id, mention_in_app, task_assigned_in_app, comment_reply_in_app, watcher_update_in_app, task_due_soon_in_app",
    )
    .in("user_id", userIds);

  if (error || !data) {
    logger.error("filterRecipientsByInAppPreference: preferences read failed (fail-open, non-fatal)", { error: error });
    return recipients;
  }

  const rowByUserId = new Map(data.map((row) => [row.user_id, row]));

  return recipients.filter((recipient) => {
    const row = rowByUserId.get(recipient.userId);
    // No row for this user: fail open (see doc comment above).
    if (!row) return true;
    const column = IN_APP_COLUMN_BY_KIND[recipient.kind];
    return row[column] !== false;
  });
}
