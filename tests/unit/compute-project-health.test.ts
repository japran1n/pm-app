import { describe, expect, it } from "vitest";

import {
  computeProjectHealth,
  countProjectHealthTasks,
} from "@/lib/projects/compute-health";

const NOW = new Date("2026-06-15T00:00:00.000Z");

describe("computeProjectHealth", () => {
  it("returns on_track for a project with no overdue tasks and no active phase", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 10,
        currentPhase: null,
      }),
    ).toBe("on_track");
  });

  it("returns on_track for a project with zero tasks at all", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: null,
      }),
    ).toBe("on_track");
  });

  it("returns at_risk when there is 1-2 overdue tasks", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 1,
        totalTaskCount: 10,
        currentPhase: null,
      }),
    ).toBe("at_risk");

    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 2,
        totalTaskCount: 10,
        currentPhase: null,
      }),
    ).toBe("at_risk");
  });

  it("returns overdue when there are 3 or more overdue tasks", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 3,
        totalTaskCount: 10,
        currentPhase: null,
      }),
    ).toBe("overdue");
  });

  it("returns overdue when 30%+ of all tasks are overdue, even under the raw count threshold", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 2,
        totalTaskCount: 5,
        currentPhase: null,
      }),
    ).toBe("overdue");
  });

  it("does not treat a small overdue percentage on a tiny task count as overdue", () => {
    // 1 overdue out of 10 = 10%, under the 30% threshold -- falls to the
    // raw-count at_risk rule instead.
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 1,
        totalTaskCount: 10,
        currentPhase: null,
      }),
    ).toBe("at_risk");
  });

  it("returns on_track when the active phase has not reached its planned_end", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: {
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: "2026-07-01",
        },
      }),
    ).toBe("on_track");
  });

  it("returns at_risk when the active phase is close to its planned_end", () => {
    // Phase spans 2026-06-01..2026-06-20 (19 days); "now" (06-15) is 5
    // days from the end, which is within 20% of the 19-day span (~3.8
    // days) -- wait, 5 days > 3.8 days, so use a bigger buffer instead: a
    // phase ending just 2 days from now.
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: {
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: "2026-06-17",
        },
      }),
    ).toBe("at_risk");
  });

  it("returns at_risk when the active phase has just passed its planned_end (small overshoot)", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: {
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: "2026-06-14",
        },
      }),
    ).toBe("at_risk");
  });

  it("returns overdue when the active phase has overshot planned_end by 20%+ of its planned duration", () => {
    // 10-day planned duration (06-01..06-11), now is 06-15 -- 4 days
    // overshoot, which is 40% of the 10-day duration, over the 20%
    // threshold.
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: {
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: "2026-06-11",
        },
      }),
    ).toBe("overdue");
  });

  it("ignores a phase with no planned_end at all", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: {
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: null,
        },
      }),
    ).toBe("on_track");
  });

  it("ignores a done phase even if its planned_end is long past", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 0,
        totalTaskCount: 0,
        currentPhase: {
          state: "done",
          plannedStart: "2026-01-01",
          plannedEnd: "2026-02-01",
        },
      }),
    ).toBe("on_track");
  });

  it("combines overdue tasks and a lagging phase into the worse of the two verdicts", () => {
    expect(
      computeProjectHealth({
        now: NOW,
        overdueTaskCount: 5,
        totalTaskCount: 20,
        currentPhase: {
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: "2026-07-01",
        },
      }),
    ).toBe("overdue");
  });
});

describe("countProjectHealthTasks with the v2 status set", () => {
  const TODAY = "2026-06-15";

  it("counts done from the column category, never the name", () => {
    const counts = countProjectHealthTasks(
      [
        { status: "Completed", category: "done", dueDate: "2026-06-01" },
        { status: "Approved", category: "done", dueDate: "2026-06-01" },
        { status: "Live", category: "done", dueDate: null },
        { status: "done", category: "in_progress", dueDate: "2026-06-01" },
      ],
      TODAY,
    );
    expect(counts).toEqual({ totalTaskCount: 4, doneTaskCount: 3, overdueTaskCount: 1 });
  });

  it("counts open v2 columns past their due date as overdue", () => {
    const counts = countProjectHealthTasks(
      [
        { status: "To Do", category: "not_started", dueDate: "2026-06-10" },
        { status: "In Dev", category: "in_progress", dueDate: "2026-06-14T12:00:00Z" },
        { status: "QA by Design", category: "in_progress", dueDate: "2026-06-15" },
        { status: "Awaiting Client", category: "in_progress", dueDate: "2026-07-01" },
        { status: "Backlog", category: "not_started", dueDate: null },
      ],
      TODAY,
    );
    expect(counts).toEqual({ totalTaskCount: 5, doneTaskCount: 0, overdueTaskCount: 2 });
  });

  it("falls back to default names when a task has no resolvable column", () => {
    const counts = countProjectHealthTasks(
      [
        { status: "Completed", category: null, dueDate: "2026-06-01" },
        { status: "done", category: null, dueDate: "2026-06-01" },
        { status: "todo", category: null, dueDate: "2026-06-01" },
      ],
      TODAY,
    );
    expect(counts).toEqual({ totalTaskCount: 3, doneTaskCount: 2, overdueTaskCount: 1 });
  });

  it("feeds computeProjectHealth: completed v2 tasks never make a project overdue", () => {
    const tasks = Array.from({ length: 5 }, () => ({
      status: "Completed",
      category: "done",
      dueDate: "2026-06-01",
    }));
    const counts = countProjectHealthTasks(tasks, TODAY);
    expect(
      computeProjectHealth({ now: NOW, ...counts, currentPhase: null }),
    ).toBe("on_track");
  });

  it("feeds computeProjectHealth: three overdue open v2 tasks mark the project overdue", () => {
    const tasks = ["To Do", "In Dev", "QA by Dev"].map((status) => ({
      status,
      category: status === "To Do" ? "not_started" : "in_progress",
      dueDate: "2026-06-01",
    }));
    const counts = countProjectHealthTasks(tasks, TODAY);
    expect(
      computeProjectHealth({ now: NOW, ...counts, currentPhase: null }),
    ).toBe("overdue");
  });
});
