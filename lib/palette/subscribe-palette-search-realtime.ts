// F012 (AS-023, AS-024): Realtime wiring for the command palette's search
// results, mirroring the pattern established by
// lib/board/subscribe-board-realtime.ts — a plain, React-free function so
// the channel configuration is unit-testable without a DOM/React runtime
// (this repo's vitest config runs with environment: "node").
//
// Workspace-scoped topic (`tasks:${workspaceId}`) rather than per-project,
// since the palette searches across every project in the workspace the
// caller can see (lib/actions/palette-search.ts). Uses the shared,
// ref-counted channel helper (lib/realtime/shared-topic-channel.ts) so a
// second subscriber to the same `tasks:<workspaceId>` topic (e.g. another
// component also watching workspace-wide task changes) never double-calls
// `.on()`/`.subscribe()` on an already-joined channel.

import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type PaletteRealtimeTaskRow = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  deleted_at?: string | null;
};

export type PaletteRealtimeEvent =
  RealtimePostgresChangesPayload<PaletteRealtimeTaskRow>;

export function subscribeToPaletteSearchRealtime(
  supabase: SupabaseClient,
  workspaceId: string,
  onChange: (event: PaletteRealtimeEvent) => void,
): () => void {
  const topic = `tasks:${workspaceId}`;
  return acquireSharedTopicChannel<PaletteRealtimeEvent>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
          },
          (payload: PaletteRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
