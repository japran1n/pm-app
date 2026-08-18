// F062 (AS-101, AS-102): Supabase Realtime subscription for a task's
// comments.
//
// Subscribes to Postgres `postgres_changes` events (INSERT/UPDATE/DELETE)
// on the `comments` table, filtered server-side to the current task — same
// per-scope pattern as components/board/use-board-realtime.ts (F049),
// which filters to the current project.
//
// This is a thin Client Component hook, per the clarified spec's "smallest
// possible client boundary" — the actual channel wiring lives in
// lib/tasks/subscribe-comments-realtime.ts's `subscribeToCommentsRealtime`
// (a plain, React-free function, unit-tested without a DOM/React runtime).
// This hook is just the useEffect lifecycle glue: subscribe on
// mount/taskId change, unsubscribe on cleanup.
//
// AS-101: when another viewer (author, admin, or owner) soft-deletes a
// comment via lib/actions/comments.ts's deleteComment, this hook's caller
// (components/task/comment-list.tsx) receives the resulting UPDATE event
// (deleted_at now set) and reconciles it via lib/tasks/reconcile-realtime-
// comment.ts's `reconcileComment`, which removes the comment from local
// state — so it disappears from this viewer's open task view without a
// manual refresh, even though this viewer did not trigger the delete.
//
// AS-102 is not this hook's concern: it's guaranteed by
// comments_select_active_members filtering `deleted_at is null` on every
// fetch, so a soft-deleted comment is simply absent from the initial query
// on reload. This hook only needs to avoid reintroducing it via a stale
// event, which `reconcileComment`'s deleted_at check covers.
//
// Requires Realtime to be enabled for `comments` at the Postgres
// replication level — see
// supabase/migrations/20260818050000_realtime_comments_publication.sql.

"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToCommentsRealtime,
  type CommentRealtimeEvent,
  type CommentRealtimeRow,
} from "@/lib/tasks/subscribe-comments-realtime";

export type { CommentRealtimeEvent, CommentRealtimeRow };

/**
 * Subscribes to Realtime changes on the `comments` table scoped to
 * `taskId`. Calls `onChange` for every INSERT/UPDATE/DELETE event received
 * while mounted. Cleanup (unsubscribe) happens automatically on unmount or
 * when `taskId` changes.
 */
export function useCommentsRealtime(
  taskId: string,
  onChange: (event: CommentRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!taskId) return;

    const supabase = createClient();
    const unsubscribe = subscribeToCommentsRealtime(
      supabase,
      taskId,
      onChange,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
}
