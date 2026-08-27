// F7 (docs/advanced-chat-plan.md): one Supabase Presence channel per
// workspace (`presence:workspace:${workspaceId}`), tracked once at
// workspace-layout mount ("online in the app", not "online in this
// channel" -- that's a broader signal than any single chat channel).
//
// Ref-counted acquire/release, same shape as
// lib/realtime/shared-topic-channel.ts and for the exact same reason
// documented in that file's header: React StrictMode double-invokes effects
// synchronously in dev (mount -> cleanup -> mount, same tick), and the
// browser Supabase client is a module-level singleton
// (`createBrowserClient`'s `cachedBrowserClient`), so its `RealtimeClient`
// and `channels` array persist across that double-mount. Without ref
// counting, the second mount's `supabase.channel(topic)` call would return
// the still-joined channel from the first mount and a second `.on(...)`
// call on it would throw. This module is deliberately its own small
// implementation rather than reusing `acquireSharedTopicChannel` because
// Presence needs `.track()` / `.untrack()` and `.presenceState()`, none of
// which that generic postgres_changes-shaped helper models.
"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type PresencePayload = {
  user_id: string;
  online_at: string;
};

type Entry = {
  channel: RealtimeChannel;
  listeners: Set<(onlineUserIds: Set<string>) => void>;
  onlineUserIds: Set<string>;
  removalTimer: ReturnType<typeof setTimeout> | null;
};

const registries = new WeakMap<SupabaseClient, Map<string, Entry>>();

function registryFor(supabase: SupabaseClient): Map<string, Entry> {
  let registry = registries.get(supabase);
  if (!registry) {
    registry = new Map();
    registries.set(supabase, registry);
  }
  return registry;
}

function topicFor(workspaceId: string): string {
  return `presence:workspace:${workspaceId}`;
}

export type WorkspacePresenceHandle = {
  /** Current online user ids, snapshot at the time this handle is returned. */
  onlineUserIds: Set<string>;
  /** Releases this subscriber's interest in the channel (ref-counted). */
  release: () => void;
  /**
   * Best-effort synchronous-ish untrack, for a `beforeunload` handler --
   * Supabase Presence already has its own server-side heartbeat/timeout
   * that removes a client whose socket just drops (tab killed, network
   * loss), so this is purely a "leave sooner than the default timeout in
   * the common orderly tab-close case" nicety, not the actual
   * correctness mechanism.
   */
  untrackNow: () => void;
};

/**
 * Acquires a shared, ref-counted Presence channel for `workspaceId` on
 * `supabase`, tracking `currentUserId` as present on this connection and
 * calling `onChange` with the full set of currently-online user ids
 * whenever Presence reports a sync/join/leave. Returns a handle whose
 * `release()` must be called from effect cleanup.
 */
export function acquireWorkspacePresence(
  supabase: SupabaseClient,
  workspaceId: string,
  currentUserId: string,
  onChange: (onlineUserIds: Set<string>) => void,
): WorkspacePresenceHandle {
  const topic = topicFor(workspaceId);
  const registry = registryFor(supabase);
  let entry = registry.get(topic);

  if (entry) {
    if (entry.removalTimer !== null) {
      clearTimeout(entry.removalTimer);
      entry.removalTimer = null;
    }
  } else {
    const listeners = new Set<(onlineUserIds: Set<string>) => void>();
    const newEntry: Entry = {
      channel: null as unknown as RealtimeChannel, // set below before use
      listeners,
      onlineUserIds: new Set<string>(),
      removalTimer: null,
    };

    // `config.presence.key` is what this client's own presence entry is
    // keyed under -- keying it by the user's own id means
    // `presenceState()` comes back keyed by user id across every client
    // subscribed to this topic, so "who's online" is just "the state's
    // keys", with no per-payload user-id bookkeeping needed.
    const channel = supabase.channel(topic, {
      config: { presence: { key: currentUserId } },
    });
    newEntry.channel = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresencePayload>();
      newEntry.onlineUserIds = new Set(Object.keys(state));
      newEntry.listeners.forEach((listener) => listener(newEntry.onlineUserIds));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          user_id: currentUserId,
          online_at: new Date().toISOString(),
        } satisfies PresencePayload);
      }
    });

    entry = newEntry;
    registry.set(topic, entry);
  }

  const liveEntry = entry;
  liveEntry.listeners.add(onChange);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    liveEntry.listeners.delete(onChange);
    if (liveEntry.listeners.size > 0) return;

    // Deferred teardown for the exact same reason
    // acquireSharedTopicChannel defers it -- see this file's header.
    liveEntry.removalTimer = setTimeout(() => {
      const stillCurrent = registry.get(topic) === liveEntry;
      if (stillCurrent && liveEntry.listeners.size === 0) {
        registry.delete(topic);
        void liveEntry.channel.untrack();
        void supabase.removeChannel(liveEntry.channel);
      }
    }, 0);
  };

  return {
    onlineUserIds: liveEntry.onlineUserIds,
    release,
    untrackNow: () => {
      void liveEntry.channel.untrack();
    },
  };
}
