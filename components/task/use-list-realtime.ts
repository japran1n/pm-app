"use client";

// F251 (AS-488): the project List view's Realtime subscription. This
// deliberately does NOT introduce a second subscription mechanism — it
// wraps `useBoardRealtime` (components/board/use-board-realtime.ts, F049)
// directly, which already wires the SAME `board:<projectId>` topic/filter
// through `lib/realtime/shared-topic-channel.ts`'s ref-counted registry
// (F329). Reusing it means:
//   - No new channel/topic name: a List view and a Board view open for
//     the same project at the same time (two browser tabs, or this view
//     plus a background Board tab) share exactly one live channel via the
//     registry's ref-count, not two independent subscriptions to the same
//     `postgres_changes` filter.
//   - The StrictMode mount -> cleanup -> mount safety and the RLS-scoped
//     row filter (`project_id=eq.<projectId>`, evaluated at the Postgres
//     replication level regardless of RLS — narrowing the payload to
//     exactly the caller's project) are inherited for free rather than
//     re-implemented.
//   - Private-project visibility (F322): this hook is only ever mounted
//     from a route the caller already had server-side access to render
//     (list/page.tsx relies on the project detail layout's membership
//     guard one level up, same as the board page) — same security
//     posture the board's own subscription already relies on; a Realtime
//     DELETE payload here can only ever be for a task in a project this
//     viewer's client legitimately opened the List page for.
//
// `undefined` `projectId` (e.g. the workspace-wide dashboard table, which
// spans every project and has no single topic to subscribe to) is a
// deliberate no-op — see task-list-table.tsx's own doc comment on why
// AS-488 is scoped to the single-project List view for this feature.
import { useBoardRealtime } from "@/components/board/use-board-realtime";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

export type { BoardRealtimeEvent };

export function useListRealtime(
  projectId: string | undefined,
  onChange: (event: BoardRealtimeEvent) => void,
) {
  useBoardRealtime(projectId ?? "", onChange);
}
