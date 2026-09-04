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
  it("subscribes on a per-workspace channel, on the tasks table, for all events, with no row filter when no projectId is given (multi-project chooser page -- tasks has no workspace_id column to filter on)", () => {
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

  // F081: an unfiltered `postgres_changes` binding on `tasks` makes
  // Realtime RLS-recheck and ship every OTHER project's task writes in the
  // whole Supabase project to this client, just to have them discarded
  // client-side by the pending_client_approval/project-match predicate.
  // When the caller (the per-project portal shell) knows its projectId,
  // there is no reason to pay that cost -- assert the actual `filter`
  // string, not just that a filter object exists, so a future regression
  // that drops `filter` while keeping `event`/`schema`/`table` is caught.
  it("F081: subscribes with a project_id row filter, on a project-scoped channel, when projectId is given", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToPortalOverviewRealtime(
      supabase as never,
      "ws-1",
      onChange,
      "project-1",
    );

    expect(channelCalls).toEqual(["portal-overview:ws-1:project-1"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "tasks",
      filter: "project_id=eq.project-1",
    });
  });

  it("F081: two different projects in the same workspace get distinct, independently-filtered channels", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();

    subscribeToPortalOverviewRealtime(
      supabase as never,
      "ws-1",
      vi.fn(),
      "project-a",
    );
    subscribeToPortalOverviewRealtime(
      supabase as never,
      "ws-1",
      vi.fn(),
      "project-b",
    );

    expect(channelCalls).toEqual([
      "portal-overview:ws-1:project-a",
      "portal-overview:ws-1:project-b",
    ]);
    expect(onCalls[0].filter.filter).toBe("project_id=eq.project-a");
    expect(onCalls[1].filter.filter).toBe("project_id=eq.project-b");
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
