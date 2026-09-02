// @vitest-environment jsdom
//
// F005: component tests for the portal approval actions' optimistic
// apply. Mocks the two server actions and `sonner`'s toast, and a fake
// `next/navigation` router so `router.refresh()` calls are observable
// without a real Next.js app tree.

import { createElement, type ReactNode, type MouseEventHandler } from "react";
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

  it("test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry", async () => {
    const first = deferred<never>();
    approveMock.mockReturnValueOnce(first.promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());

    first.reject(new Error("network down"));

    // Reverts to the pre-click state — the Approve button is back.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(approveMock).toHaveBeenCalledTimes(1);

    // The in-flight ref must have been cleared on the failure path (not
    // only on success) — otherwise the button is permanently inert and the
    // user can never retry without a reload. A fresh click after the
    // failure must issue a genuinely new call. `disabled` is stripped
    // defensively before clicking so this exercises the ref guard itself
    // (`inFlightRef.current`), not React's own `isPending` render timing,
    // which is not what AS-014 is about.
    const second = deferred<{ ok: true; data: { taskId: string } }>();
    approveMock.mockReturnValueOnce(second.promise);
    const retryButton = screen.getByRole("button", { name: /approve/i });
    retryButton.removeAttribute("disabled");
    fireEvent.click(retryButton);

    await waitFor(() => expect(approveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());
    second.resolve({ ok: true, data: { taskId: "task-1" } });
  });

  it("test_AS_014_ref_is_cleared_after_ok_false_allowing_retry", async () => {
    const first = deferred<{ ok: false; error: string }>();
    approveMock.mockReturnValueOnce(first.promise);

    render(createElement(PortalApprovalActions, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());

    first.resolve({ ok: false, error: "Task not found." });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(approveMock).toHaveBeenCalledTimes(1);

    const second = deferred<{ ok: true; data: { taskId: string } }>();
    approveMock.mockReturnValueOnce(second.promise);
    const retryButton = screen.getByRole("button", { name: /approve/i });
    retryButton.removeAttribute("disabled");
    fireEvent.click(retryButton);

    await waitFor(() => expect(approveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Approved.")).toBeInTheDocument());
    second.resolve({ ok: true, data: { taskId: "task-1" } });
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

  it("test_AS_016_ref_is_cleared_after_a_rejected_action_allowing_retry", async () => {
    // Same rationale as `test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled`:
    // the real Base UI `Button` enforces `disabled` inside its own click
    // closure, so waiting on React's `isPending` to settle (and the real
    // button's `disabled` attribute to clear) after a rejection is a race
    // against React's transition scheduling that has nothing to do with
    // AS-016. The stub Button below always forwards `onClick`, so a second
    // click deterministically reaches `handleRequestChanges` regardless of
    // `isPending` timing, and only `inFlightRef.current` can still be
    // blocking it — which is exactly what this assertion is about.
    vi.resetModules();
    vi.doMock("@/components/ui/button", () => ({
      Button: ({
        children,
        disabled,
        onClick,
        ...rest
      }: {
        children?: ReactNode;
        disabled?: boolean;
        onClick?: MouseEventHandler<HTMLButtonElement>;
        [key: string]: unknown;
      }) =>
        createElement(
          "button",
          { ...rest, "data-disabled": disabled ? "" : undefined, onClick },
          children,
        ),
    }));

    const { PortalApprovalActions: UnguardedUiComponent } = await import(
      "./approval-actions"
    );

    const first = deferred<never>();
    requestChangesMock.mockReturnValueOnce(first.promise);

    render(createElement(UnguardedUiComponent, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText(/sent — the team will follow up/i)).toBeInTheDocument(),
    );
    expect(requestChangesMock).toHaveBeenCalledTimes(1);

    first.reject(new Error("network down"));

    // Reverts back to the form on failure, with the message preserved.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/describe what you'd like changed/i)).toHaveValue(
        "please fix the header",
      ),
    );

    // The in-flight ref must have been cleared on the failure path (not
    // only on success) — otherwise the Send button is permanently inert
    // and a second click, even one that genuinely reaches the handler,
    // issues no new call.
    const second = deferred<{ ok: true; data: { taskId: string } }>();
    requestChangesMock.mockReturnValueOnce(second.promise);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(requestChangesMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/sent — the team will follow up/i)).toBeInTheDocument(),
    );
    second.resolve({ ok: true, data: { taskId: "task-1" } });

    vi.doUnmock("@/components/ui/button");
    vi.resetModules();
  });

  it("test_AS_016_ref_is_cleared_after_ok_false_allowing_retry", async () => {
    vi.resetModules();
    vi.doMock("@/components/ui/button", () => ({
      Button: ({
        children,
        disabled,
        onClick,
        ...rest
      }: {
        children?: ReactNode;
        disabled?: boolean;
        onClick?: MouseEventHandler<HTMLButtonElement>;
        [key: string]: unknown;
      }) =>
        createElement(
          "button",
          { ...rest, "data-disabled": disabled ? "" : undefined, onClick },
          children,
        ),
    }));

    const { PortalApprovalActions: UnguardedUiComponent } = await import(
      "./approval-actions"
    );

    const first = deferred<{ ok: false; error: string }>();
    requestChangesMock.mockReturnValueOnce(first.promise);

    render(createElement(UnguardedUiComponent, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText(/sent — the team will follow up/i)).toBeInTheDocument(),
    );
    expect(requestChangesMock).toHaveBeenCalledTimes(1);

    first.resolve({ ok: false, error: "Something went wrong." });

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/describe what you'd like changed/i)).toHaveValue(
        "please fix the header",
      ),
    );

    const second = deferred<{ ok: true; data: { taskId: string } }>();
    requestChangesMock.mockReturnValueOnce(second.promise);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(requestChangesMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/sent — the team will follow up/i)).toBeInTheDocument(),
    );
    second.resolve({ ok: true, data: { taskId: "task-1" } });

    vi.doUnmock("@/components/ui/button");
    vi.resetModules();
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

  it("test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled", async () => {
    // The real `Button` (`@/components/ui/button`, Base UI) enforces its
    // own `disabled` prop entirely inside its click handler's JS closure —
    // stripping the DOM `disabled`/`data-disabled` attributes does not
    // bypass it (`useButton`'s `getButtonProps().onClick` reads the
    // `disabled` argument captured at render time, not the DOM node), so a
    // click never reaches `handleRequestChanges` while the button element
    // itself is disabled. That means the *only* thing standing between a
    // whitespace-only message and a server call, from this test's point of
    // view, is `handleRequestChanges`'s own `if (!trimmed) return;` guard —
    // exactly what AS-016 is about, not the UI affordance. To exercise that
    // guard "with the button enabled" this test remounts the component
    // against a stub Button that forwards `onClick` unconditionally (still
    // rendering a `data-disabled` marker so the affordance is inspectable)
    // so a click always reaches the real handler regardless of the
    // disabled prop, and only the component's own guard can block it.
    vi.resetModules();
    vi.doMock("@/components/ui/button", () => ({
      Button: ({
        children,
        disabled,
        onClick,
        ...rest
      }: {
        children?: ReactNode;
        disabled?: boolean;
        onClick?: MouseEventHandler<HTMLButtonElement>;
        [key: string]: unknown;
      }) =>
        createElement(
          "button",
          { ...rest, "data-disabled": disabled ? "" : undefined, onClick },
          children,
        ),
    }));

    const { PortalApprovalActions: UnguardedUiComponent } = await import(
      "./approval-actions"
    );

    render(createElement(UnguardedUiComponent, { taskId: "task-1" }));

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "   " },
    });

    const sendButton = screen.getByRole("button", { name: /^send$/i });
    // The stub still marks the button as disabled for inspection, but does
    // not enforce it — so this click genuinely reaches
    // `handleRequestChanges` with `trimmed === ""`.
    expect(sendButton).toHaveAttribute("data-disabled", "");
    fireEvent.click(sendButton);

    expect(requestChangesMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/sent — the team will follow up/i),
    ).not.toBeInTheDocument();

    vi.doUnmock("@/components/ui/button");
    vi.resetModules();
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
