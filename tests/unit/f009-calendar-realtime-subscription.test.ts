// F009 (AS-019, AS-020, AS-021, AS-022): unit tests for the calendar's
// Realtime wiring (subscribeToCalendarRealtime) and its pure event
// reconciler (reconcileCalendarRealtimeEvent) -- same DOM-less coverage
// shape as tests/unit/board-realtime-subscription.test.ts (F049): channel/
// table/event configuration on the subscribe side, and every
// INSERT/UPDATE-move/UPDATE-clear/DELETE branch on the reconcile side.

import { describe, expect, it, vi } from "vitest";

import { subscribeToCalendarRealtime } from "@/lib/tasks/subscribe-calendar-realtime";
import type { CalendarRealtimeEvent } from "@/lib/tasks/subscribe-calendar-realtime";
import { reconcileCalendarRealtimeEvent } from "@/lib/calendar/reconcile-realtime-task";
import type { CalendarTasksByDate } from "@/lib/calendar/reconcile-realtime-task";
import type { CalendarTask } from "@/lib/queries/calendar";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: CalendarRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: CalendarRealtimeEvent) => void,
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

describe("subscribeToCalendarRealtime (AS-019, AS-020, AS-021, AS-022)", () => {
  it("subscribes on a per-workspace channel to all tasks-table events", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToCalendarRealtime(supabase as never, "workspace-123", onChange);

    expect(channelCalls).toEqual(["tasks:calendar:workspace-123"]);
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

    subscribeToCalendarRealtime(supabase as never, "workspace-123", onChange);

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", project_id: "project-1", due_date: "2026-09-05" },
      old: { id: "t1" },
    } as unknown as CalendarRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("scopes different workspaces to different channel names", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToCalendarRealtime(supabase as never, "workspace-a", vi.fn());
    subscribeToCalendarRealtime(supabase as never, "workspace-b", vi.fn());

    expect(channelCalls).toEqual([
      "tasks:calendar:workspace-a",
      "tasks:calendar:workspace-b",
    ]);
  });

  it("returns an unsubscribe function that removes the channel (deferred teardown)", async () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToCalendarRealtime(
      supabase as never,
      "workspace-123",
      vi.fn(),
    );
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removedChannels).toEqual([channelObject]);
  });
});

