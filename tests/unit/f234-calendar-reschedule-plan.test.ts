// Unit tests for F234 (AS-445) — lib/calendar/reschedule.ts's pure
// `planReschedule`. Exercises the drag-target planning logic in isolation
// (no React, no dnd-kit, no Supabase), including the off-by-one/timezone
// guard and the adjacent-month case the feature spec explicitly calls out.

import { describe, expect, it } from "vitest";

import { planReschedule } from "@/lib/calendar/reschedule";
import type { CalendarTask } from "@/lib/queries/calendar";

function makeTask(overrides: Partial<CalendarTask> & { id: string; dueDate: string }): CalendarTask {
  return {
    title: "Task",
    status: "todo",
    statusCategory: null,
    isDone: false,
    priority: null,
    number: 1,
    projectId: "project-1",
    projectKey: "PRJ",
    projectName: "Project",
    assignees: [],
    ...overrides,
  };
}

describe("F234 planReschedule (AS-445)", () => {
  it("test_AS_445_moves_a_task_from_its_source_date_bucket_to_the_target_date_bucket", () => {
    const task = makeTask({ id: "t1", dueDate: "2026-06-10" });
    const byDate = { "2026-06-10": [task] };

    const plan = planReschedule(byDate, "t1", "2026-06-15");

    expect(plan).not.toBeNull();
    expect(plan!.sourceDate).toBe("2026-06-10");
    expect(plan!.targetDate).toBe("2026-06-15");
    expect(plan!.nextTasksByDate["2026-06-10"]).toEqual([]);
    expect(plan!.nextTasksByDate["2026-06-15"]).toHaveLength(1);
    expect(plan!.nextTasksByDate["2026-06-15"][0].id).toBe("t1");
    expect(plan!.nextTasksByDate["2026-06-15"][0].dueDate).toBe("2026-06-15");
  });

  it("test_AS_445_off_by_one_guard_the_moved_tasks_dueDate_is_exactly_the_dropped_on_cells_YYYY_MM_DD_string_never_shifted", () => {
    // The exact string the cell carries -- never round-tripped through
    // `new Date(...)`, which (in a zone west of UTC) can silently roll a
    // "YYYY-MM-DD" back a calendar day once reformatted. This test proves
    // the literal string identity is preserved regardless of the runtime's
    // ambient timezone (no Date object is constructed anywhere in this
    // module).
    const task = makeTask({ id: "t1", dueDate: "2026-01-01" });
    const byDate = { "2026-01-01": [task] };
    const targetCellDate = "2026-01-31"; // month-end boundary, deliberately

    const plan = planReschedule(byDate, "t1", targetCellDate);

    expect(plan).not.toBeNull();
    expect(plan!.task.dueDate).toBe("2026-01-31");
    expect(plan!.task.dueDate).toBe(targetCellDate);
    // Same string reference-equal content, not a Date-derived reformat.
    expect(typeof plan!.task.dueDate).toBe("string");
  });

  it("test_AS_445_dropping_on_a_leading_or_trailing_adjacent_month_day_sets_that_adjacent_months_real_date", () => {
    // A leading day rendered inside a "June" grid but really belonging to
    // May -- lib/calendar/month-grid.ts already emits that day's own real
    // "YYYY-MM-DD" as `day.date`; planReschedule must not clamp it into
    // the visible month.
    const task = makeTask({ id: "t1", dueDate: "2026-06-03" });
    const byDate = { "2026-06-03": [task] };
    const leadingDayFromPreviousMonth = "2026-05-31";

    const plan = planReschedule(byDate, "t1", leadingDayFromPreviousMonth);

    expect(plan).not.toBeNull();
    expect(plan!.targetDate).toBe("2026-05-31");
    expect(plan!.task.dueDate).toBe("2026-05-31");
    expect(plan!.nextTasksByDate["2026-05-31"]).toHaveLength(1);
  });

  it("test_AS_445_dropping_on_the_tasks_own_current_day_is_a_no_op", () => {
    const task = makeTask({ id: "t1", dueDate: "2026-06-10" });
    const byDate = { "2026-06-10": [task] };

    const plan = planReschedule(byDate, "t1", "2026-06-10");

    expect(plan).toBeNull();
  });

  it("test_AS_445_a_task_id_not_present_in_any_bucket_returns_null_rather_than_throwing", () => {
    const byDate = { "2026-06-10": [makeTask({ id: "t1", dueDate: "2026-06-10" })] };

    const plan = planReschedule(byDate, "does-not-exist", "2026-06-15");

    expect(plan).toBeNull();
  });

  it("test_AS_445_other_tasks_already_on_the_target_date_are_preserved_alongside_the_moved_one", () => {
    const moving = makeTask({ id: "t1", dueDate: "2026-06-10" });
    const alreadyThere = makeTask({ id: "t2", dueDate: "2026-06-15" });
    const byDate = { "2026-06-10": [moving], "2026-06-15": [alreadyThere] };

    const plan = planReschedule(byDate, "t1", "2026-06-15");

    expect(plan).not.toBeNull();
    const ids = plan!.nextTasksByDate["2026-06-15"].map((t) => t.id).sort();
    expect(ids).toEqual(["t1", "t2"]);
  });

  it("test_AS_445_other_tasks_remaining_on_the_source_date_are_preserved", () => {
    const moving = makeTask({ id: "t1", dueDate: "2026-06-10" });
    const staying = makeTask({ id: "t2", dueDate: "2026-06-10" });
    const byDate = { "2026-06-10": [moving, staying] };

    const plan = planReschedule(byDate, "t1", "2026-06-20");

    expect(plan).not.toBeNull();
    expect(plan!.nextTasksByDate["2026-06-10"]).toHaveLength(1);
    expect(plan!.nextTasksByDate["2026-06-10"][0].id).toBe("t2");
  });
});
