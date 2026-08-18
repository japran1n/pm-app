// F049 (AS-076): Supabase Realtime subscription for the Kanban board.
//
// Subscribes to Postgres `postgres_changes` events (INSERT/UPDATE/DELETE)
// on the `tasks` table, filtered server-side to the current project — this
// repo's board is already scoped one project at a time (F042), so
// filtering at the subscription level (rather than the fixed-workspace
// scoping used elsewhere) keeps the payload to exactly what this board
// needs and matches AS-068's per-project scoping.
//
// This is a thin Client Component hook, per the clarified spec's "smallest
// possible client boundary" — the actual channel wiring lives in
// lib/board/subscribe-board-realtime.ts's `subscribeToBoardRealtime` (a
// plain, React-free function, so it can be unit-tested without a DOM/React
// runtime — see tests/unit/board-realtime-subscription.test.ts). This hook
// is just the useEffect lifecycle glue: subscribe on mount/projectId
// change, unsubscribe on cleanup.
//
// Every change is handed back to the caller (board.tsx) via `onChange`,
// which decides how to reconcile local state. Reconciling with the
// just-arrived server row is simpler and more robust than trying to detect
// "was this caused by my own optimistic update" — both this client's own
// moves and another viewer's moves arrive as the same event shape once the
// server commit lands, so board.tsx applies the same merge either way via
// the pure `reconcileTask` helper in lib/board/reconcile-realtime-task.ts.
//
// Requires Realtime to be enabled for `tasks` at the Postgres replication
// level — see supabase/migrations/20260818040000_realtime_tasks_publication.sql
// (`ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks`), without
// which postgres_changes silently never fires for this table. Realtime
// broadcasts still respect the table's RLS SELECT policy
// (tasks_select_active_members), so a client only receives events for
// tasks in projects it's a workspace member of.

"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToBoardRealtime,
  type BoardRealtimeEvent,
  type BoardRealtimeTaskRow,
} from "@/lib/board/subscribe-board-realtime";

export type { BoardRealtimeEvent, BoardRealtimeTaskRow };

/**
 * Subscribes to Realtime changes on the `tasks` table scoped to
 * `projectId`. Calls `onChange` for every INSERT/UPDATE/DELETE event
 * received while mounted. Cleanup (unsubscribe) happens automatically on
 * unmount or when `projectId` changes.
 */
export function useBoardRealtime(
  projectId: string,
  onChange: (event: BoardRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient();
    const unsubscribe = subscribeToBoardRealtime(supabase, projectId, onChange);

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
}
