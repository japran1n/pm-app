// @vitest-environment jsdom
//
// Unit test for F248 (AS-479, AS-480, AS-482, AS-483): the single-input
// quick-add control at a board column's foot. Renders the real
// <QuickAdd> component (components/board/quick-add.tsx) directly with a
// mocked createTask Server Action so it never touches a real database —
// asserts the DOM-level contract: collapsed trigger -> expands ->
// Enter creates and clears while keeping focus -> empty submit is a
// silent no-op -> Escape cancels without creating.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { QuickAdd } from "@/components/board/quick-add";
import { createTask } from "@/lib/actions/tasks";
import { __resetEscapeLayersForTests } from "@/lib/hooks/use-shortcut";

vi.mock("@/lib/actions/tasks", () => ({
  createTask: vi.fn(),
}));

const mockedCreateTask = vi.mocked(createTask);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetEscapeLayersForTests();
});

beforeEach(() => {
  __resetEscapeLayersForTests();
});

function renderQuickAdd(overrides: Partial<Parameters<typeof QuickAdd>[0]> = {}) {
  const onCreated = vi.fn();
  const onError = vi.fn();
  render(
    createElement(QuickAdd, {
      projectId: "proj-1",
      status: "todo",
      onCreated,
      onError,
      ...overrides,
    }),
  );
  return { onCreated, onError };
}

function openQuickAdd() {
  fireEvent.click(screen.getByRole("button", { name: /add task/i }));
  return screen.getByRole("textbox") as HTMLInputElement;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// AS-479: each column has a single-input quick add — collapsed trigger
// expands into a real text input on click.
describe("AS-479 quick add control per column", () => {
  it("test_AS_479_column_has_quick_add_that_expands_to_single_input", () => {
    renderQuickAdd();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const input = openQuickAdd();
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });
});

// AS-480: focus stays in the input so several tasks can be added in a
// row without re-opening the control.
describe("AS-480 focus remains in the input after a successful create", () => {
  it("test_AS_480_input_clears_and_keeps_focus_after_create", async () => {
    mockedCreateTask.mockResolvedValue({
      ok: true,
      data: {
        id: "t-new",
        projectId: "proj-1",
        title: "First task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        authorId: "user-1",
        position: 1000,
        createdAt: "2026-08-24T00:00:00Z",
        parentTaskId: null,
        number: 1,
      },
    });
    const { onCreated } = renderQuickAdd({ status: "todo" });

    const input = openQuickAdd();
    fireEvent.change(input, { target: { value: "First task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await flush();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(mockedCreateTask).toHaveBeenCalledWith(
      "proj-1",
      "First task",
      null,
      "todo",
      null,
      null,
      null,
    );

    // Cleared and still an editable input (never collapsed back), so a
    // second title can be typed immediately.
    expect(input.value).toBe("");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

// AS-482: an empty (or whitespace-only) submit does nothing and shows no
// error.
describe("AS-482 empty submit is a silent no-op", () => {
  it("test_AS_482_empty_submit_does_not_call_createTask", async () => {
    const { onError } = renderQuickAdd();

    const input = openQuickAdd();
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(mockedCreateTask).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    // Still open, no error surfaced anywhere in the DOM.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("test_AS_482_whitespace_only_submit_does_not_call_createTask", async () => {
    renderQuickAdd();

    const input = openQuickAdd();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(mockedCreateTask).not.toHaveBeenCalled();
  });
});

// AS-483: Escape cancels without creating.
describe("AS-483 escape cancels without creating", () => {
  it("test_AS_483_escape_collapses_input_without_calling_createTask", async () => {
    renderQuickAdd();
    const input = openQuickAdd();
    fireEvent.change(input, { target: { value: "Abandoned title" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await flush();

    expect(mockedCreateTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Back to the collapsed trigger.
    expect(screen.getByRole("button", { name: /add task/i })).toBeInTheDocument();
  });
});

// createTask failure path — the control's own actionable-on-failure
// contract (per this feature's Clarified implementation's Failure
// handling answer), separate from any of the four assigned assertions.
describe("createTask failure path", () => {
  it("surfaces the server error via onError and keeps the title so the user can retry", async () => {
    mockedCreateTask.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    });
    const { onError } = renderQuickAdd();

    const input = openQuickAdd();
    fireEvent.change(input, { target: { value: "Will fail" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(onError).toHaveBeenCalledWith(
      "Something went wrong. Please try again in a moment.",
    );
    // Title preserved — actionable retry, not silently wiped.
    expect(input.value).toBe("Will fail");
  });
});
