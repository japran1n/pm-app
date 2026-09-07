// Read receipts: subscribes to UPDATE events on `channel_members` for a
// single channel so a "Seen by" avatar strip (ChannelView) can update live
// as other members' `last_read_at` cursors move forward, without a
// polling query. Same "plain, React-free function, one shared topic per
// channel" convention as subscribe-messages-realtime.ts /
// subscribe-message-reactions-realtime.ts.
import type { SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type ChatReadReceiptRealtimeEvent = {
  userId: string;
  lastReadAt: string | null;
};

type RawChannelMemberRow = {
  channel_id?: string;
  user_id?: string;
  last_read_at?: string | null;
};

export function subscribeToChatReadReceiptsRealtime(
  supabase: SupabaseClient,
  channelId: string,
  onEvent: (event: ChatReadReceiptRealtimeEvent) => void,
): () => void {
  const topic = `chat:read-receipts:${channelId}`;

  return acquireSharedTopicChannel<ChatReadReceiptRealtimeEvent>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "channel_members",
            filter: `channel_id=eq.${channelId}`,
          },
          (payload: { new?: RawChannelMemberRow }) => {
            const userId = payload?.new?.user_id;
            if (!userId) return;
            dispatch({
              userId,
              lastReadAt: payload?.new?.last_read_at ?? null,
            });
          },
        )
        .subscribe(),
    onEvent,
  );
}
