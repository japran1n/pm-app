// F049 (AS-076): unit tests for the board's Realtime wiring.
//
// What's practically verifiable in an automated, DOM-less unit test
// (vitest, environment: "node", no React Testing Library in this repo —
// see vitest.config.ts): the exact channel/table/filter/event
// configuration passed to the Supabase client (subscribeToBoardRealtime),
// and that the registered postgres_changes callback correctly forwards
// whatever payload it's invoked with to `onChange` (i.e. the subscription
// callback fires with the expected payload shape) — plus the pure
// reconciliation logic (reconcileTask) that decides how an incoming event
// changes the board's task list.
//
// What's NOT verified here, and why: true end-to-end Realtime delivery —
// inserting a row via a second client and asserting a *live* WebSocket
// message arrives at this subscription — requires two concurrent
// connections to the real (or local) Supabase Realtime server and is
// inherently timing-dependent (message delivery is typically sub-second
// but not deterministic), which makes it a flaky fit for a fast unit
// suite. That coverage is better suited to a Playwright/e2e-style test
// with two browser contexts (the pattern F090 already establishes for
// drag-and-drop) rather than vitest — see the handoff's "Out-of-scope
// work needed" for the concrete suggestion. What IS verified below is
// that the subscription is correctly configured (channel name, table
// filter, event types) and that once a payload arrives, this feature's
// code path (callback -> reconcileTask -> board state) behaves correctly
// for INSERT, UPDATE (move + soft-delete), and DELETE.

import { describe, expect, it, vi } from "vitest";

import { subscribeToBoardRealtime } from "@/lib/board/subscribe-board-realtime";
import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: BoardRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn((event: string, filter: Record<string, unknown>, callback: (payload: BoardRealtimeEvent) => void) => {
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

describe("subscribeToBoardRealtime (AS-076)", () => {
  it("subscribes on a per-project channel filtered to the tasks table and project_id, for all events", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToBoardRealtime(supabase as never, "project-123", onChange);

    expect(channelCalls).toEqual(["board:project-123"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].event).toBe("postgres_changes");
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "tasks",
      filter: "project_id=eq.project-123",
    });
  });

  it("forwards a received payload to onChange unchanged (payload shape)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToBoardRealtime(supabase as never, "project-123", onChange);

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", project_id: "project-123", status: "in_progress" },
      old: { id: "t1" },
    } as unknown as BoardRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown)", async () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToBoardRealtime(supabase as never, "project-123", vi.fn());
    unsubscribe();

    // F329: teardown is deferred one macrotask so a synchronous
    // StrictMode remount on the same topic can cancel it and reuse the
    // channel instead of racing subscribe()/on() against removeChannel().
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });

  it("scopes different projects to different channel names", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToBoardRealtime(supabase as never, "project-a", vi.fn());
    subscribeToBoardRealtime(supabase as never, "project-b", vi.fn());

    expect(channelCalls).toEqual(["board:project-a", "board:project-b"]);
  });
});

describe("reconcileTask (AS-076)", () => {
  const baseTasks: TaskCardTask[] = [
    { id: "t1", title: "Task 1", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 1000 },
    { id: "t2", title: "Task 2", status: "in_progress", priority: "high", assigneeId: null, dueDate: null, position: 1000 },
  ];

  function updateEvent(row: Partial<Record<string, unknown>> & { id: string }): BoardRealtimeEvent {
    return {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        project_id: "project-123",
        title: "Task",
        status: "todo",
        priority: null,
        assignee_id: null,
        due_date: null,
        position: 1000,
        deleted_at: null,
        ...row,
      },
      old: { id: row.id },
    } as unknown as BoardRealtimeEvent;
  }

  it("appends a new task on INSERT", () => {
    const event = {
      eventType: "INSERT",
      schema: "public",
      table: "tasks",
      new: {
        id: "t3",
        project_id: "project-123",
        title: "New task",
        status: "todo",
        priority: null,
        assignee_id: null,
        due_date: null,
        position: 2000,
        deleted_at: null,
      },
      old: {},
    } as unknown as BoardRealtimeEvent;

    const next = reconcileTask(baseTasks, event);

    expect(next).toHaveLength(3);
    expect(next.find((t) => t.id === "t3")).toEqual({
      id: "t3",
      title: "New task",
      status: "todo",
      priority: null,
      assigneeId: null,
      dueDate: null,
      position: 2000,
    });
  });

  it("moves a task to its new column/position on UPDATE", () => {
    const event = updateEvent({
      id: "t1",
      title: "Task 1",
      status: "done",
      position: 500,
    });

    const next = reconcileTask(baseTasks, event);

    const moved = next.find((t) => t.id === "t1");
    expect(moved?.status).toBe("done");
    expect(moved?.position).toBe(500);
    expect(next).toHaveLength(2);
  });

  it("removes a task whose UPDATE payload has deleted_at set (soft delete)", () => {
    const event = updateEvent({ id: "t1", deleted_at: "2026-08-18T00:00:00Z" });

    const next = reconcileTask(baseTasks, event);

    expect(next.find((t) => t.id === "t1")).toBeUndefined();
    expect(next).toHaveLength(1);
  });

  it("removes a task on DELETE", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t2" },
    } as unknown as BoardRealtimeEvent;

    const next = reconcileTask(baseTasks, event);

    expect(next).toEqual([baseTasks[0]]);
  });

  it("is a no-op when the DELETE payload has no old.id", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: {},
    } as unknown as BoardRealtimeEvent;

    const next = reconcileTask(baseTasks, event);

    expect(next).toEqual(baseTasks);
  });
});
