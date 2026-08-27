// F8 (docs/advanced-chat-plan.md): the actual Realtime channel setup for a
// single chat channel's message reactions -- copy-paste of
// lib/tasks/subscribe-comments-realtime.ts's subscribeToReactionsRealtime,
// adapted to `message_reactions`/`channel_id` (per F8's migration
// supabase/migrations/20260904070000_message_reactions_channel_id.sql),
// extracted as a plain, React-free function per this repo's established
// convention so it's unit-testable without a DOM/React runtime.
//
// Requires Realtime to be enabled for `message_reactions` at the Postgres
// replication level -- already done by
// supabase/migrations/20260904020000_chat_system.sql, which added the
// table to the `supabase_realtime` publication in anticipation of this
// feature.
import type { SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type MessageReactionRealtimeEvent = {
  eventType: "INSERT" | "DELETE";
  messageId: string;
  userId: string;
  emoji: string;
};

export function subscribeToMessageReactionsRealtime(
  supabase: SupabaseClient,
  channelId: string,
  onChange: (event: MessageReactionRealtimeEvent) => void,
): () => void {
  const topic = `chat:message_reactions:${channelId}`;

  function forward(
    eventType: "INSERT" | "DELETE",
    dispatch: (event: MessageReactionRealtimeEvent) => void,
  ) {
    return (payload: {
      new?: { message_id?: string; user_id?: string; emoji?: string };
      old?: { message_id?: string; user_id?: string; emoji?: string };
    }) => {
      const row = eventType === "INSERT" ? payload?.new : payload?.old;
      if (!row?.message_id || !row.user_id || !row.emoji) return;
      dispatch({
        eventType,
        messageId: row.message_id,
        userId: row.user_id,
        emoji: row.emoji,
      });
    };
  }

  return acquireSharedTopicChannel<MessageReactionRealtimeEvent>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "message_reactions",
            filter: `channel_id=eq.${channelId}`,
          },
          forward("INSERT", dispatch),
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "message_reactions",
            filter: `channel_id=eq.${channelId}`,
          },
          forward("DELETE", dispatch),
        )
        .subscribe(),
    onChange,
  );
}
