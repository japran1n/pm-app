// @vitest-environment jsdom
//
// F004 (SB-019, SB-006): "Preview as client" is removed from sidebar groups
// and placed in the AccountMenu, gated on hasClient && canManageWorkspace.
// Mirrors the established shape of app-sidebar-archive-nav.test.tsx for
// items relocated into AccountMenu.

import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { createElement } from "react";
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

afterEach(() => {
  cleanup();
});

// ── AccountMenu direct tests ────────────────────────────────────────────────

import { AccountMenu } from "@/components/nav/account-menu";

const accountMenuBase = {
  workspaceSlug: "acme",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
  canManageWorkspace: true,
};

describe("AccountMenu — Preview as client (SB-019, SB-006)", () => {
  it("SB-019: shows 'Preview as client' link when hasClient=true and canManageWorkspace=true", async () => {
    render(
      createElement(AccountMenu, { ...accountMenuBase, hasClient: true, canManageWorkspace: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");

    const link = within(menu).getByText("Preview as client").closest("a");
    expect(link).toHaveAttribute("href", "/w/acme/preview-as-client");
  });

  it("SB-019: hides 'Preview as client' when hasClient=false", async () => {
    render(
      createElement(AccountMenu, { ...accountMenuBase, hasClient: false, canManageWorkspace: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Preview as client")).toBeNull();
  });

  it("SB-019: hides 'Preview as client' when canManageWorkspace=false", async () => {
    render(
      createElement(AccountMenu, { ...accountMenuBase, hasClient: true, canManageWorkspace: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Preview as client")).toBeNull();
  });

  it("SB-019: hides 'Preview as client' when both hasClient and canManageWorkspace are false", async () => {
    render(
      createElement(AccountMenu, { ...accountMenuBase, hasClient: false, canManageWorkspace: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Preview as client")).toBeNull();
  });
});

// ── AppSidebar integration tests ────────────────────────────────────────────

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "admin", hasClient: true, projectRoles: {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const sidebarBase = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
  isGuest: false,
  canManageWorkspace: true,
};

describe("AppSidebar — Preview as client absent from sidebar groups (SB-019)", () => {
  it("SB-019: 'Preview as client' link is not rendered in the sidebar nav groups (not in static markup outside the menu)", async () => {
    render(createElement(AppSidebar, sidebarBase));

    // The nav links in the sidebar scroll area — not opened menu
    // Look for the sidebar aside (desktop)
    const aside = document.querySelector("aside");
    expect(aside).not.toBeNull();
      // Preview as client must NOT appear in the sidebar group links
      const allLinks = aside!.querySelectorAll("a");
      const previewLinks = Array.from(allLinks).filter((a) =>
        a.getAttribute("href")?.includes("preview-as-client"),
      );
      // Only nav links outside the menu — before opening menu the item shouldn't be in DOM
      expect(previewLinks).toHaveLength(0);
  });

  it("SB-019: 'Preview as client' appears in account menu for owner/admin with hasClient", async () => {
    render(createElement(AppSidebar, sidebarBase));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    const link = within(menu).getByText("Preview as client").closest("a");
    expect(link).toHaveAttribute("href", "/w/acme/preview-as-client");
  });
});

describe("AppSidebar — guest filtering preserved (SB-006)", () => {
  it("SB-006: 'Preview as client' does not appear in account menu for a guest even with hasClient", async () => {
    // guest with canManageWorkspace + hasClient true: the component itself must gate
    render(createElement(AppSidebar, { ...sidebarBase, isGuest: true, canManageWorkspace: true }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Preview as client")).toBeNull();
  });
});
