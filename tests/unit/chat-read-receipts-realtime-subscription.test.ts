// Read receipts: unit tests for the per-channel `channel_members` UPDATE
// Realtime wiring. Mirrors tests/unit/chat-unread-realtime-subscription.test.ts's
// (F5) shape.

import { describe, expect, it, vi } from "vitest";

import { subscribeToChatReadReceiptsRealtime } from "@/lib/chat/subscribe-read-receipts-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: unknown) => void;
  }> = [];
  const channelCalls: string[] = [];

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
    removeChannel: vi.fn(() => {}),
  };

  return { supabase, onCalls, channelCalls, channelObject };
}

describe("subscribeToChatReadReceiptsRealtime", () => {
  it("test_read_receipts_subscribes_on_a_channel_scoped_topic_with_channel_id_filter", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();

    subscribeToChatReadReceiptsRealtime(supabase as never, "chan-1", vi.fn());

    expect(channelCalls).toEqual(["chat:read-receipts:chan-1"]);

    const updateCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "UPDATE",
    );
    expect(updateCall?.filter).toEqual({
      event: "UPDATE",
      schema: "public",
      table: "channel_members",
      filter: "channel_id=eq.chan-1",
    });
  });

  it("test_read_receipts_forwards_a_last_read_at_update_as_a_userId_event", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatReadReceiptsRealtime(supabase as never, "chan-1", onEvent);

    const updateCall = onCalls.find((c) => c.event === "postgres_changes")!;
    updateCall.callback({
      new: { channel_id: "chan-1", user_id: "user-9", last_read_at: "2026-09-07T00:00:00.000Z" },
    });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      userId: "user-9",
      lastReadAt: "2026-09-07T00:00:00.000Z",
    });
  });

  it("test_read_receipts_ignores_a_payload_missing_a_user_id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatReadReceiptsRealtime(supabase as never, "chan-1", onEvent);

    const updateCall = onCalls.find((c) => c.event === "postgres_changes")!;
    updateCall.callback({ new: { channel_id: "chan-1" } });

    expect(onEvent).not.toHaveBeenCalled();
  });
});
