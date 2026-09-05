// @vitest-environment jsdom
//
// F118 (AS-065): "A task created through a board or list quick-add
// carries the task type the user picked, when the entry point exposes a
// picker." QuickAdd's layout has no room for a type picker without a
// redesign (see this feature's own handoff) — this test documents and
// locks in the negative/vacuous case the assertion's own wording exists
// for: no picker is rendered, and a task created through quick-add
// carries no type override at all (the DB's own `delivery` default,
// F116, still applies unmodified).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const createTask = vi.fn(async () => ({
  ok: true,
  data: {
    id: "t1",
    projectId: "p1",
    title: "Quick task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
}));

vi.mock("@/lib/actions/tasks", () => ({
  createTask: (...args: Parameters<typeof createTask>) => createTask(...args),
}));

vi.mock("@/lib/hooks/use-shortcut", () => ({
  useEscapeLayer: vi.fn(),
}));

import { QuickAdd } from "@/components/board/quick-add";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuickAdd has no task type picker (F118, AS-065 negative case)", () => {
  it("test_AS_065_quick_add_exposes_no_type_picker_and_creates_a_task_with_no_type_override", async () => {
    render(
      createElement(QuickAdd, {
        projectId: "p1",
        status: "todo",
        onCreated: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    // No Select/combobox of any kind renders in this control at all —
    // the whole surface is a single text input.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText("Task title");
    fireEvent.change(input, { target: { value: "Quick task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    // createTask(projectId, title, description, status, priority,
    // assigneeId, dueDate) — quick-add never supplies an 8th
    // (taskTypeId) argument, so the database's own delivery default
    // (F116) is exactly what still applies.
    const callArgs = createTask.mock.calls[0]!;
    expect(callArgs).toHaveLength(7);
  });
});
