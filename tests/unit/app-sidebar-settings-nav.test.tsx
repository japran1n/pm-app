// @vitest-environment jsdom
//
// F136 (AS-239): "a settings page exists, reachable from the sidebar for
// owners and admins". F003 (SB-016): the sidebar's own standalone
// "Settings" nav item (a duplicate of AccountMenu's own Settings item,
// formerly living in the sidebar's "Other" group) is removed — Settings
// was already reachable via AccountMenu since F002
// (tests/unit/f002-account-menu.test.tsx), so this test now asserts
// reachability there instead of in react-dom/server static markup of the
// bare sidebar.

import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { createElement } from "react";
import "@testing-library/jest-dom/vitest";

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

describe("AppSidebar settings nav item (F136, AS-239; relocated to AccountMenu by F002/F003)", () => {
  it("AS-239: renders a 'Settings' link to /w/acme/settings in the account menu when canManageWorkspace is true (owner/admin)", async () => {
    render(
      createElement(AppSidebar, { ...baseProps, canManageWorkspace: true }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    const link = within(menu).getByText("Settings").closest("a");
    expect(link).toHaveAttribute("href", "/w/acme/settings");
  });

  it("AS-239 (negative): does not render a 'Settings' link when canManageWorkspace is false (member/viewer)", async () => {
    render(
      createElement(AppSidebar, { ...baseProps, canManageWorkspace: false }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Settings")).toBeNull();
  });

  it("AS-239 (negative): a guest also gets no 'Settings' link even if canManageWorkspace were somehow true", async () => {
    render(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: true,
        canManageWorkspace: false,
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Settings")).toBeNull();
  });
});
