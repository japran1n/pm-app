// F6 (docs/advanced-chat-plan.md): unit tests for the typing indicator's
// Broadcast channel wiring -- verifies (1) it uses Supabase Broadcast, NOT
// `postgres_changes` on any table (F6's acceptance: a typing event never
// writes a row to the database), (2) events are scoped per-channel by
// topic, (3) sending reuses the subscribed channel object, and (4)
// sending before any subscribe exists is a safe no-op rather than a
// throw.
//
// Mirrors tests/unit/chat-messages-realtime-subscription.test.ts's mock
// Supabase client shape.

import { describe, expect, it, vi } from "vitest";

import {
  sendTypingBroadcast,
  subscribeToTypingBroadcast,
} from "@/lib/realtime/chat-typing-channel";

function createMockSupabaseClient() {
  const channelCalls: { name: string; config: unknown }[] = [];
  const onCalls: { event: string; filter: Record<string, unknown>; callback: (p: unknown) => void }[] = [];
  const sendCalls: unknown[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn((event: string, filter: Record<string, unknown>, callback: (p: unknown) => void) => {
      onCalls.push({ event, filter, callback });
      return channelObject;
    }),
    subscribe: vi.fn(() => channelObject),
    send: vi.fn((payload: unknown) => {
      sendCalls.push(payload);
      return Promise.resolve("ok");
    }),
  };

  const supabase = {
    channel: vi.fn((name: string, config: unknown) => {
      channelCalls.push({ name, config });
      return channelObject;
    }),
    removeChannel: vi.fn((ch: unknown) => {
      removedChannels.push(ch);
    }),
  };

  return { supabase, channelCalls, onCalls, sendCalls, removedChannels, channelObject };
}

describe("chat typing channel (F6)", () => {
  it("test_F6_subscribes_via_broadcast_never_postgres_changes", () => {
    const { supabase, channelCalls, onCalls } = createMockSupabaseClient();

    subscribeToTypingBroadcast(supabase as never, "chan-1", vi.fn());

    expect(channelCalls).toEqual([
      { name: "chat:typing:chan-1", config: { config: { broadcast: { self: false } } } },
    ]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0]!.event).toBe("broadcast");
    expect(onCalls[0]!.filter).toEqual({ event: "typing" });
    // Never subscribes to postgres_changes / a table -- no DB row is ever
    // written by this feature.
    expect(onCalls.some((c) => c.event === "postgres_changes")).toBe(false);
  });

  it("test_F6_scopes_different_channels_to_different_typing_topics", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToTypingBroadcast(supabase as never, "chan-a", vi.fn());
    subscribeToTypingBroadcast(supabase as never, "chan-b", vi.fn());

    expect(channelCalls.map((c) => c.name)).toEqual([
      "chat:typing:chan-a",
      "chat:typing:chan-b",
    ]);
  });

  it("test_F6_forwards_a_broadcast_payload_to_the_listener", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToTypingBroadcast(supabase as never, "chan-1", onEvent);
    onCalls[0]!.callback({ payload: { userId: "u1", name: "Marko" } });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ userId: "u1", name: "Marko" });
  });

  it("test_F6_sendTypingBroadcast_reuses_the_subscribed_channel_and_never_touches_the_db", () => {
    const { supabase, sendCalls } = createMockSupabaseClient();

    subscribeToTypingBroadcast(supabase as never, "chan-1", vi.fn());
    sendTypingBroadcast(supabase as never, "chan-1", { userId: "u1", name: "Marko" });

    expect(sendCalls).toEqual([
      { type: "broadcast", event: "typing", payload: { userId: "u1", name: "Marko" } },
    ]);
    // No insert/update/table interaction of any kind is available on this
    // mock client, and none was called -- send() is the only surface used.
  });

  it("test_F6_sendTypingBroadcast_is_a_safe_no_op_before_any_subscribe", () => {
    const { supabase, channelObject } = createMockSupabaseClient();

    expect(() =>
      sendTypingBroadcast(supabase as never, "chan-never-subscribed", {
        userId: "u1",
        name: "Marko",
      }),
    ).not.toThrow();
    expect(channelObject.send).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown)", async () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToTypingBroadcast(supabase as never, "chan-1", vi.fn());
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});
