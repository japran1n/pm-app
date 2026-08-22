// F062 (AS-101, AS-102): pure reducer that merges one Realtime
// `postgres_changes` event for the `comments` table into a task's local
// comment list.
//
// Extracted as a pure function (no React dependency) for the same reason
// lib/board/reconcile-realtime-task.ts (F049/F103) is: it's unit-testable
// without a browser/DOM, and the mechanic that matters here — removing a
// comment the instant its `deleted_at` is set, even for a viewer who
// currently has the task open — is a pure list transform independent of
// how the event arrived over the wire.
//
// Scope note: this feature (F062) is assigned only AS-101/AS-102, the
// soft-delete-removal path. A sibling feature, F063 (AS-103), owns "new
// comments appear live" and will extend this same file's INSERT handling
// when it runs — this reducer intentionally still handles INSERT/plain
// UPDATE (append/replace) so it's correct out of the box for both, mirroring
// reconcileTask's shape, but F062's own tests only cover the soft-delete
// removal path per its assigned assertions.
//
// - INSERT: comment appended if not already present (idempotent against a
//   local optimistic-append already having added it, same convention as
//   reconcileTask).
// - UPDATE: existing comment (matched by id) replaced with the new row. If
//   the updated row is now soft-deleted (deleted_at is not null), it's
//   removed instead — this is the AS-101 path: a comment deleted by any
//   viewer (author, admin, or owner) disappears from every other viewer's
//   open task view without a manual refresh.
// - DELETE: comment removed by id (comments never hard-delete per
//   tech-decisions.md's soft-delete convention, but handled defensively
//   for parity with reconcileTask and in case REPLICA IDENTITY changes).
//
// AS-102 (a soft-deleted comment does not reappear after reload) is not
// this reducer's concern — it's guaranteed by comments_select_active_members
// (supabase/migrations/20260818040214_create_comments.sql) filtering
// `deleted_at is null` on every fetch, so a reload's initial query never
// includes the row in the first place. This reducer only needs to make
// sure it doesn't *reintroduce* a soft-deleted row on a later event, which
// the `if (row.deleted_at)` branch below covers for both first-time and
// repeat soft-delete events.

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { JSONContent } from "@tiptap/react";
import type { TaskComment } from "@/components/task/comment-list";
import { docFromPlainText } from "@/lib/comments/rich-text";

export type CommentRealtimeRow = {
  id: string;
  task_id: string;
  user_id: string;
  text: string;
  created_at: string;
  deleted_at: string | null;
  // F174 (AS-312): optional so every existing test payload (constructed
  // before this feature existed) still satisfies this type unchanged.
  // Realtime postgres_changes on the `comments` table always includes
  // every column of the row, so a live event always has this populated
  // once the DB migration has run; the fallback below only matters for
  // synthetic/older test payloads.
  body_json?: JSONContent | null;
  // F197 (AS-362): present on a `comment_edited` broadcast payload (and on
  // any future live row that has been edited); absent/undefined for a
  // comment that's never been edited, same "optional, older/synthetic
  // payloads still satisfy this type" convention as body_json above.
  edited_at?: string | null;
};

export type CommentRealtimeEvent =
  RealtimePostgresChangesPayload<CommentRealtimeRow>;

function toTaskComment(row: CommentRealtimeRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    text: row.text,
    // F174 (AS-312): a live-delivered row always carries body_json once
    // the migration has run; a synthetic/legacy payload without it falls
    // back to the same single-paragraph wrap used everywhere else in this
    // feature (docFromPlainText), so a realtime-delivered comment always
    // renders through RichTextRenderer identically to one loaded on
    // initial page fetch.
    bodyJson: row.body_json ?? docFromPlainText(row.text),
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
  };
}

export function reconcileComment(
  comments: TaskComment[],
  event: CommentRealtimeEvent,
): TaskComment[] {
  if (event.eventType === "DELETE") {
    const deletedId = event.old?.id;
    if (!deletedId) return comments;
    return comments.filter((c) => c.id !== deletedId);
  }

  const row = event.new;
  if (!row || !row.id) return comments;

  // AS-101: a soft-deleted row (deleted_at set) is removed from the local
  // list, whether this is the first UPDATE that sets it or a later replay
  // of the same event (reconnect/duplicate delivery).
  if (row.deleted_at) {
    return comments.filter((c) => c.id !== row.id);
  }

  const incoming = toTaskComment(row);
  const existingIndex = comments.findIndex((c) => c.id === incoming.id);

  if (existingIndex === -1) {
    return [...comments, incoming];
  }

  const next = comments.slice();
  next[existingIndex] = incoming;
  return next;
}
