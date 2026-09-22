// @vitest-environment jsdom
//
// F013 (SB-057): after this feature, no sidebar item "Watching" exists —
// it is absorbed into the Inbox tabs.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test", email: "t@example.com", avatarUrl: null },
  isGuest: false,
  canManageWorkspace: true,
};

describe("SB-057: Watching removed from sidebar", () => {
  it("test_SB_057_no_watching_link_in_sidebar_for_member", () => {
    const html = renderToStaticMarkup(createElement(AppSidebar, baseProps));
    expect(html).not.toContain('href="/w/acme/watching"');
    expect(html).not.toContain(">Watching<");
  });

  it("test_SB_057_no_watching_link_in_sidebar_for_guest", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );
    expect(html).not.toContain('href="/w/acme/watching"');
    expect(html).not.toContain(">Watching<");
  });
});
