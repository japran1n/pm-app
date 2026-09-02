// @vitest-environment jsdom
//
// F005: component tests for the portal approval actions' optimistic
// apply. Mocks the two server actions and `sonner`'s toast, and a fake
// `next/navigation` router so `router.refresh()` calls are observable
// without a real Next.js app tree.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { toastErrorMock, toastSuccessMock, approveMock, requestChangesMock, refreshMock } =
  vi.hoisted(() => ({
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    approveMock: vi.fn(),
    requestChangesMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/actions/portal-approval", () => ({
  approvePortalTask: approveMock,
  requestPortalTaskChanges: requestChangesMock,
}));

import { PortalApprovalActions } from "./approval-actions";

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  approveMock.mockReset();
  requestChangesMock.mockReset();
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

describe("PortalApprovalActions (F005)", () => {
  it("test_AS_012_approved_state_renders_before_action_resolves", async () => {
    const { promise, resolve } = deferred<{ ok: true; data: { taskId: string } }>();
    approveMock.mockReturnValue(promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // Optimistic state renders immediately, before the mocked action's
    // promise has resolved at all.
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());
    expect(approveMock).toHaveBeenCalledWith("task-1");

    resolve({ ok: true, data: { taskId: "task-1" } });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("test_AS_013_approve_reverts_and_toasts_on_ok_false", async () => {
    const { promise, resolve } = deferred<{ ok: false; error: string }>();
    approveMock.mockReturnValue(promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());

    resolve({ ok: false, error: "Task not found." });

    // Reverts to the pre-click state — the Approve button is back.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith("Task not found.");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("test_AS_014_approve_reverts_and_toasts_on_throw", async () => {
    const { promise, reject } = deferred<never>();
    approveMock.mockReturnValue(promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());

    reject(new Error("network down"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Something went wrong. Please try again in a moment.",
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("test_AS_015_second_synchronous_approve_click_issues_no_second_call", async () => {
    const { promise } = deferred<{ ok: true; data: { taskId: string } }>();
    approveMock.mockReturnValue(promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    const button = screen.getByRole("button", { name: /approve/i });
    // Both clicks are dispatched inside a single `act` callback via the raw
    // DOM `.click()` method (not two separate `fireEvent.click` calls,
    // which each flush a render in between — by the time the second
    // `fireEvent` runs, the optimistic "Approved." branch has already
    // detached this button from the DOM, so a second `fireEvent.click`
    // reaches no handler and the test would pass even with the ref guard
    // deleted). Calling `.click()` twice inside one `act` lets React batch
    // both event-handler invocations before committing the re-render, so
    // the second click genuinely reaches `handleApprove` while
    // `inFlightRef.current` is still `true` from the first.
    act(() => {
      button.click();
      button.click();
    });

    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());
    expect(approveMock).toHaveBeenCalledTimes(1);
  });

  it("test_AS_016_request_changes_gets_optimistic_apply_and_revert_on_failure", async () => {
    const { promise, resolve } = deferred<{ ok: false; error: string }>();
    requestChangesMock.mockReturnValue(promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // Optimistic "sent" state renders before the action resolves.
    await waitFor(() =>
      expect(screen.getByText(/sent — the team will follow up/i)).toBeInTheDocument(),
    );
    expect(requestChangesMock).toHaveBeenCalledWith("task-1", "please fix the header");

    resolve({ ok: false, error: "Something went wrong." });

    // Reverts back to the form on failure, with the message preserved.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/describe what you'd like changed/i)).toHaveValue(
        "please fix the header",
      ),
    );
    expect(toastErrorMock).toHaveBeenCalledWith("Something went wrong.");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("test_AS_016_request_changes_with_whitespace_only_message_issues_no_call", async () => {
    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "   " },
    });

    const sendButton = screen.getByRole("button", { name: /^send$/i });
    expect(sendButton).toBeDisabled();
    fireEvent.click(sendButton);

    expect(requestChangesMock).not.toHaveBeenCalled();
  });

  it("test_AS_016_second_synchronous_send_click_issues_no_second_call", async () => {
    const { promise } = deferred<{ ok: true; data: { taskId: string } }>();
    requestChangesMock.mockReturnValue(promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });

    const sendButton = screen.getByRole("button", { name: /^send$/i });
    // Same reasoning as the approve double-click above: two separate
    // `fireEvent.click` calls would let the optimistic "Sent" branch
    // detach this button between clicks, so the second click would reach
    // no handler regardless of the ref guard. Both clicks are dispatched
    // inside one `act` callback so they both reach `handleRequestChanges`
    // while the button is still mounted.
    act(() => {
      sendButton.click();
      sendButton.click();
    });

    await waitFor(() =>
      expect(screen.getByText(/sent — the team will follow up/i)).toBeInTheDocument(),
    );
    expect(requestChangesMock).toHaveBeenCalledTimes(1);
  });
});
