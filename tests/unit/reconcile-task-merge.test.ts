// REUSE-LOGIC-04: board + List share one merge-don't-replace reconciler.
import { describe, expect, it } from "vitest";

import type { TaskCardTask } from "@/components/task/task-card";
import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";
import { reconcileListTask } from "@/lib/tasks/reconcile-list-realtime-task";

const loaded: TaskCardTask = {
  id: "t1",
  title: "Old",
  status: "todo",
  statusCategory: "not_started",
  priority: "low",
  assigneeId: "u1",
  assigneeIds: ["u1", "u2"],
  dueDate: null,
  position: 1,
  updatedAt: "2026-01-01T00:00:00Z",
  totalMinutes: 90,
  estimateMinutes: 120,
  subtaskCount: 3,
  openBlockerCount: 1,
  projectKey: "PM",
  number: 7,
};

function update(partial: Record<string, unknown>): BoardRealtimeEvent {
  return {
    eventType: "UPDATE",
    new: { id: "t1", ...partial },
    old: { id: "t1" },
  } as unknown as BoardRealtimeEvent;
}

describe("shared task reconciler", () => {
  it("the List view uses the same function as the board", () => {
    expect(reconcileListTask).toBe(reconcileTask);
  });

  it("keeps join/aggregate fields the realtime payload cannot carry", () => {
    const [next] = reconcileTask(
      [loaded],
      update({
        title: "New",
        status: "done",
        priority: "high",
        assignee_id: "u1",
        due_date: "2026-02-01",
        position: 2,
        updated_at: "2026-01-02T00:00:00Z",
        number: 7,
        deleted_at: null,
        project_id: "p1",
      }),
    );
    expect(next).toMatchObject({
      title: "New",
      status: "done",
      priority: "high",
      position: 2,
      assigneeIds: ["u1", "u2"],
      statusCategory: "not_started",
      totalMinutes: 90,
      estimateMinutes: 120,
      subtaskCount: 3,
      openBlockerCount: 1,
      projectKey: "PM",
      number: 7,
    });
  });

  it("does not clear fields absent from a partial payload", () => {
    const [next] = reconcileTask(
      [loaded],
      update({ status: "in_progress", updated_at: "2026-01-02T00:00:00Z" }),
    );
    expect(next!.title).toBe("Old");
    expect(next!.priority).toBe("low");
    expect(next!.assigneeId).toBe("u1");
    expect(next!.status).toBe("in_progress");
  });

  it("drops an out-of-order older update", () => {
    const tasks = [loaded];
    expect(
      reconcileTask(tasks, update({ title: "Stale", updated_at: "2025-12-31T00:00:00Z" })),
    ).toBe(tasks);
  });

  it("inserts a new task borrowing the project key", () => {
    const next = reconcileTask([loaded], {
      eventType: "INSERT",
      new: {
        id: "t2", title: "Fresh", status: "todo", priority: null, assignee_id: null,
        due_date: null, position: 5, deleted_at: null, updated_at: "x", number: 8, project_id: "p1",
      },
      old: {},
    } as unknown as BoardRealtimeEvent);
    expect(next[1]).toMatchObject({ id: "t2", projectKey: "PM", number: 8 });
  });
});
