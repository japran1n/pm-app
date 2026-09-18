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
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";
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
    // P2-31: subscribeWhenAuthenticated awaits the session AND explicitly
    // calls realtime.setAuth() before subscribing — the inline
    // getSession().then() pattern only waited for session hydration but
    // did not set the JWT on the socket, so the first phx_join could
    // still be sent unauthenticated. See
    // lib/realtime/subscribe-when-authenticated.ts for the full
    // root-cause write-up.
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToNotificationsRealtime(client, userId, onInsert),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
