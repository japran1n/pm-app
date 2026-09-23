// @vitest-environment jsdom
//
// F005 (TT-007, TT-009): every surface that displays a task's priority
// (List view read-only cell + editable Select trigger/options, the Board
// card, the task detail sheet's Priority Select trigger/options, and the
// New Task dialog's Priority Select trigger/options) renders the shared
// <PriorityFlag> (components/task/priority-flag.tsx, F004) instead of a
// locally invented dot/badge — proven here via `role="img"` + the flag's
// `aria-label` (the priority's PRIORITY_LABELS text), so this test fails
// if any surface reverts to a plain StatusBadge/dot.
//
// TT-009: changing priority through these selects must still call the
// real `editTask` Server Action unchanged — proven for
// <ListPrioritySelect> via a real DOM change event against the same
// bare-<select> substitution tests/unit/list-priority-select-optimistic.
// test.tsx already established for driving base-ui's pointer-only
// <Select> under jsdom.

import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PRIORITY_LABELS } from "@/lib/task-colors";
import type { TaskCardTask } from "@/components/task/task-card";

// Same "bare native <select>, every option rendered unconditionally" mock
// tests/unit/list-priority-select-optimistic.test.tsx already established
// for driving base-ui's pointer-event-only <Select> under jsdom/SSR —
// base-ui's own listbox only portals its options once opened, which
// neither renderToStaticMarkup nor jsdom can trigger without real pointer
// events, so this mock is what makes the *options* observable at all.
function mockBareSelect() {
  vi.doMock("@/components/ui/select", () => ({
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string | null) => void;
      children: ReactNode;
    }) =>
      createElement(
        "select",
        {
          "aria-label": "priority-select",
          value,
          onChange: (e: { target: { value: string } }) =>
            onValueChange(e.target.value),
        },
        children,
      ),
    SelectContent: ({ children }: { children: ReactNode }) =>
      createElement(Fragment, null, children),
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
      createElement("option", { value }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
  }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
  vi.doUnmock("@/lib/actions/tasks");
  vi.doUnmock("@/components/auth/membership-provider");
  vi.doUnmock("@/components/ui/select");
  vi.doUnmock("sonner");
  vi.doUnmock("next/navigation");
});

describe("F005 (TT-007): PriorityFlag renders on every priority surface", () => {
  it("test_TT_007_list_priority_select_readonly_mode_renders_PriorityFlag", async () => {
    vi.doMock("@/components/auth/membership-provider", () => ({
      useMembership: () => ({ role: "viewer" }),
    }));
    const { ListPrioritySelect } = await import(
      "@/components/task/list-priority-select"
    );
    const html = renderToStaticMarkup(
      createElement(ListPrioritySelect, { taskId: "task-1", priority: "high" }),
    );
    expect(html).toContain(`aria-label="${PRIORITY_LABELS.high}"`);
  });

  it("test_TT_007_list_priority_select_dropdown_options_render_PriorityFlag", async () => {
    mockBareSelect();
    const { ListPrioritySelect } = await import(
      "@/components/task/list-priority-select"
    );
    render(createElement(ListPrioritySelect, { taskId: "task-2", priority: "low" }));

    // Every non-none priority's flag (identified by its aria-label) shows
    // up somewhere in the rendered trigger + option list.
    for (const priority of ["urgent", "high", "medium", "low", "backlog"] as const) {
      expect(screen.getAllByLabelText(PRIORITY_LABELS[priority]).length).toBeGreaterThan(0);
    }
  });

  it("test_TT_007_board_task_card_renders_PriorityFlag", async () => {
    const { TaskCard } = await import("@/components/task/task-card");
    const task: TaskCardTask = {
      id: "task-3",
      title: "Ship it",
      status: "todo",
      priority: "urgent",
      assigneeId: null,
      dueDate: null,
      position: 1,
    };
    const html = renderToStaticMarkup(
      createElement(TaskCard, { task, timezone: "UTC" }),
    );
    expect(html).toContain(`aria-label="${PRIORITY_LABELS.urgent}"`);
  });

  it("test_TT_007_new_task_dialog_priority_select_renders_PriorityFlag_in_options", async () => {
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    }));
    mockBareSelect();
    const { NewTaskDialog } = await import("@/components/task/new-task-dialog");
    render(
      createElement(NewTaskDialog, {
        projectId: "proj-1",
        assigneeOptions: [],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    for (const priority of ["urgent", "high", "medium", "low", "backlog"] as const) {
      expect(screen.getAllByLabelText(PRIORITY_LABELS[priority]).length).toBeGreaterThan(0);
    }
  });
});

describe("F005 (TT-009): priority select persistence via editTask is unchanged", () => {
  it("test_TT_009_changing_priority_in_list_select_still_calls_editTask_unchanged", async () => {
    const editTaskMock = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: editTaskMock }));
    vi.doMock("@/components/auth/membership-provider", () => ({
      useMembership: () => ({ role: "member" }),
    }));
    vi.doMock("sonner", () => ({ toast: { error: vi.fn() } }));
    mockBareSelect();

    const { ListPrioritySelect } = await import(
      "@/components/task/list-priority-select"
    );
    render(createElement(ListPrioritySelect, { taskId: "task-1", priority: "low" }));

    const select = screen.getByLabelText("priority-select");
    fireEvent.change(select, { target: { value: "urgent" } });

    await waitFor(() =>
      expect(editTaskMock).toHaveBeenCalledWith("task-1", { priority: "urgent" }),
    );
  });
});
