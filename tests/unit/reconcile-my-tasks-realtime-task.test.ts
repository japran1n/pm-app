import { describe, expect, it } from "vitest";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import {
  reconcileMyTasksRealtimeTask,
  type MyTaskRealtimeRow,
} from "@/lib/tasks/reconcile-my-tasks-realtime-task";

type Task = MyTaskRealtimeRow & { title: string };

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    assignee_id: USER_ID,
    title: "Write tests",
    ...overrides,
  };
}

function insertEvent(row: Task): RealtimePostgresChangesPayload<Task> {
  return {
    eventType: "INSERT",
    schema: "public",
    table: "tasks",
    commit_timestamp: "2026-08-30T00:00:00Z",
    new: row,
    old: {},
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Task>;
}

function updateEvent(row: Task): RealtimePostgresChangesPayload<Task> {
  return {
    eventType: "UPDATE",
    schema: "public",
    table: "tasks",
    commit_timestamp: "2026-08-30T00:00:00Z",
    new: row,
    old: {},
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Task>;
}

function deleteEvent(oldRow: { id: string }): RealtimePostgresChangesPayload<Task> {
  return {
    eventType: "DELETE",
    schema: "public",
    table: "tasks",
    commit_timestamp: "2026-08-30T00:00:00Z",
    new: {},
    old: oldRow,
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Task>;
}

describe("reconcileMyTasksRealtimeTask", () => {
  it("test_AS_015_insert_adds_newly_assigned_task", () => {
    const tasks: Task[] = [];
    const event = insertEvent(makeTask({ id: "task-2", assignee_id: USER_ID }));

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("task-2");
    expect(result).not.toBe(tasks);
  });

  it("test_AS_015_insert_for_other_assignee_is_ignored", () => {
    const tasks: Task[] = [];
    const event = insertEvent(makeTask({ id: "task-2", assignee_id: OTHER_USER_ID }));

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toEqual([]);
  });

  it("test_AS_016_update_status_updates_existing_task_in_place", () => {
    const tasks: Task[] = [makeTask({ id: "task-1", title: "Old title" })];
    const event = updateEvent(makeTask({ id: "task-1", title: "New title" }));

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("New title");
    expect(result).not.toBe(tasks);
    // Original array must not be mutated.
    expect(tasks[0]!.title).toBe("Old title");
  });

  it("test_AS_017_update_with_null_assignee_removes_task", () => {
    const tasks: Task[] = [makeTask({ id: "task-1", assignee_id: USER_ID })];
    const event = updateEvent(makeTask({ id: "task-1", assignee_id: null }));

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toEqual([]);
  });

  it("test_AS_017_update_reassigned_to_someone_else_removes_task", () => {
    const tasks: Task[] = [makeTask({ id: "task-1", assignee_id: USER_ID })];
    const event = updateEvent(makeTask({ id: "task-1", assignee_id: OTHER_USER_ID }));

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toEqual([]);
  });

  it("test_AS_017_delete_removes_task", () => {
    const tasks: Task[] = [makeTask({ id: "task-1" })];
    const event = deleteEvent({ id: "task-1" });

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toEqual([]);
  });

  it("returns tasks unchanged for an unknown event type", () => {
    const tasks: Task[] = [makeTask({ id: "task-1" })];
    const event = {
      eventType: "UNKNOWN",
      schema: "public",
      table: "tasks",
      commit_timestamp: "2026-08-30T00:00:00Z",
      new: {},
      old: {},
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Task>;

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toBe(tasks);
  });

  it("does not duplicate an insert for a task already in the list", () => {
    const tasks: Task[] = [makeTask({ id: "task-1" })];
    const event = insertEvent(makeTask({ id: "task-1" }));

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toHaveLength(1);
  });

  it("handles an empty task list naturally", () => {
    const tasks: Task[] = [];
    const event = deleteEvent({ id: "task-nonexistent" });

    const result = reconcileMyTasksRealtimeTask(tasks, event, USER_ID);

    expect(result).toEqual([]);
  });
});
