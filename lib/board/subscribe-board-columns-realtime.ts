// F221 (AS-413): Realtime channel setup for a board's COLUMNS
// (`project_statuses`), mirroring lib/board/subscribe-board-realtime.ts's
// pattern exactly (same "plain, React-free function" shape, unit-testable
// without a DOM) but for a different table -- a separate channel/
// subscription from the existing tasks one, so a column-only reconnect
// never has to also resubscribe to every task event and vice versa.
//
// Channel name `board-columns:<projectId>`, table `project_statuses`, all
// three events, filtered server-side to this project
// (`project_id=eq.<projectId>`). See the migration
// (20260824050000_realtime_project_statuses_publication.sql) for why
// `project_statuses` needed REPLICA IDENTITY FULL for this filter to work
// on DELETE, and why that filter is the real anti-leak boundary for
// DELETE payloads specifically (Realtime does not run RLS against a row
// that's already gone).

import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type BoardRealtimeColumnRow = {
  id: string;
  project_id: string;
  name: string;
  color: string;
  category: "not_started" | "in_progress" | "done";
  position: number;
};

export type BoardColumnsRealtimeEvent =
  RealtimePostgresChangesPayload<BoardRealtimeColumnRow>;

export function subscribeToBoardColumnsRealtime(
  supabase: SupabaseClient,
  projectId: string,
  onChange: (event: BoardColumnsRealtimeEvent) => void,
): () => void {
  return acquireSharedTopicChannel<BoardColumnsRealtimeEvent>(
    supabase,
    `board-columns:${projectId}`,
    (dispatch) =>
      supabase
        .channel(`board-columns:${projectId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "project_statuses",
            filter: `project_id=eq.${projectId}`,
          },
          (payload: BoardColumnsRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
