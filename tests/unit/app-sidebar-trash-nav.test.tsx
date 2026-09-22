// @vitest-environment jsdom
//
// F188 (AS-343..352): the "Trash" nav item is gated to non-guests, same
// pattern as "Archive" (F142) and "Templates" (F183). F003 (SB-016,
// SB-017, SB-006): relocated from the sidebar's own "Other" group into
// AccountMenu — this test now opens that menu the same way
// tests/unit/f002-account-menu.test.tsx does, rather than checking
// react-dom/server static markup (the item no longer renders until the
// menu is opened).

import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { createElement } from "react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useSearchParams: () => new URLSearchParams(),
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

describe("AppSidebar trash nav item (F188, relocated by F003)", () => {
  it("test_AS_343_renders_a_trash_link_for_a_non_guest_member", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    const link = within(menu).getByText("Trash").closest("a");
    expect(link).toHaveAttribute("href", "/w/acme/trash");
  });

  it("test_AS_352_does_not_render_a_trash_link_for_a_guest", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: true }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Trash")).toBeNull();
  });
});
