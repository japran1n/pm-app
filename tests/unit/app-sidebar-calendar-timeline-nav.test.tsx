import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F241: the sidebar's "Calendar" and "Timeline" nav items are visible to
// everyone including guests (unlike Members/Archive/Templates/Trash),
// since neither page gates guests server-side -- see
// tests/unit/app-sidebar-archive-nav.test.tsx for the established test
// shape this file follows for the gated case, and
// tests/unit/app-sidebar-trash-nav.test.tsx likewise.

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/calendar",
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("AppSidebar calendar/timeline nav items (F241)", () => {
  it("renders a 'Calendar' link to /w/acme/calendar for a non-guest member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain("Calendar");
    expect(html).toContain('href="/w/acme/calendar"');
  });

  it("renders a 'Timeline' link to /w/acme/timeline for a non-guest member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain("Timeline");
    expect(html).toContain('href="/w/acme/timeline"');
  });

  it("renders a 'Calendar' link for a guest (workspace-wide, no guest gate)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).toContain('href="/w/acme/calendar"');
  });

  it("renders a 'Timeline' link for a guest (workspace-wide, no guest gate)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).toContain('href="/w/acme/timeline"');
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
});
