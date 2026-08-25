import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F142: the sidebar's "Archive" nav item is gated to non-guests, same
// pattern as "Members" (F134) and "Settings" (F136) — see
// tests/unit/app-sidebar-settings-nav.test.tsx for the established test
// shape this file follows.
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

describe("AppSidebar archive nav item (F142)", () => {
  it("renders an 'Archive' link to /w/acme/archive for a non-guest member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain("Archive");
    expect(html).toContain('href="/w/acme/archive"');
  });

  it("does not render an 'Archive' link for a guest", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).not.toContain('href="/w/acme/archive"');
  });
});
