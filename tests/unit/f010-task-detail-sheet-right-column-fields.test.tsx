// @vitest-environment jsdom
//
// F010 (TT-021, TT-025): the right column populated by F009's shell now
// shows the task's field controls (status, assignees, priority, dates,
// tags, time-tracked summary) — TT-021 — while every previously existing
// detail capability (watchers, checklist, subtasks, dependencies) keeps
// working — TT-025. Mirrors tests/unit/f009-task-detail-sheet-two-column-
// shell.test.tsx's own render/mock setup exactly.

import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/custom-fields", () => ({
  getCustomFieldsForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  setTaskCustomFieldValue: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/actions/page-links", () => ({
  getPageLinksForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createPageLink: vi.fn(),
  updatePageLink: vi.fn(),
  deletePageLink: vi.fn(),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Right column task",
        description: null,
        status: "todo",
        priority: "high",
        assigneeId: null,
        assigneeIds: [],
        dueDate: "2026-10-01",
        startDate: "2026-09-20",
        tags: ["design", "urgent"],
        projectKey: "RC",
        number: 3,
        checklistItems: [
          { id: "c1", content: "Do the thing", isChecked: false, position: 0 },
        ],
        children: [],
        dependencies: { blockedBy: [], blocks: [] },
        watcherIds: [],
        isWatching: false,
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams("taskId=t1"),
}));

vi.mock("@/lib/actions/comments", () => ({
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: [] })),
}));

import { Board } from "@/components/board/board";
import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";

function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Right column task",
    status: "todo",
    priority: "high",
    assigneeId: null,
    dueDate: "2026-10-01",
    position: 1000,
    projectKey: "RC",
    number: 3,
  },
];

describe("TaskDetailSheet right column fields (F010, TT-021/TT-025)", () => {
  it("test_TT_021_right_column_shows_status_assignees_priority_dates_tags_time_tracked", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Right column task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const rightColumn = await screen.findByTestId("detail-right-column");
    await waitFor(() => expect(rightColumn).not.toBeEmptyDOMElement());

    // Status, priority, dates all render as label+control rows inside
    // the right column, not the old left-column metadata grid.
    expect(within(rightColumn).getByText("Status")).toBeInTheDocument();
    expect(within(rightColumn).getByLabelText("Status")).toBeInTheDocument();
    expect(within(rightColumn).getByText("Priority")).toBeInTheDocument();
    expect(within(rightColumn).getByLabelText("Priority")).toBeInTheDocument();
    expect(within(rightColumn).getByText("Start date")).toBeInTheDocument();
    expect(within(rightColumn).getByLabelText("Start date")).toBeInTheDocument();
    expect(within(rightColumn).getByText("Due date")).toBeInTheDocument();
    expect(within(rightColumn).getByLabelText("Due date")).toBeInTheDocument();
    expect(within(rightColumn).getByText("Assignees")).toBeInTheDocument();

    // Tags editor and a time-tracked summary both live in the right
    // column now, not inline in the old left-column composition block.
    expect(within(rightColumn).getByText("design")).toBeInTheDocument();
    expect(within(rightColumn).getByText("urgent")).toBeInTheDocument();
    expect(within(rightColumn).getByText("Time tracked")).toBeInTheDocument();
  });

  it("test_TT_025_existing_detail_capabilities_still_work_alongside_right_column", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Right column task", { exact: false }),
      ).toBeInTheDocument(),
    );

    // TT-025: checklist (an existing detail capability) still renders
    // and shows its item, unaffected by the right-column move.
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Do the thing", { exact: false }),
      ).toBeInTheDocument(),
    );

    // Delete task control (footer capability) still present.
    expect(
      screen.getByRole("button", { name: /delete task/i }),
    ).toBeInTheDocument();

    // Duplicate control (footer capability) still present.
    expect(
      screen.getByRole("button", { name: /duplicate/i }),
    ).toBeInTheDocument();
  });
});
