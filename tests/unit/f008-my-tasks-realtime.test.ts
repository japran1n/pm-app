// F008: unit tests for the My Tasks Realtime subscription wiring
// (components/my-tasks/use-my-tasks-realtime.ts). Same DOM-less
// `subscribeTo*Realtime` pattern as the board's own Realtime tests
// (tests/unit/board-realtime-subscription.test.ts) -- verifies the exact
// channel/table/filter configuration passed to the Supabase client and
// that the registered postgres_changes callback correctly reconciles the
// three event shapes (INSERT, UPDATE-status, UPDATE-unassign, DELETE)
// into the onInsert/onUpdate/onDelete callback contract.

import { describe, expect, it, vi } from "vitest";

import {
  subscribeToMyTasksRealtime,
  type MyTasksRealtimeEvent,
} from "@/components/my-tasks/use-my-tasks-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: MyTasksRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: MyTasksRealtimeEvent) => void,
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

describe("subscribeToMyTasksRealtime (AS-015, AS-016, AS-017, AS-018)", () => {
  it("subscribes on a per-user channel filtered to the tasks table and assignee_id, for all events", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(channelCalls).toEqual(["tasks:my-tasks:user-1"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].event).toBe("postgres_changes");
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "tasks",
      filter: "assignee_id=eq.user-1",
    });
  });

  it("AS-015: calls onInsert when an INSERT event arrives with matching assignee_id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onInsert = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const payload = {
      eventType: "INSERT",
      schema: "public",
      table: "tasks",
      new: { id: "t1", assignee_id: "user-1", title: "New task", status: "todo" },
      old: {},
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onInsert).toHaveBeenCalledExactlyOnceWith(payload.new);
  });

  it("AS-016: calls onUpdate when a status change UPDATE arrives with assignee_id unchanged", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onUpdate = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate,
      onDelete: vi.fn(),
    });

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", assignee_id: "user-1", title: "Task 1", status: "done" },
      old: { id: "t1", assignee_id: "user-1", status: "todo" },
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(payload.new);
  });

  it("AS-017 (failure test): calls onDelete when an UPDATE event sets assignee_id to null", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();
    const onUpdate = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate,
      onDelete,
    });

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", assignee_id: null, title: "Task 1", status: "todo" },
      old: { id: "t1", assignee_id: "user-1", status: "todo" },
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("t1");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("AS-017: calls onDelete when an UPDATE event re-assigns the task to a different user", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete,
    });

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", assignee_id: "user-2", title: "Task 1", status: "todo" },
      old: { id: "t1", assignee_id: "user-1", status: "todo" },
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("calls onDelete when a DELETE event arrives", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete,
    });

    const payload = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t1" },
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("AS-018: scopes different users to different channels/topics (no cross-user leakage at the subscription level)", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });
    subscribeToMyTasksRealtime(supabase as never, "user-2", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(channelCalls).toEqual(["tasks:my-tasks:user-1", "tasks:my-tasks:user-2"]);
  });

  it("validates payload shape: drops an INSERT/UPDATE event whose new record has no id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onInsert = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", { onInsert, onUpdate, onDelete });

    const malformedInsert = {
      eventType: "INSERT",
      schema: "public",
      table: "tasks",
      new: { assignee_id: "user-1" },
      old: {},
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(malformedInsert);

    expect(onInsert).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("validates payload shape: drops a DELETE event whose old record has no id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete,
    });

    const malformedDelete = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: {},
    } as unknown as MyTasksRealtimeEvent;

    onCalls[0].callback(malformedDelete);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown, F329 pattern)", async () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});
