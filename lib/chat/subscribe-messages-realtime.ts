// F3 (docs/advanced-chat-plan.md): the actual Realtime channel setup for a
// single chat channel's messages -- extracted as a plain, React-free
// function per this repo's established convention (lib/notifications/
// subscribe-notifications-realtime.ts, lib/tasks/subscribe-comments-
// realtime.ts), so it's unit-testable without a DOM/React runtime (this
// repo's vitest config runs with `environment: "node"`).
//
// Subscribes to INSERT and UPDATE on `messages` filtered to this one
// channel (`channel_id=eq.<channelId>`) -- INSERT for new messages
// appearing live (F3's core acceptance), UPDATE for the same "Message
// deleted" placeholder needing to appear live in every other open client
// when a sender edits/soft-deletes their own message (`deleted_at`/
// `edited_at` changing), matching F3's other acceptance criterion: a
// soft-deleted message renders a placeholder rather than vanishing
// abruptly for participants who already have it open.
//
// Uses the shared ref-counted channel registry (lib/realtime/shared-topic-
// channel.ts, F329) for the same StrictMode-double-subscribe fix every
// other subscribe* module in this repo relies on.
import type { SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type ChatMessageRealtimeEvent =
  | { type: "insert"; message: ChatMessageEventPayload }
  | { type: "update"; message: ChatMessageEventPayload };

export type ChatMessageEventPayload = {
  id: string;
  channelId: string;
  senderId: string;
  bodyJson: unknown;
  parentMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

type RawMessageRow = {
  id?: string;
  channel_id?: string;
  sender_id?: string;
  body_json?: unknown;
  parent_message_id?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  created_at?: string;
};

function toEventPayload(row?: RawMessageRow): ChatMessageEventPayload | null {
  if (!row?.id || !row.channel_id || !row.sender_id || row.body_json === undefined) {
    return null;
  }
  return {
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    bodyJson: row.body_json,
    parentMessageId: row.parent_message_id ?? null,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function subscribeToChatMessagesRealtime(
  supabase: SupabaseClient,
  channelId: string,
  onEvent: (event: ChatMessageRealtimeEvent) => void,
): () => void {
  const topic = `chat:messages:${channelId}`;

  return acquireSharedTopicChannel<ChatMessageRealtimeEvent>(
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
            table: "messages",
            filter: `channel_id=eq.${channelId}`,
          },
          (payload: { new?: RawMessageRow }) => {
            const message = toEventPayload(payload?.new);
            if (!message) return;
            dispatch({ type: "insert", message });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `channel_id=eq.${channelId}`,
          },
          (payload: { new?: RawMessageRow }) => {
            const message = toEventPayload(payload?.new);
            if (!message) return;
            dispatch({ type: "update", message });
          },
        )
        .subscribe(),
    onEvent,
  );
}
