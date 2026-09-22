// @vitest-environment jsdom
//
// F052 (M4 scrutiny FU-M4-5): "Approvals" and "Client requests" now live at
// `/w/<slug>/inbox?tab=approvals` / `?tab=requests` rather than their own
// route. The sidebar's active-state check used to compare only `pathname`,
// which never contains the query string, so these two items could never
// highlight (`bg-accent`) nor receive `aria-current="page"` even while the
// user was actually looking at that exact tab. This test drives the active
// check with the real (mocked) `useSearchParams` value per case, so it fails
// if the pathname-only comparison is reintroduced.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));

// F001 (SB-010): "Approvals"/"Client requests" only render when the
// workspace has a client — the sidebar reads this from useMembership().
vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ hasClient: true }),
}));

let mockPathname = "/w/acme/inbox";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
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
  isGuest: false,
};

function renderAt(pathname: string, search: string) {
  mockPathname = pathname;
  mockSearchParams = new URLSearchParams(search);
  render(createElement(AppSidebar, baseProps));
}

describe("F052 (SB-056): sidebar active-state honours the tab search param", () => {
  it("highlights 'Approvals' and sets aria-current when on /inbox?tab=approvals", () => {
    renderAt("/w/acme/inbox", "?tab=approvals");

    const links = screen.getAllByText("Approvals").map((el) => el.closest("a")!);
    const link = links[0];
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toMatch(/bg-accent text-foreground/);
  });

  it("does NOT highlight 'Approvals' when on /inbox?tab=requests (different tab, same path)", () => {
    renderAt("/w/acme/inbox", "?tab=requests");

    const links = screen.getAllByText("Approvals").map((el) => el.closest("a")!);
    const link = links[0];
    expect(link).not.toHaveAttribute("aria-current");
    expect(link.className).not.toMatch(/bg-accent text-foreground/);
  });

  it("highlights 'Client requests' and sets aria-current when on /inbox?tab=requests", () => {
    renderAt("/w/acme/inbox", "?tab=requests");

    const links = screen.getAllByText("Client requests").map((el) => el.closest("a")!);
    const link = links[0];
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toMatch(/bg-accent text-foreground/);
  });

  it("does NOT highlight 'Client requests' when on /inbox?tab=approvals (different tab, same path)", () => {
    renderAt("/w/acme/inbox", "?tab=approvals");

    const links = screen.getAllByText("Client requests").map((el) => el.closest("a")!);
    const link = links[0];
    expect(link).not.toHaveAttribute("aria-current");
    expect(link.className).not.toMatch(/bg-accent text-foreground/);
  });

  it("does NOT highlight 'Client requests' when on /inbox with no tab param at all", () => {
    renderAt("/w/acme/inbox", "");

    const links = screen.getAllByText("Client requests").map((el) => el.closest("a")!);
    const link = links[0];
    expect(link).not.toHaveAttribute("aria-current");
  });

  // FU-M4-11 (M4 scrutiny attempt 2, SB-056): "Inbox" (tab-less href) used to
  // stay active on `pathMatches` alone, so it lit up alongside "Approvals" or
  // "Client requests" whenever the URL shared its `/inbox` path but carried a
  // sibling's own `?tab=` value -- two `aria-current="page"` links at once.
  // Exactly one sidebar link must carry `aria-current="page"` for each of
  // these three URLs.
  it.each([
    ["/inbox", "", "Inbox"],
    ["/inbox", "?tab=approvals", "Approvals"],
    ["/inbox", "?tab=requests", "Client requests"],
  ])("exactly one link is aria-current='page' for /w/acme%s%s (expected: %s)", (path, search, expectedLabel) => {
    renderAt(`/w/acme${path}`, search);

    const current = document.querySelectorAll('a[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0]).toHaveTextContent(expectedLabel);
  });
});
