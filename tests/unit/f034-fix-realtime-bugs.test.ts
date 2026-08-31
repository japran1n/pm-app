// F034 (AS-018, AS-020, AS-024): regression coverage for three realtime
// correctness bugs.
//
// AS-018: `task_assignees` DELETE broadcasts (Supabase never row-filters
// DELETEs) must be dropped client-side for any user other than the
// current caller.
// AS-020: an already-tracked calendar task's `isDone` must be RE-DERIVED
// from a `tasks` UPDATE's new status, not left stale from first insert.
// AS-024: a task removed from the command palette's search results via a
// realtime DELETE must stay tombstoned even if a slower, already
// in-flight search response resolves afterward and would otherwise
// resurrect it.
import { describe, expect, it, vi } from "vitest";

import {
  subscribeToMyTasksRealtime,
  type MyTasksRealtimeAssigneeEvent,
} from "@/components/my-tasks/use-my-tasks-realtime";
import { reconcileCalendarRealtimeEvent } from "@/lib/calendar/reconcile-realtime-task";
import type { CalendarTasksByDate } from "@/lib/calendar/reconcile-realtime-task";
import type { CalendarRealtimeEvent } from "@/lib/tasks/subscribe-calendar-realtime";
import type { CalendarTask } from "@/lib/queries/calendar";
import {
  applyRealtimePatches,
  type RealtimeTaskPatch,
} from "@/components/command/command-palette";
import type {
  PaletteSearchResults,
  PaletteTaskResult,
} from "@/lib/palette/palette-search-types";

function createMockSupabaseClient() {
  const onCalls: Array<{ table: string; callback: (payload: unknown) => void }> = [];
  const channel = {
    on: vi.fn((_event: string, config: { table: string }, callback: (payload: unknown) => void) => {
      onCalls.push({ table: config.table, callback });
      return channel;
    }),
    subscribe: vi.fn(() => channel),
    unsubscribe: vi.fn(),
  };
  const supabase = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };
  return { supabase, onCalls };
}

function callbackFor(
  onCalls: Array<{ table: string; callback: (payload: unknown) => void }>,
  table: string,
) {
  const match = onCalls.find((entry) => entry.table === table);
  if (!match) throw new Error(`no handler registered for table ${table}`);
  return match.callback;
}

describe("F034/AS-018: task_assignees DELETE is scoped to the current user", () => {
  it("test_AS_018_ignores_task_assignees_delete_for_a_different_user", () => {
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

  it("test_AS_018_forwards_task_assignees_delete_for_the_current_user", () => {
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
});

describe("F034/AS-020: calendar isDone re-derives from a tasks UPDATE's new status", () => {
  const baseTask: CalendarTask = {
    id: "t1",
    title: "Ship it",
    status: "todo",
    // AS-020/F036: realistic non-null statusCategory (as every existing
    // task in local state actually has, resolved by the initial server
    // fetch's `project_statuses` join) — this reproduces the real bug:
    // `isDoneStatus(row.status, existing.statusCategory)` short-circuits
    // on a non-null category and ignores `row.status` entirely, so a task
    // moved to a "done"-category status would still read as not-done
    // because the STALE `existing.statusCategory` ("in_progress") gets
    // consulted instead of the NEW status.
    statusCategory: "in_progress",
    isDone: false,
    priority: "medium",
    dueDate: "2026-08-31" as CalendarTask["dueDate"],
    number: 1,
    projectId: "p1",
    projectKey: "ENG",
    projectName: "Engineering",
    assignees: [],
  };

  function byDateWith(task: CalendarTask): CalendarTasksByDate {
    return { [task.dueDate]: [task] };
  }

  it("test_AS_020_marks_isDone_true_when_an_update_moves_a_tracked_task_to_done", () => {
    const byDate = byDateWith(baseTask);
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t1",
        project_id: "p1",
        title: "Ship it",
        status: "done",
        priority: "medium",
        due_date: "2026-08-31",
        number: 1,
        deleted_at: null,
        updated_at: "2026-08-31T00:00:00Z",
      },
      old: { id: "t1" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(byDate, event, new Set(["p1"]));

    const updated = next["2026-08-31"]?.find((task) => task.id === "t1");
    expect(updated?.isDone).toBe(true);
  });

  it("test_AS_020_marks_isDone_false_when_an_update_moves_a_tracked_done_task_back_to_todo", () => {
    const byDate = byDateWith({
      ...baseTask,
      status: "done",
      statusCategory: "done",
      isDone: true,
    });
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t1",
        project_id: "p1",
        title: "Ship it",
        status: "todo",
        priority: "medium",
        due_date: "2026-08-31",
        number: 1,
        deleted_at: null,
        updated_at: "2026-08-31T00:00:00Z",
      },
      old: { id: "t1" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(byDate, event, new Set(["p1"]));

    const updated = next["2026-08-31"]?.find((task) => task.id === "t1");
    expect(updated?.isDone).toBe(false);
  });
});

describe("F034/AS-024: a deleted palette task stays tombstoned against a stale search response", () => {
  // Exercises the REAL production `applyRealtimePatches` (exported from
  // components/command/command-palette.tsx) rather than a local
  // re-implementation — this test fails if `isTombstone`/the tombstone
  // branch is ever removed or regressed to a `.delete(id)`-based
  // (non-tombstone) map, because a `.delete(id)`-based map would have no
  // entry left to filter the task back out with once the stale response
  // "re-adds" it below.
  function task(id: string, title: string): PaletteTaskResult {
    return {
      type: "task",
      id,
      title,
      projectId: "p1",
      projectName: "Project 1",
      projectKey: "P1",
      number: 1,
    };
  }

  it("test_AS_024_stale_search_response_does_not_resurrect_a_realtime_deleted_task", () => {
    const patches = new Map<string, RealtimeTaskPatch>();

    // Realtime DELETE arrives first: task removed from live results and
    // tombstoned.
    patches.set("t1", { _deleted: true });

    // A slower search request that was in flight before the delete now
    // resolves, still naming the deleted task.
    const staleResponse: PaletteSearchResults = {
      projects: [],
      members: [],
      tasks: [task("t1", "Old title"), task("t2", "Still here")],
    };

    const merged = applyRealtimePatches(staleResponse, patches);

    expect(merged.tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("test_AS_024_a_task_with_no_tombstone_passes_through_unchanged", () => {
    const patches = new Map<string, RealtimeTaskPatch>();
    const response: PaletteSearchResults = {
      projects: [],
      members: [],
      tasks: [task("t1", "Old title")],
    };

    const merged = applyRealtimePatches(response, patches);

    expect(merged).toBe(response);
    expect(merged.tasks.map((t) => t.id)).toEqual(["t1"]);
  });
});
