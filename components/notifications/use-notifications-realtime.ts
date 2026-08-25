// F209 (AS-388): Supabase Realtime subscription for the current user's
// notification inbox — the bell's unread badge updates live without a
// reload.
//
// Thin Client Component hook, same "smallest possible client boundary"
// convention as components/task/use-reactions-realtime.ts (F202): the
// actual channel wiring lives in
// lib/notifications/subscribe-notifications-realtime.ts's
// `subscribeToNotificationsRealtime` (a plain, React-free function, unit-
// tested without a DOM/React runtime). This hook is just the useEffect
// lifecycle glue: subscribe on mount/userId change, unsubscribe on
// cleanup.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToNotificationsRealtime,
  type NotificationInsertEvent,
} from "@/lib/notifications/subscribe-notifications-realtime";

export type { NotificationInsertEvent };

/**
 * Subscribes to Realtime INSERT events on the `notifications` table for
 * `userId` (subscription-level user scoping — see
 * subscribeToNotificationsRealtime's doc comment). Calls `onInsert` for
 * every new notification received while mounted. Cleanup (unsubscribe)
 * happens automatically on unmount or when `userId` changes.
 */
export function useNotificationsRealtime(
  userId: string | null | undefined,
  onInsert: (event: NotificationInsertEvent) => void,
) {
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();

    // F272 (part 2, AS-388 regression): on a freshly-loaded page,
    // `createBrowserClient`'s GoTrueClient reads the session from cookies
    // ASYNCHRONOUSLY, and only once that resolves does supabase-js's own
    // auth-state listener call `realtime.setAuth(token)` (see
    // node_modules/@supabase/supabase-js/dist/index.cjs's
    // `_handleTokenChanged`, fired from an `INITIAL_SESSION` event).
    // Subscribing to the channel before that finishes joins it with NO
    // access token — every `postgres_changes` row is then silently
    // dropped by Realtime's RLS check for this channel's entire
    // lifetime, with no visible error (`.subscribe()` still reports
    // `SUBSCRIBED`, since the join itself succeeds independent of RLS).
    // Confirmed with a standalone repro against the real linked Supabase
    // project outside the app entirely (see this session's handoff).
    // `getSession()` awaits that exact same initialization promise, so
    // subscribing only after it resolves guarantees `realtime.setAuth`
    // has already run for the real session first. `cancelled` guards the
    // case where `userId` changes/unmounts before this resolves.
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      unsubscribe = subscribeToNotificationsRealtime(
        supabase,
        userId,
        onInsert,
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
