// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => createElement("div"),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const props = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "T", email: "t@example.com", avatarUrl: null },
  isGuest: false,
  canManageWorkspace: true,
  // F045 (SB-042 boundary fix): 0 favourites + 0 recognised recent visits
  // now always renders the section's own empty state (see
  // project-nav-list.tsx's own `isTrueEmptyRecents` comment), so this
  // fixture needs `isFavorite: true` to keep rendering an actual project
  // row -- this file's own focus is the mobile Sheet nav tree, not that
  // boundary (covered by
  // tests/unit/f045-project-nav-empty-state-boundary.test.tsx).
  projects: [
    { id: "p1", name: "Apollo Launch", slug: "apollo", isFavorite: true },
  ] as never,
};

const origWidth = window.innerWidth;
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true, writable: true });
  window.dispatchEvent(new Event("resize"));
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { value: origWidth, configurable: true, writable: true });
});

describe("SB-009: mobile nav Sheet at 375px", () => {
  it("test_SB_009_hamburger_opens_sheet_with_full_nav_tree", () => {
    render(createElement(AppSidebar, props));
    // Closed: the Sheet content is not mounted at all.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = within(screen.getByRole("dialog"));

    // Primary work band
    for (const name of ["Dashboard", "My Tasks", "Watching"]) {
      expect(dialog.getByRole("link", { name: new RegExp(name, "i") })).toBeInTheDocument();
    }
    // Plan and Team groups
    expect(dialog.getByText("Plan")).toBeInTheDocument();
    expect(dialog.getAllByRole("link", { name: /^Team$/i }).length).toBe(1);
    // Collapsible Tools group
    const tools = dialog.getAllByRole("button", { name: /tools/i }).find((b) => b.hasAttribute("aria-expanded"));
    expect(tools).toBeTruthy();
    // Projects section
    expect(dialog.getAllByText(/projects/i).length).toBeGreaterThan(0);
    expect(dialog.getByRole("link", { name: /apollo launch/i })).toBeInTheDocument();
    // Account-menu trigger
    expect(dialog.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });
});
