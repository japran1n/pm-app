// @vitest-environment jsdom
//
// F187 (AS-339, AS-340): the "Delete" bulk action rendered into F185's
// <BulkActionBar> children slot (components/task/bulk-delete-action.tsx).
//
// AS-339: clicking the trigger button opens a confirmation dialog naming
//   the selected count ("Move N tasks to trash?") — the delete call itself
//   must NOT fire until the dialog's own confirm button is clicked.
// AS-340: a partial failure (bulkUpdateTasks-style mixed permitted/
//   forbidden selection) reports which task failed BY KEY ("PM-2"), not by
//   raw uuid, while still reporting the successes.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const bulkDeleteTasksMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastWarningMock = vi.fn();

vi.mock("@/lib/actions/tasks", () => ({
  bulkDeleteTasks: (...args: unknown[]) => bulkDeleteTasksMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

import { BulkDeleteAction } from "@/components/task/bulk-delete-action";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SELECTED_TASKS = [
  { id: "11111111-1111-4111-8111-111111111111", projectKey: "PM", number: 2 },
  { id: "22222222-2222-4222-8222-222222222222", projectKey: "PM", number: 5 },
];

describe("BulkDeleteAction (F187: AS-339, AS-340)", () => {
  it("AS-339: opening the dialog does not call bulkDeleteTasks, and the dialog names the selected count", async () => {
    render(
      createElement(BulkDeleteAction, {
        selectedTasks: SELECTED_TASKS,
        onDone: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    // The dialog is open and names the count...
    expect(
      await screen.findByText(/move 2 tasks to trash\?/i),
    ).toBeInTheDocument();
    // ...but the mutation has not fired yet — only opening the trigger
    // must never call the server action.
    expect(bulkDeleteTasksMock).not.toHaveBeenCalled();
  });

  it("AS-339: the delete only proceeds after the dialog's own confirm button is clicked", async () => {
    bulkDeleteTasksMock.mockResolvedValue({
      ok: true,
      data: { succeededIds: SELECTED_TASKS.map((t) => t.id), failedIds: [] },
    });
    const onDone = vi.fn();

    render(
      createElement(BulkDeleteAction, {
        selectedTasks: SELECTED_TASKS,
        onDone,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await screen.findByText(/move 2 tasks to trash\?/i);
    expect(bulkDeleteTasksMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /move tasks to trash/i }),
    );

    await waitFor(() => {
      expect(bulkDeleteTasksMock).toHaveBeenCalledTimes(1);
    });
    expect(bulkDeleteTasksMock).toHaveBeenCalledWith(
      SELECTED_TASKS.map((t) => t.id),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('AS-339: the confirmation copy says "trash", not permanent deletion', async () => {
    render(
      createElement(BulkDeleteAction, {
        selectedTasks: SELECTED_TASKS,
        onDone: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(
      await screen.findByText(/moved to trash, not permanently deleted/i),
    ).toBeInTheDocument();
  });

  it("AS-340: a partial failure reports the failed task by its KEY, not its raw uuid, and still reports the successes", async () => {
    bulkDeleteTasksMock.mockResolvedValue({
      ok: true,
      data: {
        succeededIds: [SELECTED_TASKS[0].id],
        failedIds: [{ id: SELECTED_TASKS[1].id, reason: "forbidden" }],
      },
    });

    render(
      createElement(BulkDeleteAction, {
        selectedTasks: SELECTED_TASKS,
        onDone: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await screen.findByText(/move 2 tasks to trash\?/i);
    fireEvent.click(
      screen.getByRole("button", { name: /move tasks to trash/i }),
    );

    await waitFor(() => expect(toastWarningMock).toHaveBeenCalledTimes(1));
    const [message] = toastWarningMock.mock.calls[0];
    // Reports the successful count...
    expect(message).toMatch(/moved 1 of 2 tasks/i);
    // ...and names the failed task by its "PM-5" key, never the raw uuid.
    expect(message).toContain("PM-5");
    expect(message).not.toContain(SELECTED_TASKS[1].id);
  });
});
