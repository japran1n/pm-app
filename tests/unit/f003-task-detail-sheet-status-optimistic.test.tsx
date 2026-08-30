// @vitest-environment jsdom
//
// F003 (AS-005, AS-006): TaskDetailSheet's status Select updates its badge/
// value the instant a new status is chosen — before moveTaskStatus's server
// round trip resolves (AS-005) — and reverts, with an error toast naming
// the target status, if the server rejects the change (AS-006).
//
// Mounts the real <Board> the same way
// tests/unit/f246-task-detail-sheet-copy-link.test.tsx does (Radix Sheet
// only portals its content when actually open). The real
// components/ui/select.tsx wraps @base-ui/react's pointer-event-driven
// combobox, which jsdom cannot reliably drive (same constraint documented
// in tests/unit/list-priority-select-optimistic.test.tsx and
// tests/unit/f325-board-toolbar-groupby-none.test.tsx) — so, following
// list-priority-select-optimistic.test.tsx's own established pattern, this
// replaces <Select>/<SelectTrigger>/<SelectContent>/<SelectItem> with a bare
// native <select>, wired to the same value/onValueChange contract, to
// exercise TaskDetailSheet's REAL handleStatusChange through a real DOM
// change event.

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

let latestValue: string | undefined;
let latestOnValueChange: ((value: string | null) => void) | null = null;
let latestId: string | undefined;
let latestDisabled: boolean | undefined;

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
  }) => {
    latestValue = value;
    latestOnValueChange = onValueChange;
    latestDisabled = disabled;
    return createElement(Fragment, null, children);
  },
  SelectTrigger: ({ id, children }: { id?: string; children: ReactNode }) => {
    latestId = id;
    return createElement(Fragment, null, children);
  },
  SelectContent: ({ children }: { children: ReactNode }) => {
    // Snapshot the enclosing Select/SelectTrigger's props at THIS render —
    // several <Select> instances exist in the tree simultaneously (the
    // board's group-by dropdown, this Status select, the Priority select),
    // all sharing the same module-level `latest*` variables set just
    // before each one's own SelectContent renders. The onChange closure
    // below must close over a per-instance snapshot, not the live mutable
    // variable, or every rendered <select>'s onChange would fire whichever
    // Select happened to render LAST in the whole tree instead of its own.
    const onValueChange = latestOnValueChange;
    const id = latestId;
    const disabled = latestDisabled;
    const value = latestValue;
    return createElement(
      "select",
      {
        id,
        disabled,
        value,
        onChange: (e: { target: { value: string } }) =>
          onValueChange?.(e.target.value),
      },
      children,
    );
  },
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectValue: () => null,
}));

// Resolved manually per-test so the "instant" optimistic update can be
// observed BEFORE the server call settles.
let resolveMoveTaskStatus: ((value: unknown) => void) | null = null;
const moveTaskStatus = vi.fn(
  (_taskId: string, _status: string) =>
    new Promise((resolve) => {
      resolveMoveTaskStatus = resolve;
    }),
);

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  moveTaskStatus: (taskId: string, status: string) =>
    moveTaskStatus(taskId, status),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Status task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resolveMoveTaskStatus = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Status task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetStatusSelect() {
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
      screen.getByDisplayValue("Status task", { exact: false }),
    ).toBeInTheDocument(),
  );

  return screen.getByLabelText("Status") as HTMLSelectElement;
}

describe("TaskDetailSheet status Select optimistic update (F003, AS-005, AS-006)", () => {
  it("test_AS_005_status_updates_immediately_before_the_server_responds", async () => {
    const statusSelect = await openSheetAndGetStatusSelect();
    expect(statusSelect.value).toBe("todo");

    fireEvent.change(statusSelect, { target: { value: "done" } });

    // Assert the optimistic value is applied before moveTaskStatus's
    // promise has resolved at all (resolveMoveTaskStatus hasn't been
    // called yet — this proves the update did not wait on the server).
    await waitFor(() => expect(statusSelect.value).toBe("done"));
    expect(moveTaskStatus).toHaveBeenCalledWith("t1", "done");
    expect(resolveMoveTaskStatus).not.toBeNull();

    // Cleanup: resolve so the pending transition doesn't leak across tests.
    resolveMoveTaskStatus?.({ ok: true, data: { status: "done" } });
    await waitFor(() => {});
  });

  it("test_AS_006_status_reverts_and_shows_an_error_toast_on_server_failure", async () => {
    const statusSelect = await openSheetAndGetStatusSelect();

    fireEvent.change(statusSelect, { target: { value: "in_progress" } });

    await waitFor(() => expect(statusSelect.value).toBe("in_progress"));

    resolveMoveTaskStatus?.({ ok: false, error: "Network error" });

    await waitFor(() => expect(statusSelect.value).toBe("todo"));
    expect(toastError).toHaveBeenCalledWith(
      "Failed to set status to In progress",
    );
  });
});
