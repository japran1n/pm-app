// F008/F025: unit tests for the My Tasks Realtime subscription wiring
// (components/my-tasks/use-my-tasks-realtime.ts). Same DOM-less
// `subscribeTo*Realtime` pattern as the board's own Realtime tests
// (tests/unit/board-realtime-subscription.test.ts) -- verifies the exact
// channel/table configuration passed to the Supabase client and that the
// registered postgres_changes callbacks correctly reconcile
// task_assignees INSERT/DELETE and tasks UPDATE/DELETE into the
// onAssigned/onUnassigned/onUpdate/onDelete callback contract.
//
// F025: `tasks.assignee_id` is DEPRECATED -- assignment now flows through
// the `task_assignees` join table (see
// supabase/migrations/20260822020000_task_assignees_table.sql). This
// suite replaces F008's original assertions (which pinned the buggy
// `assignee_id=eq.<userId>` row filter on `tasks`) with coverage of the
// two-table, no-row-filter subscription.

import { describe, expect, it, vi } from "vitest";

import {
  subscribeToMyTasksRealtime,
  type MyTasksRealtimeAssigneeEvent,
  type MyTasksRealtimeTaskEvent,
} from "@/components/my-tasks/use-my-tasks-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: MyTasksRealtimeTaskEvent | MyTasksRealtimeAssigneeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: MyTasksRealtimeTaskEvent | MyTasksRealtimeAssigneeEvent) => void,
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

function callbackFor(
  onCalls: ReturnType<typeof createMockSupabaseClient>["onCalls"],
  table: string,
) {
  const entry = onCalls.find((c) => c.filter.table === table);
  if (!entry) throw new Error(`no .on() registered for table ${table}`);
  return entry.callback;
}

