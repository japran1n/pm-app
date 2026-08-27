// F5 (docs/advanced-chat-plan.md): workspace-wide unread-count Realtime
// wiring for the chat sidebar. Reuses the exact same `messages` INSERT
// event F3's per-channel subscribe-messages-realtime.ts listens to (per
// F5's acceptance criteria: "subscribe na isti messages insert event iz
// F3, update lokalni state bez novog query-ja"), but unfiltered at the
// subscription level -- there is no single-channel-id filter to scope to
// here since the sidebar cares about every channel the caller belongs to
// at once. RLS's `messages_select_channel_members` policy (see
// supabase/migrations/20260904020000_chat_system.sql) is what actually
// keeps this scoped: Realtime only ever delivers rows the caller's
// session is permitted to SELECT, so an unfiltered subscription here
// still only ever surfaces inserts for channels this user is a member of
// -- no cross-tenant leak.
//
// Extracted as a plain, React-free function per this repo's established
// convention (lib/chat/subscribe-messages-realtime.ts,
// lib/notifications/subscribe-notifications-realtime.ts) so it's
// unit-testable without a DOM/React runtime.
import type { SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type ChatUnreadRealtimeEvent = { channelId: string };

type RawMessageRow = { channel_id?: string };

/**
 * Subscribes to every INSERT on `messages` visible to the caller (RLS
 * scopes visibility; see module doc comment above) and calls `onEvent`
 * with the affected `channelId` for each one. `topicKey` should be a
 * value unique per workspace (e.g. the workspace id) so the shared-topic
 * registry keys this subscription distinctly from F3's per-channel
 * topics and from any other workspace's sidebar.
 */
export function subscribeToChatUnreadRealtime(
  supabase: SupabaseClient,
  topicKey: string,
  onEvent: (event: ChatUnreadRealtimeEvent) => void,
): () => void {
  const topic = `chat:unread:${topicKey}`;

  return acquireSharedTopicChannel<ChatUnreadRealtimeEvent>(
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
          },
          (payload: { new?: RawMessageRow }) => {
            const channelId = payload?.new?.channel_id;
            if (!channelId) return;
            dispatch({ channelId });
          },
        )
        .subscribe(),
    onEvent,
  );
}
