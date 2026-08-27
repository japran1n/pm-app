// F6 (docs/advanced-chat-plan.md): typing indicator -- the first use of
// Supabase Broadcast in this codebase (every other `subscribe*Realtime`
// module listens to `postgres_changes` on a real table). Broadcast events
// are ephemeral pub/sub messages relayed by Realtime's server; they are
// NEVER written to Postgres, which is exactly what F6's acceptance
// criterion requires ("Broadcast event NIKAD ne upisuje red u bazu").
//
// Reuses lib/realtime/shared-topic-channel.ts's ref-counted registry for
// the same StrictMode-double-subscribe fix every other subscribe* module
// in this repo relies on (see that file's doc comment for the full
// root-cause writeup) -- `buildChannel` below is called at most once per
// live topic no matter how many components mount `useTypingIndicator` for
// the same channel.
//
// Sending a broadcast requires the SAME (subscribed) `RealtimeChannel`
// object used for listening -- `supabase.channel(topic)` dedupes by topic,
// but calling `.send()` on a *different*, never-subscribed channel object
// silently fails to deliver in some client versions. `rawChannels` below
// keeps a side-table of the actual channel object per (client, topic) so
// `sendTypingBroadcast` can reuse it without re-subscribing.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type TypingBroadcastEvent = {
  userId: string;
  name: string | null;
};

const TYPING_BROADCAST_EVENT = "typing";

function topicFor(channelId: string): string {
  return `chat:typing:${channelId}`;
}

const rawChannels = new WeakMap<SupabaseClient, Map<string, RealtimeChannel>>();

function rememberRawChannel(
  supabase: SupabaseClient,
  topic: string,
  channel: RealtimeChannel,
) {
  let map = rawChannels.get(supabase);
  if (!map) {
    map = new Map();
    rawChannels.set(supabase, map);
  }
  map.set(topic, channel);
}

/**
 * Subscribes to typing Broadcast events for `channelId`. `onEvent` fires
 * for every typing event another client sends on this channel's topic
 * (self-broadcasts are excluded at the channel config level, `self:
 * false`, so a sender never receives its own event back). Returns a
 * cleanup function -- call it on unmount / when `channelId` changes.
 */
export function subscribeToTypingBroadcast(
  supabase: SupabaseClient,
  channelId: string,
  onEvent: (event: TypingBroadcastEvent) => void,
): () => void {
  const topic = topicFor(channelId);
  return acquireSharedTopicChannel<TypingBroadcastEvent>(
    supabase,
    topic,
    (dispatch) => {
      const channel = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: TYPING_BROADCAST_EVENT }, ({ payload }) => {
          dispatch(payload as TypingBroadcastEvent);
        });
      channel.subscribe();
      rememberRawChannel(supabase, topic, channel);
      return channel;
    },
    onEvent,
  );
}

/**
 * Sends a typing Broadcast event on `channelId`'s topic. No-op (and safe
 * to call) if this client hasn't subscribed to that topic yet -- e.g. a
 * keystroke that races the initial `useTypingIndicator` subscribe --
 * since there's no channel object yet to send on and nothing has failed;
 * the very next debounced keystroke will succeed once the subscribe
 * resolves. Never touches Postgres.
 */
export function sendTypingBroadcast(
  supabase: SupabaseClient,
  channelId: string,
  event: TypingBroadcastEvent,
): void {
  const topic = topicFor(channelId);
  const channel = rawChannels.get(supabase)?.get(topic);
  if (!channel) return;
  void channel.send({ type: "broadcast", event: TYPING_BROADCAST_EVENT, payload: event });
}
