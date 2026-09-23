// @vitest-environment jsdom
//
// F003 (TT-003, TT-005): every task date/duration call site this feature
// touches (TaskCard's due date, MyTaskRowItem's due date, TimeTracking's
// per-entry date) renders through the shared `formatTaskDate`/
// `formatDuration` helpers — no en-US "Sep 14, 2026" / "1h 30m" strings —
// and always in a mono font. These tests derive from the assertion text
// (the rendered string's shape + the font-mono class), not from the
// implementation that produces them.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

describe("TT-003: no en-US 'Sep 14, 2026' task date anywhere it used to render", () => {
  it("TaskCard's due date reads '11 Sep 2026', not 'Sep 11, 2026'", async () => {
    const { TaskCard } = await import("@/components/task/task-card");
    render(
      createElement(TaskCard, {
        task: {
          id: "task-1",
          title: "Ship the release",
          status: "todo",
          priority: null,
          assigneeId: null,
          dueDate: "2026-09-11",
          position: 1000,
        },
        timezone: "UTC",
      }),
    );
    expect(screen.getByText("11 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText(/Sep 11, 2026/)).not.toBeInTheDocument();
  });

  it("TimeTracking's per-entry date reads '11 Sep 2026', not 'Sep 11, 2026'", async () => {
    vi.doMock("@/lib/actions/time-entries", () => ({
      logTimeEntry: vi.fn(),
      updateTimeEntry: vi.fn(),
      deleteTimeEntry: vi.fn(),
      startTimer: vi.fn(),
      stopTimer: vi.fn(),
    }));
    const { TimeTracking } = await import("@/components/task/time-tracking");
    render(
      createElement(TimeTracking, {
        taskId: "task-1",
        taskTags: [],
        timeEntries: [
          {
            id: "entry-1",
            taskId: "task-1",
            userId: "user-1",
            minutes: 90,
            entryDate: "2026-09-11",
            billable: true,
            workCategory: null,
            note: null,
          },
        ],
        members: [{ userId: "user-1", name: "Alex", email: "alex@example.com" }],
        currentUserId: "user-1",
        currentUserRole: "member",
      }),
    );
    expect(screen.getByText("11 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText(/Sep 11, 2026/)).not.toBeInTheDocument();
    vi.doUnmock("@/lib/actions/time-entries");
  });
});

describe("TT-005: dates and durations render in mono font", () => {
  it("TaskCard's due date and duration carry font-mono", async () => {
    const { TaskCard } = await import("@/components/task/task-card");
    render(
      createElement(TaskCard, {
        task: {
          id: "task-1",
          title: "Ship the release",
          status: "todo",
          priority: null,
          assigneeId: null,
          dueDate: "2026-09-11",
          totalMinutes: 90,
          position: 1000,
        },
        timezone: "UTC",
      }),
    );
    const dueDateText = screen.getByText((_, node) =>
      node?.tagName === "SPAN" && !!node.textContent?.includes("11 Sep 2026"),
    );
    expect(dueDateText.className).toMatch(/font-mono/);

    const durationText = screen.getByText("1 hr 30 min");
    expect(durationText.closest(".font-mono")).not.toBeNull();
  });

  it("MyTaskRowItem's due date cell carries font-mono", async () => {
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
    vi.doMock("@/lib/actions/tasks", () => ({
      editTask: vi.fn(async () => ({ ok: true })),
      moveTaskStatus: vi.fn(async () => ({ ok: true })),
    }));
    vi.doMock("@/components/auth/membership-provider", () => ({
      useMembership: () => null,
    }));
    const { MyTaskRowItem } = await import("@/components/task/my-task-row");
    const { Table, TableBody } = await import("@/components/ui/table");
    render(
      createElement(
        Table,
        null,
        createElement(
          TableBody,
          null,
          createElement(MyTaskRowItem, {
            row: {
              id: "task-1",
              title: "Write the report",
              status: "todo",
              statusCategory: null,
              priority: "high",
              dueDate: "2026-09-11",
              number: 1,
              projectId: "proj-1",
              projectKey: "ACME",
              projectName: "Acme project",
              isDone: false,
              bucket: "today",
              isWatched: false,
              isAssigned: true,
              clientVisible: false,
              pendingClientApproval: false,
              taskType: null,
              estimateMinutes: null,
              totalMinutes: 0,
            } as never,
            workspaceSlug: "acme",
            timezone: "UTC",
          }),
        ),
      ),
    );
    const cell = screen.getByText("11 Sep 2026");
    expect(cell.className).toMatch(/font-mono/);
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/lib/actions/tasks");
    vi.doUnmock("@/components/auth/membership-provider");
  });
});
