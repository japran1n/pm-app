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
// Pure diffing only: this module has NO Supabase/network access and knows
// nothing about how a notification is actually delivered. Delivery
// (F206-F212, this mission's notification fan-out chain) does not exist
// yet in this repo. `notifyNewlyMentionedUsers` below is therefore a
// documented no-op stub — it returns the diffed ids for a future F207 to
// consume, and logs them (dev-visibility only), but sends nothing. Do NOT
// build real notification delivery here; that is out of scope for F205.

import type { JSONContent } from "@tiptap/react";

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
 * Documented no-op stub. F206-F212 (this mission's notification fan-out
 * chain) have not been built yet — there is no notifications table, no
 * delivery mechanism, and no in-app/email surface for this feature to call
 * into. Rather than either (a) building a delivery mechanism here, which
 * is explicitly out of scope for F205, or (b) silently dropping the
 * newly-mentioned ids on the floor with no trace at all, this function is
 * the single, obvious seam a future F207 worker can replace: swap this
 * function's body for a real enqueue/send call and every call site
 * (lib/actions/tasks.ts's editTask) keeps working unchanged.
 *
 * Never throws — a missing/future notification system must never fail the
 * description save itself, mirroring every other "non-fatal side effect"
 * in this codebase (see e.g. lib/actions/tasks.ts's editTask
 * writeTaskFieldChanges try/catch).
 */
export async function notifyNewlyMentionedUsers(params: {
  taskId: string;
  authorId: string;
  newlyMentionedUserIds: string[];
}): Promise<{ notified: string[] }> {
  if (params.newlyMentionedUserIds.length === 0) {
    return { notified: [] };
  }

  // TODO(F207): replace this log with a real notification enqueue once the
  // notification fan-out chain (F206-F212) exists. See this file's top
  // doc comment.
  console.log(
    "[F205 stub] would notify newly mentioned users on task description save:",
    {
      taskId: params.taskId,
      authorId: params.authorId,
      newlyMentionedUserIds: params.newlyMentionedUserIds,
    },
  );

  return { notified: params.newlyMentionedUserIds };
}
