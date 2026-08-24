// F049 (AS-076): the actual Realtime channel setup, extracted out of
// components/board/use-board-realtime.ts as a plain function so it's
// testable without a React runtime/DOM (this repo's vitest config runs
// with `environment: "node"`, no React Testing Library — see
// vitest.config.ts — so a hook that only exposed its logic inside
// `useEffect` would be unverifiable without a browser-like test
// environment). The hook itself (use-board-realtime.ts) is a two-line
// wrapper: call this in an effect, return the unsubscribe it gives back.
//
// Kept intentionally dumb: given a Supabase client, a project id, and a
// callback, wires up exactly one channel/subscription (channel name
// `board:<projectId>`, table `tasks`, all three events, filtered to this
// project via Realtime's row-filter syntax) and returns a cleanup
// function. No React, no local component state.

import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type BoardRealtimeTaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  deleted_at: string | null;
  updated_at: string;
  // F146 (AS-258): a plain `tasks` column (F145), so it's already present
  // in every Realtime payload for this row with no join needed — unlike
  // a task's project key, which lives on `projects` and never arrives in
  // a `tasks`-table Realtime event (see reconcile-realtime-task.ts for
  // how that half is resolved instead).
  number: number;
};

export type BoardRealtimeEvent =
  RealtimePostgresChangesPayload<BoardRealtimeTaskRow>;

export function subscribeToBoardRealtime(
  supabase: SupabaseClient,
  projectId: string,
  onChange: (event: BoardRealtimeEvent) => void,
): () => void {
  return acquireSharedTopicChannel<BoardRealtimeEvent>(
    supabase,
    `board:${projectId}`,
    (dispatch) =>
      supabase
        .channel(`board:${projectId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
            filter: `project_id=eq.${projectId}`,
          },
          (payload: BoardRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
