// F209 (AS-388): unit tests for the notification-inbox Realtime wiring —
// the unread count updates live without a reload.
//
// Mirrors tests/unit/reactions-realtime-subscription.test.ts's (F202)
// shape: this repo's vitest config runs with environment: "node" (no
// React Testing Library), so what's verified here is (1) the exact
// channel/table/event/filter configuration passed to the Supabase client
// (subscribeToNotificationsRealtime), including the SUBSCRIPTION-LEVEL
// `user_id=eq.<userId>` filter this feature's clarified Notes require
// (not just RLS + a client-side filter after delivery), and (2) that its
// registered postgres_changes callback translates an INSERT payload into
// the flat NotificationInsertEvent shape, ignoring malformed payloads.

import { describe, expect, it, vi } from "vitest";

import { subscribeToNotificationsRealtime } from "@/lib/notifications/subscribe-notifications-realtime";

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

describe("subscribeToNotificationsRealtime (AS-388)", () => {
  it("test_AS_388_subscribes_on_a_per_user_channel_with_a_subscription_level_user_id_filter", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onInsert = vi.fn();

    subscribeToNotificationsRealtime(supabase as never, "user-123", onInsert);

    expect(channelCalls).toEqual(["notifications:user-123"]);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    );
    expect(insertCall).toBeDefined();
    // AS-388's clarified Notes: user-scoped AT THE SUBSCRIPTION LEVEL, not
    // just RLS + client-side filtering after delivery.
    expect(insertCall?.filter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "notifications",
      filter: "user_id=eq.user-123",
    });
  });

  it("test_AS_388_forwards_an_INSERT_payload_as_a_flat_notification_insert_event", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onInsert = vi.fn();

    subscribeToNotificationsRealtime(supabase as never, "user-123", onInsert);

    const insertCall = onCalls.find(
      (c) => c.event === "postgres_changes",
    )!;

    insertCall.callback({
      new: {
        id: "n1",
        user_id: "user-123",
        workspace_id: "w1",
        kind: "task_assigned",
        created_at: "2026-08-23T00:00:00.000Z",
      },
    });

    expect(onInsert).toHaveBeenCalledExactlyOnceWith({
      id: "n1",
      userId: "user-123",
      workspaceId: "w1",
      kind: "task_assigned",
      createdAt: "2026-08-23T00:00:00.000Z",
    });
  });

  it("ignores an INSERT payload missing required fields (no onInsert call)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onInsert = vi.fn();

    subscribeToNotificationsRealtime(supabase as never, "user-123", onInsert);

    const insertCall = onCalls.find(
      (c) => c.event === "postgres_changes",
    )!;

    insertCall.callback({ new: { id: "n1", user_id: "user-123" } });

    expect(onInsert).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that removes the channel", () => {
    const { supabase, removedChannels, channelObject } =
      createMockSupabaseClient();

    const unsubscribe = subscribeToNotificationsRealtime(
      supabase as never,
      "user-123",
      vi.fn(),
    );
    unsubscribe();

    expect(removedChannels).toEqual([channelObject]);
  });

  it("scopes different users to different channel names and filters", () => {
    const { supabase, channelCalls, onCalls } = createMockSupabaseClient();

    subscribeToNotificationsRealtime(supabase as never, "user-a", vi.fn());
    subscribeToNotificationsRealtime(supabase as never, "user-b", vi.fn());

    expect(channelCalls).toEqual([
      "notifications:user-a",
      "notifications:user-b",
    ]);
    expect(
      onCalls.map((c) => (c.filter as { filter?: string }).filter),
    ).toEqual(["user_id=eq.user-a", "user_id=eq.user-b"]);
  });
});
