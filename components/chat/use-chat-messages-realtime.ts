// F3 (docs/advanced-chat-plan.md): thin Client Component hook wrapping
// lib/chat/subscribe-messages-realtime.ts's plain subscribe function --
// same "smallest possible client boundary" convention as components/
// notifications/use-notifications-realtime.ts (F209) / components/task/
// use-reactions-realtime.ts (F202).
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToChatMessagesRealtime,
  type ChatMessageRealtimeEvent,
} from "@/lib/chat/subscribe-messages-realtime";

export type { ChatMessageRealtimeEvent, ChatMessageEventPayload } from "@/lib/chat/subscribe-messages-realtime";

/**
 * Subscribes to Realtime INSERT/UPDATE events on `messages` for
 * `channelId`, calling `onEvent` for every new or edited/deleted message
 * received while mounted. Cleanup (unsubscribe) happens automatically on
 * unmount or when `channelId` changes.
 *
 * F272 (part 2, AS-388 regression) fix applied here too: subscribing only
 * after `supabase.auth.getSession()` resolves guarantees `realtime.setAuth`
 * has already been called with the real session's access token before this
 * channel joins -- subscribing earlier silently drops every row Realtime's
 * RLS check would otherwise deliver, with no visible error. See
 * use-notifications-realtime.ts's doc comment for the full root-cause
 * writeup (verified live against a real Supabase project).
 */
export function useChatMessagesRealtime(
  channelId: string | null | undefined,
  onEvent: (event: ChatMessageRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!channelId) return;

    const supabase = createClient();

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      unsubscribe = subscribeToChatMessagesRealtime(
        supabase,
        channelId,
        onEvent,
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);
}
