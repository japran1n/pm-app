import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F241: the sidebar's "Calendar" nav item is visible to everyone
// including guests (unlike Members/Archive/Templates/Trash), since the
// page doesn't gate guests server-side -- see
// tests/unit/app-sidebar-archive-nav.test.tsx for the established test
// shape this file follows for the gated case, and
// tests/unit/app-sidebar-trash-nav.test.tsx likewise.
//
// Timeline was removed entirely (dedicated feature request) -- its nav
// item, route, and dedicated components/queries no longer exist, so its
// assertions were dropped from this file rather than left pointing at
// dead code.

// F262: AppSidebar now conditionally mounts NewProjectDialog (a Client
// Component using useRouter) inside its "Projects" section's empty state
// when no projects are passed in (the default here) — useRouter must be
// mocked alongside usePathname now, or that mount throws.
vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/calendar",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("AppSidebar calendar nav item (F241)", () => {
  it("renders a 'Calendar' link to /w/acme/calendar for a non-guest member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    // UI polish: the sidebar label was renamed "Calendar" -> "Planner"
    // (the route/href are unchanged).
    expect(html).toContain("Planner");
    expect(html).toContain('href="/w/acme/calendar"');
  });

  it("renders a 'Calendar' link for a guest (workspace-wide, no guest gate)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).toContain('href="/w/acme/calendar"');
  });

  it("marks the Calendar link active when on /w/acme/calendar (prefix match)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    // The active link carries aria-current="page"; assert it's on the
    // Calendar anchor specifically by checking the surrounding markup
    // contains both the href and aria-current together.
    expect(html).toMatch(
      /aria-current="page"[^>]*href="\/w\/acme\/calendar"/,
    );
  });

  it("no longer renders a 'Timeline' nav item (feature removed)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).not.toContain('href="/w/acme/timeline"');
  });
});
