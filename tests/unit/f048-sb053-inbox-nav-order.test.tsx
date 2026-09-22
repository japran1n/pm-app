// @vitest-environment jsdom
//
// F048 (SB-053, scrutiny FU-M4-1): "Inbox" must be the *first* item of the
// unlabeled primary nav group (`work`), not merely present anywhere in the
// sidebar. Prior coverage (f014-sb053-sb054-sb055-inbox-badge.test.ts) only
// exercised the badge-sum helper and never rendered the sidebar at all, so
// this ordering regression shipped undetected. This test asserts on the
// accessible name of the *first* rendered nav link within the primary
// unlabeled group, for owner, member and guest roles — it fails if Inbox is
// moved back down (e.g. to its previous last-of-five position) regardless
// of whether it's still present somewhere else in the DOM.
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "member", hasClient: true, projectRoles: {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

function firstPrimaryNavLinkName() {
  const nav = document.querySelector('[data-tour="sidebar-nav"]');
  if (!nav) throw new Error("primary nav not found");
  const links = within(nav as HTMLElement).getAllByRole("link");
  // The primary (unlabeled) group is the first group rendered, so its
  // items are the first links in the nav regardless of which later,
  // labeled groups (Tools/Plan/Team/Other) exist.
  return links[0].textContent?.trim();
}

describe("SB-053: Inbox is the first item of the primary nav group", () => {
  it("test_SB_053_inbox_is_first_primary_nav_link_for_owner", () => {
    render(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: false,
        canManageWorkspace: true,
      }),
    );
    expect(firstPrimaryNavLinkName()).toBe("Inbox");
  });

  it("test_SB_053_inbox_is_first_primary_nav_link_for_member", () => {
    render(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: false,
        canManageWorkspace: false,
      }),
    );
    expect(firstPrimaryNavLinkName()).toBe("Inbox");
  });

  it("test_SB_053_inbox_is_first_primary_nav_link_for_guest", () => {
    render(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: true,
        canManageWorkspace: false,
      }),
    );
    expect(firstPrimaryNavLinkName()).toBe("Inbox");
  });

  it("test_SB_053_inbox_is_not_the_last_of_five_primary_items (regression guard)", () => {
    render(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: false,
        canManageWorkspace: true,
      }),
    );
    const nav = document.querySelector('[data-tour="sidebar-nav"]') as HTMLElement;
    const names = within(nav).getAllByRole("link").slice(0, 5).map((l) => l.textContent?.trim());
    // Old (broken) order was Dashboard, My Tasks, Projects, Chat, Inbox.
    expect(names).not.toEqual(["Dashboard", "My Tasks", "Projects", "Chat", "Inbox"]);
    expect(names[0]).toBe("Inbox");
  });
});
