// F221 (AS-413): unit tests for the board's COLUMNS Realtime wiring —
// mirrors tests/unit/board-realtime-subscription.test.ts's established
// pattern exactly (subscription configuration + the pure reconciliation
// reducer), for the sibling `project_statuses` channel instead of `tasks`.

import { describe, expect, it, vi } from "vitest";

import { subscribeToBoardColumnsRealtime } from "@/lib/board/subscribe-board-columns-realtime";
import { reconcileColumn } from "@/lib/board/reconcile-realtime-column";
import type { BoardColumnDef } from "@/lib/queries/statuses";
import type { BoardColumnsRealtimeEvent } from "@/lib/board/subscribe-board-columns-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: BoardColumnsRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn((event: string, filter: Record<string, unknown>, callback: (payload: BoardColumnsRealtimeEvent) => void) => {
      onCalls.push({ event, filter, callback });
      return channelObject;
    }),
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

describe("subscribeToBoardColumnsRealtime (AS-413)", () => {
  it("subscribes on a per-project channel filtered to the project_statuses table and project_id, for all events", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToBoardColumnsRealtime(supabase as never, "project-123", onChange);

    expect(channelCalls).toEqual(["board-columns:project-123"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].event).toBe("postgres_changes");
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "project_statuses",
      filter: "project_id=eq.project-123",
    });
  });

  it("scopes different projects to different channel names, so one board never subscribes to another project's column events (anti-leak boundary)", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToBoardColumnsRealtime(supabase as never, "project-a", vi.fn());
    subscribeToBoardColumnsRealtime(supabase as never, "project-b", vi.fn());

    expect(channelCalls).toEqual([
      "board-columns:project-a",
      "board-columns:project-b",
    ]);
  });

  it("forwards a received payload to onChange unchanged", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToBoardColumnsRealtime(supabase as never, "project-123", onChange);

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "project_statuses",
      new: { id: "c1", project_id: "project-123", name: "Blocked" },
      old: { id: "c1" },
    } as unknown as BoardColumnsRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown)", async () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToBoardColumnsRealtime(
      supabase as never,
      "project-123",
      vi.fn(),
    );
    unsubscribe();

    // F329: teardown is deferred one macrotask so a synchronous
    // StrictMode remount on the same topic can cancel it and reuse the
    // channel instead of racing subscribe()/on() against removeChannel().
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});

describe("reconcileColumn (AS-413, AS-416)", () => {
  const baseColumns: BoardColumnDef[] = [
    { id: "c1", name: "todo", color: "#94a3b8", category: "not_started", position: 1000 },
    { id: "c2", name: "in_progress", color: "#3b82f6", category: "in_progress", position: 2000 },
  ];

  it("appends a new column on INSERT", () => {
    const event = {
      eventType: "INSERT",
      schema: "public",
      table: "project_statuses",
      new: { id: "c3", project_id: "p1", name: "Blocked", color: "#ef4444", category: "in_progress", position: 1500 },
      old: {},
    } as unknown as BoardColumnsRealtimeEvent;

    const next = reconcileColumn(baseColumns, event);

    expect(next).toHaveLength(3);
    expect(next.find((c) => c.id === "c3")).toEqual({
      id: "c3",
      name: "Blocked",
      color: "#ef4444",
      category: "in_progress",
      position: 1500,
    });
    // Original array untouched (pure function).
    expect(baseColumns).toHaveLength(2);
  });

  it("replaces a column in place on UPDATE (rename/recolor/reorder all arrive as this same shape)", () => {
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "project_statuses",
      new: { id: "c1", project_id: "p1", name: "Backlog", color: "#94a3b8", category: "not_started", position: 500 },
      old: { id: "c1" },
    } as unknown as BoardColumnsRealtimeEvent;

    const next = reconcileColumn(baseColumns, event);

    expect(next).toHaveLength(2);
    const updated = next.find((c) => c.id === "c1");
    expect(updated?.name).toBe("Backlog");
    expect(updated?.position).toBe(500);
    // The other column is untouched.
    expect(next.find((c) => c.id === "c2")).toEqual(baseColumns[1]);
  });

  it("removes a column on DELETE", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "project_statuses",
      new: {},
      old: { id: "c2" },
    } as unknown as BoardColumnsRealtimeEvent;

    const next = reconcileColumn(baseColumns, event);

    expect(next).toEqual([baseColumns[0]]);
  });

  it("is a no-op when the DELETE payload has no old.id (would otherwise be a false-positive removal)", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "project_statuses",
      new: {},
      old: {},
    } as unknown as BoardColumnsRealtimeEvent;

    const next = reconcileColumn(baseColumns, event);

    expect(next).toEqual(baseColumns);
  });
});
