// F5 (docs/advanced-chat-plan.md): thin Client Component hook wrapping
// lib/chat/subscribe-unread-realtime.ts's plain subscribe function -- same
// "smallest possible client boundary" convention as
// components/chat/use-chat-messages-realtime.ts (F3) /
// components/notifications/use-notifications-realtime.ts (F209).
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToChatUnreadRealtime,
  type ChatUnreadRealtimeEvent,
} from "@/lib/chat/subscribe-unread-realtime";

export type { ChatUnreadRealtimeEvent } from "@/lib/chat/subscribe-unread-realtime";

/**
 * Subscribes to every `messages` INSERT visible to the caller (RLS-scoped
 * to channels they belong to) for as long as `topicKey` is truthy, calling
 * `onEvent` with `{ channelId }` for each one. Same F272-derived fix as
 * use-chat-messages-realtime.ts: subscribing only after
 * `supabase.auth.getSession()` resolves guarantees `realtime.setAuth` has
 * already run with the real session token before this channel joins.
 */
export function useChatUnreadRealtime(
  topicKey: string | null | undefined,
  onEvent: (event: ChatUnreadRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!topicKey) return;

    const supabase = createClient();

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      unsubscribe = subscribeToChatUnreadRealtime(supabase, topicKey, onEvent);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey]);
}
