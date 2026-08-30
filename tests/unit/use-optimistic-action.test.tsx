// @vitest-environment jsdom
//
// F007: unit tests for the shared lib/hooks/use-optimistic-action.ts hook
// itself, independent of any one caller — per this feature's clarified
// definition of done ("Unit test the hook itself with a mock server
// action"). A tiny harness component exercises the hook exactly the way
// list-priority-select.tsx/list-due-date-cell.tsx do: render the
// optimistic value, expose `run`, and surface `isPending`.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

function Harness({
  current,
  action,
  errorMessage,
  next,
}: {
  current: string;
  action: (value: string) => Promise<void | { error: string }>;
  errorMessage: string;
  next: string;
}) {
  const [value, isPending, run] = useOptimisticAction(
    current,
    action,
    errorMessage,
  );
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "value" }, value),
    createElement("span", { "data-testid": "pending" }, String(isPending)),
    createElement(
      "button",
      { onClick: () => run(next), "data-testid": "run" },
      "run",
    ),
  );
}

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
});

describe("useOptimisticAction (F007)", () => {
  it("test_AS_primary_hook_returns_optimistic_value_immediately_and_resolves_on_success", async () => {
    let resolveAction: (value: unknown) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void | { error: string }>((resolve) => {
          resolveAction = resolve as (value: unknown) => void;
        }),
    );

    render(
      createElement(Harness, {
        current: "old",
        action,
        errorMessage: "Failed to update",
        next: "new",
      }),
    );

    expect(screen.getByTestId("value").textContent).toBe("old");

    fireEvent.click(screen.getByTestId("run"));

    // The optimistic value is applied immediately, before `action`'s
    // promise has resolved at all.
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("new"));
    expect(action).toHaveBeenCalledWith("new");

    resolveAction(undefined);
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("false"));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("test_AS_failure_hook_reverts_and_calls_toast_on_action_rejection_with_generic_message", async () => {
    const action = vi.fn(async () => ({ error: "" }));

    render(
      createElement(Harness, {
        current: "old",
        action,
        errorMessage: "Failed to update",
        next: "new",
      }),
    );

    fireEvent.click(screen.getByTestId("run"));

    // Reverts back to the base `current` value once the failed transition
    // settles.
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("old"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to update"),
    );
  });

  it("test_AS_failure_hook_shows_actions_own_error_message_when_provided", async () => {
    const action = vi.fn(async () => ({ error: "Specific server error" }));

    render(
      createElement(Harness, {
        current: "old",
        action,
        errorMessage: "Generic fallback",
        next: "new",
      }),
    );

    fireEvent.click(screen.getByTestId("run"));

    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("old"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Specific server error"),
    );
  });
});
