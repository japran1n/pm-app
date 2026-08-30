// @vitest-environment jsdom
//
// F006 (AS-012, AS-013, AS-014): PersonalTodoList's checkbox toggle uses
// React.useOptimistic so checking/unchecking a to-do updates the checkbox
// and strikethrough styling immediately, before the server responds
// (AS-012, AS-014), and reverts with an error toast if the server call
// fails (AS-013).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

let resolveToggle: ((value: unknown) => void) | null = null;
const toggleTodo = vi.fn(
  (_input: unknown) =>
    new Promise((resolve) => {
      resolveToggle = resolve;
    }),
);

vi.mock("@/lib/actions/personal-todos", () => ({
  createPersonalTodo: vi.fn(async () => ({ ok: true })),
  deleteTodo: vi.fn(async () => ({ ok: true })),
  toggleTodo: (input: unknown) => toggleTodo(input),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PersonalTodoList } from "@/components/my-tasks/personal-todo-list";
import type { PersonalTodo } from "@/lib/queries/personal-todos";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resolveToggle = null;
});

const TODOS: PersonalTodo[] = [
  { id: "todo-1", title: "Write handoff", isDone: false, position: 1000 },
];

const DONE_TODOS: PersonalTodo[] = [
  { id: "todo-1", title: "Write handoff", isDone: true, position: 1000 },
];

function renderList(initialTodos: PersonalTodo[]) {
  render(
    createElement(PersonalTodoList, { workspaceId: "workspace-1", initialTodos }),
  );
  return screen.getByLabelText(/mark "write handoff"/i) as HTMLButtonElement;
}

describe("PersonalTodoList optimistic checkbox toggle (F006, AS-012, AS-013, AS-014)", () => {
  it("test_AS_012_checking_a_task_marks_it_visually_complete_before_the_server_confirms", async () => {
    const checkbox = renderList(TODOS);

    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Write handoff")).not.toHaveClass("line-through");

    fireEvent.click(checkbox);

    // Optimistic update happens before toggleTodo's promise resolves.
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText("Write handoff")).toHaveClass("line-through");
    expect(toggleTodo).toHaveBeenCalledWith({ todoId: "todo-1", isDone: true });

    resolveToggle?.({ ok: true });
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));
  });

  it("test_AS_013_checkbox_reverts_and_shows_an_error_toast_when_the_toggle_fails", async () => {
    const checkbox = renderList(TODOS);

    fireEvent.click(checkbox);

    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText("Write handoff")).toHaveClass("line-through");

    resolveToggle?.({ ok: false, error: "Something went wrong." });

    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText("Write handoff")).not.toHaveClass("line-through");
    expect(toastError).toHaveBeenCalledWith("Failed to update task");
  });

  it("test_AS_014_unchecking_a_completed_task_marks_it_incomplete_immediately", async () => {
    const checkbox = renderList(DONE_TODOS);

    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Write handoff")).toHaveClass("line-through");

    fireEvent.click(checkbox);

    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText("Write handoff")).not.toHaveClass("line-through");
    expect(toggleTodo).toHaveBeenCalledWith({ todoId: "todo-1", isDone: false });

    resolveToggle?.({ ok: true });
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));
  });
});
