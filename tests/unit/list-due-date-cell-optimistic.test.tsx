// @vitest-environment jsdom
//
// F002 (AS-003, AS-004): <ListDueDateCell> (components/task/
// list-due-date-cell.tsx) now uses React.useOptimistic directly, per this
// feature's Clarified implementation — mirroring the pattern F001 already
// established for components/task/list-priority-select.tsx (see that
// feature's own tests/unit/list-priority-select-optimistic.test.tsx, which
// this file is modeled on).
//
//   AS-003: changing a task's due date in the list view updates the date
//     cell immediately, without waiting for `editTask` to resolve — proven
//     here by an `editTask` mock whose promise never resolves during the
//     assertion, so the only way the new date can appear is the optimistic
//     update.
//   AS-004: when the server rejects the change, the cell reverts to its
//     prior value and an error toast appears.
//
// Unlike list-priority-select's <Select> (Base UI, portal-driven, can't be
// reliably exercised in jsdom), ListDueDateCell renders a plain native
// `<input type="date">`, so this test drives the real component directly
// through a real DOM change event with no substitute needed.

import { createElement } from "react";
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

beforeEach(() => {
  // Each test mocks "@/lib/actions/tasks" differently; without resetting
  // the module registry, the dynamic import() below would reuse the FIRST
  // test's already-evaluated (and cached) list-due-date-cell module — and
  // with it, the first test's editTask mock closure — no matter what the
  // second test's vi.doMock supplies. Same convention list-priority-select-
  // optimistic.test.tsx already uses.
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
});

describe("ListDueDateCell optimistic update (F002: AS-003, AS-004)", () => {
  it("test_AS_003_due_date_cell_shows_new_date_immediately_before_server_responds", async () => {
    let resolveEditTask: (value: unknown) => void = () => {};
    const editTaskMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveEditTask = resolve;
        }),
    );
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: editTaskMock }));

    const { ListDueDateCell } = await import("@/components/task/list-due-date-cell");

    render(
      createElement(ListDueDateCell, { taskId: "task-1", dueDate: "2026-09-01" }),
    );

    const input = screen.getByLabelText(
      "Change due date for task task-1",
    ) as HTMLInputElement;
    expect(input.value).toBe("2026-09-01");

    fireEvent.change(input, { target: { value: "2026-09-15" } });

    // Assert the optimistic value is applied before editTask's promise has
    // resolved at all (resolveEditTask hasn't been called yet).
    await waitFor(() => expect(input.value).toBe("2026-09-15"));
    expect(editTaskMock).toHaveBeenCalledWith("task-1", {
      dueDate: "2026-09-15",
    });

    // Cleanup: resolve so the pending transition doesn't leak across tests.
    resolveEditTask({ ok: true, data: { dueDate: "2026-09-15" } });
    await waitFor(() => {});
    vi.doUnmock("@/lib/actions/tasks");
  });

  it("test_AS_004_due_date_cell_reverts_and_shows_error_toast_when_server_action_rejects", async () => {
    const editTaskMock = vi.fn(async () => ({
      ok: false as const,
      error: "Failed to update due date",
    }));
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: editTaskMock }));

    const { ListDueDateCell } = await import("@/components/task/list-due-date-cell");

    render(
      createElement(ListDueDateCell, { taskId: "task-1", dueDate: "2026-09-01" }),
    );

    const input = screen.getByLabelText(
      "Change due date for task task-1",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "2026-09-15" } });

    // Reverts back to the prior server value once the failed action settles.
    await waitFor(() => expect(input.value).toBe("2026-09-01"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to update due date"),
    );

    vi.doUnmock("@/lib/actions/tasks");
  });

  it("test_AS_004_clearing_a_due_date_is_also_optimistic_and_reverts_on_failure", async () => {
    // Follow-up decision: the clear-date action (setting null) is
    // optimistic too, not just picking a new date.
    const editTaskMock = vi.fn(async () => ({
      ok: false as const,
      error: "Failed to update due date",
    }));
    vi.doMock("@/lib/actions/tasks", () => ({ editTask: editTaskMock }));

    const { ListDueDateCell } = await import("@/components/task/list-due-date-cell");

    render(
      createElement(ListDueDateCell, { taskId: "task-1", dueDate: "2026-09-01" }),
    );

    const input = screen.getByLabelText(
      "Change due date for task task-1",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() =>
      expect(editTaskMock).toHaveBeenCalledWith("task-1", { dueDate: null }),
    );

    await waitFor(() => expect(input.value).toBe("2026-09-01"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to update due date"),
    );

    vi.doUnmock("@/lib/actions/tasks");
  });
});
