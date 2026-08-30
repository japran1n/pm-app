// @vitest-environment jsdom
//
// F001 (AS-001, AS-002): <ListPrioritySelect> (components/task/
// list-priority-select.tsx) now uses React.useOptimistic directly, per
// this feature's Clarified implementation, instead of hand-rolled local
// state — mirroring the pattern components/task/list-status-select.tsx
// already established (F057/F158).
//
//   AS-001: changing a task's priority in the list view updates the
//     priority cell immediately, without waiting for `editTask` to
//     resolve — proven here by an `editTask` mock whose promise never
//     resolves during the assertion, so the only way the new label can
//     appear is the optimistic update.
//   AS-002: when the server rejects the change, the cell reverts to its
//     prior value and an error toast appears.
//
// The real <Select> (components/ui/select.tsx) wraps @base-ui/react's
// pointer-event-driven combobox, which jsdom cannot reliably drive (same
// constraint documented in tests/unit/f325-board-toolbar-groupby-none.
// test.tsx). ListPrioritySelect's own optimistic-update/revert/toast logic
// lives entirely in its `handleChange` — not inside the Select primitive
// — so this test replaces <Select> with a bare native <select>, wired to
// the same value/onValueChange contract, to exercise the REAL
// handleChange function through a real DOM change event.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "member" }),
}));

vi.mock("@/components/ui/select", () => ({
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
        "aria-label": "Change priority for task task-1",
        value,
        onChange: (e: { target: { value: string } }) => onValueChange(e.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectTrigger: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectValue: ({ children }: { children: () => ReactNode }) =>
    typeof children === "function" ? children() : children,
}));

beforeEach(() => {
  // Each test mocks "@/lib/actions/tasks" differently; without resetting
  // the module registry, the dynamic import() below would reuse the
  // FIRST test's already-evaluated (and cached) list-priority-select
  // module — and with it, the first test's editTask mock closure — no
  // matter what the second test's vi.doMock supplies.
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
});

describe("ListPrioritySelect optimistic update (F001: AS-001, AS-002)", () => {
  it("test_AS_001_priority_cell_shows_new_value_immediately_before_server_responds", async () => {
    let resolveEditTask: (value: unknown) => void = () => {};
    const editTaskMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveEditTask = resolve;
        }),
    );
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: editTaskMock }));

    const { ListPrioritySelect } = await import("@/components/task/list-priority-select");

    render(createElement(ListPrioritySelect, { taskId: "task-1", priority: "medium" }));

    const select = screen.getByLabelText("Change priority for task task-1");
    expect((select as HTMLSelectElement).value).toBe("medium");

    fireEvent.change(select, { target: { value: "urgent" } });

    // Assert the optimistic value is applied before editTask's promise
    // has resolved at all (resolveEditTask hasn't been called yet).
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe("urgent"),
    );
    expect(editTaskMock).toHaveBeenCalledWith("task-1", { priority: "urgent" });

    // Cleanup: resolve so the pending transition doesn't leak across tests.
    resolveEditTask({ ok: true, data: { priority: "urgent" } });
    await waitFor(() => {});
    vi.doUnmock("@/lib/actions/tasks");
  });

  it("test_AS_002_priority_cell_reverts_and_shows_error_toast_when_server_action_throws", async () => {
    const editTaskMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: editTaskMock }));

    const { ListPrioritySelect } = await import("@/components/task/list-priority-select");

    render(createElement(ListPrioritySelect, { taskId: "task-1", priority: "medium" }));

    const select = screen.getByLabelText("Change priority for task task-1");
    fireEvent.change(select, { target: { value: "urgent" } });

    // Reverts back to the prior server value once the failed action settles.
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe("medium"),
    );
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to update priority"),
    );

    vi.doUnmock("@/lib/actions/tasks");
  });
});
