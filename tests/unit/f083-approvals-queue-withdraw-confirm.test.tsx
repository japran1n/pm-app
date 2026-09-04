// @vitest-environment jsdom
//
// F083: withdrawing an approval used to fire straight from onClick, with
// no confirmation. This mirrors tests/unit/bulk-delete-action.test.tsx's
// established shape for asserting an AlertDialog-gated destructive action
// — the mutation must not fire until the dialog's own confirm button is
// clicked, and it must fire once that button is clicked.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const withdrawApprovalMock = vi.fn();
const routerRefreshMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/actions/approvals", () => ({
  withdrawApproval: (...args: unknown[]) => withdrawApprovalMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

import { ApprovalsQueue, type ApprovalsQueueRow } from "@/components/approvals/approvals-queue";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const APPROVAL: ApprovalsQueueRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectId: "11111111-1111-4111-8111-111111111111",
  title: "Homepage copy",
  description: null,
  decisionType: "content",
  subjectType: "task",
  subjectId: "22222222-2222-4222-8222-222222222222",
  artifactUrl: null,
  artifactSnapshotPath: null,
  state: "pending",
  requestedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  dueAt: null,
  decidedAt: null,
  decisionNote: null,
  decidedBy: null,
  round: 1,
  projectName: "Acme Marketing",
  requestedByName: "PM Person",
  blocks: null,
  decisionOwnerName: null,
};

describe("ApprovalsQueue withdraw confirmation (F083)", () => {
  it("does not call withdrawApproval when only the trigger is clicked, and names the approval in the dialog", async () => {
    render(
      createElement(ApprovalsQueue, {
        workspaceSlug: "acme",
        approvals: [APPROVAL],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));

    expect(
      await screen.findByText(/withdraw .*homepage copy.*\?/i),
    ).toBeInTheDocument();
    expect(withdrawApprovalMock).not.toHaveBeenCalled();
  });

  it("calls withdrawApproval only after the dialog's own confirm action is clicked", async () => {
    withdrawApprovalMock.mockResolvedValue({ ok: true });

    render(
      createElement(ApprovalsQueue, {
        workspaceSlug: "acme",
        approvals: [APPROVAL],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    await screen.findByText(/withdraw .*homepage copy.*\?/i);
    expect(withdrawApprovalMock).not.toHaveBeenCalled();

    // The dialog itself renders a second "Withdraw" (the confirm action) —
    // pick the last one, matching the confirm button rather than the
    // trigger that's still in the DOM behind the dialog.
    const withdrawButtons = screen.getAllByRole("button", { name: /withdraw/i });
    fireEvent.click(withdrawButtons[withdrawButtons.length - 1]);

    await waitFor(() => {
      expect(withdrawApprovalMock).toHaveBeenCalledTimes(1);
    });
    expect(withdrawApprovalMock).toHaveBeenCalledWith(APPROVAL.id);
  });

  it("cancelling the dialog never calls withdrawApproval", async () => {
    render(
      createElement(ApprovalsQueue, {
        workspaceSlug: "acme",
        approvals: [APPROVAL],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    await screen.findByText(/withdraw .*homepage copy.*\?/i);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(withdrawApprovalMock).not.toHaveBeenCalled();
  });
});
