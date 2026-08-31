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
const pendingResolvers: Array<(value: unknown) => void> = [];
const toggleTodo = vi.fn(
  (_input: unknown) =>
    new Promise((resolve) => {
      resolveToggle = resolve;
      pendingResolvers.push(resolve);
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
  pendingResolvers.length = 0;
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

  // F013 (AS-013): a thrown rejection (network loss, 500, serialization
  // error) must revert + toast exactly like an `{ ok: false }` return —
  // not just be silently swallowed.
  it("test_AS_013_checkbox_reverts_and_shows_an_error_toast_when_the_server_action_throws", async () => {
    toggleTodo.mockImplementationOnce(() => Promise.reject(new Error("network")));

    const checkbox = renderList(TODOS);

    fireEvent.click(checkbox);

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

  // F015: rapid check-then-uncheck before the first response resolves must
  // leave the committed state matching the LAST user action (unchecked),
  // even if the first (check) response resolves after the second (uncheck).
  it("test_AS_012_AS_014_rapid_toggle_commits_last_user_intent_when_responses_resolve_out_of_order", async () => {
    const checkbox = renderList(TODOS);

    // First click: check.
    fireEvent.click(checkbox);
    await waitFor(() => expect(toggleTodo).toHaveBeenCalledTimes(1));
    expect(toggleTodo).toHaveBeenNthCalledWith(1, { todoId: "todo-1", isDone: true });

    // Second click before the first response arrives: uncheck.
    fireEvent.click(checkbox);
    await waitFor(() => expect(toggleTodo).toHaveBeenCalledTimes(2));
    expect(toggleTodo).toHaveBeenNthCalledWith(2, { todoId: "todo-1", isDone: false });

    expect(pendingResolvers).toHaveLength(2);
    const [resolveFirst, resolveSecond] = pendingResolvers;

    // Resolve out of order: the second (uncheck) response lands first,
    // then the first (check) response lands last.
    resolveSecond({ ok: true });
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));

    resolveFirst({ ok: true });

    // Final committed state must reflect the last user action (unchecked),
    // not whichever response happened to resolve last.
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText("Write handoff")).not.toHaveClass("line-through");
  });

  // F019 (AS-012, AS-014): if router.refresh() causes the server-fetched
  // initialTodos prop to re-render with a NEW array identity while a toggle
  // is still in-flight, the pre-toggle server value must not silently
  // clobber the optimistic/committed state for that row.
  it("test_AS_012_optimistic_check_survives_a_server_data_refresh_that_arrives_before_the_toggle_resolves", async () => {
    const { rerender } = render(
      createElement(PersonalTodoList, { workspaceId: "workspace-1", initialTodos: TODOS }),
    );
    const checkbox = screen.getByLabelText(/mark "write handoff"/i) as HTMLButtonElement;

    expect(checkbox).toHaveAttribute("aria-checked", "false");
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));
    expect(toggleTodo).toHaveBeenCalledWith({ todoId: "todo-1", isDone: true });

    // Simulate router.refresh() delivering fresh server data (still the
    // stale pre-toggle value, since the server hasn't committed yet) via a
    // NEW array identity, before the toggle promise resolves.
    const staleServerTodos: PersonalTodo[] = [
      { id: "todo-1", title: "Write handoff", isDone: false, position: 1000 },
    ];
    rerender(
      createElement(PersonalTodoList, { workspaceId: "workspace-1", initialTodos: staleServerTodos }),
    );

    // The optimistic/in-flight state must NOT be reset by the stale sync.
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Write handoff")).toHaveClass("line-through");

    // Now the toggle resolves successfully and the committed state settles.
    resolveToggle?.({ ok: true });
    await waitFor(() => {
      expect(checkbox).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("Write handoff")).toHaveClass("line-through");
    });
  });

  it("test_AS_014_optimistic_uncheck_survives_a_server_data_refresh_that_arrives_before_the_toggle_resolves", async () => {
    const { rerender } = render(
      createElement(PersonalTodoList, { workspaceId: "workspace-1", initialTodos: DONE_TODOS }),
    );
    const checkbox = screen.getByLabelText(/mark "write handoff"/i) as HTMLButtonElement;

    expect(checkbox).toHaveAttribute("aria-checked", "true");
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));
    expect(toggleTodo).toHaveBeenCalledWith({ todoId: "todo-1", isDone: false });

    const staleServerTodos: PersonalTodo[] = [
      { id: "todo-1", title: "Write handoff", isDone: true, position: 1000 },
    ];
    rerender(
      createElement(PersonalTodoList, { workspaceId: "workspace-1", initialTodos: staleServerTodos }),
    );

    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Write handoff")).not.toHaveClass("line-through");

    resolveToggle?.({ ok: true });
    await waitFor(() => {
      expect(checkbox).toHaveAttribute("aria-checked", "false");
      expect(screen.getByText("Write handoff")).not.toHaveClass("line-through");
    });
  });

  // F019 (AS-012, AS-014): a boolean checkbox field is masked while
  // useOptimistic's pending action is still applying its flip, so a plain
  // aria-checked assertion during the in-flight window can pass even with
  // the render-phase reset bug present. This test instead proves the fix
  // mechanism directly: the WHOLE row object must be preserved (not just
  // isDone) for an in-flight id when new `initialTodos` data arrives via a
  // NEW array identity mid-toggle. If the render-phase sync blindly
  // replaces the row (the reverted bug), a concurrently-changed field like
  // `title` leaks through into the DOM even though this row's own toggle
  // hasn't settled yet.
  it("test_AS_012_AS_014_in_flight_row_is_not_clobbered_by_a_stale_sync_mid_toggle", async () => {
    const { rerender } = render(
      createElement(PersonalTodoList, { workspaceId: "workspace-1", initialTodos: TODOS }),
    );
    const checkbox = screen.getByLabelText(/mark "write handoff"/i) as HTMLButtonElement;

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));

    // Simulate router.refresh() delivering a fresh `initialTodos` array
    // (new identity) for the SAME row while the toggle is still in-flight.
    const staleWithDifferentTitle: PersonalTodo[] = [
      { id: "todo-1", title: "STALE TITLE FROM SERVER", isDone: false, position: 1000 },
    ];
    rerender(
      createElement(PersonalTodoList, {
        workspaceId: "workspace-1",
        initialTodos: staleWithDifferentTitle,
      }),
    );

    // Toggle fails: useOptimistic reverts to the committed base state once
    // the transition settles.
    resolveToggle?.({ ok: false });
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "false"));

    // The in-flight row's original data must have been preserved through
    // the stale sync — not silently replaced with the server's payload.
    expect(screen.getByText("Write handoff")).toBeInTheDocument();
    expect(screen.queryByText("STALE TITLE FROM SERVER")).not.toBeInTheDocument();
  });
});
