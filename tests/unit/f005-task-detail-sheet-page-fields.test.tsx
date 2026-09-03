// @vitest-environment jsdom
//
// F005 (missions/20260903-portal, AS-014): TaskDetailSheet's Page
// slug/order fields — this feature's own Definition of done, side-effect
// verification: "the task detail sheet still works for non-page tasks,
// with the new fields hidden."
//
// Mirrors tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx's
// own pattern exactly: mounting the real <Board>, mocking
// @/components/ui/select with a bare native <select> (the Sheet also
// renders the unrelated Status/Priority/Phase Selects on every open), and
// mocking `next/navigation`'s `useSearchParams` to a fixed `?taskId=t1`
// — which is why every scenario below reuses the SAME task id "t1" and
// varies `getTaskDetail`'s resolved value per test via
// `mockImplementationOnce`, rather than varying the id.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string | null) => void;
    disabled?: boolean;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      {
        value,
        disabled,
        onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
      },
      children,
    ),
  SelectTrigger: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectContent: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectValue: () => null,
}));

const editTask = vi.fn(async (_taskId: string, _updates: unknown) => ({
  ok: true,
  data: {},
}));

function baseTask(overrides: Record<string, unknown>) {
  return {
    id: "t1",
    title: "Board task",
    description: null,
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    tags: [],
    projectId: "project-1",
    ...overrides,
  };
}

const getTaskDetail = vi.fn(async (taskId: string) => ({
  ok: true,
  data: {
    task: baseTask({ id: taskId }),
    comments: [],
    attachments: [],
    currentUserId: "user-1",
    currentUserRole: "member",
  },
}));

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: (taskId: string, updates: unknown) => editTask(taskId, updates),
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: (taskId: string) => getTaskDetail(taskId),
}));

vi.mock("@/lib/actions/phases", () => ({
  getProjectPhaseOptions: vi.fn(async () => ({ ok: true, data: { phases: [] } })),
  setTaskPhase: vi.fn(async () => ({ ok: true, data: { id: "t1", phaseId: null } })),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Board task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheet() {
  render(
    createElement(Board, { projectId: "project-1", initialTasks: TASKS, timezone: "UTC" }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(screen.getByDisplayValue("Board task", { exact: false })).toBeInTheDocument(),
  );
}

describe("TaskDetailSheet Page slug/order fields (F005, AS-014)", () => {
  it("test_AS_014_shows_page_slug_and_order_prefilled_for_a_page_type_task", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "Page",
          pageSlug: "about-us",
          pageOrder: 3,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    expect(screen.getByTestId("page-fields")).toBeInTheDocument();
    expect(screen.getByLabelText("Page slug")).toHaveValue("about-us");
    expect(screen.getByLabelText("Page order")).toHaveValue(3);
  });

  it("test_AS_014_hides_page_fields_entirely_for_a_non_page_task", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({ id: taskId, taskTypeName: "QA", pageSlug: null, pageOrder: null }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    expect(screen.queryByTestId("page-fields")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Page slug")).not.toBeInTheDocument();
  });

  it("side-effect verification: hides page fields (and does not crash) for a task with no type set at all", async () => {
    // `getTaskDetail`'s default mock implementation (no taskTypeName) —
    // proves an ordinary, unrelated task (existing tests/fixtures never
    // updated to carry a type) still renders correctly with no page
    // fields at all.
    await openSheet();

    expect(screen.queryByTestId("page-fields")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Board task")).toBeInTheDocument();
  });

  it("test_AS_014_editing_the_page_slug_commits_on_blur_via_editTask", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "Page",
          pageSlug: "about-us",
          pageOrder: 3,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    const slugInput = screen.getByLabelText("Page slug");
    fireEvent.change(slugInput, { target: { value: "New-Slug" } });
    fireEvent.blur(slugInput);

    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith("t1", { pageSlug: "new-slug" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Page slug updated."));
  });

  it("test_AS_014_editing_the_page_order_commits_on_blur_via_editTask", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "Page",
          pageSlug: "about-us",
          pageOrder: 3,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    const orderInput = screen.getByLabelText("Page order");
    fireEvent.change(orderInput, { target: { value: "7" } });
    fireEvent.blur(orderInput);

    await waitFor(() => expect(editTask).toHaveBeenCalledWith("t1", { pageOrder: 7 }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Page order updated."));
  });

  it("rejects a non-integer page order and reverts, without calling editTask", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "Page",
          pageSlug: "about-us",
          pageOrder: 3,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    // A plain <input type="number"> (no `step`) accepts a decimal like
    // "3.5" at the DOM level — the rejection has to be this feature's own
    // blur-handler check (Number.isInteger), not something the input
    // type itself already prevents.
    const orderInput = screen.getByLabelText("Page order");
    fireEvent.change(orderInput, { target: { value: "3.5" } });
    fireEvent.blur(orderInput);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Page order must be a whole number."),
    );
    expect(editTask).not.toHaveBeenCalled();
    expect(orderInput).toHaveValue(3);
  });
});
