// @vitest-environment jsdom
//
// F060 (SB-056): exactly one sidebar link carries `aria-current="page"` for
// EVERY `?tab=` value the Inbox page supports (all, notifications,
// approvals, requests, watching), including the two tabs (notifications,
// watching) that have no dedicated sidebar item of their own. F058 made
// "Inbox" (tab-less) inactive whenever a sibling item's own `hrefTab`
// matched the current tab, but that over-corrected: for `notifications`/
// `watching`, no sibling item claims the tab at all, so nothing lit up.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import "@testing-library/jest-dom/vitest";

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

describe("F060 (SB-056): exactly one aria-current='page' link for every ?tab= value", () => {
  it.each([
    ["", "Inbox"],
    ["?tab=all", "Inbox"],
    ["?tab=notifications", "Inbox"],
    ["?tab=approvals", "Approvals"],
    ["?tab=requests", "Client requests"],
    ["?tab=watching", "Inbox"],
  ])("exactly one aria-current='page' link for /w/acme/inbox%s (expected: %s)", (search, expectedLabel) => {
    renderAt("/w/acme/inbox", search);

    const current = document.querySelectorAll('a[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0]).toHaveTextContent(expectedLabel);
  });

  it("bare /inbox (no query string at all) also has exactly one aria-current='page' link, on Inbox", () => {
    renderAt("/w/acme/inbox", "");

    const current = screen.getAllByRole("link").filter((el) => el.getAttribute("aria-current") === "page");
    expect(current.length).toBe(1);
    expect(current[0]).toHaveTextContent("Inbox");
  });

  it("test_SB_056_notifications_tab_activates_Inbox_not_nothing (no sibling item claims 'notifications')", () => {
    renderAt("/w/acme/inbox", "?tab=notifications");

    const inboxLinks = screen.getAllByText("Inbox").map((el) => el.closest("a")!);
    expect(inboxLinks[0]).toHaveAttribute("aria-current", "page");
  });

  it("test_SB_056_watching_tab_activates_Inbox_not_nothing (no sibling item claims 'watching')", () => {
    renderAt("/w/acme/inbox", "?tab=watching");

    const inboxLinks = screen.getAllByText("Inbox").map((el) => el.closest("a")!);
    expect(inboxLinks[0]).toHaveAttribute("aria-current", "page");
  });
});
