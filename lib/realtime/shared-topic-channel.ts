// F329: shared, ref-counted Realtime channel acquisition, used by every
// `subscribe*Realtime` module in this repo (notifications, comments,
// comment_reactions, board tasks, board columns) to fix a crash that hit
// EVERY `/w/*` page in development:
//
//   cannot add `postgres_changes` callbacks for realtime:<topic> after
//   `subscribe()`.
//
// Root cause (verified by reading the installed @supabase/realtime-js
// source, not assumed): `RealtimeClient.channel(topic)` dedupes by topic —
// if a `RealtimeChannel` for that exact topic string already exists on the
// client, `channel()` returns the SAME object instead of creating a new
// one (node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js,
// `channel()`). Calling `.on(...)` on a channel that is already
// joined/joining throws (`RealtimeChannel.on()`, same package). The
// browser Supabase client returned by `createClient()`
// (lib/supabase/client.ts, `@supabase/ssr`'s `createBrowserClient`) is
// itself a module-level singleton in the browser
// (node_modules/@supabase/ssr/dist/main/createBrowserClient.js,
// `cachedBrowserClient`) — so its underlying `RealtimeClient` and its
// `channels` array persist across every React remount, not just across
// re-renders of one component instance.
//
// Every one of this repo's `subscribe*Realtime` functions previously
// called `supabase.channel(topic).on(...).subscribe()` on mount and
// `void supabase.removeChannel(channel)` (NOT awaited) on cleanup. React
// StrictMode (dev only) double-invokes effects synchronously — mount,
// cleanup, mount — all in the same tick, before `removeChannel`'s async
// `channel.unsubscribe()` has resolved and removed the channel from the
// client's `channels` array. The second mount's `channel(topic)` call
// therefore finds the still-registered (still joined) channel from the
// first mount and reuses it; `.on(...)` on that reused, already-subscribed
// channel then throws. This is fully reproducible on every workspace page
// because `AppSidebar` (rendered by every `/w/*` layout) mounts
// `useNotificationsRealtime`.
//
// Fix: never call `.channel(topic)` / `.on(...)` / `.subscribe()` a
// second time for a topic that's already live. This module keeps a
// ref-counted registry of live channels PER SUPABASE CLIENT INSTANCE
// (a `WeakMap<SupabaseClient, Map<topic, Entry>>` — the browser client is
// a singleton per the above, so this correctly models "one live channel
// per topic for the app's lifetime," while still letting tests use fresh
// mock clients per test without cross-test pollution, since each mock is
// its own WeakMap key).
//
// - First subscriber for a topic: creates the channel, wires ALL `.on(...)`
//   handlers exactly once (dispatching to a `Set` of callbacks owned by
//   this module, not to the caller's callback directly), and calls
//   `.subscribe()`.
// - Any later subscriber for the same still-live topic: does NOT touch
//   `.on()`/`.subscribe()` at all — it just adds its callback to the
//   `Set` and reuses the existing channel.
// - On release: if a topic's callback `Set` becomes empty, teardown
//   (`supabase.removeChannel`) is deferred one macrotask (`setTimeout(0)`)
//   instead of firing immediately. A StrictMode remount re-subscribes to
//   the same topic SYNCHRONOUSLY, in the same tick as the cleanup that
//   just emptied the `Set` — so by the time the deferred teardown's
//   callback runs, the `Set` is non-empty again (or the registry no
//   longer points at this now-stale entry at all) and teardown is
//   skipped, exactly reusing the channel a genuine remount needs. A real
//   unmount (no synchronous remount) lets the timer fire and tears the
//   channel down as before.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Entry<TEvent> = {
  channel: RealtimeChannel;
  listeners: Set<(event: TEvent) => void>;
  removalTimer: ReturnType<typeof setTimeout> | null;
};

// Keyed by the Supabase client instance so distinct clients (e.g. a fresh
// mock per unit test) never share state, while the real singleton browser
// client naturally gets one shared map for the app's lifetime.
const registries = new WeakMap<SupabaseClient, Map<string, Entry<unknown>>>();

function registryFor(supabase: SupabaseClient): Map<string, Entry<unknown>> {
  let registry = registries.get(supabase);
  if (!registry) {
    registry = new Map();
    registries.set(supabase, registry);
  }
  return registry;
}

/**
 * Acquires a shared, ref-counted Realtime channel for `topic` on
 * `supabase`. `buildChannel(dispatch)` is called AT MOST ONCE per topic,
 * for as long as at least one subscriber is attached — it must call
 * `supabase.channel(topic)`, wire every `.on(...)` handler so that it
 * forwards its payload through `dispatch`, call `.subscribe()`, and
 * return the resulting channel. `onEvent` is this caller's own callback;
 * it's added to the topic's listener set and is called for every event
 * `dispatch` forwards, for as long as this subscription is live.
 *
 * Returns a `release()` function — call it from your effect cleanup (or
 * equivalent). Actual teardown is deferred; see the module doc comment
 * above for why.
 */
export function acquireSharedTopicChannel<TEvent>(
  supabase: SupabaseClient,
  topic: string,
  buildChannel: (dispatch: (event: TEvent) => void) => RealtimeChannel,
  onEvent: (event: TEvent) => void,
): () => void {
  const registry = registryFor(supabase);
  let entry = registry.get(topic) as Entry<TEvent> | undefined;

  if (entry) {
    if (entry.removalTimer !== null) {
      clearTimeout(entry.removalTimer);
      entry.removalTimer = null;
    }
  } else {
    const listeners = new Set<(event: TEvent) => void>();
    const channel = buildChannel((event) => {
      listeners.forEach((listener) => listener(event));
    });
    entry = { channel, listeners, removalTimer: null };
    registry.set(topic, entry as Entry<unknown>);
  }

  entry.listeners.add(onEvent);

  const liveEntry = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    liveEntry.listeners.delete(onEvent);
    if (liveEntry.listeners.size > 0) return;

    liveEntry.removalTimer = setTimeout(() => {
      const stillCurrent = registry.get(topic) === liveEntry;
      if (stillCurrent && liveEntry.listeners.size === 0) {
        registry.delete(topic);
        void supabase.removeChannel(liveEntry.channel);
      }
    }, 0);
  };
}