describe("subscribeToMyTasksRealtime (AS-015, AS-016, AS-017, AS-018)", () => {
  it("subscribes on a per-user channel to task_assignees and tasks, with no row filter", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(channelCalls).toEqual(["tasks:my-tasks:user-1"]);
    expect(onCalls).toHaveLength(2);

    const assigneesCall = onCalls.find((c) => c.filter.table === "task_assignees");
    expect(assigneesCall?.filter).toEqual({
      event: "*",
      schema: "public",
      table: "task_assignees",
    });
    expect(assigneesCall?.filter.filter).toBeUndefined();

    const tasksCall = onCalls.find((c) => c.filter.table === "tasks");
    expect(tasksCall?.filter).toEqual({
      event: "*",
      schema: "public",
      table: "tasks",
    });
    expect(tasksCall?.filter.filter).toBeUndefined();
  });

  it("AS-015: calls onAssigned when a task_assignees row is INSERTed for this user", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onAssigned = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned,
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const payload = {
      eventType: "INSERT",
      schema: "public",
      table: "task_assignees",
      new: { task_id: "t1", user_id: "user-1" },
      old: {},
    } as unknown as MyTasksRealtimeAssigneeEvent;

    callbackFor(onCalls, "task_assignees")(payload);

    expect(onAssigned).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("does not call onAssigned when a task_assignees INSERT is for a different user", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onAssigned = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned,
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const payload = {
      eventType: "INSERT",
      schema: "public",
      table: "task_assignees",
      new: { task_id: "t1", user_id: "user-2" },
      old: {},
    } as unknown as MyTasksRealtimeAssigneeEvent;

    callbackFor(onCalls, "task_assignees")(payload);

    expect(onAssigned).not.toHaveBeenCalled();
  });

  it("AS-017: calls onUnassigned when a task_assignees row is DELETEd for this user", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onUnassigned = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const payload = {
      eventType: "DELETE",
      schema: "public",
      table: "task_assignees",
      new: {},
      old: { task_id: "t1", user_id: "user-1" },
    } as unknown as MyTasksRealtimeAssigneeEvent;

    callbackFor(onCalls, "task_assignees")(payload);

    expect(onUnassigned).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("does not call onUnassigned when a task_assignees DELETE is for a different user", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onUnassigned = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const payload = {
      eventType: "DELETE",
      schema: "public",
      table: "task_assignees",
      new: {},
      old: { task_id: "t1", user_id: "user-2" },
    } as unknown as MyTasksRealtimeAssigneeEvent;

    callbackFor(onCalls, "task_assignees")(payload);

    expect(onUnassigned).not.toHaveBeenCalled();
  });

  it("AS-016: calls onUpdate when a tasks row UPDATE arrives for an already-tracked task", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onUpdate = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate,
      onDelete: vi.fn(),
    });

    // F031/AS-018: `tasks` UPDATE/DELETE only propagate for tasks this
    // subscriber already tracks -- establish that via a prior
    // `task_assignees` INSERT for this user, mirroring how a caller would
    // actually come to know about "t1" in a real session.
    callbackFor(onCalls, "task_assignees")({
      eventType: "INSERT",
      schema: "public",
      table: "task_assignees",
      new: { task_id: "t1", user_id: "user-1" },
      old: {},
    } as unknown as MyTasksRealtimeAssigneeEvent);

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", title: "Task 1", status: "done" },
      old: { id: "t1", status: "todo" },
    } as unknown as MyTasksRealtimeTaskEvent;

    callbackFor(onCalls, "tasks")(payload);

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(payload.new);
  });

  it("AS-018: calls onDelete when a tasks row DELETE arrives for an already-tracked task", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete,
    });

    callbackFor(onCalls, "task_assignees")({
      eventType: "INSERT",
      schema: "public",
      table: "task_assignees",
      new: { task_id: "t1", user_id: "user-1" },
      old: {},
    } as unknown as MyTasksRealtimeAssigneeEvent);

    const payload = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t1" },
    } as unknown as MyTasksRealtimeTaskEvent;

    callbackFor(onCalls, "tasks")(payload);

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("AS-018: does NOT call onUpdate for a tasks row UPDATE that's RLS-visible but never tracked (workspace-wide leak fix)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onUpdate = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate,
      onDelete: vi.fn(),
    });

    // No task_assignees event has ever established "t-other" as this
    // user's -- it's a task in another project, still RLS-visible on the
    // shared `tasks` topic (no row filter), but never assigned to user-1.
    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t-other", title: "Someone else's task", status: "done" },
      old: { id: "t-other", status: "todo" },
    } as unknown as MyTasksRealtimeTaskEvent;

    callbackFor(onCalls, "tasks")(payload);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("AS-018: does NOT call onDelete for a tasks row DELETE that's RLS-visible but never tracked", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete,
    });

    const payload = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t-other" },
    } as unknown as MyTasksRealtimeTaskEvent;

    callbackFor(onCalls, "tasks")(payload);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("scopes different users to different channels/topics (no cross-user leakage at the subscription level)", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });
    subscribeToMyTasksRealtime(supabase as never, "user-2", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(channelCalls).toEqual(["tasks:my-tasks:user-1", "tasks:my-tasks:user-2"]);
  });

  it("validates payload shape: drops a tasks UPDATE event whose new record has no id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onUpdate = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate,
      onDelete: vi.fn(),
    });

    const malformedUpdate = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { title: "no id" },
      old: {},
    } as unknown as MyTasksRealtimeTaskEvent;

    callbackFor(onCalls, "tasks")(malformedUpdate);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("validates payload shape: drops a tasks DELETE event whose old record has no id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onDelete = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete,
    });

    const malformedDelete = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: {},
    } as unknown as MyTasksRealtimeTaskEvent;

    callbackFor(onCalls, "tasks")(malformedDelete);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("validates payload shape: drops a task_assignees event with a missing task_id/user_id", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onAssigned = vi.fn();
    const onUnassigned = vi.fn();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned,
      onUnassigned,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const malformedInsert = {
      eventType: "INSERT",
      schema: "public",
      table: "task_assignees",
      new: { user_id: "user-1" },
      old: {},
    } as unknown as MyTasksRealtimeAssigneeEvent;

    callbackFor(onCalls, "task_assignees")(malformedInsert);

    expect(onAssigned).not.toHaveBeenCalled();
    expect(onUnassigned).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown, F329 pattern)", async () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});
