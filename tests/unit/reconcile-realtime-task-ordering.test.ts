// F103 (AS-076): unit tests for reconcileTask's updated_at ordering guard.
//
// Finding 3 of M5-scrutiny.md: reconcileTask previously always overwrote
// the locally held task with whatever row arrived via Realtime, with no
// comparison against `updated_at`. Two `postgres_changes` UPDATE events
// for the same task delivered out of commit order (plausible under
// reconnect/replay, or two independent writes landing on the wire out of
// turn) could let a stale row overwrite newer local state.
//
// These tests simulate exactly that: a newer-timestamped event applied
// first, then an older-timestamped event for the same task id arriving
// second, asserting the older event is a no-op against the already-applied
// newer state.

import { describe, expect, it } from "vitest";

import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

function updateEvent(
  row: Partial<Record<string, unknown>> & { id: string },
): BoardRealtimeEvent {
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
      updated_at: "2026-01-01T00:00:00.000Z",
      ...row,
    },
    old: { id: row.id },
  } as unknown as BoardRealtimeEvent;
}

describe("reconcileTask ordering guard (AS-076)", () => {
  const baseTasks: TaskCardTask[] = [
    {
      id: "t1",
      title: "Task 1",
      status: "todo",
      priority: null,
      assigneeId: null,
      dueDate: null,
      position: 1000,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("drops a strictly older event arriving after a newer one for the same task id", () => {
    const newerEvent = updateEvent({
      id: "t1",
      status: "in_progress",
      position: 2000,
      updated_at: "2026-01-01T00:05:00.000Z",
    });

    const afterNewer = reconcileTask(baseTasks, newerEvent);
    expect(afterNewer[0]).toMatchObject({
      status: "in_progress",
      position: 2000,
      updatedAt: "2026-01-01T00:05:00.000Z",
    });

    // Out-of-order: an older event (commit timestamp before the one just
    // applied) arrives second, e.g. a replayed/reconnect-delivered event.
    const olderEvent = updateEvent({
      id: "t1",
      status: "done",
      position: 9000,
      updated_at: "2026-01-01T00:02:00.000Z",
    });

    const afterOlder = reconcileTask(afterNewer, olderEvent);

    // The already-applied newer state must be untouched.
    expect(afterOlder[0]).toMatchObject({
      status: "in_progress",
      position: 2000,
      updatedAt: "2026-01-01T00:05:00.000Z",
    });
  });

  it("still applies a same-timestamp event (retry/correction), per the >= rule", () => {
    const correctionEvent = updateEvent({
      id: "t1",
      status: "in_review",
      position: 1500,
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const result = reconcileTask(baseTasks, correctionEvent);

    expect(result[0]).toMatchObject({
      status: "in_review",
      position: 1500,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("applies a strictly newer event normally", () => {
    const newerEvent = updateEvent({
      id: "t1",
      status: "done",
      position: 5000,
      updated_at: "2026-01-01T01:00:00.000Z",
    });

    const result = reconcileTask(baseTasks, newerEvent);

    expect(result[0]).toMatchObject({
      status: "done",
      position: 5000,
      updatedAt: "2026-01-01T01:00:00.000Z",
    });
  });

  it("applies the incoming row when local state has no updatedAt to compare against (initial fetch case)", () => {
    const tasksWithoutUpdatedAt: TaskCardTask[] = [
      {
        id: "t1",
        title: "Task 1",
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        position: 1000,
      },
    ];

    const event = updateEvent({
      id: "t1",
      status: "in_progress",
      position: 2000,
      updated_at: "2020-01-01T00:00:00.000Z", // "old" timestamp, but nothing to compare against locally
    });

    const result = reconcileTask(tasksWithoutUpdatedAt, event);

    expect(result[0]).toMatchObject({ status: "in_progress", position: 2000 });
  });
});
