// F207: notification fan-out (AS-294, AS-374, AS-375, AS-380, AS-381,
// AS-382, AS-384).
//
// Pure, side-effect-free recipient computation — per this feature's
// Clarified implementation Q1-Q10: a small named-function module under
// lib/, no Supabase client, no React, no I/O, no module-level state. The
// *actual* write (looping recipients through
// `public.create_notification()`, F206's SECURITY DEFINER RPC) happens in
// the calling Server Action (lib/actions/tasks.ts, lib/actions/comments.ts,
// lib/notifications/mentions.ts), never here — this file only answers
// "given this event, who gets notified, and with what kind", so the
// question can be unit-tested independently of React and Supabase, per the
// clarified "validation rules" answer.
//
// Kind values mirror the notifications table's closed vocabulary
// (supabase/migrations/20260823020000_create_notifications.sql's
// `notifications_kind_check`): mention, comment_reply, task_assigned,
// task_due_soon, watcher_update.
//
// F307 (AS-391 follow-up): `task_due_soon` IS included in this union so it
// is a real, consultable kind through the same shared
// IN_APP_COLUMN_BY_KIND path (lib/notifications/preferences.ts) every
// other kind goes through -- a future caller that ever needs to filter
// task_due_soon recipients in TypeScript (e.g. a notification-panel
// preview, or a future non-SQL sweep) gets the exhaustive compile-time
// safety net, not a silently-missing map entry. `computeFanoutRecipients`
// below still never produces a `task_due_soon` recipient itself --
// F212's hourly pg_cron sweep (supabase/migrations/
// 20260823050000_overdue_notification_sweep.sql) computes and gates
// task_due_soon recipients entirely in SQL, reading the SAME
// `task_due_soon_in_app` column IN_APP_COLUMN_BY_KIND now also points at
// for this kind (see that migration's header comment and
// lib/notifications/preferences.ts's doc comment for why a literal
// shared TypeScript code path across the SQL/pg_cron boundary isn't
// realistic -- the column name, not the code, is the single source of
// truth these two call sites share).
export type NotificationKind =
  | "mention"
  | "comment_reply"
  | "task_assigned"
  | "task_due_soon"
  | "watcher_update";

// F084: three portal-originated kinds (see lib/notifications/
// portal-recipients.ts's doc comment), passed straight to
// `createNotification` from lib/actions/portal-approval.ts,
// lib/actions/client-requests.ts and lib/actions/portal-deliverables.ts --
// never through `computeFanoutRecipients` below, the same "direct call,
// bypasses this file" pattern `decide_approval_atomic` already
// established for `approval_decided`/`assumption_flagged` (those two
// never appear in `NotificationKind` either, for the same reason: they
// are written by a `perform create_notification(...)` inside a SQL
// function, not through this TypeScript fan-out path at all). Kept as a
// separate type, not folded into `NotificationKind`, so
// lib/notifications/preferences.ts's `IN_APP_COLUMN_BY_KIND` -- which is
// only ever consulted for a `computeFanoutRecipients` result, never for
// one of these three -- stays an exhaustive map over the kinds it
// actually needs to gate, instead of being forced to invent an in-app
// preference column for kinds it never filters.
export type PortalNotificationKind =
  | "portal_task_decided"
  | "client_request_submitted"
  | "client_deliverable_submitted"
  // F090 item 3: a client naming one decision owner to look at one still-
  // open approval request (lib/actions/portal-approval.ts's
  // nudgeApprovalOwner) -- replaces approval-card.tsx's old `mailto:`
  // stopgap. Single-recipient, never fanned out via
  // `getPortalEventRecipients`, same "direct call, bypasses this file"
  // shape as the three kinds above.
  | "approval_owner_nudge";

// The four event shapes this feature's spec names: assignment, status
// change, a new comment (which may itself carry mentions), and a
// description mention (F205's diffed newly-mentioned set). Each event
// carries only the plain typed ids the caller already holds — no hidden
// queries, no globals such as "the current time", per the clarified "data
// shape" and "performance budget" answers.
export type FanoutEvent =
  | {
      type: "assigned";
      /** The user whose action triggered this event — the RPC's caller,
       * who is pinned server-side as `actor_id` (F206's spoofing fix) and
       * who must never notify themselves (AS-384). */
      actorId: string;
      /** Users newly assigned to the task by this action. */
      assigneeIds: string[];
    }
  | {
      type: "status_changed";
      actorId: string;
      /** The task's current active watchers (AS-294, AS-382). */
      watcherIds: string[];
    }
  | {
      type: "commented";
      actorId: string;
      /** The task's current active watchers (AS-382). */
      watcherIds: string[];
      /** Users mentioned in the new comment who actually survived F204's
       * visibility strip (a stripped mention must never notify —
       * AS-381/AS-374). */
      mentionedIds: string[];
    }
  | {
      type: "mentioned";
      actorId: string;
      /** Newly-mentioned users in a task description save (F205's
       * `extractNewlyMentionedIds`, already visibility-checked). */
      mentionedIds: string[];
    };

export type FanoutRecipient = {
  userId: string;
  kind: NotificationKind;
};

/**
 * AS-294/AS-374/AS-375/AS-380/AS-381/AS-382/AS-384: computes exactly which
 * users should be notified for `event`, and with which kind, applying two
 * invariants unconditionally:
 *
 *  - AS-384: the actor (the person whose action triggered the event) is
 *    never included, even if they also appear in an input id list (e.g.
 *    they assigned the task to themselves, or they are their own watcher).
 *  - The spec's dedupe note: a user who qualifies through more than one
 *    channel in the same event (e.g. a comment where the same user is both
 *    a watcher and freshly mentioned) receives at most one entry. When a
 *    "commented" event's watcher and mention sets overlap, the more
 *    specific `mention` kind wins (AS-374's "notifies with a link to the
 *    comment" — a plain watcher-of-a-comment notification would lose that
 *    specificity), rather than emitting one row per channel.
 *
 * Returns an explicit empty array — never null/undefined — for an event
 * with no qualifying recipients (the clarified "empty state" answer);
 * `null` is reserved for genuinely invalid input (the clarified "failure
 * handling" answer).
 */
export function computeFanoutRecipients(
  event: FanoutEvent | null | undefined,
): FanoutRecipient[] | null {
  if (!event || typeof event.actorId !== "string" || !event.actorId) {
    return null;
  }

  const kindByUser = new Map<string, NotificationKind>();

  // mention always wins over any other kind already recorded for the same
  // user in this event, per this function's dedupe rule above.
  const add = (ids: string[] | undefined, kind: NotificationKind) => {
    for (const id of ids ?? []) {
      if (!id || id === event.actorId) continue; // AS-384
      const existing = kindByUser.get(id);
      if (existing === "mention") continue;
      kindByUser.set(id, kind);
    }
  };

  switch (event.type) {
    case "assigned":
      add(event.assigneeIds, "task_assigned"); // AS-380
      break;
    case "status_changed":
      add(event.watcherIds, "watcher_update"); // AS-294, AS-382
      break;
    case "commented":
      add(event.watcherIds, "comment_reply"); // AS-382
      add(event.mentionedIds, "mention"); // AS-374, AS-381 (overrides comment_reply on overlap)
      break;
    case "mentioned":
      add(event.mentionedIds, "mention"); // AS-374, AS-381
      break;
    default:
      return null;
  }

  return Array.from(kindByUser.entries()).map(([userId, kind]) => ({
    userId,
    kind,
  }));
}
