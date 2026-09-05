// @vitest-environment jsdom
//
// F118 (AS-064): a task created through the New Task dialog carries the
// task type the user picked in that dialog. Mirrors
// tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx's own
// "mock @/components/ui/select with a bare native <select>" pattern, but
// mounts <NewTaskDialog> directly rather than the whole Board.

import { createElement, Fragment, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Same per-instance-snapshot pattern as
// tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx's own
// doc comment explains: several <Select> instances (priority/type/phase)
// share these module-level `latest*` variables, but SelectContent
// captures a fresh snapshot of them at ITS OWN render (which always
// happens immediately after that same Select's SelectTrigger sets them,
// before the next sibling <Select> mounts).
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
    const onValueChange = latestOnValueChange;
    const id = latestId;
    const disabled = latestDisabled;
    const value = latestValue;
    return createElement(
      "select",
      {
        "aria-label": id,
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

const createTask = vi.fn(async () => ({
  ok: true,
  data: { id: "t1", title: "New task", projectId: "p1" },
}));

vi.mock("@/lib/actions/tasks", () => ({
  createTask: (...args: Parameters<typeof createTask>) => createTask(...args),
  setTaskAssignees: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/actions/phases", () => ({
  getProjectPhaseOptions: vi.fn(async () => ({ ok: true, data: { phases: [] } })),
  setTaskPhase: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/actions/task-types", () => ({
  getProjectTaskTypeOptions: vi.fn(async () => ({
    ok: true,
    data: {
      taskTypes: [
        { id: "type-page", name: "Page", color: "#111111", position: 1, systemKey: "page", isBillable: true },
        { id: "type-qa", name: "QA issue", color: "#222222", position: 2, systemKey: "qa", isBillable: false },
      ],
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NewTaskDialog } from "@/components/task/new-task-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewTaskDialog task type picker (F118, AS-064)", () => {
  it("test_AS_064_a_task_created_through_the_new_task_dialog_carries_the_picked_task_type", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));

    const typeSelect = await waitFor(() =>
      screen.getByLabelText("task-type") as HTMLSelectElement,
    );

    fireEvent.change(typeSelect, { target: { value: "type-qa" } });

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Fix broken layout" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    // createTask(projectId, title, description, status, priority,
    // assigneeId, dueDate, parentTaskId, taskTypeId) — the picked type's
    // id must be the LAST positional argument this call passes.
    const callArgs = createTask.mock.calls[0]!;
    expect(callArgs[callArgs.length - 1]).toBe("type-qa");
  });

  it("test_AS_064_leaving_the_picker_untouched_never_forces_a_type_override", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    await waitFor(() => screen.getByLabelText("task-type"));

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Untyped task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    const callArgs = createTask.mock.calls[0]!;
    // Not overriding the picker must pass `undefined`, so the database's
    // own delivery default (F116) still applies — never a forged value.
    expect(callArgs[callArgs.length - 1]).toBeUndefined();
  });
});
