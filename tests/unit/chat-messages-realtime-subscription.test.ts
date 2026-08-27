// F3 (docs/advanced-chat-plan.md): unit tests for the per-channel chat
// message Realtime wiring -- messages appear live in every open client
// without a reload, and a soft-deleted/edited message's UPDATE also
// arrives live (so a "Message deleted" placeholder can render instead of
// the row disappearing abruptly).
//
// Mirrors tests/unit/notifications-realtime-subscription.test.ts's (F209)
// shape: verifies (1) the exact channel/table/event/filter configuration
// passed to the Supabase client, scoped to a single channel via
// `channel_id=eq.<channelId>` at the SUBSCRIPTION level, and (2) that
// INSERT/UPDATE payloads translate into the flat event shape, ignoring
// malformed payloads.

import { describe, expect, it, vi } from "vitest";

import { subscribeToChatMessagesRealtime } from "@/lib/chat/subscribe-messages-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: unknown) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: unknown) => void,
      ) => {
        onCalls.push({ event, filter, callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };

  const supabase = {
    channel: vi.fn((name: string) => {
      channelCalls.push(name);
      return channelObject;
    }),
    removeChannel: vi.fn((ch: unknown) => {
      removedChannels.push(ch);
    }),
  };

  return { supabase, onCalls, channelCalls, removedChannels, channelObject };
}

const rawRow = {
  id: "m1",
  channel_id: "chan-1",
  sender_id: "user-1",
  body_json: { type: "doc", content: [] },
  parent_message_id: null,
  edited_at: null,
  deleted_at: null,
  created_at: "2026-08-27T00:00:00.000Z",
};

describe("subscribeToChatMessagesRealtime (F3)", () => {
  it("test_F3_subscribes_on_a_per_channel_topic_with_a_subscription_level_channel_id_filter", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatMessagesRealtime(supabase as never, "chan-1", onEvent);

    expect(channelCalls).toEqual(["chat:messages:chan-1"]);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    );
    expect(insertCall?.filter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: "channel_id=eq.chan-1",
    });

    const updateCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "UPDATE",
    );
    expect(updateCall?.filter).toEqual({
      event: "UPDATE",
      schema: "public",
      table: "messages",
      filter: "channel_id=eq.chan-1",
    });
  });

  it("test_F3_forwards_an_INSERT_payload_as_a_flat_message_insert_event", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatMessagesRealtime(supabase as never, "chan-1", onEvent);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    )!;

    insertCall.callback({ new: rawRow });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: "insert",
      message: {
        id: "m1",
        channelId: "chan-1",
        senderId: "user-1",
        bodyJson: { type: "doc", content: [] },
        parentMessageId: null,
        editedAt: null,
        deletedAt: null,
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    });
  });

  it("test_F3_forwards_an_UPDATE_payload_so_a_soft_deleted_message_can_render_a_placeholder_live", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatMessagesRealtime(supabase as never, "chan-1", onEvent);

    const updateCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "UPDATE",
    )!;

    updateCall.callback({
      new: { ...rawRow, deleted_at: "2026-08-27T00:05:00.000Z" },
    });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: "update",
      message: expect.objectContaining({
        id: "m1",
        deletedAt: "2026-08-27T00:05:00.000Z",
      }),
    });
  });

  it("ignores a payload missing required fields (no onEvent call)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatMessagesRealtime(supabase as never, "chan-1", onEvent);

    const insertCall = onCalls.find(
      (c) => c.event === "postgres_changes",
    )!;

    insertCall.callback({ new: { id: "m1" } });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("scopes different channels to different topic names and filters", () => {
    const { supabase, channelCalls, onCalls } = createMockSupabaseClient();

    subscribeToChatMessagesRealtime(supabase as never, "chan-a", vi.fn());
    subscribeToChatMessagesRealtime(supabase as never, "chan-b", vi.fn());

    expect(channelCalls).toEqual([
      "chat:messages:chan-a",
      "chat:messages:chan-b",
    ]);
    expect(
      onCalls
        .filter((c) => (c.filter as { event?: string }).event === "INSERT")
        .map((c) => (c.filter as { filter?: string }).filter),
    ).toEqual(["channel_id=eq.chan-a", "channel_id=eq.chan-b"]);
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown)", async () => {
    const { supabase, removedChannels, channelObject } =
      createMockSupabaseClient();

    const unsubscribe = subscribeToChatMessagesRealtime(
      supabase as never,
      "chan-1",
      vi.fn(),
    );
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});
