// Thin Client Component hook wrapping
// lib/chat/subscribe-read-receipts-realtime.ts's plain subscribe function --
// same "smallest possible client boundary" convention as
// use-chat-messages-realtime.ts / use-message-reactions-realtime.ts.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";
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
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToChatReadReceiptsRealtime(client, channelId, onEvent),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);
}
