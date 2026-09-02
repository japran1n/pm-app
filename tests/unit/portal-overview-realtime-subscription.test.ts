// F008 (AS-024): unit tests for the portal overview's Realtime channel
// wiring, mirroring tests/unit/board-realtime-subscription.test.ts's
// mock-Supabase-client shape (this repo's vitest environment is "node",
// no DOM here -- see vitest.config.ts).

import { describe, expect, it, vi } from "vitest";

import { subscribeToPortalOverviewRealtime } from "@/lib/portal/subscribe-portal-overview-realtime";
import type { PortalOverviewRealtimeEvent } from "@/lib/portal/subscribe-portal-overview-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: PortalOverviewRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: PortalOverviewRealtimeEvent) => void,
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

describe("subscribeToPortalOverviewRealtime (AS-024)", () => {
  it("subscribes on a per-workspace channel, on the tasks table, for all events, with no row filter", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToPortalOverviewRealtime(supabase as never, "ws-1", onChange);

    expect(channelCalls).toEqual(["portal-overview:ws-1"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].event).toBe("postgres_changes");
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "tasks",
    });
  });

  it("forwards a received payload to onChange unchanged", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToPortalOverviewRealtime(supabase as never, "ws-1", onChange);

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", pending_client_approval: false },
      old: { id: "t1" },
    } as unknown as PortalOverviewRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown) -- AS-024", async () => {
    const { supabase, removedChannels, channelObject } =
      createMockSupabaseClient();

    const unsubscribe = subscribeToPortalOverviewRealtime(
      supabase as never,
      "ws-1",
      vi.fn(),
    );
    unsubscribe();

    // F329: teardown is deferred one macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });

  it("does NOT remove the channel if unsubscribe is never called -- proves teardown is real, not a no-op", async () => {
    const { supabase, removedChannels } = createMockSupabaseClient();

    subscribeToPortalOverviewRealtime(supabase as never, "ws-1", vi.fn());

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([]);
  });

  it("scopes different workspaces to different channel names", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToPortalOverviewRealtime(supabase as never, "ws-a", vi.fn());
    subscribeToPortalOverviewRealtime(supabase as never, "ws-b", vi.fn());

    expect(channelCalls).toEqual([
      "portal-overview:ws-a",
      "portal-overview:ws-b",
    ]);
  });
});
