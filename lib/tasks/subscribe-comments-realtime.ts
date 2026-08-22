// F062 (AS-101, AS-102): the actual Realtime channel setup for a task's
// comments, extracted out of components/task/use-comments-realtime.ts as a
// plain function so it's testable without a React runtime/DOM — same
// rationale as lib/board/subscribe-board-realtime.ts (F049): this repo's
// vitest config runs with `environment: "node"` (no React Testing
// Library), so logic that only lived inside a `useEffect` would be
// unverifiable without a browser-like test environment.
//
// Kept intentionally dumb: given a Supabase client, a task id, and a
// callback, wires up exactly one channel/subscription (channel name
// `comments:<taskId>`) and returns a cleanup function. No React, no local
// component state.
//
// Requires Realtime to be enabled for `comments` at the Postgres
// replication level — see
// supabase/migrations/20260818050000_realtime_comments_publication.sql
// (`ALTER PUBLICATION supabase_realtime ADD TABLE public.comments`),
// without which postgres_changes silently never fires for this table.
//
// F104 (AS-101 fix): this channel now combines TWO delivery mechanisms
// rather than relying on postgres_changes alone:
//
// - postgres_changes, `event: "INSERT"` only (no longer `"*"`). New
//   comments are unaffected by the bug below — an inserted row's own
//   values always pass `comments_select_active_members`'s
//   `deleted_at is null` SELECT RLS check, since a freshly-inserted
//   comment never has deleted_at set. AS-103 (new comments appear live)
//   still works exactly as before.
//
// - broadcast, event `"comment_deleted"`, sent explicitly by
//   lib/actions/comments.ts's deleteComment right after its soft-delete
//   UPDATE succeeds. This replaces postgres_changes UPDATE/DELETE
//   entirely for the delete path: Supabase Realtime's postgres_changes
//   evaluates the SELECT RLS policy against the row's NEW state for
//   UPDATE events, and a soft-delete's new state (deleted_at now set)
//   fails that same policy's `deleted_at is null` clause — so
//   postgres_changes silently drops the delete event for every
//   subscriber, not just the deleter. Broadcast delivery doesn't depend
//   on the row still passing a read policy, so it isn't affected.
//
// Security note: broadcast messages on this channel are NOT RLS-gated at
// the transport level the way postgres_changes is — anyone who can guess
// or construct a `comments:<taskId>` channel name could in principle send
// to it. This is accepted here (documented in lib/actions/comments.ts too)
// because the only client code that subscribes
// (components/task/use-comments-realtime.ts, via comment-list.tsx inside
// task-detail-sheet.tsx) only ever does so for a task the current user has
// already independently passed the normal RLS-gated fetch for, and the
// broadcast payload carries only a bare comment id — no data a subscriber
// couldn't already see.
//
// The broadcast payload is translated into the same
// `CommentRealtimeEvent` shape `onChange`/`reconcileComment` already
// handle (a DELETE-shaped event, `old: { id }`) so the reducer and its
// existing tests don't need a second code path for "how a comment gets
// removed."
//
// F191 (AS-346): a symmetrical `comment_restored` broadcast, sent by
// lib/actions/comments.ts's restoreComment right after its restore UPDATE
// succeeds. Restoring is also an UPDATE under the hood, and postgres_changes
// is only subscribed to `event: "INSERT"` above (not UPDATE at all) —
// precisely because of the same RLS-on-NEW-row class of bug F104 already
// worked around for delete — so a restore would never reach subscribers
// via postgres_changes regardless of whether the NEW row now passes
// comments_select_active_members. Broadcast is therefore the only
// delivery path here too. The payload carries the full comment row (not
// just an id) and is translated into an INSERT-shaped
// `CommentRealtimeEvent`, so `reconcileComment`'s existing "append if not
// already present" branch reconstructs the comment without a second code
// path or a second round trip.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CommentRealtimeEvent,
  CommentRealtimeRow,
} from "@/lib/tasks/reconcile-realtime-comment";

export type { CommentRealtimeEvent, CommentRealtimeRow };

