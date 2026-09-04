// @vitest-environment jsdom
//
// F090 item 5: `client_deliverables` is one of the eleven portal-producer
// entities that hard `.delete()` with no `deleted_at`/Trash entry (this
// audit's own finding). This locks in the fix -- deleting a deliverable
// now offers a real Undo (lib/toast/undo-toast.ts's showUndoToast) that
// re-inserts the exact pre-delete row via `restoreDeliverable`, not just
// a toast that expires into permanent loss.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { ClientDeliverable } from "@/lib/queries/deliverables";

const { toastErrorMock, deleteMock, restoreMock, showUndoToastMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  deleteMock: vi.fn(),
  restoreMock: vi.fn(),
  showUndoToastMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock("@/lib/actions/deliverables", () => ({
  createDeliverable: vi.fn(),
  decideDeliverable: vi.fn(),
  deleteDeliverable: deleteMock,
  restoreDeliverable: restoreMock,
  reorderDeliverables: vi.fn(),
  updateDeliverable: vi.fn(),
}));

vi.mock("@/lib/toast/undo-toast", () => ({
  showUndoToast: showUndoToastMock,
}));

import { DeliverablesPanel } from "./deliverables-panel";

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
  deleteMock.mockReset();
  restoreMock.mockReset();
  showUndoToastMock.mockReset();
});

function makeDeliverable(overrides: Partial<ClientDeliverable> = {}): ClientDeliverable {
  return {
    id: "d1",
    projectId: "project-1",
    phaseId: null,
    taskId: null,
    title: "Homepage copy",
    description: null,
    kind: "copy",
    ownerName: "Jane",
    dueAt: null,
    blocking: false,
    state: "not_started",
    deliveredAt: null,
    acceptedAt: null,
    acceptedBy: null,
    reviewNote: null,
    position: 1,
    ...overrides,
  };
}

async function confirmDelete(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Delete ${title}` }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  });
}

describe("test_AS_090_5_deliverable_hard_delete_offers_real_undo", () => {
  it("deleting a deliverable removes it locally, then Undo re-inserts the exact pre-delete row", async () => {
    const deliverable = makeDeliverable();
    const restoreSnapshot = { ...deliverable };
    deleteMock.mockResolvedValue({ ok: true, data: { id: deliverable.id, restore: restoreSnapshot } });

    render(
      createElement(DeliverablesPanel, {
        projectId: "project-1",
        initialDeliverables: [deliverable],
        taskOptions: [],
        canManage: true,
      }),
    );

    expect(screen.getByDisplayValue("Homepage copy")).toBeInTheDocument();

    await confirmDelete("Homepage copy");

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith("d1");
    });
    // Removed from the list immediately -- never waits for Undo to
    // resolve/expire before reflecting the delete locally.
    expect(screen.queryByDisplayValue("Homepage copy")).toBeNull();

    // showUndoToast was offered with the exact captured snapshot as its
    // restore payload, and an honest (non-Trash) description, since this
    // table has no Trash entry.
    expect(showUndoToastMock).toHaveBeenCalledTimes(1);
    const call = showUndoToastMock.mock.calls[0]![0];
    expect(call.message).toBe("Deliverable deleted.");
    expect(call.description).not.toMatch(/trash/i);

    restoreMock.mockResolvedValue({ ok: true, data: deliverable });

    // Simulate the user clicking "Undo" on the toast.
    await act(async () => {
      await call.onUndo();
    });

    expect(restoreMock).toHaveBeenCalledWith(restoreSnapshot);
    expect(screen.getByDisplayValue("Homepage copy")).toBeInTheDocument();
  });

  it("a failed restore surfaces an error and does not silently pretend the row came back", async () => {
    const deliverable = makeDeliverable();
    deleteMock.mockResolvedValue({
      ok: true,
      data: { id: deliverable.id, restore: { ...deliverable } },
    });

    render(
      createElement(DeliverablesPanel, {
        projectId: "project-1",
        initialDeliverables: [deliverable],
        taskOptions: [],
        canManage: true,
      }),
    );

    await confirmDelete("Homepage copy");
    await waitFor(() => expect(showUndoToastMock).toHaveBeenCalledTimes(1));

    restoreMock.mockResolvedValue({ ok: false, error: "Something went wrong." });
    const call = showUndoToastMock.mock.calls[0]![0];

    await act(async () => {
      await call.onUndo();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Something went wrong.");
    expect(screen.queryByDisplayValue("Homepage copy")).toBeNull();
  });
});
