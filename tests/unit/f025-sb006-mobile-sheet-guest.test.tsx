// @vitest-environment jsdom
// F025 (SB-006): guest filtering must hold in the MOBILE Sheet's account menu,
// not just the desktop <aside> instance (earlier tests drove getAllBy...[0]).
import { createElement } from "react";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }),
}));
vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "admin", hasClient: true, projectRoles: {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const base = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "T", email: "t@example.com", avatarUrl: null },
  canManageWorkspace: true,
};
const GATED = ["Templates", "Archive", "Trash", "Settings", "Preview as client"];

afterEach(cleanup);

async function openSheetAccountMenu(isGuest: boolean) {
  render(createElement(AppSidebar, { ...base, isGuest }));
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const dialog = within(screen.getByRole("dialog"));
  // The trigger inside the Sheet, not the desktop aside's instance.
  fireEvent.click(dialog.getByRole("button", { name: /account menu/i }));
  return within(await screen.findByRole("menu"));
}

describe("F025 SB-006: guest in the mobile Sheet account menu", () => {
  it("test_SB_006_guest_sheet_account_menu_hides_gated_items", async () => {
    const menu = await openSheetAccountMenu(true);
    // Menu is really open and populated (not vacuous).
    expect(menu.getByText("Sign out")).toBeInTheDocument();
    for (const label of GATED) expect(menu.queryByText(label)).toBeNull();
  });

  it("test_SB_006_non_guest_sheet_account_menu_shows_gated_items_control", async () => {
    const menu = await openSheetAccountMenu(false);
    for (const label of GATED) expect(menu.getByText(label)).toBeInTheDocument();
  });

  it("test_SB_006_guest_sheet_nav_tree_hides_gated_links", () => {
    render(createElement(AppSidebar, { ...base, isGuest: true }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = within(screen.getByRole("dialog"));
    for (const name of [/^Team$/, /^Members$/, /^Settings$/, /approvals/i, /client requests|requests/i]) {
      expect(dialog.queryByRole("link", { name })).toBeNull();
    }
    // Control: the same query finds Team for a non-guest, so absence is meaningful.
    cleanup();
    render(createElement(AppSidebar, { ...base, isGuest: false }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /^Team$/ })).toBeInTheDocument();
  });
});
