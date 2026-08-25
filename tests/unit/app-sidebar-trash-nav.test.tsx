import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F188 (AS-343..352): the sidebar's "Trash" nav item is gated to
// non-guests, same pattern as "Archive" (F142) and "Templates" (F183) —
// see tests/unit/app-sidebar-archive-nav.test.tsx for the established
// test shape this file follows.
// F262: AppSidebar now conditionally mounts NewProjectDialog (a Client
// Component using useRouter) inside its "Projects" section's empty state
// when no projects are passed in (the default here) — useRouter must be
// mocked alongside usePathname now, or that mount throws.
vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("AppSidebar trash nav item (F188)", () => {
  it("test_AS_343_renders_a_trash_link_for_a_non_guest_member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain("Trash");
    expect(html).toContain('href="/w/acme/trash"');
  });

  it("test_AS_352_does_not_render_a_trash_link_for_a_guest", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).not.toContain('href="/w/acme/trash"');
  });
});
