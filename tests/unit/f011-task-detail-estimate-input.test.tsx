// @vitest-environment jsdom
//
// F011 (TT-023): the Estimate input in TaskDetailFields accepts human
// strings ("2h", "90m", "1h 30m"), parses them via
// lib/time/parse-estimate.ts, and persists the resulting minutes through
// editTask({ estimateMinutes }) on blur — clearing the field saves
// `estimateMinutes: null`. Same "mount the real Board, drive real DOM
// events" pattern as tests/unit/f005-task-detail-sheet-title-optimistic
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

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: (taskId: string, updates: unknown) => editTask(taskId, updates),
  setTaskBlockedReason: vi.fn(async () => ({ ok: true })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Original title",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        estimateMinutes: 120,
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
  resolveEditTask = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Original title",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetEstimateInput() {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks: TASKS,
      timezone: "UTC",
    }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(screen.getByTestId("task-estimate-input")).toBeInTheDocument(),
  );

  return screen.getByTestId("task-estimate-input") as HTMLInputElement;
}

describe("TaskDetailFields estimate input (F011, TT-023)", () => {
  it("test_TT_023_shows_the_current_estimate_formatted_as_a_human_string", async () => {
    const estimateInput = await openSheetAndGetEstimateInput();

    expect(estimateInput.value).toBe("2 hr");
  });

  it("test_TT_023_parses_a_human_estimate_string_and_persists_the_parsed_minutes_on_blur", async () => {
    const estimateInput = await openSheetAndGetEstimateInput();

    fireEvent.change(estimateInput, { target: { value: "1h 30m" } });
    fireEvent.blur(estimateInput);

    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith("t1", { estimateMinutes: 90 }),
    );

    resolveEditTask?.({ ok: true, data: {} });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Estimate updated."));
  });

  it("test_TT_023_parses_bare_minutes_shorthand_like_90m", async () => {
    const estimateInput = await openSheetAndGetEstimateInput();

    fireEvent.change(estimateInput, { target: { value: "90m" } });
    fireEvent.blur(estimateInput);

    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith("t1", { estimateMinutes: 90 }),
    );
  });

  it("test_TT_023_clearing_the_estimate_field_persists_estimateMinutes_null", async () => {
    const estimateInput = await openSheetAndGetEstimateInput();

    fireEvent.change(estimateInput, { target: { value: "" } });
    fireEvent.blur(estimateInput);

    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith("t1", { estimateMinutes: null }),
    );

    resolveEditTask?.({ ok: true, data: {} });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Estimate cleared."));
  });

  it("test_TT_023_an_unparseable_estimate_is_not_saved_and_reverts_the_input", async () => {
    const estimateInput = await openSheetAndGetEstimateInput();

    fireEvent.change(estimateInput, { target: { value: "not a duration" } });
    fireEvent.blur(estimateInput);

    expect(editTask).not.toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(estimateInput.value).toBe("2 hr"));
  });
});
