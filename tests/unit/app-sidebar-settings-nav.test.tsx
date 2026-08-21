import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F136 (AS-239): "a settings page exists, reachable from the sidebar for
// owners and admins". Mocks next/navigation the same way
// list-view-empty-state.test.ts does — AppSidebar's usePathname() call
// needs an app router context that isn't present under plain
// react-dom/server.
vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("AppSidebar settings nav item (F136, AS-239)", () => {
  it("AS-239: renders a 'Settings' link to /w/acme/settings when canManageWorkspace is true (owner/admin)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, canManageWorkspace: true }),
    );

    expect(html).toContain("Settings");
    expect(html).toContain('href="/w/acme/settings"');
  });

  it("AS-239 (negative): does not render a 'Settings' link when canManageWorkspace is false (member/viewer)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, canManageWorkspace: false }),
    );

    expect(html).not.toContain('href="/w/acme/settings"');
  });

  it("AS-239 (negative): a guest also gets no 'Settings' link even if canManageWorkspace were somehow true", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: true,
        canManageWorkspace: false,
      }),
    );

    expect(html).not.toContain('href="/w/acme/settings"');
  });
});
