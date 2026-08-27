"use client";

// F8 (docs/advanced-chat-plan.md): thin Client Component hook wrapping
// lib/chat/subscribe-message-reactions-realtime.ts's plain subscribe
// function -- mirrors use-chat-messages-realtime.ts's own doc comment on
// this convention, including its F272 auth-session-first fix (subscribing
// only after `supabase.auth.getSession()` resolves).

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToMessageReactionsRealtime,
  type MessageReactionRealtimeEvent,
} from "@/lib/chat/subscribe-message-reactions-realtime";

export type { MessageReactionRealtimeEvent } from "@/lib/chat/subscribe-message-reactions-realtime";

export function useMessageReactionsRealtime(
  channelId: string | null | undefined,
  onChange: (event: MessageReactionRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!channelId) return;

    const supabase = createClient();

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      unsubscribe = subscribeToMessageReactionsRealtime(
        supabase,
        channelId,
        onChange,
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);
}
