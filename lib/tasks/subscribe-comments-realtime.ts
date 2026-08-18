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
// `comments:<taskId>`, table `comments`, all three events, filtered to
// this task via Realtime's row-filter syntax) and returns a cleanup
// function. No React, no local component state.
//
// Requires Realtime to be enabled for `comments` at the Postgres
// replication level — see
// supabase/migrations/20260818050000_realtime_comments_publication.sql
// (`ALTER PUBLICATION supabase_realtime ADD TABLE public.comments`),
// without which postgres_changes silently never fires for this table.
// Realtime broadcasts still respect the table's RLS SELECT policy
// (comments_select_active_members,
// supabase/migrations/20260818040214_create_comments.sql), so a client
// only receives events for comments on tasks in workspaces it's an active
// member of.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CommentRealtimeEvent,
  CommentRealtimeRow,
} from "@/lib/tasks/reconcile-realtime-comment";

export type { CommentRealtimeEvent, CommentRealtimeRow };

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
        event: "*",
        schema: "public",
        table: "comments",
        filter: `task_id=eq.${taskId}`,
      },
      (payload: CommentRealtimeEvent) => {
        onChange(payload);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
