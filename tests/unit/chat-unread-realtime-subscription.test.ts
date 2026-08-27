// F5 (docs/advanced-chat-plan.md): unit tests for the workspace-wide
// unread-count Realtime wiring -- a new message in ANY of the caller's
// channels should surface as a `{ channelId }` event without a filter
// scoping the subscription to one channel (RLS is what actually limits
// what's delivered; see subscribe-unread-realtime.ts's doc comment).
// Mirrors tests/unit/chat-messages-realtime-subscription.test.ts's (F3)
// shape.

import { describe, expect, it, vi } from "vitest";

import { subscribeToChatUnreadRealtime } from "@/lib/chat/subscribe-unread-realtime";

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

describe("subscribeToChatUnreadRealtime (F5)", () => {
  it("test_AS_unread_subscribes_on_a_workspace_scoped_topic_without_a_channel_id_filter", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();

    subscribeToChatUnreadRealtime(supabase as never, "workspace-1", vi.fn());

    expect(channelCalls).toEqual(["chat:unread:workspace-1"]);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    );
    expect(insertCall?.filter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "messages",
    });
  });

  it("test_AS_unread_forwards_a_new_message_insert_as_a_channelId_event", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatUnreadRealtime(supabase as never, "workspace-1", onEvent);

    const insertCall = onCalls.find(
      (c) => c.event === "postgres_changes",
    )!;
    insertCall.callback({ new: { channel_id: "chan-9" } });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ channelId: "chan-9" });
  });

  it("ignores a payload missing channel_id (no onEvent call)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onEvent = vi.fn();

    subscribeToChatUnreadRealtime(supabase as never, "workspace-1", onEvent);

    const insertCall = onCalls.find(
      (c) => c.event === "postgres_changes",
    )!;
    insertCall.callback({ new: {} });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("scopes different workspaces to different topic names", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToChatUnreadRealtime(supabase as never, "workspace-a", vi.fn());
    subscribeToChatUnreadRealtime(supabase as never, "workspace-b", vi.fn());

    expect(channelCalls).toEqual([
      "chat:unread:workspace-a",
      "chat:unread:workspace-b",
    ]);
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown)", async () => {
    const { supabase, removedChannels, channelObject } =
      createMockSupabaseClient();

    const unsubscribe = subscribeToChatUnreadRealtime(
      supabase as never,
      "workspace-1",
      vi.fn(),
    );
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});
