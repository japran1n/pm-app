// F202 (AS-369): Supabase Realtime subscription for a task's comment
// reactions — reactions appear live for other viewers without a reload.
//
// Thin Client Component hook, same "smallest possible client boundary"
// convention as components/task/use-comments-realtime.ts (F062): the
// actual channel wiring lives in lib/tasks/subscribe-comments-realtime.ts's
// `subscribeToReactionsRealtime` (a plain, React-free function, unit-
// tested without a DOM/React runtime). This hook is just the useEffect
// lifecycle glue: subscribe on mount/taskId change, unsubscribe on
// cleanup.
//
// Requires Realtime to be enabled for `comment_reactions` at the Postgres
// replication level — already done by F199's migration
// (supabase/migrations/20260823010000_create_comment_reactions.sql),
// which added the table to the `supabase_realtime` publication in
// anticipation of this feature.

"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToReactionsRealtime,
  type ReactionRealtimeEvent,
} from "@/lib/tasks/subscribe-comments-realtime";

export type { ReactionRealtimeEvent };

/**
 * Subscribes to Realtime changes on the `comment_reactions` table for
 * `taskId`. Calls `onChange` for every INSERT (reaction added) /
 * DELETE (reaction removed) event received while mounted. Cleanup
 * (unsubscribe) happens automatically on unmount or when `taskId`
 * changes.
 */
export function useReactionsRealtime(
  taskId: string,
  onChange: (event: ReactionRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!taskId) return;

    const supabase = createClient();
    const unsubscribe = subscribeToReactionsRealtime(
      supabase,
      taskId,
      onChange,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
}
