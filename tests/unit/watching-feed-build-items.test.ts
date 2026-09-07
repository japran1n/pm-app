import { describe, expect, it } from "vitest";

import {
  buildWatchedTaskItems,
  type WatchingQueryActivityRow,
  type WatchingQueryTaskRow,
} from "@/lib/queries/watching";

const TASK_A: WatchingQueryTaskRow = {
  id: "task-a",
  title: "Fix login bug",
  key: "PM-1",
  project_id: "proj-1",
  status: "in_progress",
  due_date: "2026-06-01",
  updated_at: "2026-06-01T10:00:00.000Z",
};

const TASK_B: WatchingQueryTaskRow = {
  id: "task-b",
  title: "Write onboarding docs",
  key: "PM-2",
  project_id: "proj-2",
  status: "todo",
  due_date: null,
  updated_at: "2026-06-05T10:00:00.000Z",
};

const projectNameById = new Map([
  ["proj-1", "Alpha"],
  ["proj-2", "Beta"],
]);

describe("buildWatchedTaskItems (Watching feed)", () => {
  it("falls back to the task's own updated_at when there is no activity yet", () => {
    const items = buildWatchedTaskItems(
      [TASK_A],
      projectNameById,
      new Map<string, WatchingQueryActivityRow>(),
      new Map<string, string | null>(),
    );

    expect(items).toHaveLength(1);
    expect(items[0].lastActivityAt).toBe(TASK_A.updated_at);
    expect(items[0].lastActivitySummary).toBeNull();
    expect(items[0].projectName).toBe("Alpha");
  });

  it("sorts by most recent activity, newest first", () => {
    const activityByTask = new Map<string, WatchingQueryActivityRow>([
      [
        "task-a",
        {
          task_id: "task-a",
          kind: "field_changed",
          field: "status",
          old_value: "todo",
          new_value: "in_progress",
          actor_id: "user-1",
          created_at: "2026-06-10T00:00:00.000Z",
        },
      ],
    ]);

    const items = buildWatchedTaskItems(
      [TASK_A, TASK_B],
      projectNameById,
      activityByTask,
      new Map([["user-1", "Alice"]]),
    );

    // task-a's activity (06-10) is newer than task-b's fallback
    // updated_at (06-05), so task-a must sort first.
    expect(items.map((item) => item.taskId)).toEqual(["task-a", "task-b"]);
  });

  it("renders a human-readable summary line for the latest activity entry", () => {
    const activityByTask = new Map<string, WatchingQueryActivityRow>([
      [
        "task-a",
        {
          task_id: "task-a",
          kind: "comment_added",
          field: null,
          old_value: null,
          new_value: null,
          actor_id: "user-1",
          created_at: "2026-06-10T00:00:00.000Z",
        },
      ],
    ]);

    const items = buildWatchedTaskItems(
      [TASK_A],
      projectNameById,
      activityByTask,
      new Map([["user-1", "Alice"]]),
    );

    expect(items[0].lastActivitySummary).toBe("Alice added a comment");
  });

  it("renders 'System' for a system-generated activity entry with no actor", () => {
    const activityByTask = new Map<string, WatchingQueryActivityRow>([
      [
        "task-a",
        {
          task_id: "task-a",
          kind: "comment_deleted",
          field: null,
          old_value: null,
          new_value: null,
          actor_id: null,
          created_at: "2026-06-10T00:00:00.000Z",
        },
      ],
    ]);

    const items = buildWatchedTaskItems(
      [TASK_A],
      projectNameById,
      activityByTask,
      new Map(),
    );

    expect(items[0].lastActivitySummary).toBe("System deleted a comment");
  });

  it("falls back to 'Unknown project' when a project name can't be resolved", () => {
    const items = buildWatchedTaskItems(
      [TASK_A],
      new Map(),
      new Map<string, WatchingQueryActivityRow>(),
      new Map(),
    );

    expect(items[0].projectName).toBe("Unknown project");
  });
});
