// F329: a Supabase Realtime client double that faithfully models the
// state machine that actually caused the production crash — unlike the
// hand-built fakes used elsewhere in this repo's realtime unit tests
// (whose `.on()` never throws and whose channel has no state at all, so a
// StrictMode-style remount collision is unrepresentable in them).
//
// Modeled directly off the installed @supabase/realtime-js source
// (node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js
// `channel()`, and RealtimeChannel.js `on()`):
//
// - `channel(topic)` DEDUPES by topic: if a channel for that exact topic
//   string is still registered on the client, the SAME object is
//   returned instead of a new one.
// - `.on(...)` THROWS if the channel is already joined or joining —
//   `cannot add \`postgres_changes\` callbacks for realtime:<topic> after
//   \`subscribe()\`.` — matching the exact production error message.
// - `.subscribe()` marks the channel joined (synchronously, for test
//   simplicity — real joins are async over the wire, but the crash this
//   feature fixes only depends on the "already joined" state existing by
//   the time a remount's `.on()` runs, which is true either way).
// - `removeChannel` is ASYNC: it awaits the channel's own async
//   `unsubscribe()` before deregistering it from the client's channel
//   list. This is the actual mechanism that makes the StrictMode
//   mount -> cleanup -> mount sequence dangerous: a cleanup that doesn't
//   await `removeChannel` lets a synchronous remount's `channel(topic)`
//   observe the OLD, still-joined channel and crash on `.on()`.
import { vi } from "vitest";

export class FaithfulFakeChannel {
  topic: string;
  private _joined = false;
  private _joining = false;
  onCalls: Array<{ type: string; filter: unknown; callback: (...args: unknown[]) => void }> = [];

  constructor(topic: string) {
    this.topic = topic;
  }

  on(type: string, filter: unknown, callback: (...args: unknown[]) => void) {
    const typeCheck = type === "presence" || type === "postgres_changes";
    if ((this._joined || this._joining) && typeCheck) {
      throw new Error(
        `cannot add \`${type}\` callbacks for realtime:${this.topic} after \`subscribe()\`.`,
      );
    }
    this.onCalls.push({ type, filter, callback });
    return this;
  }

  subscribe() {
    this._joining = true;
    // Real subscribe() joins asynchronously over the wire; tests that
    // need "already joined" synchronously (matching the production
    // failure window) call `.markJoined()` directly, mirroring how a real
    // channel is joined by the time a synchronous StrictMode remount's
    // `.on()` call would observe it.
    this._joined = true;
    this._joining = false;
    return this;
  }

  // Faithful to RealtimeChannel.unsubscribe() being asynchronous over the
  // wire (a `leave` push + server ack), not instantaneous.
  async unsubscribe() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    this._joined = false;
    return "ok";
  }
}

export function createFaithfulSupabaseClient() {
  const channels: FaithfulFakeChannel[] = [];
  const removeChannelCalls: FaithfulFakeChannel[] = [];

  const supabase = {
    channel: vi.fn((topic: string) => {
      const existing = channels.find((c) => c.topic === topic);
      if (existing) return existing;
      const chan = new FaithfulFakeChannel(topic);
      channels.push(chan);
      return chan;
    }),
    // Faithful to RealtimeClient.removeChannel: awaits unsubscribe()
    // before deregistering the channel from the client's channel list.
    removeChannel: vi.fn(async (channel: FaithfulFakeChannel) => {
      const status = await channel.unsubscribe();
      if (status === "ok") {
        const idx = channels.indexOf(channel);
        if (idx !== -1) channels.splice(idx, 1);
      }
      removeChannelCalls.push(channel);
      return status;
    }),
  };

  return { supabase, channels, removeChannelCalls };
}
