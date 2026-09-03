// @vitest-environment jsdom
//
// F009 (missions/20260903-portal, AS-021, AS-022, AS-023): component
// tests for `ApprovalCard`, the F007/F008-shaped `approval_requests` card
// that supersedes `approval-actions.tsx`'s task-boolean approve/reject
// pair for this feature's own surface (see that component's own header
// comment for why it stays alongside this one rather than being deleted
// -- the task detail page's legacy `pending_client_approval` toggle flow
// is untouched by this feature's file list). Same mocked-server-action +
// fake-router shape as approval-actions.test.tsx.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { toastErrorMock, toastSuccessMock, decideMock, refreshMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  decideMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/actions/portal-approval", () => ({
  decideApproval: decideMock,
}));

import { ApprovalCard } from "./approval-card";
import type { PortalApproval } from "@/lib/queries/approvals";

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  decideMock.mockReset();
  refreshMock.mockReset();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const APPROVAL: PortalApproval = {
  id: "req-1",
  projectId: "project-1",
  title: "Homepage copy",
  description: "Final copy for the homepage hero.",
  decisionType: "brand",
  subjectType: "artifact",
  subjectId: null,
  artifactUrl: "https://figma.com/file/abc",
  state: "pending",
  requestedAt: "2026-08-01T00:00:00Z",
  dueAt: "2026-09-01",
  decidedAt: null,
  decisionNote: null,
  decidedBy: null,
  round: 1,
};

function renderCard(overrides: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  return render(
    createElement(ApprovalCard, {
      approval: APPROVAL,
      workspaceSlug: "acme",
      projectId: "project-1",
      isOwner: true,
      ownerName: "Jane Doe",
      ...overrides,
    }),
  );
}

describe("ApprovalCard (F009)", () => {
  it("test_AS_022_non_owner_sees_disabled_buttons_naming_who_decides", () => {
    renderCard({ isOwner: false, ownerName: "Jane Doe" });

    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /request changes/i })).toBeDisabled();
    expect(screen.getByText(/only jane doe can decide this/i)).toBeInTheDocument();
    // Presentation only -- decideApproval is never even attempted from a
    // disabled control; the real enforcement (AS-022) lives in the RPC,
    // not asserted by this component test.
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("test_AS_022_no_owner_assigned_says_so_plainly", () => {
    renderCard({ isOwner: false, ownerName: null });

    expect(screen.getByText(/no one is assigned to decide this yet/i)).toBeInTheDocument();
  });

  it("test_AS_023_approve_applies_optimistically_before_the_action_resolves", async () => {
    const { promise, resolve } = deferred<{
      ok: true;
      data: { requestId: string; state: string; decidedAt: string };
    }>();
    decideMock.mockReturnValue(promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());
    expect(decideMock).toHaveBeenCalledWith("req-1", "approved", null);

    resolve({ ok: true, data: { requestId: "req-1", state: "approved", decidedAt: "2026-09-01T00:00:00Z" } });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // The card settles IN PLACE on success -- it is never removed from the
  // list, so a client cannot mistake success for a crash (this feature's
  // own explicit instruction).
  it("test_AS_023_settled_card_stays_on_the_page_after_success", async () => {
    decideMock.mockResolvedValue({
      ok: true,
      data: { requestId: "req-1", state: "approved", decidedAt: "2026-09-01T00:00:00Z" },
    });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByTestId("approval-card")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());
    expect(screen.getByTestId("approval-card")).toBeInTheDocument();
  });

  it("test_AS_023_approve_reverts_and_toasts_on_ok_false", async () => {
    const { promise, resolve } = deferred<{ ok: false; error: string }>();
    decideMock.mockReturnValue(promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());

    resolve({ ok: false, error: "you are not the decision owner for this request" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith("you are not the decision owner for this request");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("test_AS_023_approve_reverts_and_toasts_on_throw", async () => {
    const { promise, reject } = deferred<never>();
    decideMock.mockReturnValue(promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());

    reject(new Error("network down"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Something went wrong. Please try again in a moment.",
    );
  });

  it("test_AS_015_second_synchronous_approve_click_issues_no_second_call", async () => {
    const { promise } = deferred<{
      ok: true;
      data: { requestId: string; state: string; decidedAt: string };
    }>();
    decideMock.mockReturnValue(promise);

    renderCard();

    const button = screen.getByRole("button", { name: /approve/i });
    act(() => {
      button.click();
      button.click();
    });

    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());
    expect(decideMock).toHaveBeenCalledTimes(1);
  });

  it("test_AS_023_request_changes_requires_a_note_before_sending", () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    const sendButton = screen.getByRole("button", { name: /^send$/i });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "   " },
    });
    fireEvent.click(sendButton);

    expect(decideMock).not.toHaveBeenCalled();
  });

  it("test_AS_023_request_changes_settles_with_the_note", async () => {
    decideMock.mockResolvedValue({
      ok: true,
      data: {
        requestId: "req-1",
        state: "changes_requested",
        decidedAt: "2026-09-01T00:00:00Z",
        resultingTaskId: "task-created-1",
      },
    });

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith("req-1", "changes_requested", "please fix the header"),
    );
    await waitFor(() => expect(screen.getByText(/changes requested on/i)).toBeInTheDocument());
  });

  // F011 (AS-025): the settled card names the task the decision created,
  // without ever forming a link to it (the resulting task is never
  // client_visible by default -- see decide_approval_atomic's own
  // migration comment).
  it("test_AS_025_settled_card_names_the_task_that_was_created_without_linking_to_it", async () => {
    decideMock.mockResolvedValue({
      ok: true,
      data: {
        requestId: "req-1",
        state: "changes_requested",
        decidedAt: "2026-09-01T00:00:00Z",
        resultingTaskId: "task-created-1",
      },
    });

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    const loggedLine = await screen.findByText(/we.ve logged this as work for the team/i);
    expect(loggedLine).toBeInTheDocument();
    // Never a link -- a client-created task is not client_visible by
    // default, so this line is deliberately text, not an <a>.
    expect(loggedLine.closest("a")).toBeNull();
  });

  it("shows an overdue due chip when the due date has passed and the card is still pending", () => {
    renderCard({ approval: { ...APPROVAL, dueAt: "2020-01-01" } });

    const chip = screen.getByTestId("approval-due-chip");
    expect(chip).toHaveAttribute("data-overdue", "true");
    expect(chip).toHaveTextContent(/overdue/i);
  });
});
