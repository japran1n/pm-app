// Thin Client Component hook wrapping
// lib/chat/subscribe-read-receipts-realtime.ts's plain subscribe function --
// same "smallest possible client boundary" convention as
// use-chat-messages-realtime.ts / use-message-reactions-realtime.ts.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToChatReadReceiptsRealtime,
  type ChatReadReceiptRealtimeEvent,
} from "@/lib/chat/subscribe-read-receipts-realtime";

export type { ChatReadReceiptRealtimeEvent } from "@/lib/chat/subscribe-read-receipts-realtime";

export function useReadReceiptsRealtime(
  channelId: string | null | undefined,
  onEvent: (event: ChatReadReceiptRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!channelId) return;

    const supabase = createClient();

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      unsubscribe = subscribeToChatReadReceiptsRealtime(supabase, channelId, onEvent);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);
}
