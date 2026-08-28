import { logger } from "@/lib/observability/logger";

// F205 (AS-378): mentions work in task descriptions as well as comments.
//
// F203/F204 built the @-mention picker, storage, render-time display
// resolution, and server-side visibility enforcement
// (lib/comments/mentions.ts's sanitiseMentionsForVisibility) for COMMENTS.
// This feature wires the exact same client extension + server-side
// enforcement into task DESCRIPTIONS (lib/actions/tasks.ts's editTask,
// components/task/task-detail-sheet.tsx) and additionally needs one new
// piece comments never needed: a description is edited and re-saved
// repeatedly over its lifetime (unlike a comment, which is posted once and
// only rarely edited), so naively "notify every mentioned id on every
// save" would re-notify the same collaborators on every unrelated edit.
// This module is the one place that diff lives — "notify only newly added
// mentions, diffed against the previous save" (this feature's Notes for
// clarification, and its own explicit note that the diff IS the whole
// feature).
//
// The diffing functions below (extractMentionIds, extractNewlyMentionedIds)
// remain pure — no Supabase/network access, per F205's original design.
// `notifyNewlyMentionedUsers` is F207's real implementation of the seam
// F205 left open: it delivers a notification (via F206's
// create_notification RPC, through F207's computeFanoutRecipients for the
// actor-exclusion/kind computation) for each newly-mentioned, still-
// visible id.

import type { JSONContent } from "@tiptap/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";

/** Walks a Tiptap JSONContent tree collecting every `mention` node's
 * `attrs.id`. Deliberately duplicated from
 * lib/comments/mentions.ts's module-private `collectMentionIds` (not
 * exported there) rather than reaching into that module's internals —
 * same "simpler option, no second source of truth for the RULE, a little
 * duplication of a five-line tree walk is fine" tradeoff already made
 * elsewhere in this codebase (see e.g. task-detail-sheet.tsx's
 * setJsonTaskItemChecked doc comment for the same reasoning). The RULE
 * this feature reuses without duplication is visibility enforcement
 * (sanitiseMentionsForVisibility itself, called directly from
 * lib/actions/tasks.ts) — this file only needs "which ids are mentioned",
 * not "which ids are allowed to be". */
function collectMentionIds(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "mention" && typeof n.attrs?.id === "string" && n.attrs.id) {
    into.add(n.attrs.id);
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) collectMentionIds(child, into);
  }
}

/** Returns every mention id present anywhere in `doc`, as a Set. Exported
 * mainly for tests; `extractNewlyMentionedIds` below is the function
 * production callers actually use. */
export function extractMentionIds(doc: JSONContent | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!doc) return ids;
  collectMentionIds(doc, ids);
  return ids;
}

/**
 * AS-378: the whole feature. Returns the ids that are mentioned in
 * `nextDoc` but were NOT already mentioned in `previousDoc` — i.e. exactly
 * the set that should be notified for THIS save. An id mentioned in both
 * (whether the surrounding text changed or not — editing an unrelated word
 * does not remove and re-add the same mention node) is never returned
 * again. An id removed from `nextDoc` is never returned either (it isn't
 * "newly" anything).
 *
 * Order is not meaningful (a Set-difference) — callers that need a stable
 * order should sort the result themselves.
 */
export function extractNewlyMentionedIds(
  previousDoc: JSONContent | null | undefined,
  nextDoc: JSONContent | null | undefined,
): string[] {
  const previousIds = extractMentionIds(previousDoc);
  const nextIds = extractMentionIds(nextDoc);

  const newlyMentioned: string[] = [];
  for (const id of nextIds) {
    if (!previousIds.has(id)) newlyMentioned.push(id);
  }
  return newlyMentioned;
}

/**
 * F207: the real implementation of the seam F205 deliberately left as a
 * no-op stub (see this function's git history / the F205 handoff) — the
 * notification fan-out chain (F206's `create_notification` RPC, F207's
 * `computeFanoutRecipients`) now exists, so this notifies every newly-
 * mentioned user (AS-374, AS-381) except the author themselves (AS-384),
 * and additionally promotes a mentioned non-watcher to watcher (AS-375),
 * same durable `ignoreDuplicates` upsert pattern as
 * `lib/actions/comments.ts`'s addComment auto-watch/mention block — an
 * existing explicit unwatch is never overridden.
 *
 * `newlyMentionedUserIds` must already be the *visibility-checked* set
 * (the caller, `editTask`, diffs `sanitiseMentionsForVisibility`'s output,
 * never the raw client input — see that call site's doc comment) so a
 * mention stripped for visibility is never notified either.
 *
 * Never throws — a notification failure must never fail the description
 * save itself, mirroring every other "non-fatal side effect" in this
 * codebase (see e.g. lib/actions/tasks.ts's editTask
 * writeTaskFieldChanges try/catch). `supabase` is the caller's own
 * authenticated session client (not the admin/service-role client) so
 * `create_notification`'s SECURITY DEFINER function can pin `actor_id` to
 * `auth.uid()` server-side (F206's spoofing fix); `admin` is used only for
 * the watcher-promotion upsert, which must bypass RLS to write a row on
 * behalf of someone other than the caller.
 */
export async function notifyNewlyMentionedUsers(params: {
  taskId: string;
  workspaceId: string;
  authorId: string;
  newlyMentionedUserIds: string[];
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
}): Promise<{ notified: string[] }> {
  if (params.newlyMentionedUserIds.length === 0) {
    return { notified: [] };
  }

  const computedRecipients = computeFanoutRecipients({
    type: "mentioned",
    actorId: params.authorId,
    mentionedIds: params.newlyMentionedUserIds,
  });

  // F211 (AS-391): drop recipients who have this kind's in-app channel
  // disabled before ever calling create_notification.
  const recipients = await filterRecipientsByInAppPreference(
    params.admin,
    computedRecipients ?? [],
  );

  const notified: string[] = [];

  for (const recipient of recipients ?? []) {
    const result = await createNotification(
      params.supabase,
      {
        userId: recipient.userId,
        workspaceId: params.workspaceId,
        kind: recipient.kind,
        taskId: params.taskId,
      },
      "notifyNewlyMentionedUsers",
    );
    if (result.ok) {
      notified.push(recipient.userId);
    }
  }

  // AS-375: a mentioned non-watcher becomes a watcher. Never overrides an
  // existing row (including an explicit prior unwatch) — see this
  // function's doc comment above.
  const mentionRecipientIds = params.newlyMentionedUserIds.filter(
    (id) => id !== params.authorId,
  );
  if (mentionRecipientIds.length > 0) {
    try {
      await params.admin.from("task_watchers").upsert(
        mentionRecipientIds.map((id) => ({
          task_id: params.taskId,
          user_id: id,
          is_watching: true,
        })),
        { onConflict: "task_id,user_id", ignoreDuplicates: true },
      );
    } catch (watcherError) {
      logger.error("notifyNewlyMentionedUsers: watcher-promotion upsert failed (non-fatal)", { error: watcherError });
    }
  }

  return { notified };
}
