// @vitest-environment jsdom
//
// UX audit fix (list page, Nalaz 2): a task with no due date previously
// rendered a bare, empty `<input type="date">`, which shows the browser's
// own locale placeholder pattern text (e.g. "dd. mm. yyyy.") directly in
// the cell — looking like a broken/garbled date rather than "no due date
// set". This test proves the fixed behaviour: an empty cell renders a
// plain "Set date" button (no native date input, hence no placeholder
// text can leak through) and only swaps to a real date input once the
// user clicks it.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "member" }),
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
});

describe("ListDueDateCell empty state (Nalaz 2)", () => {
  it("test_due_date_cell_shows_set_date_button_not_a_raw_empty_date_input_when_no_date", async () => {
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: vi.fn() }));

    const { ListDueDateCell } = await import("@/components/task/list-due-date-cell");

    render(createElement(ListDueDateCell, { taskId: "task-1", dueDate: null }));

    // No native date input should be present at all — that's exactly what
    // renders the raw placeholder pattern text.
    expect(screen.queryByLabelText("Change due date for task task-1")).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Set due date for task task-1" });
    expect(button).toHaveTextContent("Set date");

    vi.doUnmock("@/lib/actions/tasks");
  });

  it("test_due_date_cell_swaps_set_date_button_for_a_real_date_input_on_click", async () => {
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: vi.fn() }));

    const { ListDueDateCell } = await import("@/components/task/list-due-date-cell");

    render(createElement(ListDueDateCell, { taskId: "task-1", dueDate: null }));

    const button = screen.getByRole("button", { name: "Set due date for task task-1" });
    fireEvent.click(button);

    const input = screen.getByLabelText("Change due date for task task-1") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe("date");
    expect(input.value).toBe("");

    vi.doUnmock("@/lib/actions/tasks");
  });

  it("test_due_date_cell_with_existing_date_renders_the_input_directly_not_a_button", async () => {
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: vi.fn() }));

    const { ListDueDateCell } = await import("@/components/task/list-due-date-cell");

    render(createElement(ListDueDateCell, { taskId: "task-1", dueDate: "2026-09-01" }));

    expect(screen.queryByRole("button", { name: /Set due date/ })).not.toBeInTheDocument();
    const input = screen.getByLabelText("Change due date for task task-1") as HTMLInputElement;
    expect(input.value).toBe("2026-09-01");

    vi.doUnmock("@/lib/actions/tasks");
  });
});