describe("reconcileCalendarRealtimeEvent (AS-019, AS-020, AS-021, AS-022)", () => {
  const visibleProjectIds = new Set(["project-1"]);

  const existingTask: CalendarTask = {
    id: "t1",
    title: "Existing task",
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority: "medium",
    dueDate: "2026-09-01" as CalendarTask["dueDate"],
    number: 1,
    projectId: "project-1",
    projectKey: "ENG",
    projectName: "Engineering",
    assignees: [],
  };

  function baseByDate(): CalendarTasksByDate {
    return { "2026-09-01": [existingTask] };
  }

  function insertOrUpdateEvent(
    eventType: "INSERT" | "UPDATE",
    row: Partial<Record<string, unknown>> & { id: string },
  ): CalendarRealtimeEvent {
    return {
      eventType,
      schema: "public",
      table: "tasks",
      new: {
        project_id: "project-1",
        title: "Existing task",
        status: "todo",
        priority: "medium",
        due_date: null,
        number: 1,
        deleted_at: null,
        updated_at: "2026-09-01T00:00:00Z",
        ...row,
      },
      old: { id: row.id },
    } as unknown as CalendarRealtimeEvent;
  }

  // Primary success test (DoD): onDueDateChange -> reconcile called when
  // UPDATE changes due_date (AS-019).
  it("moves a task to its new date bucket when UPDATE changes due_date", () => {
    const event = insertOrUpdateEvent("UPDATE", {
      id: "t1",
      due_date: "2026-09-05",
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next["2026-09-01"]).toBeUndefined();
    expect(next["2026-09-05"]).toHaveLength(1);
    expect(next["2026-09-05"]?.[0]?.id).toBe("t1");
    // Previously-resolved joined fields (projectKey/projectName/assignees)
    // survive the move -- only the columns the event carries are patched.
    expect(next["2026-09-05"]?.[0]?.projectKey).toBe("ENG");
  });

  it("appends a new task with a due_date on INSERT (AS-020)", () => {
    const event = insertOrUpdateEvent("INSERT", {
      id: "t2",
      title: "New task",
      due_date: "2026-09-10",
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next["2026-09-10"]).toHaveLength(1);
    expect(next["2026-09-10"]?.[0]?.title).toBe("New task");
    // Unresolved joined fields default rather than crash/throw.
    expect(next["2026-09-10"]?.[0]?.assignees).toEqual([]);
  });

  it("does not add an INSERT with no due_date", () => {
    const event = insertOrUpdateEvent("INSERT", {
      id: "t3",
      due_date: null,
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next).toEqual(baseByDate());
  });

  // Failure test (DoD): task removed from calendar when due_date set to
  // null (AS-021).
  it("removes a task from the calendar when UPDATE clears due_date", () => {
    const event = insertOrUpdateEvent("UPDATE", {
      id: "t1",
      due_date: null,
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next["2026-09-01"]).toBeUndefined();
    expect(Object.values(next).flat().find((t) => t.id === "t1")).toBeUndefined();
  });

  it("removes a task on DELETE (AS-021)", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t1", project_id: "project-1" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next["2026-09-01"]).toBeUndefined();
  });

  it("removes a task whose UPDATE payload has deleted_at set (soft delete)", () => {
    const event = insertOrUpdateEvent("UPDATE", {
      id: "t1",
      due_date: "2026-09-01",
      deleted_at: "2026-09-02T00:00:00Z",
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next["2026-09-01"]).toBeUndefined();
  });

  it("is a no-op when the DELETE payload has no old.id", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: {},
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next).toEqual(baseByDate());
  });

  it("ignores a payload missing due_date entirely (validation)", () => {
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", project_id: "project-1" },
      old: { id: "t1" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next).toEqual(baseByDate());
  });

  // AS-022: events for a project outside the caller's visible set never
  // touch local state, regardless of event type -- the client-side
  // backstop for the DELETE-skips-RLS gap (and a harmless redundant check
  // for INSERT/UPDATE, which RLS already gates upstream).
  it("ignores INSERT/UPDATE events for a project outside the caller's visible set (AS-022)", () => {
    const event = insertOrUpdateEvent("INSERT", {
      id: "t9",
      project_id: "private-project",
      due_date: "2026-09-12",
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next).toEqual(baseByDate());
    expect(Object.values(next).flat().find((t) => t.id === "t9")).toBeUndefined();
  });

  // F029/AS-022: `tasks` has no `replica identity full`, so a DELETE's
  // `old` record only ever carries `{id}` in production -- `old.project_id`
  // is never actually populated by real Supabase Realtime broadcasts, so a
  // test fabricating it would exercise a code path that can never run. The
  // real backstop is "is this id in our own local state" -- a DELETE for
  // an id this client never had (e.g. it belonged to a project this
  // caller can't see, so it was never inserted locally) is a no-op.
  it("ignores a DELETE event for a task id not present in local state (AS-022)", () => {
    const byDateWithOnlyT1: CalendarTasksByDate = {
      "2026-09-01": [existingTask],
    };
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "invisible-task" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(
      byDateWithOnlyT1,
      event,
      visibleProjectIds,
    );

    // "invisible-task" was never in local state (this client never saw
    // it, e.g. it belongs to a project outside this caller's visibility)
    // -- the DELETE is skipped rather than trusted, and t1 is untouched.
    expect(next).toEqual(byDateWithOnlyT1);
  });

  it("removes a task on DELETE when its id IS present in local state, even with no project_id on old (AS-022)", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      // Realistic shape: `old` carries only `{id}` -- no `project_id`,
      // reflecting the actual replica-identity-default payload shape.
      old: { id: "t1" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(Object.values(next).flat().find((t) => t.id === "t1")).toBeUndefined();
  });

  // AS-020: isDone is derived from the INSERT row's own `status` column
  // (degraded/no-category path) rather than hardcoded `false`.
  it("derives isDone from the payload's status on INSERT rather than hardcoding false (AS-020)", () => {
    const event = insertOrUpdateEvent("INSERT", {
      id: "t4",
      status: "done",
      due_date: "2026-09-11",
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    const inserted = next["2026-09-11"]?.[0];
    expect(inserted?.status).toBe("done");
    expect(inserted?.isDone).toBe(true);
  });

  it("keeps isDone false on INSERT when the payload's status is not 'done' (AS-020)", () => {
    const event = insertOrUpdateEvent("INSERT", {
      id: "t5",
      status: "todo",
      due_date: "2026-09-12",
    });

    const next = reconcileCalendarRealtimeEvent(
      baseByDate(),
      event,
      visibleProjectIds,
    );

    expect(next["2026-09-12"]?.[0]?.isDone).toBe(false);
  });
});
