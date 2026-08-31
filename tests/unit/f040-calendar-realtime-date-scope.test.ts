// F040 (AS-022): the calendar realtime reconciler is scoped, client-side,
// to the currently-displayed date window ("YYYY-MM-DD" `start`/`end`,
// inclusive) — see lib/calendar/reconcile-realtime-task.ts's header
// comment for why (`CalendarDayGrid` derives it from `days[0]`/
// `days[days.length - 1]`, which already includes leading/trailing days
// from adjacent months). An INSERT/UPDATE naming a due_date outside the
// window is dropped rather than appended to an off-screen bucket the grid
// never renders for the current view.
import { describe, expect, it } from "vitest";

import {
  reconcileCalendarRealtimeEvent,
  type CalendarTasksByDate,
} from "@/lib/calendar/reconcile-realtime-task";
import type { CalendarRealtimeEvent } from "@/lib/tasks/subscribe-calendar-realtime";

const RANGE = { start: "2026-08-01" as const, end: "2026-08-31" as const };

function insertEvent(dueDate: string): CalendarRealtimeEvent {
  return {
    eventType: "INSERT",
    schema: "public",
    table: "tasks",
    new: {
      id: "t1",
      project_id: "p1",
      title: "New task",
      status: "todo",
      priority: "medium",
      due_date: dueDate,
      number: 1,
      deleted_at: null,
      updated_at: "2026-08-31T00:00:00Z",
    },
    old: {},
  } as unknown as CalendarRealtimeEvent;
}

describe("F040/AS-022: calendar realtime is scoped to the displayed date window", () => {
  it("test_AS_022_ignores_an_insert_whose_due_date_is_outside_the_visible_window", () => {
    const byDate: CalendarTasksByDate = {};

    const next = reconcileCalendarRealtimeEvent(
      byDate,
      insertEvent("2026-09-15"),
      new Set(["p1"]),
      RANGE,
    );

    expect(next).toEqual(byDate);
    expect(next["2026-09-15"]).toBeUndefined();
  });

  it("test_AS_022_accepts_an_insert_whose_due_date_is_inside_the_visible_window", () => {
    const byDate: CalendarTasksByDate = {};

    const next = reconcileCalendarRealtimeEvent(
      byDate,
      insertEvent("2026-08-15"),
      new Set(["p1"]),
      RANGE,
    );

    expect(next["2026-08-15"]?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("test_AS_022_removes_a_tracked_task_when_an_update_moves_its_due_date_outside_the_window", () => {
    const byDate: CalendarTasksByDate = {
      "2026-08-15": [
        {
          id: "t1",
          title: "Ship it",
          status: "todo",
          statusCategory: null,
          isDone: false,
          priority: "medium",
          dueDate: "2026-08-15" as never,
          number: 1,
          projectId: "p1",
          projectKey: null,
          projectName: "",
          assignees: [],
        },
      ],
    };
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
        due_date: "2026-09-20",
        number: 1,
        deleted_at: null,
        updated_at: "2026-08-31T00:00:00Z",
      },
      old: { id: "t1" },
    } as unknown as CalendarRealtimeEvent;

    const next = reconcileCalendarRealtimeEvent(
      byDate,
      event,
      new Set(["p1"]),
      RANGE,
    );

    expect(next["2026-08-15"]).toBeUndefined();
    expect(next["2026-09-20"]).toBeUndefined();
  });

  it("test_AS_022_without_a_visibleDateRange_no_scoping_is_applied_backward_compat", () => {
    // No `visibleDateRange` passed (matches every pre-F040 caller/test) --
    // this documents that the default behavior is unscoped, so this test
    // fails if the INSERT path itself is ever removed/broken, not just if
    // scoping regresses.
    const byDate: CalendarTasksByDate = {};

    const next = reconcileCalendarRealtimeEvent(
      byDate,
      insertEvent("2099-01-01"),
      new Set(["p1"]),
    );

    expect(next["2099-01-01"]?.map((t) => t.id)).toEqual(["t1"]);
  });
});