// F202 (AS-369): a second, independent Realtime subscription — reactions
// on any comment in the current task — kept as its own channel/function
// rather than folded into subscribeToCommentsRealtime above, per this
// feature's "no new dependency, no second source of truth" ambiguity
// answer: comment_reactions is a distinct table with a distinct payload
// shape, and keeping it separate avoids widening subscribeToCommentsRealtime's
// existing, already-tested `CommentRealtimeEvent` contract.
//
// comment_reactions has no task_id column (F199's migration), so unlike
// the comments channel above, postgres_changes can't be given a
// `filter: task_id=eq.<taskId>` clause directly. This channel therefore
// subscribes to ALL comment_reactions changes (RLS — comment_reactions_
// select_visible, F199 — still governs which rows a client is even sent)
// and the caller (components/task/use-reactions-realtime.ts's consumer,
// comment-list.tsx) filters client-side by checking the event's commentId
// against the task's already-loaded comment ids, the same "narrow inside
// the component that already has the scoping context" shape F049's board
// channel uses for out-of-scope project rows.
//
// Both INSERT and DELETE are usable via plain postgres_changes here
// (unlike comments' F104 workaround): comment_reactions_select_visible's
// RLS predicate depends only on the *task's* visibility (public.is_task_
// visible_to), not on any column that a reaction's own INSERT/DELETE
// changes — so, unlike a comment's soft-delete (which flips deleted_at,
// the very column its SELECT policy gates on), a reaction row's
// visibility never changes out from under it. No broadcast fallback is
// needed for either direction.
//
// DELETE payloads carry old.comment_id/old.user_id/old.emoji without
// requiring `REPLICA IDENTITY FULL` because all three columns are part of
// comment_reactions' composite primary key (F199's migration) — Postgres
// always includes primary-key columns in a DELETE's replicated OLD row
// regardless of replica identity setting.
export type ReactionRealtimeEvent = {
  eventType: "INSERT" | "DELETE";
  commentId: string;
  userId: string;
  emoji: string;
};

export function subscribeToReactionsRealtime(
  supabase: SupabaseClient,
  taskId: string,
  onChange: (event: ReactionRealtimeEvent) => void,
): () => void {
  function forward(eventType: "INSERT" | "DELETE") {
    return (payload: {
      new?: { comment_id?: string; user_id?: string; emoji?: string };
      old?: { comment_id?: string; user_id?: string; emoji?: string };
    }) => {
      const row = eventType === "INSERT" ? payload?.new : payload?.old;
      if (!row?.comment_id || !row.user_id || !row.emoji) return;
      onChange({
        eventType,
        commentId: row.comment_id,
        userId: row.user_id,
        emoji: row.emoji,
      });
    };
  }

  const channel = supabase
    .channel(`comment_reactions:${taskId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comment_reactions" },
      forward("INSERT"),
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "comment_reactions" },
      forward("DELETE"),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToCommentsRealtime(
  supabase: SupabaseClient,
  taskId: string,
  onChange: (event: CommentRealtimeEvent) => void,
): () => void {
  const channel = supabase
    .channel(`comments:${taskId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "comments",
        filter: `task_id=eq.${taskId}`,
      },
      (payload: CommentRealtimeEvent) => {
        onChange(payload);
      },
    )
    .on<{ id: string }>(
      "broadcast",
      { event: "comment_deleted" },
      (message) => {
        const deletedId = message?.payload?.id;
        if (!deletedId) return;
        onChange({
          eventType: "DELETE",
          schema: "public",
          table: "comments",
          old: { id: deletedId },
          new: {},
        } as unknown as CommentRealtimeEvent);
      },
    )
    .on<CommentRealtimeRow>(
      "broadcast",
      { event: "comment_restored" },
      (message) => {
        const row = message?.payload;
        if (!row || !row.id) return;
        onChange({
          eventType: "INSERT",
          schema: "public",
          table: "comments",
          new: row,
          old: {},
        } as unknown as CommentRealtimeEvent);
      },
    )
    // F197 (AS-362): a symmetrical `comment_edited` broadcast, sent by
    // lib/actions/comments.ts's editComment right after its content UPDATE
    // succeeds. Same rationale as comment_restored above — postgres_changes
    // is only subscribed to `event: "INSERT"`, so an edit (also an UPDATE
    // under the hood) would never reach other subscribers via
    // postgres_changes at all. Translated into an UPDATE-shaped event so
    // reconcileComment's existing "replace by id" branch handles it without
    // a new reducer path.
    .on<CommentRealtimeRow>(
      "broadcast",
      { event: "comment_edited" },
      (message) => {
        const row = message?.payload;
        if (!row || !row.id) return;
        onChange({
          eventType: "UPDATE",
          schema: "public",
          table: "comments",
          new: row,
          old: {},
        } as unknown as CommentRealtimeEvent);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
