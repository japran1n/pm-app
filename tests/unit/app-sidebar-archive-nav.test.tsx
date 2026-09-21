// @vitest-environment jsdom
//
// F142: the "Archive" nav item is gated to non-guests, same pattern as
// "Members" (F134) and "Settings" (F136). F003 (SB-016, SB-017, SB-006):
// relocated from the sidebar's own "Other" group into AccountMenu — this
// test now opens that menu the same way tests/unit/f002-account-menu.test.tsx
// does, rather than checking react-dom/server static markup (the item no
// longer renders until the menu is opened).

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
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

afterEach(() => {
  cleanup();
});

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("AppSidebar archive nav item (F142, relocated by F003)", () => {
  it("renders an 'Archive' link to /w/acme/archive in the account menu for a non-guest member", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    const link = within(menu).getByText("Archive").closest("a");
    expect(link).toHaveAttribute("href", "/w/acme/archive");
  });

  it("does not render an 'Archive' link for a guest", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: true }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Archive")).toBeNull();
  });
});
