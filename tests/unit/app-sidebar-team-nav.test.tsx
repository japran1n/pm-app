import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Team directory nav item: gated to non-guests, same convention as
// Members/Archive/Settings — see app-sidebar-archive-nav.test.tsx for the
// established test shape this file follows.
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

describe("AppSidebar team nav item", () => {
  it("renders a 'Team' link to /w/acme/team for a non-guest member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain("Team");
    expect(html).toContain('href="/w/acme/team"');
  });

  it("does not render a 'Team' link for a guest", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).not.toContain('href="/w/acme/team"');
  });
});
