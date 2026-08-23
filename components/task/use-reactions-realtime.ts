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

    // F315 (AS-214 regression fix): createClient() throws synchronously
    // when NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    // aren't present (e.g. a jsdom unit test environment that never loads
    // .env, as opposed to real browser/SSR contexts, which always have
    // these injected at build time). There's no established
    // "client construction might fail" guard elsewhere in this codebase
    // (lib/supabase/client.ts, use-comments-realtime.ts, and every other
    // caller assume env vars are always present in real environments) —
    // this hook is the one exception because it happens to get mounted,
    // unmocked, inside tests/unit/user-avatar.test.tsx's real DOM render
    // of comment-list.tsx. Skip the subscription non-fatally rather than
    // throwing and crashing the host component's render; this cannot
    // change real production behavior since the env vars are always
    // present there.
    let supabase;
    try {
      supabase = createClient();
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "useReactionsRealtime: skipping subscription, Supabase client unavailable",
          error,
        );
      }
      return;
    }

    const unsubscribe = subscribeToReactionsRealtime(
      supabase,
      taskId,
      onChange,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
}
