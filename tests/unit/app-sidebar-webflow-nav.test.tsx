import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F003 (AS-001, AS-005, AS-006, AS-007, AS-127): the sidebar's "Webflow" nav
// item links to the converter tool page (F002). Same test shape as
// tests/unit/app-sidebar-archive-nav.test.tsx.
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

describe("AppSidebar Webflow nav item (F003)", () => {
  it("AS-001/AS-005: renders a 'Webflow' link to /w/acme/tools/webflow for a non-guest member", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain("Webflow");
    expect(html).toContain('href="/w/acme/tools/webflow"');
  });

  it("AS-006: highlights the Webflow link as active when the current route is under /tools/webflow", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      usePathname: () => "/w/acme/tools/webflow",
      useRouter: () => ({ push: () => {}, refresh: () => {} }),
    }));
    const { AppSidebar: FreshAppSidebar } = await import("@/components/nav/app-sidebar");

    const html = renderToStaticMarkup(
      createElement(FreshAppSidebar, { ...baseProps, isGuest: false }),
    );

    // The active link carries aria-current="page" and the active styling class.
    const linkMatch = html.match(
      /<a[^>]*href="\/w\/acme\/tools\/webflow"[^>]*>/,
    );
    expect(linkMatch).not.toBeNull();
    expect(linkMatch?.[0]).toContain('aria-current="page"');
    expect(linkMatch?.[0]).toContain("bg-accent");
  });

  it("AS-007: still renders the Webflow link for a guest (no per-workspace/role gating)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).toContain('href="/w/acme/tools/webflow"');
  });

  it("AS-127: the Webflow link uses the same token-based classes (text-muted-foreground / bg-accent) as sibling nav items, holding contrast in both themes", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    const linkMatch = html.match(
      /<a[^>]*href="\/w\/acme\/tools\/webflow"[^>]*>/,
    );
    expect(linkMatch).not.toBeNull();
    // Inactive state relies on the same semantic tokens as Dashboard/Chat/etc.
    // rather than a hardcoded color, so it resolves correctly in both themes.
    expect(linkMatch?.[0]).toContain("text-muted-foreground");
  });
});
