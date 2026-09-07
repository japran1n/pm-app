import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Feature request (sidebar unread badges): "Chat" carries an unread-count
// badge, same shape and same test convention as
// tests/unit/f083-app-sidebar-requests-badge.test.tsx's "Client requests"
// badge.
vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "member", hasClient: false, projectRoles: {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
  isGuest: false,
};

describe("AppSidebar 'Chat' unread badge", () => {
  it("renders a count badge next to 'Chat' when chatUnreadCount > 0", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, chatUnreadCount: 5 }),
    );

    expect(html).toContain("Chat");
    const afterLabel = html.slice(html.indexOf(">Chat<"));
    const beforeNextItem = afterLabel.slice(0, afterLabel.indexOf("Projects") === -1 ? undefined : 400);
    expect(beforeNextItem).toMatch(/5/);
  });

  it("renders no badge next to 'Chat' when chatUnreadCount is 0", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, chatUnreadCount: 0 }),
    );

    const afterLabel = html.slice(html.indexOf(">Chat<"));
    const beforeNextGroup = afterLabel.slice(0, 400);
    expect(beforeNextGroup).not.toMatch(/>\d+</);
  });

  it("defaults chatUnreadCount to 0 (no badge) when the prop is omitted", () => {
    const html = renderToStaticMarkup(createElement(AppSidebar, baseProps));

    const afterLabel = html.slice(html.indexOf(">Chat<"));
    const beforeNextGroup = afterLabel.slice(0, 400);
    expect(beforeNextGroup).not.toMatch(/>\d+</);
  });
});
