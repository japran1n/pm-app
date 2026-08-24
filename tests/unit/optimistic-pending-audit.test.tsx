// @vitest-environment jsdom
//
// F256 (AS-497, AS-498, AS-499): consistent optimistic/pending behaviour
// across mutating controls.
//
// This mission-wide sweep (see missions/20260818-213033/handoffs/
// F256-handoff.md for the full enumeration of every control audited) found
// exactly one real straggler: the sidebar's sign-out control was a bare
// `<form action={signOut}>` with no pending/disabled state, so a fast
// double-click could fire signOut() twice. It is now `SignOutButton`
// (components/nav/app-sidebar.tsx), using the same useTransition +
// disabled-while-pending shape every other mutating control in this app
// already follows (RemoveMemberButton, RevokeInviteButton, etc).
//
// AS-497/AS-499 are covered directly against the fixed SignOutButton.
// AS-498 (failed mutation rolls back + explains what failed via toast) is
// covered against RemoveMemberButton, a representative already-compliant
// control from the audit — chosen because, unlike SignOutButton (whose
// server action always redirects and never resolves an {ok:false}), it has
// a real failure branch to exercise.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const signOutMock = vi.fn();
const removeMemberMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/lib/actions/auth", () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

vi.mock("@/lib/actions/workspaces", () => ({
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

// window.confirm is used by RemoveMemberButton before it ever calls the
// action — auto-confirm for these tests.
vi.stubGlobal("confirm", vi.fn(() => true));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("F256 AS-499: the triggering control shows pending state and cannot be double-submitted", () => {
  it("sign-out button disables itself the instant it is clicked, before the action resolves", async () => {
    let resolveSignOut: () => void = () => {};
    signOutMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    const { SignOutButton } = await import("@/components/nav/app-sidebar");
    render(createElement(SignOutButton));

    const button = screen.getByRole("button", { name: /sign out/i });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    // AS-497: pending is visible essentially immediately (well within
    // 100ms — React applies the disabled state synchronously on the next
    // render, no artificial delay in this component).
    await waitFor(() => expect(button).toBeDisabled());

    resolveSignOut();
  });

  it("a second click while pending does not call signOut() a second time", async () => {
    let resolveSignOut: () => void = () => {};
    signOutMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    const { SignOutButton } = await import("@/components/nav/app-sidebar");
    render(createElement(SignOutButton));

    const button = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    // Disabled buttons don't dispatch click handlers in jsdom, mirroring a
    // real browser — this is the actual double-submit guard under test.
    fireEvent.click(button);

    resolveSignOut();
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
  });
});

describe("F256 AS-498: a failed mutation rolls back and explains what failed", () => {
  it("RemoveMemberButton re-enables and shows a toast naming the failure when removeMember fails", async () => {
    removeMemberMock.mockResolvedValue({
      ok: false,
      error: "You cannot remove the workspace's sole owner.",
    });

    const { RemoveMemberButton } = await import("@/components/remove-member-button");
    render(
      createElement(RemoveMemberButton, {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspaceMemberId: "22222222-2222-4222-8222-222222222222",
        memberLabel: "Jane Doe",
      }),
    );

    const button = screen.getByRole("button", { name: /remove jane doe/i });
    fireEvent.click(button);

    await waitFor(() => expect(removeMemberMock).toHaveBeenCalledTimes(1));

    // Explains what failed — the exact server-provided reason, not a
    // generic "something went wrong".
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "You cannot remove the workspace's sole owner.",
      ),
    );
    // Rolled back to actionable (not stuck in a permanent pending/disabled
    // state) so the user can retry or take a different action.
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
