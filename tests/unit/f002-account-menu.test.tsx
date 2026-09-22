// @vitest-environment jsdom
//
// F002 (SB-009, SB-012, SB-013, SB-014, SB-015): the sidebar footer's
// avatar row is a single AccountMenu (Profile / Settings / Theme / Sign
// out) replacing the old plain profile Link + standalone ThemeToggle +
// standalone SignOutButton. Real DOM render + click tests, mirroring
// tests/unit/optimistic-pending-audit.test.tsx's fireEvent/waitFor shape
// for the pending sign-out state.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// FU-8 / SB-004: the bell is an unrelated async client that calls a server
// action (cookies()) on mount; stub it so E251 rejections do not flood the run.
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastErrorMock(...a) } }));

const signOutMock = vi.fn();
vi.mock("@/lib/actions/auth", () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

let currentTheme = "light";
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: currentTheme,
    setTheme: (t: string) => {
      currentTheme = t;
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentTheme = "light";
});

import { AppSidebar } from "@/components/nav/app-sidebar";
import { AccountMenu } from "@/components/nav/account-menu";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("test_SB_012_account_menu_opens_from_avatar", () => {
  it("clicking the avatar row in the sidebar footer opens a menu with Profile, Settings, Theme and Sign out", async () => {
    render(
      createElement(AppSidebar, { ...baseProps, isGuest: false, canManageWorkspace: true }),
    );

    const trigger = screen.getAllByRole("button", { name: /account menu/i })[0];
    fireEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Profile")).toBeInTheDocument();
    expect(within(menu).getByText("Settings")).toBeInTheDocument();
    expect(within(menu).getByText("Theme")).toBeInTheDocument();
    expect(within(menu).getByText("Sign out")).toBeInTheDocument();
  });

  it("hides the Settings item for a caller who cannot manage the workspace", async () => {
    render(
      createElement(AppSidebar, { ...baseProps, isGuest: false, canManageWorkspace: false }),
    );

    const trigger = screen.getAllByRole("button", { name: /account menu/i })[0];
    fireEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Settings")).toBeNull();
  });
});

describe("test_SB_013_standalone_theme_and_signout_removed", () => {
  it("renders no standalone theme toggle button and no standalone sign-out button outside the menu", () => {
    render(
      createElement(AppSidebar, { ...baseProps, isGuest: false, canManageWorkspace: true }),
    );

    expect(screen.queryByRole("button", { name: /toggle theme/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^sign out$/i })).toBeNull();
  });
});

// SB-014 is covered unmocked in tests/unit/f019-theme-toggle.test.tsx.

describe("test_SB_015_sign_out_works_from_menu", () => {
  it("selecting Sign out calls the signOut action and disables the item while pending", async () => {
    let resolveSignOut: () => void = () => {};
    signOutMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    render(createElement(AccountMenu, { ...baseProps, canManageWorkspace: true }));

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");
    const signOutItem = within(menu).getByText("Sign out").closest('[role="menuitem"]')!;

    fireEvent.click(signOutItem);

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(signOutItem.getAttribute("data-disabled")).not.toBeNull(),
    );

    resolveSignOut();
  });
});

describe("test_SB_015_sign_out_failure_path", () => {
  async function openAndClickSignOut() {
    render(createElement(AccountMenu, { ...baseProps, canManageWorkspace: true }));
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");
    const item = within(menu).getByText("Sign out").closest('[role="menuitem"]')!;
    fireEvent.click(item);
  }

  // Re-query each time: the menu may close/remount after the click, so a
  // held element reference can be stale.
  function signOutItemNow() {
    const menuNow = screen.queryByRole("menu");
    return menuNow
      ? within(menuNow).queryByText("Sign out")?.closest('[role="menuitem"]') ?? null
      : null;
  }

  // F022: the menu closes on select, so "re-enabled" cannot be asserted on
  // the (unmounted) item. Reopen the menu and require the Sign out item to be
  // present, visible and not disabled -- a stuck-disabled item fails here.
  async function expectSignOutVisiblyEnabled() {
    await waitFor(() => expect(signOutItemNow()).toBeNull()); // closed after select
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");
    const item = within(menu).getByText("Sign out").closest('[role="menuitem"]') as HTMLElement;
    expect(item).toBeVisible();
    expect(item.getAttribute("data-disabled")).toBeNull();
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
  }

  it("a rejected signOut shows an error and re-enables the menu item", async () => {
    signOutMock.mockRejectedValue(new Error("boom"));
    await openAndClickSignOut();
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    await expectSignOutVisiblyEnabled();
  });

  it("an {ok:false} result shows the error and re-enables the menu item", async () => {
    signOutMock.mockResolvedValue({ ok: false, error: "Couldn't sign out. Please try again." });
    await openAndClickSignOut();
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Couldn't sign out. Please try again."),
    );
    await expectSignOutVisiblyEnabled();
  });
});

describe("test_SB_009_mobile_nav_includes_account_menu", () => {
  it("the mobile hamburger Sheet's nav tree includes the account menu trigger, same as desktop", async () => {
    render(
      createElement(AppSidebar, { ...baseProps, isGuest: false, canManageWorkspace: true }),
    );

    // Desktop <aside> already has its own account menu trigger mounted.
    expect(
      screen.getAllByRole("button", { name: /account menu/i }).length,
    ).toBeGreaterThanOrEqual(1);

    // Open the mobile hamburger Sheet (its SidebarContent -- and thus the
    // account menu -- only mounts once the Sheet is open).
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(
        within(dialog).getAllByRole("button", { name: /account menu/i }).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });
});
