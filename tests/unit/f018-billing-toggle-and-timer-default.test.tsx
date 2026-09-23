// @vitest-environment jsdom
//
// F018 (TT-041): the task detail sheet's Billing toggle shows/edits
// `tasks.billable` (F017) via editTask({ billable }), and the manual
// log-time form's billable draft defaults from the task's own billable
// flag rather than a hardcoded `true`. Same "mount the real Board, drive
// real DOM events" pattern as tests/unit/f011-task-detail-estimate-input
// .test.tsx.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

let resolveEditTask: ((value: unknown) => void) | null = null;
const editTask = vi.fn(
  (_taskId: string, _updates: unknown) =>
    new Promise((resolve) => {
      resolveEditTask = resolve;
    }),
);

function makeTaskDetail(taskId: string, billable: boolean) {
  return {
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Billing task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        billable,
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  };
}

const getTaskDetailMock = vi.fn(async (taskId: string) => makeTaskDetail(taskId, true));

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: (taskId: string, updates: unknown) => editTask(taskId, updates),
  setTaskBlockedReason: vi.fn(async () => ({ ok: true })),
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: (taskId: string) => getTaskDetailMock(taskId),
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
  resolveEditTask = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Billing task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetBillableToggle() {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks: TASKS,
      timezone: "UTC",
    }),
  );

  await waitFor(() => expect(getTaskDetailMock).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(screen.getByTestId("task-billable-toggle")).toBeInTheDocument(),
  );

  return screen.getByTestId("task-billable-toggle") as HTMLElement;
}

describe("TaskDetailFields Billing toggle (F018, TT-041)", () => {
  it("test_TT_041_shows_billable_as_the_default_state_for_a_billable_task", async () => {
    const toggle = await openSheetAndGetBillableToggle();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("task-billable-label")).toHaveTextContent("Billable");
  });

  it("test_TT_041_shows_non_billable_for_a_task_marked_non_billable", async () => {
    getTaskDetailMock.mockImplementationOnce(async (taskId: string) =>
      makeTaskDetail(taskId, false),
    );

    const toggle = await openSheetAndGetBillableToggle();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("task-billable-label")).toHaveTextContent(
      "Non-billable",
    );
  });

  it("test_TT_041_toggling_billing_calls_editTask_and_updates_the_label", async () => {
    const toggle = await openSheetAndGetBillableToggle();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith("t1", { billable: false }),
    );

    resolveEditTask?.({ ok: true, data: { billable: false } });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Marked as non-billable."),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByTestId("task-billable-label")).toHaveTextContent(
      "Non-billable",
    );
  });

  it("test_TT_041_new_time_entries_default_their_billable_flag_from_the_task", async () => {
    getTaskDetailMock.mockImplementationOnce(async (taskId: string) =>
      makeTaskDetail(taskId, false),
    );

    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetailMock).toHaveBeenCalledWith("t1"));

    // The manual log-time form's own billable checkbox — separate control
    // from the detail sheet's Billing toggle above — should start
    // unchecked because this task's `billable` is false.
    await waitFor(() =>
      expect(screen.getByLabelText("Billable", { selector: "#time-billable-t1" })).toBeInTheDocument(),
    );
    const timeBillableCheckbox = screen.getByLabelText("Billable", {
      selector: "#time-billable-t1",
    }) as HTMLInputElement;
    expect(timeBillableCheckbox.checked).toBe(false);
  });
});
